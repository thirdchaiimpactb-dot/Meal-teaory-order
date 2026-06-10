import { assertEquals, assertRejects } from "jsr:@std/assert";
import { verifyLineIdToken, pushText } from "./line.ts";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (_input, _init) =>
    Promise.resolve(new Response(JSON.stringify(body), { status })) as ReturnType<typeof fetch>;
}

Deno.test("verifyLineIdToken: token ดี → ได้ sub/name", async () => {
  const p = await verifyLineIdToken("tok", "chan", fakeFetch(200, { sub: "U123", name: "สมชาย" }));
  assertEquals(p.sub, "U123");
  assertEquals(p.name, "สมชาย");
});

Deno.test("verifyLineIdToken: token เสีย → โยน HttpError 401", async () => {
  await assertRejects(() => verifyLineIdToken("bad", "chan", fakeFetch(400, { error: "invalid" })));
});

Deno.test("pushText: ส่ง body ถูก endpoint ถูก", async () => {
  let captured: { url: string; body: string } | null = null;
  const f: typeof fetch = (input, init) => {
    captured = { url: String(input), body: String(init?.body) };
    return Promise.resolve(new Response("{}", { status: 200 })) as ReturnType<typeof fetch>;
  };
  await pushText("U123", "สวัสดี", "TOKEN", f);
  assertEquals(captured!.url, "https://api.line.me/v2/bot/message/push");
  assertEquals(JSON.parse(captured!.body), { to: "U123", messages: [{ type: "text", text: "สวัสดี" }] });
});
