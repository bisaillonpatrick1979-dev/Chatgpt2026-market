create table if not exists public.market_instruments (
  id text primary key,
  symbol text not null,
  provider_symbol text not null,
  label text not null,
  asset_type text not null check (asset_type in ('equity','forex','crypto','fund','index','commodity','option')),
  market_region text not null,
  venue_name text not null,
  exchange_code text,
  mic_code text,
  country text,
  timezone text not null,
  currency text not null,
  session_kind text not null check (session_kind in ('exchange','forex','crypto')),
  sessions jsonb not null default '[]'::jsonb,
  data_provider text not null default 'twelve_data',
  execution_provider text not null default 'internal_paper',
  access_note text,
  default_watchlist boolean not null default true,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(sessions) = 'array')
);

create unique index if not exists market_instruments_provider_venue_key
  on public.market_instruments(provider_symbol, coalesce(mic_code, ''));
create index if not exists market_instruments_region_idx
  on public.market_instruments(market_region, sort_order);

alter table public.market_instruments enable row level security;
drop policy if exists market_instruments_authenticated_select on public.market_instruments;
create policy market_instruments_authenticated_select
on public.market_instruments
for select to authenticated
using (enabled = true);

revoke all on public.market_instruments from anon, authenticated;
grant select on public.market_instruments to authenticated;

insert into public.market_instruments (
  id, symbol, provider_symbol, label, asset_type, market_region, venue_name,
  exchange_code, mic_code, country, timezone, currency, session_kind, sessions,
  data_provider, execution_provider, access_note, default_watchlist, sort_order
) values
  ('us_aapl','AAPL','AAPL','Apple','equity','new_york','Nasdaq','NASDAQ','XNAS','United States','America/New_York','USD','exchange','[{"name":"Régulière","open":"09:30","close":"16:00"}]','twelve_data','internal_paper','Temps réel offert selon le forfait Twelve Data.',true,10),
  ('us_msft','MSFT','MSFT','Microsoft','equity','new_york','Nasdaq','NASDAQ','XNAS','United States','America/New_York','USD','exchange','[{"name":"Régulière","open":"09:30","close":"16:00"}]','twelve_data','internal_paper','Temps réel offert selon le forfait Twelve Data.',true,11),
  ('ca_shop','SHOP','SHOP','Shopify','equity','toronto','Toronto Stock Exchange','TSX','XTSE','Canada','America/Toronto','CAD','exchange','[{"name":"Régulière","open":"09:30","close":"16:00"}]','twelve_data','internal_paper','Couverture canadienne et délai selon le forfait.',true,20),
  ('uk_vod','VOD','VOD','Vodafone','equity','london','London Stock Exchange','LSE','XLON','United Kingdom','Europe/London','GBP','exchange','[{"name":"Régulière","open":"08:00","close":"16:30"}]','twelve_data','internal_paper','Couverture européenne généralement soumise au forfait ou à une donnée de fin de journée.',true,30),
  ('eu_air','AIR','AIR','Airbus','equity','europe','Euronext Paris','EURONEXT','XPAR','France','Europe/Paris','EUR','exchange','[{"name":"Régulière","open":"09:00","close":"17:30"}]','twelve_data','internal_paper','Couverture Euronext selon le forfait; vérifier le délai de chaque instrument.',true,31),
  ('jp_7203','7203','7203','Toyota Motor','equity','tokyo','Tokyo Stock Exchange','TSE','XJPX','Japan','Asia/Tokyo','JPY','exchange','[{"name":"Matin","open":"09:00","close":"11:30"},{"name":"Après-midi","open":"12:30","close":"15:30"}]','twelve_data','internal_paper','Accès Tokyo selon le forfait; la place est explicitement transmise avec le symbole.',true,40),
  ('au_bhp','BHP','BHP','BHP Group','equity','sydney','Australian Securities Exchange','ASX','XASX','Australia','Australia/Sydney','AUD','exchange','[{"name":"Régulière","open":"10:00","close":"16:00"}]','twelve_data','internal_paper','ASX peut être retardé et nécessiter un ajout de données.',true,50),
  ('fx_eurusd','EUR/USD','EUR/USD','Euro / dollar US','forex','global_fx','Forex composite mondial',null,null,null,'UTC','USD','forex','[]','twelve_data','internal_paper','Flux composite mondial; la session de liquidité est Sydney, Tokyo, Londres ou New York.',true,60),
  ('fx_usdjpy','USD/JPY','USD/JPY','Dollar US / yen','forex','global_fx','Forex composite mondial',null,null,null,'UTC','JPY','forex','[]','twelve_data','internal_paper','Flux composite mondial; la session de liquidité est Sydney, Tokyo, Londres ou New York.',true,61),
  ('fx_gbpusd','GBP/USD','GBP/USD','Livre sterling / dollar US','forex','global_fx','Forex composite mondial',null,null,null,'UTC','USD','forex','[]','twelve_data','internal_paper','Flux composite mondial; la session de liquidité est Sydney, Tokyo, Londres ou New York.',true,62),
  ('fx_audusd','AUD/USD','AUD/USD','Dollar australien / dollar US','forex','global_fx','Forex composite mondial',null,null,null,'UTC','USD','forex','[]','twelve_data','internal_paper','Flux composite mondial; la session de liquidité est Sydney, Tokyo, Londres ou New York.',true,63),
  ('fx_usdcad','USD/CAD','USD/CAD','Dollar US / dollar canadien','forex','global_fx','Forex composite mondial',null,null,null,'UTC','CAD','forex','[]','twelve_data','internal_paper','Flux composite mondial; la session de liquidité est Sydney, Tokyo, Londres ou New York.',true,64),
  ('crypto_btcusd','BTC/USD','BTC/USD','Bitcoin / dollar US','crypto','crypto_global','Marché crypto mondial',null,null,null,'UTC','USD','crypto','[]','twelve_data','internal_paper','Marché continu 24/7; la source et la destination paper restent séparées.',true,70)
on conflict (id) do update set
  symbol = excluded.symbol,
  provider_symbol = excluded.provider_symbol,
  label = excluded.label,
  asset_type = excluded.asset_type,
  market_region = excluded.market_region,
  venue_name = excluded.venue_name,
  exchange_code = excluded.exchange_code,
  mic_code = excluded.mic_code,
  country = excluded.country,
  timezone = excluded.timezone,
  currency = excluded.currency,
  session_kind = excluded.session_kind,
  sessions = excluded.sessions,
  data_provider = excluded.data_provider,
  execution_provider = excluded.execution_provider,
  access_note = excluded.access_note,
  default_watchlist = excluded.default_watchlist,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.orders
  add column if not exists market_instrument_id text references public.market_instruments(id),
  add column if not exists venue_name text,
  add column if not exists mic_code text,
  add column if not exists market_region text,
  add column if not exists market_timezone text,
  add column if not exists market_session text,
  add column if not exists data_provider text,
  add column if not exists execution_provider text,
  add column if not exists data_access_note text;

alter table public.positions
  add column if not exists market_instrument_id text references public.market_instruments(id),
  add column if not exists venue_name text,
  add column if not exists mic_code text,
  add column if not exists market_region text,
  add column if not exists market_timezone text,
  add column if not exists market_session text,
  add column if not exists data_provider text,
  add column if not exists execution_provider text,
  add column if not exists data_access_note text;

create index if not exists orders_user_market_region_idx
  on public.orders(user_id, market_region, submitted_at desc);
create index if not exists positions_user_market_region_idx
  on public.positions(user_id, market_region, opened_at desc);

create or replace function public.resolve_market_session(
  p_session_kind text,
  p_timezone text,
  p_sessions jsonb,
  p_at timestamptz default now()
)
returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_local timestamp;
  v_local_time time;
  v_iso_day integer;
  v_session jsonb;
  v_names text[] := array[]::text[];
  v_hour numeric;
  v_ny timestamp;
begin
  if p_session_kind = 'crypto' then
    return '24/7';
  end if;

  if p_session_kind = 'forex' then
    v_ny := p_at at time zone 'America/New_York';
    v_iso_day := extract(isodow from v_ny)::integer;
    v_hour := extract(hour from v_ny) + extract(minute from v_ny) / 60.0;
    if v_iso_day = 6 or (v_iso_day = 7 and v_hour < 17) or (v_iso_day = 5 and v_hour >= 17) then
      return 'Fermé hebdomadaire';
    end if;

    v_local := p_at at time zone 'Australia/Sydney';
    v_hour := extract(hour from v_local) + extract(minute from v_local) / 60.0;
    if v_hour >= 8 and v_hour < 17 then v_names := array_append(v_names, 'Sydney'); end if;

    v_local := p_at at time zone 'Asia/Tokyo';
    v_hour := extract(hour from v_local) + extract(minute from v_local) / 60.0;
    if v_hour >= 8 and v_hour < 17 then v_names := array_append(v_names, 'Tokyo'); end if;

    v_local := p_at at time zone 'Europe/London';
    v_hour := extract(hour from v_local) + extract(minute from v_local) / 60.0;
    if v_hour >= 8 and v_hour < 17 then v_names := array_append(v_names, 'Londres'); end if;

    v_local := p_at at time zone 'America/New_York';
    v_hour := extract(hour from v_local) + extract(minute from v_local) / 60.0;
    if v_hour >= 8 and v_hour < 17 then v_names := array_append(v_names, 'New York'); end if;

    if cardinality(v_names) = 0 then
      return 'Entre sessions principales';
    end if;
    return array_to_string(v_names, ' + ');
  end if;

  v_local := p_at at time zone p_timezone;
  v_iso_day := extract(isodow from v_local)::integer;
  if v_iso_day in (6, 7) then
    return 'Fermé';
  end if;
  v_local_time := v_local::time;

  for v_session in select value from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb))
  loop
    if v_local_time >= (v_session->>'open')::time
       and v_local_time < (v_session->>'close')::time then
      return coalesce(v_session->>'name', 'Régulière');
    end if;
  end loop;

  return 'Hors séance';
end;
$$;

create or replace function public.enrich_order_market_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_instrument public.market_instruments;
  v_session text;
begin
  select * into v_instrument
  from public.market_instruments
  where enabled = true
    and provider_symbol = new.symbol
  order by case when new.exchange is not null and (venue_name = new.exchange or exchange_code = new.exchange) then 0 else 1 end,
           sort_order
  limit 1;

  if v_instrument.id is null then
    return new;
  end if;

  v_session := public.resolve_market_session(v_instrument.session_kind, v_instrument.timezone, v_instrument.sessions, coalesce(new.submitted_at, now()));
  new.market_instrument_id := v_instrument.id;
  new.exchange := coalesce(new.exchange, v_instrument.venue_name);
  new.venue_name := v_instrument.venue_name;
  new.mic_code := v_instrument.mic_code;
  new.market_region := v_instrument.market_region;
  new.market_timezone := v_instrument.timezone;
  new.market_session := v_session;
  new.data_provider := v_instrument.data_provider;
  new.execution_provider := v_instrument.execution_provider;
  new.data_access_note := v_instrument.access_note;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'marketContext', jsonb_build_object(
      'instrumentId', v_instrument.id,
      'venueName', v_instrument.venue_name,
      'exchangeCode', v_instrument.exchange_code,
      'micCode', v_instrument.mic_code,
      'region', v_instrument.market_region,
      'timezone', v_instrument.timezone,
      'session', v_session,
      'dataProvider', v_instrument.data_provider,
      'executionProvider', v_instrument.execution_provider,
      'accessNote', v_instrument.access_note
    )
  );
  return new;
end;
$$;

create or replace function public.enrich_position_market_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders;
  v_instrument public.market_instruments;
  v_session text;
begin
  if new.opening_order_id is not null then
    select * into v_order from public.orders where id = new.opening_order_id;
  end if;

  if v_order.id is not null then
    new.market_instrument_id := v_order.market_instrument_id;
    new.exchange := coalesce(new.exchange, v_order.exchange);
    new.venue_name := v_order.venue_name;
    new.mic_code := v_order.mic_code;
    new.market_region := v_order.market_region;
    new.market_timezone := v_order.market_timezone;
    new.market_session := v_order.market_session;
    new.data_provider := v_order.data_provider;
    new.execution_provider := v_order.execution_provider;
    new.data_access_note := v_order.data_access_note;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('marketContext', v_order.metadata->'marketContext');
    return new;
  end if;

  select * into v_instrument
  from public.market_instruments
  where enabled = true and provider_symbol = new.symbol
  order by sort_order
  limit 1;

  if v_instrument.id is null then
    return new;
  end if;

  v_session := public.resolve_market_session(v_instrument.session_kind, v_instrument.timezone, v_instrument.sessions, coalesce(new.opened_at, now()));
  new.market_instrument_id := v_instrument.id;
  new.exchange := coalesce(new.exchange, v_instrument.venue_name);
  new.venue_name := v_instrument.venue_name;
  new.mic_code := v_instrument.mic_code;
  new.market_region := v_instrument.market_region;
  new.market_timezone := v_instrument.timezone;
  new.market_session := v_session;
  new.data_provider := v_instrument.data_provider;
  new.execution_provider := v_instrument.execution_provider;
  new.data_access_note := v_instrument.access_note;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'marketContext', jsonb_build_object(
      'instrumentId', v_instrument.id,
      'venueName', v_instrument.venue_name,
      'exchangeCode', v_instrument.exchange_code,
      'micCode', v_instrument.mic_code,
      'region', v_instrument.market_region,
      'timezone', v_instrument.timezone,
      'session', v_session,
      'dataProvider', v_instrument.data_provider,
      'executionProvider', v_instrument.execution_provider,
      'accessNote', v_instrument.access_note
    )
  );
  return new;
end;
$$;

drop trigger if exists orders_enrich_market_context on public.orders;
create trigger orders_enrich_market_context
before insert on public.orders
for each row execute function public.enrich_order_market_context();

drop trigger if exists positions_enrich_market_context on public.positions;
create trigger positions_enrich_market_context
before insert on public.positions
for each row execute function public.enrich_position_market_context();

revoke all on function public.enrich_order_market_context() from public, anon, authenticated;
revoke all on function public.enrich_position_market_context() from public, anon, authenticated;

create or replace function public.execute_agent_paper_trade(
  p_user_id uuid,
  p_session_id uuid,
  p_symbol text,
  p_side text,
  p_entry_price numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_quantity numeric,
  p_research_run_id uuid,
  p_market_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.agent_sessions;
  v_wallet public.paper_wallets;
  v_research public.market_research_runs;
  v_risk jsonb;
  v_max_positions integer;
  v_risk_pct numeric;
  v_position_count integer;
  v_existing_position uuid;
  v_agent_exposure numeric;
  v_notional numeric;
  v_risk_amount numeric;
  v_max_risk numeric;
  v_next_cash numeric;
  v_order_id uuid := gen_random_uuid();
  v_position_id uuid := gen_random_uuid();
  v_instrument public.market_instruments;
  v_market_session text;
begin
  if p_user_id is null or p_session_id is null then
    raise exception 'Utilisateur et session requis.' using errcode = '22023';
  end if;
  if p_side not in ('BUY','SELL') then
    raise exception 'Direction paper invalide.' using errcode = '22023';
  end if;
  if p_entry_price <= 0 or p_quantity <= 0 or p_stop_loss <= 0 or p_take_profit <= 0 then
    raise exception 'Prix, quantité, stop et cible doivent être positifs.' using errcode = '22023';
  end if;

  select * into v_session
  from public.agent_sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if v_session.id is null or v_session.trading_mode <> 'autonomous' or v_session.data_mode <> 'live' or v_session.status <> 'running' then
    raise exception 'Aucune session autonome live active pour cet ordre paper.' using errcode = 'P0001';
  end if;
  if v_session.ends_at is not null and v_session.ends_at <= now() then
    raise exception 'La session autonome est terminée.' using errcode = 'P0001';
  end if;

  select * into v_wallet
  from public.paper_wallets
  where id = v_session.wallet_id and user_id = p_user_id
  for update;

  if v_wallet.id is null then
    raise exception 'Portefeuille paper introuvable.' using errcode = 'P0001';
  end if;
  if v_wallet.kill_switch then
    raise exception 'Kill switch actif; nouvelle entrée refusée.' using errcode = 'P0001';
  end if;

  select * into v_research
  from public.market_research_runs
  where id = p_research_run_id
    and user_id = p_user_id
    and symbol = p_symbol
    and status = 'completed'
    and expires_at > now();

  if v_research.id is null then
    raise exception 'Recherche IA courante et valide requise.' using errcode = 'P0001';
  end if;
  if coalesce((v_research.result->'qualityGate'->>'passed')::boolean, false) is not true then
    raise exception 'Garde-fou de recherche non satisfait.' using errcode = 'P0001';
  end if;
  if v_research.signal <> p_side then
    raise exception 'Le signal IA ne correspond pas à la direction de l’ordre.' using errcode = 'P0001';
  end if;

  select * into v_instrument
  from public.market_instruments
  where enabled = true and provider_symbol = p_symbol
  order by sort_order
  limit 1;

  if v_instrument.id is null then
    raise exception 'Instrument non enregistré dans le registre mondial.' using errcode = 'P0001';
  end if;

  v_market_session := public.resolve_market_session(v_instrument.session_kind, v_instrument.timezone, v_instrument.sessions, now());
  v_risk := coalesce(v_wallet.risk_settings, '{}'::jsonb);
  if coalesce((v_risk->>'blockClosedMarkets')::boolean, true)
     and v_market_session in ('Fermé','Hors séance','Fermé hebdomadaire') then
    raise exception 'Marché fermé pour % (%).', p_symbol, v_market_session using errcode = 'P0001';
  end if;

  select id into v_existing_position
  from public.positions
  where user_id = p_user_id and symbol = p_symbol and status = 'open'
  limit 1;
  if v_existing_position is not null then
    raise exception 'Une position est déjà ouverte sur %.', p_symbol using errcode = 'P0001';
  end if;

  v_max_positions := greatest(1, coalesce((v_risk->>'maxPositions')::integer, 5));
  select count(*) into v_position_count
  from public.positions
  where user_id = p_user_id and status = 'open';
  if v_position_count >= v_max_positions then
    raise exception 'Maximum de % positions ouvertes atteint.', v_max_positions using errcode = 'P0001';
  end if;

  v_risk_pct := least(0.5, greatest(0.01, coalesce((v_risk->>'riskPerTradePct')::numeric, 0.25)));
  v_notional := abs(p_entry_price * p_quantity);
  v_risk_amount := abs(p_entry_price - p_stop_loss) * p_quantity;
  v_max_risk := greatest(0, v_wallet.agent_allocation * (v_risk_pct / 100));
  if v_risk_amount > v_max_risk + 0.01 then
    raise exception 'Risque de l’ordre supérieur à la limite paper.' using errcode = 'P0001';
  end if;

  select coalesce(sum(abs(entry_price * quantity)), 0)
    into v_agent_exposure
  from public.positions
  where user_id = p_user_id and origin = 'agent' and status = 'open';
  if v_agent_exposure + v_notional > v_wallet.agent_allocation + 0.01 then
    raise exception 'Allocation maximale des agents atteinte.' using errcode = 'P0001';
  end if;
  if p_side = 'BUY' and v_notional > v_wallet.cash_balance + 0.01 then
    raise exception 'Encaisse paper insuffisante.' using errcode = 'P0001';
  end if;

  v_next_cash := case when p_side = 'BUY'
    then v_wallet.cash_balance - v_notional
    else v_wallet.cash_balance + v_notional
  end;

  insert into public.orders (
    id, user_id, wallet_id, session_id, symbol, exchange, asset_type, side,
    order_type, quantity, stop_price, average_fill_price, status, origin,
    filled_at, metadata
  ) values (
    v_order_id, p_user_id, v_wallet.id, p_session_id, p_symbol, v_instrument.venue_name,
    v_instrument.asset_type, p_side, 'market', p_quantity, p_stop_loss,
    p_entry_price, 'filled', 'agent', now(),
    coalesce(p_market_context, '{}'::jsonb) || jsonb_build_object(
      'dataMode','live',
      'researchRunId',p_research_run_id,
      'riskAmount',v_risk_amount,
      'maxRisk',v_max_risk,
      'automaticGlobalCycle',true
    )
  );

  insert into public.positions (
    id, user_id, wallet_id, session_id, opening_order_id, symbol, exchange,
    asset_type, side, quantity, entry_price, stop_loss, take_profit, origin,
    status, opened_at, metadata
  ) values (
    v_position_id, p_user_id, v_wallet.id, p_session_id, v_order_id, p_symbol,
    v_instrument.venue_name, v_instrument.asset_type, p_side, p_quantity,
    p_entry_price, p_stop_loss, p_take_profit, 'agent', 'open', now(),
    coalesce(p_market_context, '{}'::jsonb) || jsonb_build_object(
      'dataMode','live',
      'researchRunId',p_research_run_id,
      'automaticGlobalCycle',true
    )
  );

  update public.paper_wallets
  set cash_balance = v_next_cash, updated_at = now()
  where id = v_wallet.id;

  insert into public.trade_logs (
    user_id, wallet_id, session_id, position_id, order_id, agent_name,
    action, reason, payload
  ) values (
    p_user_id, v_wallet.id, p_session_id, v_position_id, v_order_id,
    'Agent exécution global',
    case when p_side = 'BUY' then 'Achat global ' || p_symbol else 'Vente globale ' || p_symbol end,
    'Recherche multi-marchés validée, données fraîches et limites serveur respectées.',
    jsonb_build_object(
      'researchRunId',p_research_run_id,
      'venue',v_instrument.venue_name,
      'micCode',v_instrument.mic_code,
      'marketRegion',v_instrument.market_region,
      'marketSession',v_market_session,
      'dataProvider',v_instrument.data_provider,
      'executionProvider',v_instrument.execution_provider,
      'entryPrice',p_entry_price,
      'quantity',p_quantity,
      'stopLoss',p_stop_loss,
      'takeProfit',p_take_profit,
      'paperOnly',true
    )
  );

  return jsonb_build_object(
    'ok',true,
    'orderId',v_order_id,
    'positionId',v_position_id,
    'symbol',p_symbol,
    'side',p_side,
    'venue',v_instrument.venue_name,
    'micCode',v_instrument.mic_code,
    'region',v_instrument.market_region,
    'session',v_market_session,
    'dataProvider',v_instrument.data_provider,
    'executionProvider',v_instrument.execution_provider,
    'cashBalance',v_next_cash
  );
end;
$$;

revoke all on function public.execute_agent_paper_trade(uuid,uuid,text,text,numeric,numeric,numeric,numeric,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.execute_agent_paper_trade(uuid,uuid,text,text,numeric,numeric,numeric,numeric,uuid,jsonb) to service_role;

insert into public.watchlist_items (user_id, symbol, label, exchange, asset_type)
select u.id, m.provider_symbol, m.label, m.venue_name, m.asset_type
from auth.users u
cross join public.market_instruments m
where m.enabled = true and m.default_watchlist = true
on conflict (user_id, symbol) do update set
  label = excluded.label,
  exchange = excluded.exchange,
  asset_type = excluded.asset_type;