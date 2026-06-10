type MsgItem = {
  nameSnapshot: string;
  qty: number;
  options: { group: string; name: string; price_delta: number }[];
  note?: string | null;
};

export type MsgOrder = {
  order_no: number;
  pickup_type: "ASAP" | "SCHEDULED";
  pickup_time: string | null;
  total: number;
  items: MsgItem[];
};

function pickupLabel(o: Pick<MsgOrder, "pickup_type" | "pickup_time">): string {
  if (o.pickup_type === "ASAP") return "รับเลย";
  if (!o.pickup_time) return "นัดรับ (ไม่ระบุเวลา)";
  const t = new Date(o.pickup_time).toLocaleTimeString("th-TH", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  });
  return `นัดรับ ${t} น.`;
}

export function msgNewOrderForShop(o: MsgOrder): string {
  const lines = o.items.map((i) => {
    const opts = i.options.map((x) => x.name).join(", ");
    const note = i.note ? ` ✏️${i.note}` : "";
    return `• ${i.nameSnapshot} x${i.qty}${opts ? ` (${opts})` : ""}${note}`;
  });
  return [`🔔 ออเดอร์ใหม่ #${o.order_no} — ${pickupLabel(o)}`, ...lines, `รวม ${o.total} บาท (จ่ายแล้ว ✅)`].join("\n");
}

export const msgAccepted = (orderNo: number, estMinutes: number) =>
  `ร้านรับออเดอร์ #${orderNo} แล้วค่ะ 👩‍🍳 อาหารจะเสร็จในประมาณ ${estMinutes} นาที`;

export const msgReady = (orderNo: number) =>
  `ออเดอร์ #${orderNo} เสร็จแล้ว 🍳 มารับที่ร้านได้เลยค่ะ แจ้งเลขออเดอร์กับพนักงานได้เลย`;

export const msgRejected = (orderNo: number, reason: string) =>
  `ขออภัยค่ะ 🙏 ร้านไม่สามารถรับออเดอร์ #${orderNo} ได้ (${reason}) ทางร้านจะโอนเงินคืนเต็มจำนวนโดยเร็วที่สุด`;

export const msgRefunded = (orderNo: number) =>
  `ร้านโอนคืนเงินออเดอร์ #${orderNo} เรียบร้อยแล้วค่ะ ขออภัยในความไม่สะดวก 🙏`;
