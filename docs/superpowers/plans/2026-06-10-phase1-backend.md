# Phase 1: Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง backend ครบวงจรบน Supabase สำหรับระบบสั่งอาหารล่วงหน้า — schema, RLS, edge functions (สร้างออเดอร์/ตรวจสลิป/เปลี่ยนสถานะ/LINE webhook), PromptPay QR, แจ้งเตือน LINE และ expiry อัตโนมัติ

**Architecture:** Supabase local stack (CLI) เป็นสนามพัฒนา — migrations เป็น SQL ล้วน, edge functions เป็น Deno TypeScript โดยแยก logic เป็น pure modules ใน `_shared/` (ทดสอบด้วย `deno test` ไม่ต้องพึ่ง network/DB) ส่วน handler เป็นชั้นบางๆ ตรวจสอบด้วย curl กับ local stack ลูกค้า (LIFF) ยืนยันตัวตนด้วย LINE ID token ผ่าน edge function เท่านั้น (ไม่มี Supabase Auth user) ส่วนพนักงานร้านเป็น Supabase Auth user

**Tech Stack:** Supabase CLI + Postgres (pg_cron) + Deno edge functions, LINE Messaging API, EasySlip API, PromptPay EMVCo QR (เขียนเอง ~40 บรรทัด)

**Prerequisites:** ติดตั้ง Supabase CLI (`brew install supabase/tap/supabase`) และ Deno (`brew install deno`), Docker Desktop เปิดอยู่ (local stack ใช้ Docker)

---

## File Structure

```
supabase/
  config.toml                          # สร้างโดย supabase init + ปรับ verify_jwt
  migrations/
    0001_menu.sql                      # ตารางเมนู + RLS อ่านสาธารณะ
    0002_seed_menu.sql                 # เมนูตัวอย่างร้านกะเพรา
    0003_orders.sql                    # customers/orders/order_items/shop_settings/เลขออเดอร์รายวัน/RLS/realtime/slips bucket
    0004_expiry_cron.sql               # pg_cron ตัดออเดอร์ไม่จ่ายใน N นาที
  functions/
    _shared/
      http.ts                          # JSON response helper + HttpError + CORS
      promptpay.ts                     # TLV + CRC16 + payload generator (pure)
      promptpay_test.ts
      pricing.ts                       # คำนวณราคา/validate ตัวเลือก (pure)
      pricing_test.ts
      slip-check.ts                    # ตัดสินสลิปผ่าน/ไม่ผ่าน (pure)
      slip-check_test.ts
      messages.ts                      # ข้อความ LINE ภาษาไทย (pure)
      messages_test.ts
      line.ts                          # verifyIdToken + pushText (fetch injectable)
      line_test.ts
      easyslip.ts                      # เรียก EasySlip + แปลงเป็น SlipData (fetch injectable)
      easyslip_test.ts
    create-order/index.ts              # POST: สร้างออเดอร์ + QR
    verify-slip/index.ts               # POST: อัปสลิป + ตรวจ + PAID + แจ้งร้าน
    update-order-status/index.ts       # POST (staff): รับ/ปฏิเสธ/เสร็จ/รับของ/ยืนยันคืน/ยืนยันสลิปเอง + push ลูกค้า
    line-webhook/index.ts              # รับ event จาก LINE (follow/join group)
scripts/
  smoke.sh                             # ทดสอบ end-to-end กับ local stack
```

ทุก pure module รับ dependency (fetch, เวลา) เป็นพารามิเตอร์ → unit test ได้โดยไม่แตะ network

**Env secrets ของ functions** (ไฟล์ `supabase/functions/.env` — ห้าม commit):

```
LINE_LOGIN_CHANNEL_ID=     # LIFF channel id (ใช้ verify id token)
LINE_CHANNEL_ACCESS_TOKEN= # Messaging API token (push)
LINE_CHANNEL_SECRET=       # ตรวจ webhook signature
EASYSLIP_TOKEN=
```

ระหว่างพัฒนา local ใส่ค่า dummy ได้ (unit tests ไม่ใช้ และ smoke test มีโหมด bypass — ดู Task 12)

---

### Task 0: Scaffold โปรเจกต์

**Files:**
- Create: `supabase/config.toml` (ผ่าน `supabase init`)
- Create: `.gitignore`, `deno.json`, `README.md`

- [ ] **Step 1: สร้างโครง**

```bash
cd "/Users/thirdchaisattayapanich/Documents/Claude/Projects/Dorm Order system"
supabase init
```

Expected: สร้าง `supabase/config.toml`

- [ ] **Step 2: สร้างไฟล์ config พื้นฐาน**

`.gitignore`:
```
.env
supabase/functions/.env
supabase/.temp
node_modules/
.DS_Store
```

`deno.json` (ราก repo — ให้ `deno test` เจอทุก module):
```json
{
  "tasks": {
    "test": "deno test supabase/functions/_shared/"
  },
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

`README.md`:
```markdown
# ระบบสั่งอาหารล่วงหน้า — กะเพราไฟลุก by MEAL TEAory

สั่งผ่าน LINE (LIFF) → จ่าย PromptPay → ตรวจสลิปอัตโนมัติ → ปริ้นเข้าครัว → มารับที่ร้าน

- Spec: `docs/superpowers/specs/2026-06-10-dorm-order-system-design.md`
- Roadmap: `docs/superpowers/plans/2026-06-10-roadmap.md`

## Dev

​```bash
supabase start          # local stack (ต้องมี Docker)
deno task test          # unit tests
supabase functions serve --env-file supabase/functions/.env
./scripts/smoke.sh      # end-to-end กับ local stack
​```
```
(ลบ zero-width ใน code fence ด้านบนตอนสร้างไฟล์จริง — ใส่ไว้กัน fence ชนกันในแผนนี้เท่านั้น)

- [ ] **Step 3: เปิด local stack ตรวจว่า CLI ใช้ได้**

```bash
supabase start
```

Expected: ขึ้น API URL `http://127.0.0.1:54321`, anon key, service_role key (จดไว้ใช้ใน smoke test)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold supabase project"
```

---

### Task 1: Migration เมนู + RLS อ่านสาธารณะ

**Files:**
- Create: `supabase/migrations/0001_menu.sql`

- [ ] **Step 1: เขียน migration**

```sql
-- ตารางเมนูและตัวเลือก: อ่านได้สาธารณะ (LIFF ใช้ anon key) เขียนได้เฉพาะ service role / staff
create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references menu_categories(id) on delete cascade,
  name text not null,
  description text,
  base_price numeric(8,2) not null check (base_price >= 0),
  image_url text,
  is_available boolean not null default true,
  sort_order int not null default 0
);

create table option_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_required boolean not null default false,
  max_select int not null default 1 check (max_select >= 1)
);

create table option_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references option_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(8,2) not null default 0,
  is_available boolean not null default true,
  sort_order int not null default 0
);

create table menu_item_option_groups (
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  option_group_id uuid not null references option_groups(id) on delete cascade,
  primary key (menu_item_id, option_group_id)
);

alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table option_groups enable row level security;
alter table option_items enable row level security;
alter table menu_item_option_groups enable row level security;

create policy public_read on menu_categories for select using (true);
create policy public_read on menu_items for select using (true);
create policy public_read on option_groups for select using (true);
create policy public_read on option_items for select using (true);
create policy public_read on menu_item_option_groups for select using (true);

-- staff (Supabase Auth user ทุกคน = พนักงานร้าน — ระบบนี้สร้าง account ให้เฉพาะร้าน)
create policy staff_write on menu_categories for all to authenticated using (true) with check (true);
create policy staff_write on menu_items for all to authenticated using (true) with check (true);
create policy staff_write on option_groups for all to authenticated using (true) with check (true);
create policy staff_write on option_items for all to authenticated using (true) with check (true);
create policy staff_write on menu_item_option_groups for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Apply และตรวจ**

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
```

Expected: เห็นตาราง `menu_categories, menu_items, option_groups, option_items, menu_item_option_groups`

- [ ] **Step 3: ตรวจ RLS — anon อ่านได้ เขียนไม่ได้**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
set role anon;
select count(*) from menu_items;                                  -- ต้องไม่ error
insert into menu_categories (name) values ('hack');               -- ต้อง error
SQL
```

Expected: select ผ่าน (0 rows), insert ขึ้น `permission denied` หรือ `new row violates row-level security policy`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_menu.sql && git commit -m "feat: menu schema with public-read RLS"
```

---

### Task 2: Seed เมนูร้านกะเพรา

**Files:**
- Create: `supabase/migrations/0002_seed_menu.sql`

- [ ] **Step 1: เขียน seed** (ใช้ uuid คงที่ เพื่อให้ test/smoke อ้างถึงได้)

```sql
insert into menu_categories (id, name, sort_order) values
  ('c0000000-0000-0000-0000-000000000001', 'กะเพรา', 1),
  ('c0000000-0000-0000-0000-000000000002', 'เครื่องดื่ม', 2);

insert into menu_items (id, category_id, name, base_price, sort_order) values
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'กะเพราไฟลุก (ราดข้าว)', 50, 1),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'ชาเย็น', 25, 1);

insert into option_groups (id, name, is_required, max_select) values
  ('b0000000-0000-0000-0000-000000000001', 'เนื้อสัตว์', true, 1),
  ('b0000000-0000-0000-0000-000000000002', 'ระดับความเผ็ด', true, 1),
  ('b0000000-0000-0000-0000-000000000003', 'ไข่', false, 1),
  ('b0000000-0000-0000-0000-000000000004', 'พิเศษ', false, 2);

insert into option_items (id, group_id, name, price_delta, sort_order) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'หมูสับ', 0, 1),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'ไก่', 0, 2),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'เนื้อ', 10, 3),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'ทะเล', 20, 4),
  ('d0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'เผ็ดน้อย', 0, 1),
  ('d0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000002', 'เผ็ดปกติ', 0, 2),
  ('d0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000002', 'ไฟลุก 🔥', 0, 3),
  ('d0000000-0000-0000-0000-000000000021', 'b0000000-0000-0000-0000-000000000003', 'ไข่ดาว', 10, 1),
  ('d0000000-0000-0000-0000-000000000022', 'b0000000-0000-0000-0000-000000000003', 'ไข่เจียว', 10, 2),
  ('d0000000-0000-0000-0000-000000000031', 'b0000000-0000-0000-0000-000000000004', 'เพิ่มข้าว', 5, 1),
  ('d0000000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-000000000004', 'เพิ่มเนื้อ', 15, 2);

insert into menu_item_option_groups (menu_item_id, option_group_id) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000004');
```

- [ ] **Step 2: Apply และตรวจ**

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select mi.name, count(g.option_group_id) groups from menu_items mi left join menu_item_option_groups g on g.menu_item_id = mi.id group by mi.name;"
```

Expected: `กะเพราไฟลุก (ราดข้าว) | 4` และ `ชาเย็น | 0`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_seed_menu.sql && git commit -m "feat: seed krapao menu"
```

---

### Task 3: Migration ออเดอร์ + ลูกค้า + settings + realtime + slips bucket

**Files:**
- Create: `supabase/migrations/0003_orders.sql`

- [ ] **Step 1: เขียน migration**

```sql
create table customers (
  line_user_id text primary key,
  display_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- เลขออเดอร์รายวัน (#1, #2, ...) — upsert atomic กันเลขซ้ำเมื่อสั่งพร้อมกัน
create table daily_counters (
  order_date date primary key,
  last_no int not null
);

create or replace function next_order_no(d date) returns int
language sql as $$
  insert into daily_counters (order_date, last_no) values (d, 1)
  on conflict (order_date) do update set last_no = daily_counters.last_no + 1
  returning last_no;
$$;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  order_no int not null,
  customer_id text not null references customers(line_user_id),
  pickup_type text not null check (pickup_type in ('ASAP', 'SCHEDULED')),
  pickup_time timestamptz,
  status text not null default 'PENDING_PAYMENT' check (status in
    ('PENDING_PAYMENT', 'PAID', 'COOKING', 'READY', 'COMPLETED',
     'EXPIRED', 'REFUND_PENDING', 'REFUNDED')),
  total numeric(8,2) not null check (total > 0),
  qr_payload text not null,
  slip_trans_ref text unique,
  slip_image_path text,
  reject_reason text,
  refund_slip_path text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  refunded_at timestamptz,
  unique (order_date, order_no),
  check (pickup_type = 'ASAP' or pickup_time is not null)
);
create index orders_status_idx on orders (status);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id),
  name_snapshot text not null,
  qty int not null check (qty > 0),
  unit_price numeric(8,2) not null,
  options jsonb not null default '[]',   -- [{"group":"เนื้อสัตว์","name":"เนื้อ","price_delta":10}]
  note text,
  line_total numeric(8,2) not null
);

create table shop_settings (
  id int primary key default 1 check (id = 1),  -- บังคับแถวเดียว
  shop_name text not null default 'กะเพราไฟลุก by MEAL TEAory',
  is_accepting boolean not null default true,
  open_time time not null default '10:00',
  close_time time not null default '20:00',
  est_prep_minutes int not null default 15,
  promptpay_id text not null default '0800000000',
  line_group_id text,
  payment_timeout_minutes int not null default 15,
  notify_on_accept boolean not null default true  -- ปิดเพื่อลดเหลือ 1 push/ออเดอร์ (เฉพาะ "อาหารเสร็จ") ประหยัดโควต้า LINE OA
);
insert into shop_settings (id) values (1);

alter table customers enable row level security;
alter table daily_counters enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table shop_settings enable row level security;

-- ลูกค้า LIFF ไม่มี Supabase session → อ่าน/เขียนผ่าน edge functions (service role) เท่านั้น
-- staff (authenticated) เข้าถึงทุกอย่างได้ สำหรับ dashboard
create policy staff_all on customers for all to authenticated using (true) with check (true);
create policy staff_all on orders for all to authenticated using (true) with check (true);
create policy staff_all on order_items for all to authenticated using (true) with check (true);
create policy staff_all on shop_settings for all to authenticated using (true) with check (true);

-- สถานะร้านแบบสาธารณะ (LIFF เช็คเปิด/ปิด) — ไม่เผย promptpay_id / line_group_id
create view public_shop_status
  with (security_invoker = off) as
  select shop_name, is_accepting, open_time, close_time, est_prep_minutes
  from shop_settings;
grant select on public_shop_status to anon, authenticated;

-- realtime ให้ dashboard subscribe ออเดอร์
alter publication supabase_realtime add table orders;

-- bucket เก็บรูปสลิป (private — เข้าถึงผ่าน service role / signed URL)
insert into storage.buckets (id, name, public) values ('slips', 'slips', false);
```

- [ ] **Step 2: Apply และทดสอบเลขออเดอร์รายวัน + constraint**

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
select next_order_no('2026-06-10');  -- 1
select next_order_no('2026-06-10');  -- 2
select next_order_no('2026-06-11');  -- 1 (วันใหม่เริ่มนับใหม่)
insert into shop_settings (id) values (1);  -- ต้อง error (แถวเดียว)
SQL
```

Expected: ได้ 1, 2, 1 ตามลำดับ และ insert ซ้ำขึ้น duplicate key error

- [ ] **Step 3: ทดสอบ slip_trans_ref ห้ามซ้ำ (กันสลิปใช้ซ้ำ)**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
insert into customers (line_user_id) values ('U_test');
insert into orders (order_date, order_no, customer_id, pickup_type, total, qr_payload, slip_trans_ref)
  values ('2026-06-10', 98, 'U_test', 'ASAP', 60, 'x', 'REF001');
insert into orders (order_date, order_no, customer_id, pickup_type, total, qr_payload, slip_trans_ref)
  values ('2026-06-10', 99, 'U_test', 'ASAP', 60, 'x', 'REF001');
SQL
```

Expected: แถวแรกผ่าน แถวสอง `duplicate key value violates unique constraint "orders_slip_trans_ref_key"`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_orders.sql && git commit -m "feat: orders schema, daily order numbers, shop settings, slips bucket"
```

---

### Task 4: Migration pg_cron ตัดออเดอร์ค้างจ่าย

**Files:**
- Create: `supabase/migrations/0004_expiry_cron.sql`

- [ ] **Step 1: เขียน migration**

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'expire-unpaid-orders',
  '* * * * *',
  $$
    update orders
    set status = 'EXPIRED'
    where status = 'PENDING_PAYMENT'
      and created_at < now() - make_interval(
        mins => (select payment_timeout_minutes from shop_settings where id = 1))
  $$
);
```

- [ ] **Step 2: Apply และทดสอบ logic ของ query (ไม่ต้องรอ cron จริง)**

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
select count(*) from cron.job where jobname = 'expire-unpaid-orders';  -- 1
insert into customers (line_user_id) values ('U_test');
insert into orders (order_date, order_no, customer_id, pickup_type, total, qr_payload, created_at)
  values ('2026-06-10', 97, 'U_test', 'ASAP', 60, 'x', now() - interval '20 minutes');
update orders set status = 'EXPIRED'
  where status = 'PENDING_PAYMENT'
    and created_at < now() - make_interval(mins => (select payment_timeout_minutes from shop_settings where id = 1));
select status from orders where order_no = 97;  -- EXPIRED
SQL
```

Expected: job count = 1, สถานะสุดท้าย = `EXPIRED`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_expiry_cron.sql && git commit -m "feat: auto-expire unpaid orders via pg_cron"
```

---

### Task 5: `_shared/http.ts` + `_shared/promptpay.ts` (PromptPay EMVCo QR)

**Files:**
- Create: `supabase/functions/_shared/http.ts`
- Create: `supabase/functions/_shared/promptpay.ts`
- Test: `supabase/functions/_shared/promptpay_test.ts`

- [ ] **Step 1: เขียน helper HTTP (ไม่มี logic — ไม่ต้องมี test แยก)**

```ts
// supabase/functions/_shared/http.ts
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code }, e.status);
  console.error(e);
  return json({ error: "INTERNAL" }, 500);
}
```

- [ ] **Step 2: เขียน failing tests ของ promptpay**

```ts
// supabase/functions/_shared/promptpay_test.ts
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
```

- [ ] **Step 3: รัน test ให้ fail**

```bash
deno task test
```

Expected: FAIL — `Module not found ... promptpay.ts`

- [ ] **Step 4: เขียน implementation**

```ts
// supabase/functions/_shared/promptpay.ts
// EMVCo Merchant-Presented QR สำหรับ PromptPay (dynamic — ระบุยอด)

function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, "0") + value;
}

// CRC16-CCITT (init 0xFFFF, poly 0x1021) ตามสเปก EMVCo
export function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function promptPayPayload(promptpayId: string, amountTHB: number): string {
  const digits = promptpayId.replace(/\D/g, "");
  const proxy = digits.length === 13
    ? tlv("02", digits)                                // เลขบัตรประชาชน/เลขผู้เสียภาษี
    : tlv("01", "0066" + digits.replace(/^0/, ""));    // เบอร์มือถือ
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("29", tlv("00", "A000000677010111") + proxy) +
    tlv("53", "764") +
    tlv("54", amountTHB.toFixed(2)) +
    tlv("58", "TH");
  const withCrcId = body + "6304";
  return withCrcId + crc16(withCrcId);
}
```

- [ ] **Step 5: รัน test ให้ผ่าน**

```bash
deno task test
```

Expected: PASS ทั้ง 3 tests

- [ ] **Step 6: ตรวจกับของจริงหนึ่งครั้ง** — เปิดเว็บ generate PromptPay QR ที่เชื่อถือได้ (เช่น promptpay.io ใส่เบอร์+ยอดเดียวกัน) เทียบ payload หรือสแกน QR จาก payload เราด้วยแอปธนาคารว่าขึ้นชื่อ/ยอดถูก — บันทึกผลใน commit message

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/http.ts supabase/functions/_shared/promptpay.ts supabase/functions/_shared/promptpay_test.ts
git commit -m "feat: PromptPay EMVCo QR payload generator (verified against bank app scan)"
```

---

### Task 6: `_shared/pricing.ts` — คำนวณราคา + validate ตัวเลือกฝั่ง server

**Files:**
- Create: `supabase/functions/_shared/pricing.ts`
- Test: `supabase/functions/_shared/pricing_test.ts`

- [ ] **Step 1: เขียน failing tests**

```ts
// supabase/functions/_shared/pricing_test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { priceOrder, PricingError, type MenuIndex } from "./pricing.ts";

const menu: MenuIndex = {
  items: {
    krapao: { name: "กะเพราไฟลุก", basePrice: 50, isAvailable: true, groupIds: ["meat", "spice", "egg"] },
    tea: { name: "ชาเย็น", basePrice: 25, isAvailable: true, groupIds: [] },
    soldout: { name: "ของหมด", basePrice: 40, isAvailable: false, groupIds: [] },
  },
  groups: {
    meat: { name: "เนื้อสัตว์", isRequired: true, maxSelect: 1 },
    spice: { name: "ระดับความเผ็ด", isRequired: true, maxSelect: 1 },
    egg: { name: "ไข่", isRequired: false, maxSelect: 1 },
  },
  options: {
    pork: { groupId: "meat", name: "หมูสับ", priceDelta: 0, isAvailable: true },
    beef: { groupId: "meat", name: "เนื้อ", priceDelta: 10, isAvailable: true },
    mid: { groupId: "spice", name: "เผ็ดปกติ", priceDelta: 0, isAvailable: true },
    friedEgg: { groupId: "egg", name: "ไข่ดาว", priceDelta: 10, isAvailable: true },
  },
};

Deno.test("คิดราคา: base + delta คูณจำนวน และรวม total", () => {
  const r = priceOrder(
    [
      { menuItemId: "krapao", qty: 2, optionItemIds: ["beef", "mid", "friedEgg"], note: "ไม่ใส่ถั่ว" },
      { menuItemId: "tea", qty: 1, optionItemIds: [] },
    ],
    menu,
  );
  assertEquals(r.items[0].unitPrice, 70);     // 50 + 10 + 0 + 10
  assertEquals(r.items[0].lineTotal, 140);
  assertEquals(r.items[0].nameSnapshot, "กะเพราไฟลุก");
  assertEquals(r.items[0].options, [
    { group: "เนื้อสัตว์", name: "เนื้อ", price_delta: 10 },
    { group: "ระดับความเผ็ด", name: "เผ็ดปกติ", price_delta: 0 },
    { group: "ไข่", name: "ไข่ดาว", price_delta: 10 },
  ]);
  assertEquals(r.total, 165);
});

Deno.test("ตะกร้าว่าง / ไม่รู้จักเมนู / เมนูหมด → โยน error ตาม code", () => {
  assertThrows(() => priceOrder([], menu), PricingError, "EMPTY_CART");
  assertThrows(() => priceOrder([{ menuItemId: "nope", qty: 1, optionItemIds: [] }], menu), PricingError, "UNKNOWN_ITEM");
  assertThrows(() => priceOrder([{ menuItemId: "soldout", qty: 1, optionItemIds: [] }], menu), PricingError, "ITEM_UNAVAILABLE");
});

Deno.test("ไม่เลือกกลุ่มบังคับ → REQUIRED_GROUP_MISSING", () => {
  assertThrows(
    () => priceOrder([{ menuItemId: "krapao", qty: 1, optionItemIds: ["beef"] }], menu),
    PricingError,
    "REQUIRED_GROUP_MISSING",
  );
});

Deno.test("เลือกเกิน maxSelect หรือ option ไม่อยู่ในเมนูนั้น → error", () => {
  assertThrows(
    () => priceOrder([{ menuItemId: "krapao", qty: 1, optionItemIds: ["pork", "beef", "mid"] }], menu),
    PricingError,
    "TOO_MANY_IN_GROUP",
  );
  assertThrows(
    () => priceOrder([{ menuItemId: "tea", qty: 1, optionItemIds: ["pork"] }], menu),
    PricingError,
    "OPTION_NOT_ALLOWED",
  );
});
```

- [ ] **Step 2: รันให้ fail**

```bash
deno task test
```

Expected: FAIL — `Module not found ... pricing.ts`

- [ ] **Step 3: เขียน implementation**

```ts
// supabase/functions/_shared/pricing.ts
export type MenuIndex = {
  items: Record<string, { name: string; basePrice: number; isAvailable: boolean; groupIds: string[] }>;
  groups: Record<string, { name: string; isRequired: boolean; maxSelect: number }>;
  options: Record<string, { groupId: string; name: string; priceDelta: number; isAvailable: boolean }>;
};

export type CartItem = { menuItemId: string; qty: number; optionItemIds: string[]; note?: string };

export type PricedItem = {
  menuItemId: string;
  nameSnapshot: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  options: { group: string; name: string; price_delta: number }[];
  note?: string;
};

export class PricingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const baht = (n: number) => Math.round(n * 100) / 100;

export function priceOrder(cart: CartItem[], menu: MenuIndex): { items: PricedItem[]; total: number } {
  if (cart.length === 0) throw new PricingError("EMPTY_CART");
  const items = cart.map((c) => {
    const item = menu.items[c.menuItemId];
    if (!item) throw new PricingError("UNKNOWN_ITEM");
    if (!item.isAvailable) throw new PricingError("ITEM_UNAVAILABLE");
    if (!Number.isInteger(c.qty) || c.qty < 1) throw new PricingError("BAD_QTY");

    const perGroup = new Map<string, number>();
    let unitPrice = item.basePrice;
    const options = c.optionItemIds.map((oid) => {
      const opt = menu.options[oid];
      if (!opt) throw new PricingError("UNKNOWN_OPTION");
      if (!opt.isAvailable) throw new PricingError("OPTION_UNAVAILABLE");
      if (!item.groupIds.includes(opt.groupId)) throw new PricingError("OPTION_NOT_ALLOWED");
      const n = (perGroup.get(opt.groupId) ?? 0) + 1;
      perGroup.set(opt.groupId, n);
      if (n > menu.groups[opt.groupId].maxSelect) throw new PricingError("TOO_MANY_IN_GROUP");
      unitPrice = baht(unitPrice + opt.priceDelta);
      return { group: menu.groups[opt.groupId].name, name: opt.name, price_delta: opt.priceDelta };
    });

    for (const gid of item.groupIds) {
      if (menu.groups[gid].isRequired && !perGroup.has(gid)) {
        throw new PricingError("REQUIRED_GROUP_MISSING");
      }
    }

    return {
      menuItemId: c.menuItemId,
      nameSnapshot: item.name,
      qty: c.qty,
      unitPrice,
      lineTotal: baht(unitPrice * c.qty),
      options,
      note: c.note,
    };
  });
  return { items, total: baht(items.reduce((s, i) => s + i.lineTotal, 0)) };
}
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
deno task test
```

Expected: PASS ทุก test

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/pricing.ts supabase/functions/_shared/pricing_test.ts
git commit -m "feat: server-side order pricing and option validation"
```

---

### Task 7: `_shared/slip-check.ts` — ตัดสินสลิปผ่าน/ไม่ผ่าน

**Files:**
- Create: `supabase/functions/_shared/slip-check.ts`
- Test: `supabase/functions/_shared/slip-check_test.ts`

- [ ] **Step 1: เขียน failing tests**

```ts
// supabase/functions/_shared/slip-check_test.ts
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
```

- [ ] **Step 2: รันให้ fail**

```bash
deno task test
```

Expected: FAIL — `Module not found ... slip-check.ts`

- [ ] **Step 3: เขียน implementation**

```ts
// supabase/functions/_shared/slip-check.ts
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
  const m = masked.replace(/[^0-9xX]/g, "").toLowerCase();
  const f = full.replace(/\D/g, "");
  if (m.length !== f.length) return false;
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== "x" && m[i] !== f[i]) return false;
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
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
deno task test
```

Expected: PASS ทุก test

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/slip-check.ts supabase/functions/_shared/slip-check_test.ts
git commit -m "feat: slip validation rules (amount, receiver, freshness)"
```

---

### Task 8: `_shared/messages.ts` — ข้อความ LINE ภาษาไทย

**Files:**
- Create: `supabase/functions/_shared/messages.ts`
- Test: `supabase/functions/_shared/messages_test.ts`

- [ ] **Step 1: เขียน failing tests**

```ts
// supabase/functions/_shared/messages_test.ts
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
```

- [ ] **Step 2: รันให้ fail**

```bash
deno task test
```

Expected: FAIL — `Module not found ... messages.ts`

- [ ] **Step 3: เขียน implementation**

```ts
// supabase/functions/_shared/messages.ts
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
  const t = new Date(o.pickup_time!).toLocaleTimeString("th-TH", {
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
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
deno task test
```

Expected: PASS ทุก test

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/messages.ts supabase/functions/_shared/messages_test.ts
git commit -m "feat: Thai LINE notification messages"
```

---

### Task 9: `_shared/line.ts` + `_shared/easyslip.ts` — client ภายนอก (fetch injectable)

**Files:**
- Create: `supabase/functions/_shared/line.ts`
- Create: `supabase/functions/_shared/easyslip.ts`
- Test: `supabase/functions/_shared/line_test.ts`, `supabase/functions/_shared/easyslip_test.ts`

- [ ] **Step 1: เขียน failing tests**

```ts
// supabase/functions/_shared/line_test.ts
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
```

```ts
// supabase/functions/_shared/easyslip_test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { verifySlipImage } from "./easyslip.ts";

// รูปแบบ response ตามเอกสาร EasySlip v1 (ปรับ mapping ใน Step 4 ของ Task 11 ถ้าของจริงต่าง)
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

Deno.test("แปลง response สำเร็จเป็น SlipData", async () => {
  const f: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify(easyslipOk), { status: 200 })) as ReturnType<typeof fetch>;
  const s = await verifySlipImage("base64img", "TOKEN", f);
  assertEquals(s.transRef, "REF777");
  assertEquals(s.amount, 165);
  assertEquals(s.receiverProxy, "081-xxx-5678");
});

Deno.test("EasySlip ตอบ error → โยน SLIP_UNREADABLE", async () => {
  const f: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ status: 400, message: "invalid_image" }), { status: 400 })) as ReturnType<typeof fetch>;
  await assertRejects(() => verifySlipImage("junk", "TOKEN", f), Error, "SLIP_UNREADABLE");
});
```

- [ ] **Step 2: รันให้ fail**

```bash
deno task test
```

Expected: FAIL — module not found ทั้งสอง

- [ ] **Step 3: เขียน implementation**

```ts
// supabase/functions/_shared/line.ts
import { HttpError } from "./http.ts";

export type LineProfile = { sub: string; name?: string; picture?: string };

export async function verifyLineIdToken(
  idToken: string,
  channelId: string,
  fetchFn: typeof fetch = fetch,
): Promise<LineProfile> {
  const res = await fetchFn("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!res.ok) throw new HttpError(401, "INVALID_ID_TOKEN");
  return await res.json();
}

export async function pushText(
  to: string,
  text: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  // การแจ้งเตือนพังต้องไม่ทำให้ flow หลักล้ม — log แล้วไปต่อ
  if (!res.ok) console.error(`LINE push failed: ${res.status} ${await res.text()}`);
}
```

```ts
// supabase/functions/_shared/easyslip.ts
import type { SlipData } from "./slip-check.ts";

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
  return {
    transRef: d.transRef,
    amount: d.amount?.amount ?? 0,
    receiverProxy: d.receiver?.account?.proxy?.account,
    receiverName: d.receiver?.account?.name?.th,
    transDate: d.date,
  };
}
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
deno task test
```

Expected: PASS ทุก test

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/line.ts supabase/functions/_shared/line_test.ts supabase/functions/_shared/easyslip.ts supabase/functions/_shared/easyslip_test.ts
git commit -m "feat: LINE and EasySlip clients with injectable fetch"
```

---

### Task 10: Edge function `create-order`

**Files:**
- Create: `supabase/functions/create-order/index.ts`
- Modify: `supabase/config.toml` (ปิด verify_jwt — ลูกค้าไม่มี Supabase JWT)
- Create: `supabase/functions/.env` (ค่า dev) + `supabase/functions/.env.example`

หมายเหตุ dev mode: ระหว่างยังไม่มี LINE channel จริง ให้รองรับ `DEV_BYPASS_LINE=1` ใน env → ถ้า idToken ขึ้นต้นด้วย `dev:` ใช้ส่วนหลัง `dev:` เป็น line_user_id ตรงๆ (เฉพาะตอน bypass เปิด) เพื่อให้ smoke test รันได้โดยไม่ต้องมี token จริง — **ห้ามตั้งค่านี้บน production**

- [ ] **Step 1: ปรับ config + env**

เพิ่มใน `supabase/config.toml`:
```toml
[functions.create-order]
verify_jwt = false

[functions.verify-slip]
verify_jwt = false

[functions.line-webhook]
verify_jwt = false
```

`supabase/functions/.env.example` (commit ได้):
```
LINE_LOGIN_CHANNEL_ID=changeme
LINE_CHANNEL_ACCESS_TOKEN=changeme
LINE_CHANNEL_SECRET=changeme
EASYSLIP_TOKEN=changeme
DEV_BYPASS_LINE=
```

คัดลอกเป็น `supabase/functions/.env` และตั้ง `DEV_BYPASS_LINE=1` สำหรับ local

- [ ] **Step 2: เขียน handler**

```ts
// supabase/functions/create-order/index.ts
import { createClient } from "@supabase/supabase-js";
import { json, errorResponse, HttpError, CORS } from "../_shared/http.ts";
import { verifyLineIdToken } from "../_shared/line.ts";
import { priceOrder, PricingError, type MenuIndex, type CartItem } from "../_shared/pricing.ts";
import { promptPayPayload } from "../_shared/promptpay.ts";

type Body = {
  idToken: string;
  items: CartItem[];
  pickup_type: "ASAP" | "SCHEDULED";
  pickup_time?: string;
  phone?: string;
};

async function resolveLineUser(idToken: string): Promise<{ sub: string; name?: string }> {
  if (Deno.env.get("DEV_BYPASS_LINE") === "1" && idToken.startsWith("dev:")) {
    return { sub: idToken.slice(4), name: "Dev User" };
  }
  return await verifyLineIdToken(idToken, Deno.env.get("LINE_LOGIN_CHANNEL_ID")!);
}

function nowBangkok(): { date: string; time: string } {
  const now = new Date();
  const fmt = (opt: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", ...opt }).format(now);
  return {
    date: fmt({ dateStyle: "short" }),                                   // YYYY-MM-DD
    time: fmt({ hour: "2-digit", minute: "2-digit", hour12: false }),    // HH:MM
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body: Body = await req.json();
    if (!body.idToken || !Array.isArray(body.items)) throw new HttpError(400, "BAD_REQUEST");
    if (body.pickup_type === "SCHEDULED" && !body.pickup_time) throw new HttpError(400, "PICKUP_TIME_REQUIRED");

    const profile = await resolveLineUser(body.idToken);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) ร้านเปิดรับอยู่ไหม
    const { data: settings, error: se } = await db.from("shop_settings").select("*").eq("id", 1).single();
    if (se) throw se;
    const { date, time } = nowBangkok();
    if (!settings.is_accepting) throw new HttpError(409, "SHOP_CLOSED");
    if (time < settings.open_time.slice(0, 5) || time >= settings.close_time.slice(0, 5)) {
      throw new HttpError(409, "OUTSIDE_HOURS");
    }

    // 2) โหลดเมนูเฉพาะที่สั่ง สร้าง MenuIndex แล้วคิดราคาฝั่ง server
    const itemIds = [...new Set(body.items.map((i) => i.menuItemId))];
    const [{ data: items }, { data: links }] = await Promise.all([
      db.from("menu_items").select("id,name,base_price,is_available").in("id", itemIds),
      db.from("menu_item_option_groups").select("menu_item_id,option_group_id").in("menu_item_id", itemIds),
    ]);
    const groupIds = [...new Set((links ?? []).map((l) => l.option_group_id))];
    const [{ data: groups }, { data: options }] = await Promise.all([
      db.from("option_groups").select("id,name,is_required,max_select").in("id", groupIds),
      db.from("option_items").select("id,group_id,name,price_delta,is_available").in("group_id", groupIds),
    ]);
    const menu: MenuIndex = {
      items: Object.fromEntries((items ?? []).map((m) => [m.id, {
        name: m.name, basePrice: Number(m.base_price), isAvailable: m.is_available,
        groupIds: (links ?? []).filter((l) => l.menu_item_id === m.id).map((l) => l.option_group_id),
      }])),
      groups: Object.fromEntries((groups ?? []).map((g) => [g.id, {
        name: g.name, isRequired: g.is_required, maxSelect: g.max_select,
      }])),
      options: Object.fromEntries((options ?? []).map((o) => [o.id, {
        groupId: o.group_id, name: o.name, priceDelta: Number(o.price_delta), isAvailable: o.is_available,
      }])),
    };
    const priced = priceOrder(body.items, menu);

    // 3) upsert ลูกค้า + ออกเลขออเดอร์ + insert
    await db.from("customers").upsert({
      line_user_id: profile.sub,
      display_name: profile.name,
      ...(body.phone ? { phone: body.phone } : {}),
    });
    const { data: orderNo, error: ne } = await db.rpc("next_order_no", { d: date });
    if (ne) throw ne;
    const qr = promptPayPayload(settings.promptpay_id, priced.total);

    const { data: order, error: oe } = await db.from("orders").insert({
      order_date: date,
      order_no: orderNo,
      customer_id: profile.sub,
      pickup_type: body.pickup_type,
      pickup_time: body.pickup_time ?? null,
      total: priced.total,
      qr_payload: qr,
    }).select("id,order_no,total,created_at").single();
    if (oe) throw oe;

    const { error: ie } = await db.from("order_items").insert(priced.items.map((i) => ({
      order_id: order.id,
      menu_item_id: i.menuItemId,
      name_snapshot: i.nameSnapshot,
      qty: i.qty,
      unit_price: i.unitPrice,
      options: i.options,
      note: i.note ?? null,
      line_total: i.lineTotal,
    })));
    if (ie) throw ie;

    return json({
      order_id: order.id,
      order_no: order.order_no,
      total: Number(order.total),
      qr_payload: qr,
      payment_timeout_minutes: settings.payment_timeout_minutes,
    });
  } catch (e) {
    if (e instanceof PricingError) return json({ error: e.code }, 422);
    return errorResponse(e);
  }
});
```

- [ ] **Step 3: ทดสอบกับ local stack**

```bash
supabase functions serve --env-file supabase/functions/.env &
sleep 3
curl -s -X POST http://127.0.0.1:54321/functions/v1/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "dev:U_smoke1",
    "pickup_type": "ASAP",
    "items": [{
      "menuItemId": "a0000000-0000-0000-0000-000000000001",
      "qty": 1,
      "optionItemIds": [
        "d0000000-0000-0000-0000-000000000003",
        "d0000000-0000-0000-0000-000000000013",
        "d0000000-0000-0000-0000-000000000021"
      ],
      "note": "ไม่ใส่ถั่ว"
    }]
  }' | jq
```

Expected: JSON มี `order_no: 1` (หรือเลขถัดไป), `total: 70` (50+10+0+10), `qr_payload` ขึ้นต้น `000201`

- [ ] **Step 4: ทดสอบ error cases**

```bash
# ไม่เลือกเนื้อสัตว์ (กลุ่มบังคับ)
curl -s -X POST http://127.0.0.1:54321/functions/v1/create-order \
  -H "Content-Type: application/json" \
  -d '{"idToken":"dev:U_smoke1","pickup_type":"ASAP","items":[{"menuItemId":"a0000000-0000-0000-0000-000000000001","qty":1,"optionItemIds":[]}]}' | jq
# Expected: {"error":"REQUIRED_GROUP_MISSING"} status 422

# ร้านปิดรับ
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "update shop_settings set is_accepting=false;"
curl -s -X POST http://127.0.0.1:54321/functions/v1/create-order -H "Content-Type: application/json" \
  -d '{"idToken":"dev:U_smoke1","pickup_type":"ASAP","items":[{"menuItemId":"a0000000-0000-0000-0000-000000000002","qty":1,"optionItemIds":[]}]}' | jq
# Expected: {"error":"SHOP_CLOSED"}
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "update shop_settings set is_accepting=true;"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/create-order supabase/config.toml supabase/functions/.env.example
git commit -m "feat: create-order edge function with PromptPay QR"
```

---

### Task 11: Edge function `verify-slip`

**Files:**
- Create: `supabase/functions/verify-slip/index.ts`

dev mode: `DEV_BYPASS_LINE=1` + ส่ง `devSlip` object ใน body แทนรูป → ข้าม EasySlip (ใช้ทดสอบ local ก่อนมี token จริง)

- [ ] **Step 1: เขียน handler**

```ts
// supabase/functions/verify-slip/index.ts
import { createClient } from "@supabase/supabase-js";
import { json, errorResponse, HttpError, CORS } from "../_shared/http.ts";
import { verifyLineIdToken, pushText } from "../_shared/line.ts";
import { verifySlipImage } from "../_shared/easyslip.ts";
import { checkSlip, type SlipData } from "../_shared/slip-check.ts";
import { msgNewOrderForShop } from "../_shared/messages.ts";

type Body = { idToken: string; order_id: string; imageBase64?: string; devSlip?: SlipData };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body: Body = await req.json();
    const dev = Deno.env.get("DEV_BYPASS_LINE") === "1";
    const profile = dev && body.idToken.startsWith("dev:")
      ? { sub: body.idToken.slice(4) }
      : await verifyLineIdToken(body.idToken, Deno.env.get("LINE_LOGIN_CHANNEL_ID")!);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: order } = await db.from("orders")
      .select("id,order_no,total,status,customer_id,pickup_type,pickup_time")
      .eq("id", body.order_id).single();
    if (!order || order.customer_id !== profile.sub) throw new HttpError(404, "ORDER_NOT_FOUND");
    if (order.status !== "PENDING_PAYMENT") throw new HttpError(409, "WRONG_STATUS");

    // อ่านสลิป
    let slip: SlipData;
    let slipPath: string | null = null;
    if (dev && body.devSlip) {
      slip = body.devSlip;
    } else {
      if (!body.imageBase64) throw new HttpError(400, "IMAGE_REQUIRED");
      const bytes = Uint8Array.from(atob(body.imageBase64), (c) => c.charCodeAt(0));
      slipPath = `${order.id}.jpg`;
      const { error: ue } = await db.storage.from("slips").upload(slipPath, bytes, {
        contentType: "image/jpeg", upsert: true,
      });
      if (ue) throw ue;
      slip = await verifySlipImage(body.imageBase64, Deno.env.get("EASYSLIP_TOKEN")!);
    }

    // ตัดสิน
    const { data: settings } = await db.from("shop_settings").select("*").eq("id", 1).single();
    const verdict = checkSlip(slip, { total: Number(order.total) }, settings!.promptpay_id);
    if (!verdict.ok) return json({ error: verdict.reason }, 422);

    // PAID (unique slip_trans_ref กันสลิปซ้ำ — ชนแล้ว Postgres ตอบ 23505)
    const { error: pe } = await db.from("orders").update({
      status: "PAID", paid_at: new Date().toISOString(),
      slip_trans_ref: slip.transRef, slip_image_path: slipPath,
    }).eq("id", order.id).eq("status", "PENDING_PAYMENT");
    if (pe) {
      if ((pe as { code?: string }).code === "23505") return json({ error: "DUPLICATE_SLIP" }, 422);
      throw pe;
    }

    // แจ้งกลุ่มร้าน (backup ของหน้าจอ) — พังก็ไม่ล้ม flow
    if (settings!.line_group_id) {
      const { data: items } = await db.from("order_items")
        .select("name_snapshot,qty,options,note").eq("order_id", order.id);
      const text = msgNewOrderForShop({
        order_no: order.order_no,
        pickup_type: order.pickup_type,
        pickup_time: order.pickup_time,
        total: Number(order.total),
        items: (items ?? []).map((i) => ({
          nameSnapshot: i.name_snapshot, qty: i.qty, options: i.options, note: i.note,
        })),
      });
      await pushText(settings!.line_group_id, text, Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!);
    }

    return json({ ok: true, status: "PAID" });
  } catch (e) {
    return errorResponse(e);
  }
});
```

- [ ] **Step 2: ทดสอบ happy path + สลิปซ้ำ กับ local stack**

```bash
# สร้างออเดอร์ใหม่ เก็บ order_id
OID=$(curl -s -X POST http://127.0.0.1:54321/functions/v1/create-order -H "Content-Type: application/json" \
  -d '{"idToken":"dev:U_smoke1","pickup_type":"ASAP","items":[{"menuItemId":"a0000000-0000-0000-0000-000000000002","qty":2,"optionItemIds":[]}]}' | jq -r .order_id)

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# จ่ายด้วย devSlip ยอดตรง (ชาเย็น 25 x2 = 50)
curl -s -X POST http://127.0.0.1:54321/functions/v1/verify-slip -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke1\",\"order_id\":\"$OID\",\"devSlip\":{\"transRef\":\"REFA1\",\"amount\":50,\"transDate\":\"$NOW\"}}" | jq
# Expected: {"ok":true,"status":"PAID"}

# ยิงซ้ำ → สถานะไม่ใช่ PENDING แล้ว
curl -s -X POST http://127.0.0.1:54321/functions/v1/verify-slip -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke1\",\"order_id\":\"$OID\",\"devSlip\":{\"transRef\":\"REFA1\",\"amount\":50,\"transDate\":\"$NOW\"}}" | jq
# Expected: {"error":"WRONG_STATUS"}

# สลิป transRef เดิมกับออเดอร์ใหม่ → DUPLICATE_SLIP
OID2=$(curl -s -X POST http://127.0.0.1:54321/functions/v1/create-order -H "Content-Type: application/json" \
  -d '{"idToken":"dev:U_smoke1","pickup_type":"ASAP","items":[{"menuItemId":"a0000000-0000-0000-0000-000000000002","qty":2,"optionItemIds":[]}]}' | jq -r .order_id)
curl -s -X POST http://127.0.0.1:54321/functions/v1/verify-slip -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke1\",\"order_id\":\"$OID2\",\"devSlip\":{\"transRef\":\"REFA1\",\"amount\":50,\"transDate\":\"$NOW\"}}" | jq
# Expected: {"error":"DUPLICATE_SLIP"}

# ยอดไม่พอ
curl -s -X POST http://127.0.0.1:54321/functions/v1/verify-slip -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke1\",\"order_id\":\"$OID2\",\"devSlip\":{\"transRef\":\"REFA2\",\"amount\":10,\"transDate\":\"$NOW\"}}" | jq
# Expected: {"error":"AMOUNT_MISMATCH"}
```

- [ ] **Step 3: เมื่อได้ EASYSLIP_TOKEN จริง** — ยิงสลิปจริง 1 ใบผ่าน `imageBase64` ตรวจว่า mapping ใน `easyslip.ts` ตรงกับ response จริง ถ้าไม่ตรงแก้ adapter + test ใน Task 9 ให้ตรงของจริง (ทำเป็นส่วนหนึ่งของ Phase 5 ได้ถ้ายังไม่มี token)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/verify-slip && git commit -m "feat: verify-slip edge function with auto slip validation"
```

---

### Task 12: Edge function `update-order-status` (ฝั่งร้าน) + `line-webhook`

**Files:**
- Create: `supabase/functions/update-order-status/index.ts`
- Create: `supabase/functions/line-webhook/index.ts`

- [ ] **Step 1: เขียน `update-order-status`** (ต้องมี Supabase JWT ของ staff — `verify_jwt` เปิดตาม default)

```ts
// supabase/functions/update-order-status/index.ts
import { createClient } from "@supabase/supabase-js";
import { json, errorResponse, HttpError, CORS } from "../_shared/http.ts";
import { pushText } from "../_shared/line.ts";
import { msgAccepted, msgReady, msgRejected, msgRefunded } from "../_shared/messages.ts";

type Action = "ACCEPT" | "REJECT" | "READY" | "COMPLETE" | "CONFIRM_REFUND" | "MANUAL_PAID";

// สถานะที่อนุญาตก่อนทำ action + สถานะปลายทาง + คอลัมน์เวลา
const TRANSITIONS: Record<Action, { from: string[]; to: string; at: string | null }> = {
  MANUAL_PAID:    { from: ["PENDING_PAYMENT"], to: "PAID",           at: "paid_at" },
  ACCEPT:         { from: ["PAID"],            to: "COOKING",        at: "accepted_at" },
  REJECT:         { from: ["PAID", "COOKING"], to: "REFUND_PENDING", at: null },
  READY:          { from: ["COOKING"],         to: "READY",          at: "ready_at" },
  COMPLETE:       { from: ["READY"],           to: "COMPLETED",      at: "completed_at" },
  CONFIRM_REFUND: { from: ["REFUND_PENDING"],  to: "REFUNDED",       at: "refunded_at" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // ยืนยันว่าเป็น staff จริง (JWT แนบมากับ request)
    const auth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) throw new HttpError(401, "UNAUTHORIZED");

    const { order_id, action, reject_reason } = await req.json() as
      { order_id: string; action: Action; reject_reason?: string };
    const t = TRANSITIONS[action];
    if (!t) throw new HttpError(400, "BAD_ACTION");
    if (action === "REJECT" && !reject_reason) throw new HttpError(400, "REASON_REQUIRED");

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const patch: Record<string, unknown> = { status: t.to };
    if (t.at) patch[t.at] = new Date().toISOString();
    if (action === "REJECT") patch.reject_reason = reject_reason;

    const { data: order, error } = await db.from("orders").update(patch)
      .eq("id", order_id).in("status", t.from)
      .select("order_no,customer_id").single();
    if (error || !order) throw new HttpError(409, "WRONG_STATUS");

    // push ลูกค้าตามเหตุการณ์ (REJECT/REFUND รวมแจ้งคืนเงิน — ดู spec เรื่องประหยัดโควต้า)
    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
    const { data: s } = await db.from("shop_settings")
      .select("est_prep_minutes,notify_on_accept").eq("id", 1).single();
    const msg: string | null =
      action === "ACCEPT" ? (s!.notify_on_accept ? msgAccepted(order.order_no, s!.est_prep_minutes) : null)
      : action === "READY" ? msgReady(order.order_no)
      : action === "REJECT" ? msgRejected(order.order_no, reject_reason!)
      : action === "CONFIRM_REFUND" ? msgRefunded(order.order_no)
      : null;
    if (msg && !order.customer_id.startsWith("U_smoke")) {
      await pushText(order.customer_id, msg, token);
    }

    return json({ ok: true, status: t.to });
  } catch (e) {
    return errorResponse(e);
  }
});
```

- [ ] **Step 2: เขียน `line-webhook`** (ข้อความต้อนรับตอน follow ตั้งใน LINE OA Manager เป็น auto-greeting — ไม่ต้องเขียนโค้ด ที่นี่จัดการเฉพาะ event `join` เพื่อจำ group id ของกลุ่มพนักงาน)

```ts
// supabase/functions/line-webhook/index.ts
import { createClient } from "@supabase/supabase-js";
import { json } from "../_shared/http.ts";

async function validSignature(body: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === signature;
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const sig = req.headers.get("x-line-signature") ?? "";
  if (!(await validSignature(raw, sig, Deno.env.get("LINE_CHANNEL_SECRET")!))) {
    return json({ error: "BAD_SIGNATURE" }, 403);
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { events } = JSON.parse(raw);
  for (const ev of events ?? []) {
    // บอทถูกเชิญเข้ากลุ่มร้าน → จำ group id ไว้ใช้แจ้งเตือน (ถ้ายังไม่เคยตั้ง)
    if (ev.type === "join" && ev.source?.type === "group") {
      await db.from("shop_settings")
        .update({ line_group_id: ev.source.groupId })
        .eq("id", 1).is("line_group_id", null);
      console.log(`joined group: ${ev.source.groupId}`);
    }
  }
  return json({ ok: true });
});
```

- [ ] **Step 3: ทดสอบ transition กับ local stack**

```bash
# สร้าง staff user ผ่าน GoTrue admin API (Supabase CLI ไม่มีคำสั่งสร้าง user ตรงๆ)
curl -s -X POST "http://127.0.0.1:54321/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staff@shop.local","password":"staff1234","email_confirm":true}'
STAFF_JWT=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"staff@shop.local","password":"staff1234"}' | jq -r .access_token)

# ACCEPT ออเดอร์ที่ PAID จาก Task 11 ($OID)
curl -s -X POST http://127.0.0.1:54321/functions/v1/update-order-status \
  -H "Authorization: Bearer $STAFF_JWT" -H "Content-Type: application/json" \
  -d "{\"order_id\":\"$OID\",\"action\":\"ACCEPT\"}" | jq
# Expected: {"ok":true,"status":"COOKING"}

# ข้ามขั้น: COMPLETE ทั้งที่ยัง COOKING → WRONG_STATUS
curl -s -X POST http://127.0.0.1:54321/functions/v1/update-order-status \
  -H "Authorization: Bearer $STAFF_JWT" -H "Content-Type: application/json" \
  -d "{\"order_id\":\"$OID\",\"action\":\"COMPLETE\"}" | jq
# Expected: {"error":"WRONG_STATUS"} (409)

# READY → COMPLETE ตามลำดับ → ผ่าน
# ไม่มี JWT → 401
curl -s -X POST http://127.0.0.1:54321/functions/v1/update-order-status \
  -H "Content-Type: application/json" -d "{\"order_id\":\"$OID\",\"action\":\"READY\"}" -w "%{http_code}"
# Expected: 401
```

($ANON_KEY / $SERVICE_ROLE_KEY มาจาก output ของ `supabase start` หรือ `supabase status`)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/update-order-status supabase/functions/line-webhook
git commit -m "feat: staff order status transitions and LINE webhook"
```

---

### Task 13: Smoke script end-to-end

**Files:**
- Create: `scripts/smoke.sh`

- [ ] **Step 1: เขียน script** (รวมทุกอย่างจาก Task 10–12 เป็นชุดเดียว รันซ้ำได้)

```bash
#!/usr/bin/env bash
# ทดสอบ flow เต็ม: สั่ง → จ่าย(devSlip) → รับ → เสร็จ → รับของ + เคสล้มเหลวหลัก
# ใช้กับ local stack: ต้อง supabase start + supabase functions serve อยู่ก่อน
set -euo pipefail

BASE="http://127.0.0.1:54321"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ANON_KEY="${ANON_KEY:?ใส่ ANON_KEY จาก supabase status}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?ใส่ SERVICE_ROLE_KEY จาก supabase status}"
TEA="a0000000-0000-0000-0000-000000000002"
PASS=0; FAIL=0
check() { # check <desc> <actual> <expected>
  if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); echo "✅ $1";
  else FAIL=$((FAIL+1)); echo "❌ $1 — got '$2' want '$3'"; fi
}

# เตรียม staff
curl -s -X POST "$BASE/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staff@shop.local","password":"staff1234","email_confirm":true}' > /dev/null || true
JWT=$(curl -s -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"staff@shop.local","password":"staff1234"}' | jq -r .access_token)

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REF="SMOKE-$(date +%s)"

# 1. สั่ง
R=$(curl -s -X POST "$BASE/functions/v1/create-order" -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke_e2e\",\"pickup_type\":\"ASAP\",\"items\":[{\"menuItemId\":\"$TEA\",\"qty\":2,\"optionItemIds\":[]}]}")
OID=$(echo "$R" | jq -r .order_id)
check "create-order total=50" "$(echo "$R" | jq -r .total)" "50"
check "qr ขึ้นต้น 000201" "$(echo "$R" | jq -r .qr_payload | cut -c1-6)" "000201"

# 2. จ่ายยอดผิดต้องไม่ผ่าน
R=$(curl -s -X POST "$BASE/functions/v1/verify-slip" -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke_e2e\",\"order_id\":\"$OID\",\"devSlip\":{\"transRef\":\"$REF-bad\",\"amount\":10,\"transDate\":\"$NOW\"}}")
check "ยอดไม่พอ → AMOUNT_MISMATCH" "$(echo "$R" | jq -r .error)" "AMOUNT_MISMATCH"

# 3. จ่ายถูก → PAID
R=$(curl -s -X POST "$BASE/functions/v1/verify-slip" -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke_e2e\",\"order_id\":\"$OID\",\"devSlip\":{\"transRef\":\"$REF\",\"amount\":50,\"transDate\":\"$NOW\"}}")
check "จ่ายสำเร็จ → PAID" "$(echo "$R" | jq -r .status)" "PAID"

# 4. staff เดินสถานะ ACCEPT → READY → COMPLETE
for STEP in "ACCEPT:COOKING" "READY:READY" "COMPLETE:COMPLETED"; do
  A="${STEP%%:*}"; WANT="${STEP##*:}"
  R=$(curl -s -X POST "$BASE/functions/v1/update-order-status" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d "{\"order_id\":\"$OID\",\"action\":\"$A\"}")
  check "$A → $WANT" "$(echo "$R" | jq -r .status)" "$WANT"
done

# 5. flow ปฏิเสธ + คืนเงิน
OID2=$(curl -s -X POST "$BASE/functions/v1/create-order" -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke_e2e\",\"pickup_type\":\"ASAP\",\"items\":[{\"menuItemId\":\"$TEA\",\"qty\":1,\"optionItemIds\":[]}]}" | jq -r .order_id)
curl -s -X POST "$BASE/functions/v1/verify-slip" -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke_e2e\",\"order_id\":\"$OID2\",\"devSlip\":{\"transRef\":\"$REF-2\",\"amount\":25,\"transDate\":\"$NOW\"}}" > /dev/null
R=$(curl -s -X POST "$BASE/functions/v1/update-order-status" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"order_id\":\"$OID2\",\"action\":\"REJECT\",\"reject_reason\":\"วัตถุดิบหมด\"}")
check "REJECT → REFUND_PENDING" "$(echo "$R" | jq -r .status)" "REFUND_PENDING"
R=$(curl -s -X POST "$BASE/functions/v1/update-order-status" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"order_id\":\"$OID2\",\"action\":\"CONFIRM_REFUND\"}")
check "CONFIRM_REFUND → REFUNDED" "$(echo "$R" | jq -r .status)" "REFUNDED"

echo; echo "ผ่าน $PASS / ตก $FAIL"
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: รัน**

```bash
chmod +x scripts/smoke.sh
supabase status   # คัด ANON_KEY / SERVICE_ROLE_KEY
ANON_KEY=... SERVICE_ROLE_KEY=... ./scripts/smoke.sh
```

Expected: `ผ่าน 9 / ตก 0` exit code 0

- [ ] **Step 3: รัน unit tests ทั้งหมดปิดท้าย**

```bash
deno task test
```

Expected: PASS ทั้งหมด

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.sh && git commit -m "test: end-to-end smoke script for order lifecycle"
```

---

## เสร็จเฟส 1 เมื่อ

1. `deno task test` ผ่านทั้งหมด
2. `./scripts/smoke.sh` ผ่าน 9/9
3. ตรวจ SQL edge cases ใน Task 1–4 ผ่านตามที่ระบุ
4. สแกน QR จาก `qr_payload` ด้วยแอปธนาคารจริงขึ้นชื่อบัญชี+ยอดถูกต้อง (Task 5 Step 6)

สิ่งที่จงใจเลื่อนไป Phase 5 (ต้องมี account จริง): ทดสอบ EasySlip กับสลิปจริง, ทดสอบ push LINE จริง, ตั้ง webhook URL จริง



