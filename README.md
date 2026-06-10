# ระบบสั่งอาหารล่วงหน้า — กะเพราไฟลุก by MEAL TEAory

สั่งผ่าน LINE (LIFF) → จ่าย PromptPay → ตรวจสลิปอัตโนมัติ → ปริ้นเข้าครัว → มารับที่ร้าน

- [System Design](docs/superpowers/specs/2026-06-10-dorm-order-system-design.md)
- [Roadmap](docs/superpowers/plans/2026-06-10-roadmap.md)

## Dev

```bash
supabase start          # local stack (ต้องมี Docker)
deno task test          # unit tests
supabase functions serve --env-file supabase/functions/.env
./scripts/smoke.sh      # end-to-end กับ local stack
```
