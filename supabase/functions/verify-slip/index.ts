import { createClient } from "npm:@supabase/supabase-js@2";
import { json, errorResponse, HttpError, CORS } from "../_shared/http.ts";
import { resolveIdentity, pushText } from "../_shared/line.ts";
import { verifySlipImage } from "../_shared/easyslip.ts";
import { checkSlip, type SlipData } from "../_shared/slip-check.ts";
import { msgNewOrderForShop } from "../_shared/messages.ts";

type Body = { idToken: string; order_id: string; phone?: string; imageBase64?: string; devSlip?: SlipData };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body: Body = await req.json();
    const profile = await resolveIdentity(body.idToken, body.phone);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: order } = await db.from("orders")
      .select("id,order_no,total,status,customer_id,pickup_type,pickup_time,promptpay_id")
      .eq("id", body.order_id).single();
    if (!order || order.customer_id !== profile.sub) throw new HttpError(404, "ORDER_NOT_FOUND");
    if (order.status !== "PENDING_PAYMENT") throw new HttpError(409, "WRONG_STATUS");

    // อ่านสลิป
    let slip: SlipData;
    let slipPath: string | null = null;
    const dev = Deno.env.get("DEV_BYPASS_LINE") === "1";
    if (dev && body.devSlip) {
      slip = body.devSlip;
    } else {
      if (!body.imageBase64) throw new HttpError(400, "IMAGE_REQUIRED");
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(body.imageBase64), (c) => c.charCodeAt(0));
      } catch {
        throw new HttpError(422, "SLIP_UNREADABLE");
      }
      slipPath = `${order.id}.jpg`;
      const { error: ue } = await db.storage.from("slips").upload(slipPath, bytes, {
        contentType: "image/jpeg", upsert: true,
      });
      if (ue) throw ue;
      try {
        slip = await verifySlipImage(body.imageBase64, Deno.env.get("EASYSLIP_TOKEN")!);
      } catch (e) {
        // อ่านสลิปไม่ออกเป็นเรื่องฝั่งลูกค้า (รูปเบลอ/ไม่ใช่สลิป) → 422 ให้ LIFF บอกให้ถ่ายใหม่
        if (e instanceof Error && e.message === "SLIP_UNREADABLE") {
          throw new HttpError(422, "SLIP_UNREADABLE");
        }
        throw e;
      }
    }

    // ตัดสิน — ใช้ promptpay_id ที่บันทึกไว้ตอนสร้างออเดอร์ ไม่ใช่ค่าปัจจุบันใน settings
    const verdict = checkSlip(slip, { total: Number(order.total) }, order.promptpay_id);
    if (!verdict.ok) return json({ error: verdict.reason }, 422);

    // PAID (unique slip_trans_ref กันสลิปซ้ำ — ชนแล้ว Postgres ตอบ 23505)
    const { data: paidRow, error: pe } = await db.from("orders").update({
      status: "PAID", paid_at: new Date().toISOString(),
      slip_trans_ref: slip.transRef, slip_image_path: slipPath,
    }).eq("id", order.id).eq("status", "PENDING_PAYMENT")
      .select("id").maybeSingle();
    if (pe) {
      if ((pe as { code?: string }).code === "23505") return json({ error: "DUPLICATE_SLIP" }, 422);
      throw pe;
    }
    // 0 แถว = มีคนจ่ายตัดหน้าไปแล้วระหว่างที่เราตรวจ → อย่าตอบ PAID ปลอม
    if (!paidRow) throw new HttpError(409, "WRONG_STATUS");

    // แจ้งกลุ่มร้าน — พังก็ไม่ล้ม flow (pushText จัดการ error ภายในตัวเอง)
    const { data: settings } = await db.from("shop_settings")
      .select("line_group_id").eq("id", 1).single();
    if (settings?.line_group_id) {
      const { data: items } = await db.from("order_items")
        .select("name_snapshot,qty,options,note").eq("order_id", order.id);
      const text = msgNewOrderForShop({
        order_no: order.order_no,
        pickup_type: order.pickup_type,
        pickup_time: order.pickup_time,
        total: Number(order.total),
        items: (items ?? []).map((i) => ({
          nameSnapshot: i.name_snapshot, qty: i.qty, options: i.options, note: i.note,
        })),
      });
      await pushText(settings.line_group_id, text, Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!);
    }

    return json({ ok: true, status: "PAID" });
  } catch (e) {
    return errorResponse(e);
  }
});
