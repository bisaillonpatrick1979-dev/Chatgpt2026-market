alter table public.trade_logs drop constraint if exists trade_logs_position_id_fkey;
alter table public.trade_logs drop constraint if exists trade_logs_order_id_fkey;

comment on column public.trade_logs.position_id is 'Optional audit correlation ID; intentionally not enforced so logs survive partial or failed order writes.';
comment on column public.trade_logs.order_id is 'Optional audit correlation ID; intentionally not enforced so logs survive partial or failed order writes.';