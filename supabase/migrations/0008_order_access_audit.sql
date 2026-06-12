alter table orders add column if not exists order_access_token text;
update orders
set order_access_token = gen_random_uuid()::text
where order_access_token is null;
alter table orders alter column order_access_token set not null;
create unique index if not exists orders_order_access_token_idx
  on orders (order_access_token);

alter table orders add column if not exists manual_paid_at timestamptz;
alter table orders add column if not exists manual_paid_by uuid;
alter table orders add column if not exists manual_paid_reason text;
