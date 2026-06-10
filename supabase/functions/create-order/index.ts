import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errorResponse, HttpError, json } from "../_shared/http.ts";
import { resolveLineUser } from "../_shared/line.ts";
import {
  type CartItem,
  type MenuIndex,
  priceOrder,
  PricingError,
} from "../_shared/pricing.ts";
import { promptPayPayload } from "../_shared/promptpay.ts";

type Body = {
  idToken: string;
  items: CartItem[];
  pickup_type: "ASAP" | "SCHEDULED";
  pickup_time?: string;
  phone?: string;
};

function nowBangkok(): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" })
    .format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { date, time };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body: Body = await req.json();
    if (!body.idToken || !Array.isArray(body.items)) {
      throw new HttpError(400, "BAD_REQUEST");
    }
    if (body.pickup_type === "SCHEDULED" && !body.pickup_time) {
      throw new HttpError(400, "PICKUP_TIME_REQUIRED");
    }
    if (body.items.length > 20) throw new HttpError(400, "TOO_MANY_ITEMS");
    if (body.pickup_time) {
      const pt = Date.parse(body.pickup_time);
      if (Number.isNaN(pt)) throw new HttpError(400, "PICKUP_TIME_INVALID");
      const now = Date.now();
      // กันเวลาย้อนหลัง (เผื่อ clock skew 5 นาที) และจองล่วงหน้าได้ไม่เกิน 2 วัน
      if (pt < now - 5 * 60 * 1000 || pt > now + 2 * 24 * 60 * 60 * 1000) {
        throw new HttpError(400, "PICKUP_TIME_INVALID");
      }
    }
    for (const it of body.items) {
      if (it.note && it.note.length > 200) {
        throw new HttpError(400, "NOTE_TOO_LONG");
      }
    }

    const profile = await resolveLineUser(body.idToken);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) ร้านเปิดรับอยู่ไหม
    const { data: settings, error: se } = await db.from("shop_settings").select(
      "*",
    ).eq("id", 1).single();
    if (se) throw se;
    const { date, time } = nowBangkok();
    if (!settings.is_accepting) throw new HttpError(409, "SHOP_CLOSED");
    if (
      time < settings.open_time.slice(0, 5) ||
      time >= settings.close_time.slice(0, 5)
    ) {
      throw new HttpError(409, "OUTSIDE_HOURS");
    }

    // 2) โหลดเมนูเฉพาะที่สั่ง สร้าง MenuIndex แล้วคิดราคาฝั่ง server
    const itemIds = [...new Set(body.items.map((i) => i.menuItemId))];
    const [{ data: items, error: me1 }, { data: links, error: me2 }] = await Promise.all([
      db.from("menu_items").select("id,name,base_price,is_available").in("id", itemIds),
      db.from("menu_item_option_groups").select("menu_item_id,option_group_id").in("menu_item_id", itemIds),
    ]);
    if (me1 || me2) throw (me1 ?? me2);

    const groupIds = [...new Set((links ?? []).map((l) => l.option_group_id))];
    const [{ data: groups, error: me3 }, { data: options, error: me4 }] = await Promise.all([
      db.from("option_groups").select("id,name,is_required,max_select").in("id", groupIds),
      db.from("option_items").select("id,group_id,name,price_delta,is_available").in("group_id", groupIds),
    ]);
    if (me3 || me4) throw (me3 ?? me4);

    const menu: MenuIndex = {
      items: Object.fromEntries((items ?? []).map((m) => [m.id, {
        name: m.name,
        basePrice: Number(m.base_price),
        isAvailable: m.is_available,
        groupIds: (links ?? []).filter((l) => l.menu_item_id === m.id).map((l) => l.option_group_id),
      }])),
      groups: Object.fromEntries((groups ?? []).map((g) => [g.id, {
        name: g.name,
        isRequired: g.is_required,
        maxSelect: g.max_select,
      }])),
      options: Object.fromEntries((options ?? []).map((o) => [o.id, {
        groupId: o.group_id,
        name: o.name,
        priceDelta: Number(o.price_delta),
        isAvailable: o.is_available,
      }])),
    };
    const priced = priceOrder(body.items, menu);

    // 3) upsert ลูกค้า + ออกเลขออเดอร์ + insert
    const { error: ce } = await db.from("customers").upsert({
      line_user_id: profile.sub,
      display_name: profile.name,
      ...(body.phone ? { phone: body.phone } : {}),
    });
    if (ce) throw ce;

    const { data: orderNo, error: ne } = await db.rpc("next_order_no", { d: date });
    if (ne) throw ne;
    const qr = promptPayPayload(settings.promptpay_id, priced.total);

    const { data: order, error: oe } = await db.from("orders").insert({
      order_date: date,
      order_no: orderNo,
      customer_id: profile.sub,
      pickup_type: body.pickup_type,
      pickup_time: body.pickup_time ?? null,
      total: priced.total,
      qr_payload: qr,
      promptpay_id: settings.promptpay_id,
    }).select("id,order_no,total,created_at").single();
    if (oe) throw oe;

    const { error: ie } = await db.from("order_items").insert(
      priced.items.map((i) => ({
        order_id: order.id,
        menu_item_id: i.menuItemId,
        name_snapshot: i.nameSnapshot,
        qty: i.qty,
        unit_price: i.unitPrice,
        options: i.options,
        note: i.note ?? null,
        line_total: i.lineTotal,
      })),
    );
    if (ie) {
      // สองสเต็ปนี้ไม่ได้อยู่ใน transaction เดียวกัน: ถ้า insert รายการล้มเหลว
      // ลบหัวออเดอร์ทิ้งทันที กันออเดอร์กำพร้าที่ลูกค้าจ่ายได้แต่ครัวไม่เห็นรายการ
      // (ความเสี่ยงคงเหลือ: delete ล้มเหลวซ้อนอีกชั้น → ออเดอร์ค้าง PENDING_PAYMENT
      // และโดน expiry cron เก็บภายใน 15 นาที — ยอมรับได้ที่สเกลร้านเดียว)
      await db.from("orders").delete().eq("id", order.id);
      throw ie;
    }

    return json({
      order_id: order.id,
      order_no: order.order_no,
      total: Number(order.total),
      qr_payload: qr,
      payment_timeout_minutes: settings.payment_timeout_minutes,
    });
  } catch (e) {
    if (e instanceof PricingError) return json({ error: e.code }, 422);
    return errorResponse(e);
  }
});
