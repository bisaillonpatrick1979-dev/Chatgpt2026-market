alter table public.positions
  add column if not exists initial_stop_loss numeric,
  add column if not exists dynamic_stop_loss numeric,
  add column if not exists high_watermark numeric,
  add column if not exists low_watermark numeric,
  add column if not exists trailing_stop_pct numeric,
  add column if not exists last_mark_price numeric,
  add column if not exists last_marked_at timestamptz,
  add column if not exists exit_reason text,
  add column if not exists closing_order_id uuid references public.orders(id) on delete set null;

update public.positions
set initial_stop_loss = coalesce(initial_stop_loss, stop_loss),
    high_watermark = coalesce(high_watermark, entry_price),
    low_watermark = coalesce(low_watermark, entry_price),
    trailing_stop_pct = coalesce(trailing_stop_pct, 0.75)
where origin = 'agent';

create index if not exists positions_open_agent_monitor_idx
  on public.positions(user_id, opened_at)
  where origin = 'agent' and status = 'open';

create index if not exists positions_closing_order_id_idx
  on public.positions(closing_order_id)
  where closing_order_id is not null;

create or replace function public.prepare_agent_position_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.origin = 'agent' then
    new.initial_stop_loss := coalesce(new.initial_stop_loss, new.stop_loss);
    new.high_watermark := coalesce(new.high_watermark, new.entry_price);
    new.low_watermark := coalesce(new.low_watermark, new.entry_price);
    new.trailing_stop_pct := coalesce(new.trailing_stop_pct, 0.75);
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_agent_position_lifecycle() from public, anon, authenticated;

drop trigger if exists positions_prepare_agent_lifecycle on public.positions;
create trigger positions_prepare_agent_lifecycle
before insert on public.positions
for each row execute function public.prepare_agent_position_lifecycle();

create or replace function public.prevent_duplicate_agent_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.origin in ('agent','assisted')
     and coalesce(new.metadata->>'closingPositionId', '') = ''
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

create or replace function public.manage_agent_paper_position(
  p_user_id uuid,
  p_position_id uuid,
  p_market_price numeric,
  p_trailing_stop_pct numeric default 0.75,
  p_force_close boolean default false,
  p_force_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_position public.positions;
  v_wallet public.paper_wallets;
  v_initial_stop numeric;
  v_initial_risk numeric;
  v_favorable_move numeric;
  v_high numeric;
  v_low numeric;
  v_trailing_pct numeric;
  v_trailing_candidate numeric;
  v_dynamic_stop numeric;
  v_effective_stop numeric;
  v_should_close boolean := false;
  v_reason text;
  v_pnl numeric;
  v_cash_flow numeric;
  v_next_cash numeric;
  v_closing_side text;
  v_order_id uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  if p_user_id is null or p_position_id is null then
    raise exception 'Utilisateur et position requis.' using errcode = '22023';
  end if;
  if p_market_price is null or p_market_price <= 0 then
    raise exception 'Prix de marché invalide.' using errcode = '22023';
  end if;

  select * into v_position
  from public.positions
  where id = p_position_id
    and user_id = p_user_id
    and origin = 'agent'
  for update;

  if v_position.id is null then
    raise exception 'Position agent introuvable.' using errcode = 'P0001';
  end if;
  if v_position.status <> 'open' then
    return jsonb_build_object('ok', true, 'alreadyClosed', true, 'positionId', v_position.id);
  end if;

  select * into v_wallet
  from public.paper_wallets
  where id = v_position.wallet_id and user_id = p_user_id
  for update;
  if v_wallet.id is null then
    raise exception 'Portefeuille paper introuvable.' using errcode = 'P0001';
  end if;

  v_initial_stop := coalesce(v_position.initial_stop_loss, v_position.stop_loss);
  v_initial_risk := case when v_initial_stop is null then 0 else abs(v_position.entry_price - v_initial_stop) end;
  v_high := greatest(coalesce(v_position.high_watermark, v_position.entry_price), p_market_price);
  v_low := least(coalesce(v_position.low_watermark, v_position.entry_price), p_market_price);
  v_trailing_pct := greatest(0.05, least(10, coalesce(p_trailing_stop_pct, v_position.trailing_stop_pct, 0.75)));

  if v_position.side = 'BUY' then
    v_favorable_move := greatest(0, v_high - v_position.entry_price);
    v_dynamic_stop := coalesce(v_position.dynamic_stop_loss, v_initial_stop);

    if v_initial_risk > 0 and v_favorable_move >= v_initial_risk * 0.5 then
      v_trailing_candidate := v_high * (1 - v_trailing_pct / 100);
      v_dynamic_stop := greatest(coalesce(v_dynamic_stop, v_trailing_candidate), v_trailing_candidate);
    end if;
    if v_initial_risk > 0 and v_favorable_move >= v_initial_risk then
      v_dynamic_stop := greatest(coalesce(v_dynamic_stop, v_position.entry_price), v_position.entry_price);
    end if;

    v_effective_stop := greatest(coalesce(v_initial_stop, 0), coalesce(v_dynamic_stop, 0));
    if v_position.take_profit is not null and p_market_price >= v_position.take_profit then
      v_should_close := true;
      v_reason := 'Take-profit paper atteint.';
    elsif v_effective_stop > 0 and p_market_price <= v_effective_stop then
      v_should_close := true;
      v_reason := case when v_dynamic_stop is not null and v_dynamic_stop > coalesce(v_initial_stop, 0)
        then 'Stop dynamique paper atteint.' else 'Stop-loss paper atteint.' end;
    end if;
  else
    v_favorable_move := greatest(0, v_position.entry_price - v_low);
    v_dynamic_stop := coalesce(v_position.dynamic_stop_loss, v_initial_stop);

    if v_initial_risk > 0 and v_favorable_move >= v_initial_risk * 0.5 then
      v_trailing_candidate := v_low * (1 + v_trailing_pct / 100);
      v_dynamic_stop := least(coalesce(v_dynamic_stop, v_trailing_candidate), v_trailing_candidate);
    end if;
    if v_initial_risk > 0 and v_favorable_move >= v_initial_risk then
      v_dynamic_stop := least(coalesce(v_dynamic_stop, v_position.entry_price), v_position.entry_price);
    end if;

    v_effective_stop := least(coalesce(v_initial_stop, 1e30), coalesce(v_dynamic_stop, 1e30));
    if v_position.take_profit is not null and p_market_price <= v_position.take_profit then
      v_should_close := true;
      v_reason := 'Take-profit paper atteint.';
    elsif v_effective_stop < 1e30 and p_market_price >= v_effective_stop then
      v_should_close := true;
      v_reason := case when v_dynamic_stop is not null and v_dynamic_stop < coalesce(v_initial_stop, 1e30)
        then 'Stop dynamique paper atteint.' else 'Stop-loss paper atteint.' end;
    end if;
  end if;

  if p_force_close then
    v_should_close := true;
    v_reason := coalesce(nullif(trim(p_force_reason), ''), 'Fermeture automatique de fin de session.');
  end if;

  update public.positions
  set high_watermark = v_high,
      low_watermark = v_low,
      trailing_stop_pct = v_trailing_pct,
      dynamic_stop_loss = v_dynamic_stop,
      last_mark_price = p_market_price,
      last_marked_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'positionManager', jsonb_build_object(
          'lastPrice', p_market_price,
          'effectiveStop', case when v_effective_stop >= 1e30 then null else v_effective_stop end,
          'highWatermark', v_high,
          'lowWatermark', v_low,
          'trailingStopPct', v_trailing_pct,
          'updatedAt', v_now
        )
      ) || coalesce(p_metadata, '{}'::jsonb)
  where id = v_position.id;

  if not v_should_close then
    return jsonb_build_object(
      'ok', true,
      'closed', false,
      'positionId', v_position.id,
      'symbol', v_position.symbol,
      'marketPrice', p_market_price,
      'effectiveStop', case when v_effective_stop >= 1e30 then null else v_effective_stop end,
      'takeProfit', v_position.take_profit,
      'highWatermark', v_high,
      'lowWatermark', v_low
    );
  end if;

  v_pnl := case when v_position.side = 'BUY'
    then (p_market_price - v_position.entry_price) * v_position.quantity
    else (v_position.entry_price - p_market_price) * v_position.quantity
  end;
  v_cash_flow := p_market_price * v_position.quantity;
  v_next_cash := case when v_position.side = 'BUY'
    then v_wallet.cash_balance + v_cash_flow
    else v_wallet.cash_balance - v_cash_flow
  end;
  v_closing_side := case when v_position.side = 'BUY' then 'SELL' else 'BUY' end;

  insert into public.orders (
    id, user_id, wallet_id, session_id, symbol, exchange, asset_type, side,
    order_type, quantity, average_fill_price, status, origin, filled_at, metadata
  ) values (
    v_order_id, p_user_id, v_position.wallet_id, v_position.session_id,
    v_position.symbol, v_position.exchange, v_position.asset_type, v_closing_side,
    'market', v_position.quantity, p_market_price, 'filled', 'agent', v_now,
    jsonb_build_object(
      'closingPositionId', v_position.id,
      'exitReason', v_reason,
      'paperOnly', true,
      'positionManager', true
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  update public.positions
  set status = 'closed',
      closed_at = v_now,
      exit_price = p_market_price,
      realized_pnl = v_pnl,
      exit_reason = v_reason,
      closing_order_id = v_order_id,
      last_mark_price = p_market_price,
      last_marked_at = v_now
  where id = v_position.id;

  update public.paper_wallets
  set cash_balance = v_next_cash,
      updated_at = v_now
  where id = v_wallet.id;

  insert into public.trade_logs (
    user_id, wallet_id, session_id, position_id, order_id, agent_name,
    action, reason, result, payload
  ) values (
    p_user_id, v_position.wallet_id, v_position.session_id, v_position.id, v_order_id,
    'Gestionnaire autonome de positions',
    'Fermeture ' || v_position.symbol,
    v_reason,
    v_pnl,
    jsonb_build_object(
      'symbol', v_position.symbol,
      'entryPrice', v_position.entry_price,
      'exitPrice', p_market_price,
      'quantity', v_position.quantity,
      'side', v_position.side,
      'realizedPnl', v_pnl,
      'cashBalance', v_next_cash,
      'highWatermark', v_high,
      'lowWatermark', v_low,
      'effectiveStop', case when v_effective_stop >= 1e30 then null else v_effective_stop end,
      'paperOnly', true,
      'positionManager', true
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'ok', true,
    'closed', true,
    'positionId', v_position.id,
    'closingOrderId', v_order_id,
    'symbol', v_position.symbol,
    'reason', v_reason,
    'exitPrice', p_market_price,
    'realizedPnl', v_pnl,
    'cashBalance', v_next_cash
  );
end;
$$;

revoke all on function public.manage_agent_paper_position(uuid,uuid,numeric,numeric,boolean,text,jsonb) from public, anon, authenticated;
grant execute on function public.manage_agent_paper_position(uuid,uuid,numeric,numeric,boolean,text,jsonb) to service_role;