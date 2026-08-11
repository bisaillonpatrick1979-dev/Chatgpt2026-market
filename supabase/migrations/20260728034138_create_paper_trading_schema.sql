create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Edmonton',
  currency text not null default 'CAD' check (currency in ('CAD','USD','EUR','GBP','JPY','AUD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.paper_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Portefeuille principal',
  initial_capital numeric(20,4) not null default 100000 check (initial_capital >= 0),
  cash_balance numeric(20,4) not null default 100000,
  agent_allocation numeric(20,4) not null default 10000 check (agent_allocation >= 0),
  trading_mode text not null default 'manual' check (trading_mode in ('manual','assisted','autonomous','replay')),
  base_currency text not null default 'CAD' check (base_currency in ('CAD','USD','EUR','GBP','JPY','AUD')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role text not null,
  enabled boolean not null default true,
  capital_limit numeric(20,4) not null default 0 check (capital_limit >= 0),
  risk_per_trade_pct numeric(8,4) not null default 0.25 check (risk_per_trade_pct >= 0 and risk_per_trade_pct <= 100),
  priority integer not null default 100,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.paper_wallets(id) on delete cascade,
  trading_mode text not null check (trading_mode in ('autonomous','replay')),
  data_mode text not null check (data_mode in ('live','mock','historical')),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  status text not null default 'running' check (status in ('running','paused','stopped','completed','failed')),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  paused_at timestamptz,
  stopped_at timestamptz,
  starting_equity numeric(20,4),
  ending_equity numeric(20,4),
  max_loss_limit numeric(20,4),
  profit_target numeric(20,4),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.paper_wallets(id) on delete cascade,
  session_id uuid references public.agent_sessions(id) on delete set null,
  symbol text not null,
  exchange text,
  asset_type text not null default 'equity' check (asset_type in ('equity','forex','crypto','fund','index','commodity','option')),
  side text not null check (side in ('BUY','SELL')),
  order_type text not null default 'market' check (order_type in ('market','limit','stop','stop_limit','trailing_stop')),
  quantity numeric(28,10) not null check (quantity > 0),
  limit_price numeric(28,10),
  stop_price numeric(28,10),
  average_fill_price numeric(28,10),
  status text not null default 'submitted' check (status in ('draft','submitted','partially_filled','filled','cancelled','rejected')),
  origin text not null default 'manual' check (origin in ('manual','assisted','agent')),
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  filled_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.paper_wallets(id) on delete cascade,
  session_id uuid references public.agent_sessions(id) on delete set null,
  opening_order_id uuid references public.orders(id) on delete set null,
  symbol text not null,
  exchange text,
  asset_type text not null default 'equity' check (asset_type in ('equity','forex','crypto','fund','index','commodity','option')),
  side text not null check (side in ('BUY','SELL')),
  quantity numeric(28,10) not null check (quantity > 0),
  entry_price numeric(28,10) not null check (entry_price > 0),
  stop_loss numeric(28,10),
  take_profit numeric(28,10),
  origin text not null default 'manual' check (origin in ('manual','assisted','agent')),
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit_price numeric(28,10),
  realized_pnl numeric(20,4),
  metadata jsonb not null default '{}'::jsonb
);

create table public.trade_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.paper_wallets(id) on delete cascade,
  session_id uuid references public.agent_sessions(id) on delete set null,
  position_id uuid references public.positions(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  agent_name text not null,
  action text not null,
  reason text not null,
  result numeric(20,4),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  label text,
  exchange text,
  asset_type text not null default 'equity' check (asset_type in ('equity','forex','crypto','fund','index','commodity','option')),
  created_at timestamptz not null default now(),
  unique (user_id, symbol)
);

create table public.training_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.paper_wallets(id) on delete set null,
  session_id uuid references public.agent_sessions(id) on delete set null,
  name text not null,
  symbols text[] not null default '{}',
  interval text not null,
  start_date date not null,
  end_date date not null,
  speed text not null default 'max',
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  starting_capital numeric(20,4) not null,
  ending_capital numeric(20,4),
  net_profit numeric(20,4),
  max_drawdown numeric(20,4),
  total_trades integer,
  winning_trades integer,
  losing_trades integer,
  metrics jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index positions_user_status_idx on public.positions (user_id, status, opened_at desc);
create index orders_user_status_idx on public.orders (user_id, status, submitted_at desc);
create index sessions_user_status_idx on public.agent_sessions (user_id, status, started_at desc);
create index trade_logs_user_created_idx on public.trade_logs (user_id, created_at desc);
create index training_runs_user_created_idx on public.training_runs (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.paper_wallets enable row level security;
alter table public.agent_profiles enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.positions enable row level security;
alter table public.trade_logs enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.training_runs enable row level security;

create policy profiles_owner_all on public.profiles for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy wallets_owner_all on public.paper_wallets for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy agents_owner_all on public.agent_profiles for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sessions_owner_all on public.agent_sessions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy orders_owner_all on public.orders for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy positions_owner_all on public.positions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy logs_owner_all on public.trade_logs for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy watchlist_owner_all on public.watchlist_items for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy training_owner_all on public.training_runs for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.paper_wallets, public.agent_profiles, public.agent_sessions, public.orders, public.positions, public.trade_logs, public.watchlist_items, public.training_runs to authenticated;
revoke all on public.profiles, public.paper_wallets, public.agent_profiles, public.agent_sessions, public.orders, public.positions, public.trade_logs, public.watchlist_items, public.training_runs from anon;
