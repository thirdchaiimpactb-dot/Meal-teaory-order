import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errorResponse, HttpError, json } from "../_shared/http.ts";
import { pushText } from "../_shared/line.ts";
import {
  msgAccepted,
  msgReady,
  msgRefunded,
  msgRejected,
} from "../_shared/messages.ts";

type Action =
  | "ACCEPT"
  | "REJECT"
  | "READY"
  | "COMPLETE"
  | "CONFIRM_REFUND"
  | "MANUAL_PAID";

// สถานะที่อนุญาตก่อนทำ action + สถานะปลายทาง + คอลัมน์เวลา
const TRANSITIONS: Record<
  Action,
  { from: string[]; to: string; at: string | null }
> = {
  MANUAL_PAID: { from: ["PENDING_PAYMENT"], to: "PAID", at: "paid_at" },
  ACCEPT: { from: ["PAID"], to: "COOKING", at: "accepted_at" },
  REJECT: { from: ["PAID", "COOKING"], to: "REFUND_PENDING", at: null },
  READY: { from: ["COOKING"], to: "READY", at: "ready_at" },
  COMPLETE: { from: ["READY"], to: "COMPLETED", at: "completed_at" },
  CONFIRM_REFUND: {
    from: ["REFUND_PENDING"],
    to: "REFUNDED",
    at: "refunded_at",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // ยืนยันว่าเป็น staff จริง (JWT แนบมากับ request)
    const auth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" },
        },
      },
    );
    const { data: { user } } = await auth.auth.getUser();
    if (!user) throw new HttpError(401, "UNAUTHORIZED");

    const { order_id, action, reject_reason } = await req.json() as {
      order_id: string;
      action: Action;
      reject_reason?: string;
    };
    const t = TRANSITIONS[action];
    if (!t) throw new HttpError(400, "BAD_ACTION");
    if (action === "REJECT" && !reject_reason) {
      throw new HttpError(400, "REASON_REQUIRED");
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const patch: Record<string, unknown> = { status: t.to };
    if (t.at) patch[t.at] = new Date().toISOString();
    if (action === "REJECT") patch.reject_reason = reject_reason;

    const { data: order, error } = await db.from("orders").update(patch)
      .eq("id", order_id).in("status", t.from)
      .select("order_no,customer_id").maybeSingle();
    if (error) throw error;
    if (!order) throw new HttpError(409, "WRONG_STATUS");

    // push ลูกค้าตามเหตุการณ์ — ปิด ACCEPT push ได้ผ่าน notify_on_accept (ประหยัดโควต้า)
    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
    const { data: s, error: se } = await db.from("shop_settings")
      .select("est_prep_minutes,notify_on_accept").eq("id", 1).single();
    if (se || !s) {
      console.error("shop_settings fetch failed after order transition:", se);
    } else {
      const msg: string | null = action === "ACCEPT"
        ? (s.notify_on_accept ? msgAccepted(order.order_no, s.est_prep_minutes) : null)
        : action === "READY" ? msgReady(order.order_no)
        : action === "REJECT" ? msgRejected(order.order_no, reject_reason!)
        : action === "CONFIRM_REFUND" ? msgRefunded(order.order_no)
        : null;
      if (msg && !order.customer_id.startsWith("U_smoke")) {
        await pushText(order.customer_id, msg, token);
      }
    }

    return json({ ok: true, status: t.to });
  } catch (e) {
    return errorResponse(e);
  }
});
