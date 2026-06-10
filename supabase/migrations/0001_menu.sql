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

-- สิทธิ์ระดับตาราง (RLS เป็นตัวกรองชั้นบน): ลูกค้า anon อ่านเมนู, staff เขียนได้
grant select on menu_categories, menu_items, option_groups, option_items, menu_item_option_groups to anon, authenticated;
grant insert, update, delete on menu_categories, menu_items, option_groups, option_items, menu_item_option_groups to authenticated;
