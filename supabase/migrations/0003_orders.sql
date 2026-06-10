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
revoke execute on function next_order_no(date) from public;
grant execute on function next_order_no(date) to service_role, authenticated;

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
  unit_price numeric(8,2) not null check (unit_price >= 0),
  options jsonb not null default '[]',   -- [{"group":"เนื้อสัตว์","name":"เนื้อ","price_delta":10}]
  note text,
  line_total numeric(8,2) not null check (line_total >= 0)
);
create index order_items_order_id_idx on order_items (order_id);

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

-- สิทธิ์ระดับตาราง (auto_expose_new_tables=false): staff dashboard ใช้ authenticated
grant select, insert, update, delete on customers, orders, order_items, shop_settings to authenticated;
-- service role (edge functions) — รวม daily_counters เพื่อให้ next_order_no ทำงานได้
grant select, insert, update, delete on customers, orders, order_items, shop_settings, daily_counters to service_role;

-- สถานะร้านแบบสาธารณะ (LIFF เช็คเปิด/ปิด) — ไม่เผย promptpay_id / line_group_id
create view public_shop_status
  with (security_invoker = off) as
  select shop_name, is_accepting, open_time, close_time, est_prep_minutes
  from shop_settings;
grant select on public_shop_status to anon, authenticated;

-- realtime ให้ dashboard subscribe ออเดอร์
alter publication supabase_realtime add table orders;

-- bucket เก็บรูปสลิป (private — เข้าถึงผ่าน service role / signed URL)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);
