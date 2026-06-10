alter table orders add column promptpay_id text;
update orders set promptpay_id = (select promptpay_id from shop_settings where id = 1);
alter table orders alter column promptpay_id set not null;
