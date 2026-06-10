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
