import { assertStringIncludes } from "jsr:@std/assert";
import { msgNewOrderForShop, msgAccepted, msgReady, msgRejected, msgRefunded } from "./messages.ts";

const order = {
  order_no: 12,
  pickup_type: "ASAP" as const,
  pickup_time: null,
  total: 165,
  items: [
    { nameSnapshot: "กะเพราไฟลุก", qty: 2, options: [{ group: "เนื้อสัตว์", name: "เนื้อ", price_delta: 10 }], note: "ไม่ใส่ถั่ว" },
    { nameSnapshot: "ชาเย็น", qty: 1, options: [], note: undefined },
  ],
};

Deno.test("ข้อความแจ้งร้าน มีเลขออเดอร์ รายการ ตัวเลือก โน้ต และยอด", () => {
  const m = msgNewOrderForShop(order);
  assertStringIncludes(m, "#12");
  assertStringIncludes(m, "กะเพราไฟลุก x2");
  assertStringIncludes(m, "เนื้อ");
  assertStringIncludes(m, "ไม่ใส่ถั่ว");
  assertStringIncludes(m, "165");
  assertStringIncludes(m, "รับเลย");
});

Deno.test("ออเดอร์จองเวลา แสดงเวลารับเป็นเวลาไทย", () => {
  const m = msgNewOrderForShop({ ...order, pickup_type: "SCHEDULED", pickup_time: "2026-06-10T12:30:00+07:00" });
  assertStringIncludes(m, "12:30");
});

Deno.test("ข้อความฝั่งลูกค้า ครบทุกสถานะ", () => {
  assertStringIncludes(msgAccepted(12, 15), "#12");
  assertStringIncludes(msgAccepted(12, 15), "15 นาที");
  assertStringIncludes(msgReady(12), "เสร็จแล้ว");
  assertStringIncludes(msgRejected(12, "วัตถุดิบหมด"), "วัตถุดิบหมด");
  assertStringIncludes(msgRefunded(12), "คืนเงิน");
});
