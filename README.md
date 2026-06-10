# ระบบสั่งอาหารล่วงหน้า — กะเพราไฟลุก by MEAL TEAory

สั่งผ่าน LINE (LIFF) → จ่าย PromptPay → ตรวจสลิปอัตโนมัติ → ปริ้นเข้าครัว → มารับที่ร้าน

- [System Design](docs/superpowers/specs/2026-06-10-dorm-order-system-design.md)
- [Roadmap](docs/superpowers/plans/2026-06-10-roadmap.md)

## Dev

```bash
supabase start          # local stack (ต้องมี Docker)
deno task test          # unit tests
supabase functions serve --env-file supabase/functions/.env
ANON_KEY=... SERVICE_ROLE_KEY=... ./scripts/smoke.sh
python3 -m http.server 5173 -d web
```

เปิดเว็บลูกค้าที่ `http://127.0.0.1:5173/` และหน้าร้านที่ `http://127.0.0.1:5173/shop.html`

ครั้งแรกให้กด "ตั้งค่า" แล้วใส่ Supabase URL + anon key จาก `supabase status`

## Web

- `/` ลูกค้า: โหลดเมนู, เลือกตัวเลือก, ส่งออเดอร์ผ่าน `create-order`, แสดง PromptPay QR, อัปโหลดสลิปผ่าน `verify-slip`, ติดตามสถานะผ่าน `get-order`
- `/shop.html` ร้าน: login ด้วย Supabase Auth staff, ดูคิวออเดอร์วันนี้, กดรับ/เสร็จ/รับของ/คืนเงิน, เปิด-ปิดรับออเดอร์, เปิด-ปิดขายรายเมนู

สำหรับทดสอบ local โดยยังไม่ตั้ง LINE LIFF จริง ให้ตั้ง `DEV_BYPASS_LINE=1` ใน `supabase/functions/.env` แล้วใช้ token รูปแบบ `dev:U_demo` ในหน้าลูกค้า

## Smoke Test

1. เปิด Docker/Colima ให้พร้อม
2. รัน `supabase start`
3. ตั้ง `DEV_BYPASS_LINE=1` ใน `supabase/functions/.env`
4. รัน `supabase functions serve --env-file supabase/functions/.env`
5. คัด `ANON_KEY` และ `SERVICE_ROLE_KEY` จาก `supabase status`
6. รัน `ANON_KEY=... SERVICE_ROLE_KEY=... ./scripts/smoke.sh`

ผลที่ต้องได้: `ผ่าน 9 / ตก 0`
