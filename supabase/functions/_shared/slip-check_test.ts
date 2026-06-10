import { assertEquals } from "jsr:@std/assert";
import { checkSlip, type SlipData } from "./slip-check.ts";

const NOW = new Date("2026-06-10T12:00:00+07:00");
const base: SlipData = {
  transRef: "REF123",
  amount: 165,
  receiverProxy: "081-xxx-5678",   // ธนาคารมักส่งแบบ mask
  transDate: "2026-06-10T11:55:00+07:00",
};

Deno.test("สลิปถูกต้องทุกอย่าง → ok", () => {
  assertEquals(checkSlip(base, { total: 165 }, "0812345678", NOW), { ok: true });
});

Deno.test("จ่ายเกินยอด → ok (รับไว้ ไม่ต้องวุ่นวาย)", () => {
  assertEquals(checkSlip({ ...base, amount: 200 }, { total: 165 }, "0812345678", NOW), { ok: true });
});

Deno.test("ยอดน้อยกว่าออเดอร์ → AMOUNT_MISMATCH", () => {
  assertEquals(
    checkSlip({ ...base, amount: 100 }, { total: 165 }, "0812345678", NOW),
    { ok: false, reason: "AMOUNT_MISMATCH" },
  );
});

Deno.test("ผู้รับไม่ตรง (เทียบเลขท้ายที่ไม่โดน mask) → WRONG_RECEIVER", () => {
  assertEquals(
    checkSlip({ ...base, receiverProxy: "089-xxx-9999" }, { total: 165 }, "0812345678", NOW),
    { ok: false, reason: "WRONG_RECEIVER" },
  );
});

Deno.test("สลิปเก่ากว่า 24 ชม. หรืออยู่ในอนาคต → SLIP_TOO_OLD", () => {
  assertEquals(
    checkSlip({ ...base, transDate: "2026-06-08T11:00:00+07:00" }, { total: 165 }, "0812345678", NOW),
    { ok: false, reason: "SLIP_TOO_OLD" },
  );
  assertEquals(
    checkSlip({ ...base, transDate: "2026-06-10T13:00:00+07:00" }, { total: 165 }, "0812345678", NOW),
    { ok: false, reason: "SLIP_TOO_OLD" },
  );
});

Deno.test("ธนาคารไม่ส่ง receiverProxy มาเลย → ยอมรับ (ตรวจไม่ได้ ไม่บล็อกลูกค้า)", () => {
  assertEquals(checkSlip({ ...base, receiverProxy: undefined }, { total: 165 }, "0812345678", NOW), { ok: true });
});
