import { assertEquals, assertRejects } from "jsr:@std/assert";
import { verifySlipImage } from "./easyslip.ts";

// รูปแบบ response ตามเอกสาร EasySlip v1 (ตรวจกับของจริงอีกครั้งในเฟส 5)
const easyslipOk = {
  status: 200,
  data: {
    transRef: "REF777",
    date: "2026-06-10T11:55:00+07:00",
    amount: { amount: 165 },
    receiver: {
      account: { name: { th: "ร้านกะเพรา" }, proxy: { type: "MSISDN", account: "081-xxx-5678" } },
    },
  },
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(new Response(JSON.stringify(body), { status })) as ReturnType<typeof fetch>;
}

Deno.test("แปลง response สำเร็จเป็น SlipData", async () => {
  const s = await verifySlipImage("base64img", "TOKEN", fakeFetch(200, easyslipOk));
  assertEquals(s.transRef, "REF777");
  assertEquals(s.amount, 165);
  assertEquals(s.receiverProxy, "081-xxx-5678");
  assertEquals(s.receiverName, "ร้านกะเพรา");
});

Deno.test("EasySlip ตอบ error → โยน SLIP_UNREADABLE", async () => {
  await assertRejects(
    () => verifySlipImage("junk", "TOKEN", fakeFetch(400, { status: 400, message: "invalid_image" })),
    Error,
    "SLIP_UNREADABLE",
  );
});

Deno.test("date ไม่มี timezone offset → SLIP_UNREADABLE (กัน edge runtime ตีความเป็น UTC)", async () => {
  const noTz = { ...easyslipOk, data: { ...easyslipOk.data, date: "2026-06-10T11:55:00" } };
  await assertRejects(() => verifySlipImage("img", "TOKEN", fakeFetch(200, noTz)), Error, "SLIP_UNREADABLE");
});
