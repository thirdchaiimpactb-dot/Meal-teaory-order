import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errorResponse, HttpError, json } from "../_shared/http.ts";
import { resolveLineUser } from "../_shared/line.ts";

type Body = { idToken: string; order_id: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body: Body = await req.json();
    if (!body.order_id) throw new HttpError(400, "BAD_REQUEST");

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    let q = db.from("orders")
      .select(
        "id,order_no,pickup_type,pickup_time,status,total,created_at,paid_at,accepted_at,ready_at,completed_at,reject_reason,refunded_at",
      )
      .eq("id", body.order_id);
    if (body.idToken) {
      const profile = await resolveLineUser(body.idToken);
      q = q.eq("customer_id", profile.sub);
    }
    const { data: order, error } = await q.maybeSingle();
    if (error) throw error;
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND");

    const { data: items, error: ie } = await db.from("order_items")
      .select("name_snapshot,qty,unit_price,options,note,line_total")
      .eq("order_id", order.id)
      .order("id", { ascending: true });
    if (ie) throw ie;

    return json({ order, items: items ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
});
