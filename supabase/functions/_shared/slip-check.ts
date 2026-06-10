export type SlipData = {
  transRef: string;
  amount: number;            // บาท
  receiverProxy?: string;    // เบอร์/เลขพร้อมเพย์ผู้รับ (อาจถูก mask เช่น 081-xxx-5678)
  receiverName?: string;
  transDate: string;         // ISO
};

export type SlipCheck =
  | { ok: true }
  | { ok: false; reason: "AMOUNT_MISMATCH" | "WRONG_RECEIVER" | "SLIP_TOO_OLD" };

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

// เทียบ proxy แบบทน mask: ตัดทุกอย่างที่ไม่ใช่ตัวเลข/x แล้วเทียบตำแหน่งที่เป็นตัวเลขทั้งคู่
function proxyMatches(masked: string, full: string): boolean {
  const m = masked.replace(/[^0-9xX*]/g, "").toLowerCase();  // บางธนาคาร mask ด้วย * แทน x
  const f = full.replace(/\D/g, "");
  if (m.length !== f.length) return false;
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== "x" && m[i] !== "*" && m[i] !== f[i]) return false;
  }
  return true;
}

export function checkSlip(
  slip: SlipData,
  order: { total: number },
  shopPromptpayId: string,
  now: Date = new Date(),
): SlipCheck {
  const t = new Date(slip.transDate).getTime();
  if (isNaN(t) || now.getTime() - t > MAX_AGE_MS || t - now.getTime() > FUTURE_TOLERANCE_MS) {
    return { ok: false, reason: "SLIP_TOO_OLD" };
  }
  if (slip.amount < order.total) return { ok: false, reason: "AMOUNT_MISMATCH" };
  if (slip.receiverProxy && !proxyMatches(slip.receiverProxy, shopPromptpayId)) {
    return { ok: false, reason: "WRONG_RECEIVER" };
  }
  return { ok: true };
}
