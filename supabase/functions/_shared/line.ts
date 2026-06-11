import { HttpError } from "./http.ts";

export type LineProfile = { sub: string; name?: string; picture?: string };

export async function verifyLineIdToken(
  idToken: string,
  channelId: string,
  fetchFn: typeof fetch = fetch,
): Promise<LineProfile> {
  const res = await fetchFn("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!res.ok) throw new HttpError(401, "INVALID_ID_TOKEN");
  return await res.json();
}

export async function pushText(
  to: string,
  text: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  // การแจ้งเตือนพังต้องไม่ทำให้ flow หลักล้ม — log แล้วไปต่อ
  if (!res.ok) console.error(`LINE push failed: ${res.status} ${await res.text()}`);
}

export async function resolveLineUser(idToken: string, fetchFn: typeof fetch = fetch): Promise<LineProfile> {
  if (Deno.env.get("DEV_BYPASS_LINE") === "1" && idToken.startsWith("dev:")) {
    return { sub: idToken.slice(4), name: "Dev User" };
  }
  return await verifyLineIdToken(idToken, Deno.env.get("LINE_LOGIN_CHANNEL_ID")!, fetchFn);
}

export async function resolveIdentity(idToken: string, phone?: string, fetchFn: typeof fetch = fetch): Promise<LineProfile> {
  if (idToken) return await resolveLineUser(idToken, fetchFn);
  if (phone) return { sub: `phone:${phone.replace(/\D/g, "")}`, name: phone };
  throw new HttpError(400, "IDENTITY_REQUIRED");
}
