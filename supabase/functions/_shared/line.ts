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
