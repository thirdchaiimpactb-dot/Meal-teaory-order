import { createClient } from "npm:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";

async function validSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === signature;
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const sig = req.headers.get("x-line-signature") ?? "";
  if (!(await validSignature(raw, sig, Deno.env.get("LINE_CHANNEL_SECRET")!))) {
    return json({ error: "BAD_SIGNATURE" }, 403);
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { events } = JSON.parse(raw);
  for (const ev of events ?? []) {
    // บอทถูกเชิญเข้ากลุ่มร้าน → จำ group id ไว้ใช้แจ้งเตือน (ถ้ายังไม่เคยตั้ง)
    if (ev.type === "join" && ev.source?.type === "group") {
      await db.from("shop_settings")
        .update({ line_group_id: ev.source.groupId })
        .eq("id", 1).is("line_group_id", null);
      console.log(`joined group: ${ev.source.groupId}`);
    }
  }
  return json({ ok: true });
});
