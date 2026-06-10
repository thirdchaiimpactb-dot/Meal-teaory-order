import { assertEquals, assert } from "jsr:@std/assert";
import { promptPayPayload, crc16 } from "./promptpay.ts";

// แตก payload กลับเป็น TLV เพื่อตรวจโครงสร้าง
function parseTlv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

Deno.test("payload เบอร์มือถือ: โครงสร้างถูก, ยอดถูก, CRC ตรวจซ้ำได้", () => {
  const p = promptPayPayload("0812345678", 125.5);
  const t = parseTlv(p);
  assertEquals(t["00"], "01");          // payload format
  assertEquals(t["01"], "12");          // dynamic QR (ใส่ยอดแล้ว)
  assertEquals(t["53"], "764");         // THB
  assertEquals(t["54"], "125.50");
  assertEquals(t["58"], "TH");
  const merchant = parseTlv(t["29"]);
  assertEquals(merchant["00"], "A000000677010111");
  assertEquals(merchant["01"], "0066812345678");  // ตัด 0 นำ เติม 0066
  assertEquals(t["63"], crc16(p.slice(0, -4)));   // CRC ของทุกอย่างรวม "6304"
});

Deno.test("payload เลขประจำตัว 13 หลัก ใช้ proxy type 02", () => {
  const t = parseTlv(promptPayPayload("1234567890123", 50));
  assertEquals(parseTlv(t["29"])["02"], "1234567890123");
});

Deno.test("ยอดปัดเป็นทศนิยม 2 ตำแหน่งเสมอ", () => {
  const t = parseTlv(promptPayPayload("0812345678", 60));
  assertEquals(t["54"], "60.00");
});
