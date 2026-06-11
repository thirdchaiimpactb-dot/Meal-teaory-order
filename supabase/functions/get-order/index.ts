import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, errorResponse, HttpError, json } from "../_shared/http.ts";
import { resolveLineUser } from "../_shared/line.ts";

type Body = { idToken: string; order_id: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body: Body = await req.json();
    if (!body.idToken || !body.order_id) {
      throw new HttpError(400, "BAD_REQUEST");
    }

    const profile = await resolveLineUser(body.idToken);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: order, error } = await db.from("orders")
      .select(
        "id,order_no,pickup_type,pickup_time,status,total,created_at,paid_at,accepted_at,ready_at,completed_at,reject_reason,refunded_at",
      )
      .eq("id", body.order_id)
      .eq("customer_id", profile.sub)
      .maybeSingle();
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
