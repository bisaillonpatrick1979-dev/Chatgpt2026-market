create unique index if not exists positions_one_open_symbol_per_user
  on public.positions(user_id, symbol)
  where status = 'open';

create or replace function public.prevent_duplicate_agent_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.origin in ('agent','assisted')
     and exists (
       select 1 from public.positions
       where user_id = new.user_id
         and symbol = new.symbol
         and status = 'open'
     ) then
    raise exception 'Une position est déjà ouverte sur %. Nouvel ordre paper refusé.', new.symbol
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_duplicate_agent_order() from public, anon, authenticated;

drop trigger if exists orders_prevent_duplicate_agent_order on public.orders;
create trigger orders_prevent_duplicate_agent_order
before insert on public.orders
for each row execute function public.prevent_duplicate_agent_order();