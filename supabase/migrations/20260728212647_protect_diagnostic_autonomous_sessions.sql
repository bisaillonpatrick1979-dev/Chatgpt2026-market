create or replace function public.block_diagnostic_agent_orders()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.origin = 'agent'
     and new.session_id is not null
     and exists (
       select 1 from public.agent_sessions s
       where s.id = new.session_id
         and coalesce((s.settings->>'diagnostic')::boolean, false) = true
     ) then
    raise exception 'Session diagnostique : ordre paper volontairement bloqué.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.block_diagnostic_agent_orders() from public, anon, authenticated;

drop trigger if exists orders_block_diagnostic_agent_orders on public.orders;
create trigger orders_block_diagnostic_agent_orders
before insert on public.orders
for each row execute function public.block_diagnostic_agent_orders();