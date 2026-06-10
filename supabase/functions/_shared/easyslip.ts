import type { SlipData } from "./slip-check.ts";

// date ต้องมี timezone offset ชัดเจน ไม่งั้น edge runtime (UTC) จะตีความเวลาไทยผิด
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/;

export async function verifySlipImage(
  imageBase64: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<SlipData> {
  const res = await fetchFn("https://developer.easyslip.com/api/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: imageBase64 }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.data?.transRef) throw new Error("SLIP_UNREADABLE");
  const d = body.data;
  if (typeof d.date !== "string" || !HAS_TZ.test(d.date)) throw new Error("SLIP_UNREADABLE");
  return {
    transRef: d.transRef,
    amount: d.amount?.amount ?? 0,
    receiverProxy: d.receiver?.account?.proxy?.account,
    receiverName: d.receiver?.account?.name?.th,
    transDate: d.date,
  };
}
