create or replace function public.prepare_immutable_trade_log()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_previous_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1979));

  select entry_hash
    into v_previous_hash
  from public.trade_logs
  where user_id = new.user_id
  order by created_at desc, id desc
  limit 1;

  new.previous_hash := v_previous_hash;
  new.entry_hash := encode(
    extensions.digest(
      concat_ws('|',
        coalesce(v_previous_hash, 'GENESIS'),
        new.id::text,
        new.user_id::text,
        coalesce(new.wallet_id::text, ''),
        coalesce(new.session_id::text, ''),
        coalesce(new.position_id::text, ''),
        coalesce(new.order_id::text, ''),
        new.agent_name,
        new.action,
        new.reason,
        coalesce(new.result::text, ''),
        new.payload::text,
        new.created_at::text
      )::text,
      'sha256'::text
    ),
    'hex'
  );
  return new;
end;
$$;