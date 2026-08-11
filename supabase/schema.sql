-- Schema consolide de QuantFarm AI (projet Supabase samukekuucaibcxkvsff).
-- Genere le 11 aout 2026 par lecture du catalogue Postgres de la production.
--
-- CE FICHIER EST UNE REFERENCE DE LECTURE, PAS LA SOURCE DE VERITE.
-- La source de verite reste supabase/migrations/, applique dans l ordre.
-- Ne pas executer tel quel : l ordre des objets n est pas garanti resolvable.

-- ============ EXTENSIONS ============

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ============ TABLES ============

create table public.agent_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  role text not null,
  enabled boolean default true not null,
  capital_limit numeric(20,4) default 0 not null,
  risk_per_trade_pct numeric(8,4) default 0.25 not null,
  priority integer default 100 not null,
  config jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.agent_sessions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  wallet_id uuid not null,
  trading_mode text not null,
  data_mode text not null,
  duration_seconds integer,
  status text default 'running'::text not null,
  started_at timestamp with time zone default now() not null,
  ends_at timestamp with time zone,
  paused_at timestamp with time zone,
  stopped_at timestamp with time zone,
  starting_equity numeric(20,4),
  ending_equity numeric(20,4),
  max_loss_limit numeric(20,4),
  profit_target numeric(20,4),
  settings jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  last_worker_heartbeat_at timestamp with time zone,
  last_cycle_at timestamp with time zone,
  last_cycle_status text,
  last_cycle_message text,
  last_symbol text,
  next_cycle_at timestamp with time zone,
  cycle_count integer default 0 not null,
  worker_lease_until timestamp with time zone
);

create table public.integration_connections (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  provider text not null,
  environment text not null,
  label text,
  account_reference text,
  vault_secret_id uuid not null,
  status text default 'not_tested'::text not null,
  last_tested_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.intelligence_settings (
  user_id uuid not null,
  enabled boolean default true not null,
  model text default 'auto'::text not null,
  search_context_size text default 'medium'::text not null,
  auto_refresh_minutes integer default 15 not null,
  max_research_age_minutes integer default 20 not null,
  minimum_sources integer default 6 not null,
  minimum_confidence numeric default 0.68 not null,
  require_official_source boolean default true not null,
  allowed_domains text[] default ARRAY['reuters.com'::text, 'apnews.com'::text, 'bloomberg.com'::text, 'ft.com'::text, 'wsj.com'::text, 'cnbc.com'::text, 'sec.gov'::text, 'federalreserve.gov'::text, 'bankofcanada.ca'::text, 'bls.gov'::text, 'bea.gov'::text, 'ecb.europa.eu'::text, 'bankofengland.co.uk'::text, 'boj.or.jp'::text, 'rba.gov.au'::text, 'nyse.com'::text, 'nasdaq.com'::text, 'tsx.com'::text, 'asx.com.au'::text, 'oecd.org'::text, 'imf.org'::text, 'worldbank.org'::text] not null,
  enabled_agents text[] default ARRAY['Macro et banques centrales'::text, 'Nouvelles et événements'::text, 'Sentiment et consensus'::text, 'Fondamentaux et dépôts officiels'::text, 'Régime technique'::text, 'Contradicteur et risques'::text, 'Chef de portefeuille'::text] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  orchestration_mode text default 'automatic'::text not null,
  research_model text default 'gpt-5.6-luna'::text not null,
  synthesis_model text default 'gpt-5.6-sol'::text not null,
  deep_review_enabled boolean default true not null,
  minimum_distinct_domains integer default 4 not null,
  minimum_directional_agreement numeric default 0.60 not null,
  specialist_model text default 'gpt-5.6-terra'::text not null,
  max_agent_orders_per_minute integer default 2 not null,
  minimum_seconds_between_agent_orders integer default 20 not null
);

create table public.market_agent_votes (
  id uuid default gen_random_uuid() not null,
  run_id uuid not null,
  user_id uuid not null,
  agent_name text not null,
  stance text not null,
  confidence numeric not null,
  rationale text not null,
  created_at timestamp with time zone default now() not null
);

create table public.market_data_health (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  symbol text not null,
  "interval" text not null,
  provider text not null,
  latest_candle_at timestamp with time zone not null,
  received_at timestamp with time zone default now() not null,
  age_seconds integer default 0 not null,
  stale_after_seconds integer default 120 not null,
  stale boolean default false not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.market_instruments (
  id text not null,
  symbol text not null,
  provider_symbol text not null,
  label text not null,
  asset_type text not null,
  market_region text not null,
  venue_name text not null,
  exchange_code text,
  mic_code text,
  country text,
  timezone text not null,
  currency text not null,
  session_kind text not null,
  sessions jsonb default '[]'::jsonb not null,
  data_provider text default 'twelve_data'::text not null,
  execution_provider text default 'internal_paper'::text not null,
  access_note text,
  default_watchlist boolean default true not null,
  enabled boolean default true not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.market_research_runs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  wallet_id uuid,
  symbol text not null,
  asset_type text default 'equity'::text not null,
  "interval" text default '5min'::text not null,
  horizon text default 'intraday'::text not null,
  mode text default 'quick'::text not null,
  model text not null,
  status text default 'running'::text not null,
  request_context jsonb default '{}'::jsonb not null,
  result jsonb default '{}'::jsonb not null,
  overall_sentiment numeric,
  confidence numeric,
  signal text,
  source_count integer default 0 not null,
  official_source_count integer default 0 not null,
  generated_at timestamp with time zone,
  expires_at timestamp with time zone,
  error text,
  created_at timestamp with time zone default now() not null
);

create table public.market_research_sources (
  id uuid default gen_random_uuid() not null,
  run_id uuid not null,
  user_id uuid not null,
  url text not null,
  title text,
  domain text not null,
  source_class text default 'major_media'::text not null,
  credibility_score numeric default 0.70 not null,
  relevance_score numeric default 0.50 not null,
  published_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.orders (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  wallet_id uuid not null,
  session_id uuid,
  symbol text not null,
  exchange text,
  asset_type text default 'equity'::text not null,
  side text not null,
  order_type text default 'market'::text not null,
  quantity numeric(28,10) not null,
  limit_price numeric(28,10),
  stop_price numeric(28,10),
  average_fill_price numeric(28,10),
  status text default 'submitted'::text not null,
  origin text default 'manual'::text not null,
  rejection_reason text,
  submitted_at timestamp with time zone default now() not null,
  filled_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb not null,
  market_instrument_id text,
  venue_name text,
  mic_code text,
  market_region text,
  market_timezone text,
  market_session text,
  data_provider text,
  execution_provider text,
  data_access_note text
);

create table public.paper_wallets (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text default 'Portefeuille principal'::text not null,
  initial_capital numeric(20,4) default 100000 not null,
  cash_balance numeric(20,4) default 100000 not null,
  agent_allocation numeric(20,4) default 10000 not null,
  trading_mode text default 'manual'::text not null,
  base_currency text default 'CAD'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  kill_switch boolean default false not null,
  risk_settings jsonb default jsonb_build_object('riskPerTradePct', 0.25, 'maxDailyLossPct', 2, 'maxPositions', 5, 'minAgentConfidence', 0.55, 'closeAgentsAtEnd', true, 'blockClosedMarkets', true, 'blockStaleData', true, 'staleAfterSeconds', 120, 'requireAiResearch', true, 'maxResearchAgeMinutes', 45) not null
);

create table public.positions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  wallet_id uuid not null,
  session_id uuid,
  opening_order_id uuid,
  symbol text not null,
  exchange text,
  asset_type text default 'equity'::text not null,
  side text not null,
  quantity numeric(28,10) not null,
  entry_price numeric(28,10) not null,
  stop_loss numeric(28,10),
  take_profit numeric(28,10),
  origin text default 'manual'::text not null,
  status text default 'open'::text not null,
  opened_at timestamp with time zone default now() not null,
  closed_at timestamp with time zone,
  exit_price numeric(28,10),
  realized_pnl numeric(20,4),
  metadata jsonb default '{}'::jsonb not null,
  market_instrument_id text,
  venue_name text,
  mic_code text,
  market_region text,
  market_timezone text,
  market_session text,
  data_provider text,
  execution_provider text,
  data_access_note text,
  initial_stop_loss numeric,
  dynamic_stop_loss numeric,
  high_watermark numeric,
  low_watermark numeric,
  trailing_stop_pct numeric,
  last_mark_price numeric,
  last_marked_at timestamp with time zone,
  exit_reason text,
  closing_order_id uuid
);

create table public.profiles (
  user_id uuid not null,
  display_name text,
  timezone text default 'America/Edmonton'::text not null,
  currency text default 'CAD'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.runtime_diagnostics (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  component text not null,
  status text not null,
  message text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.trade_logs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  wallet_id uuid,
  session_id uuid,
  position_id uuid,
  order_id uuid,
  agent_name text not null,
  action text not null,
  reason text not null,
  result numeric(20,4),
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  previous_hash text,
  entry_hash text
);

create table public.training_runs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  wallet_id uuid,
  session_id uuid,
  name text not null,
  symbols text[] default '{}'::text[] not null,
  "interval" text not null,
  start_date date not null,
  end_date date not null,
  speed text default 'max'::text not null,
  status text default 'queued'::text not null,
  starting_capital numeric(20,4) not null,
  ending_capital numeric(20,4),
  net_profit numeric(20,4),
  max_drawdown numeric(20,4),
  total_trades integer,
  winning_trades integer,
  losing_trades integer,
  metrics jsonb default '{}'::jsonb not null,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.watchlist_items (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  symbol text not null,
  label text,
  exchange text,
  asset_type text default 'equity'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.worker_configuration (
  name text not null,
  secret_hash text not null,
  enabled boolean default true not null,
  updated_at timestamp with time zone default now() not null
);

-- ============ CONTRAINTES ============

alter table public.agent_profiles add constraint agent_profiles_pkey PRIMARY KEY (id);
alter table public.agent_profiles add constraint agent_profiles_user_id_name_key UNIQUE (user_id, name);
alter table public.agent_profiles add constraint agent_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.agent_profiles add constraint agent_profiles_capital_limit_check CHECK ((capital_limit >= (0)::numeric));
alter table public.agent_profiles add constraint agent_profiles_risk_per_trade_pct_check CHECK (((risk_per_trade_pct >= (0)::numeric) AND (risk_per_trade_pct <= (100)::numeric)));
alter table public.agent_sessions add constraint agent_sessions_pkey PRIMARY KEY (id);
alter table public.agent_sessions add constraint agent_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.agent_sessions add constraint agent_sessions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES paper_wallets(id) ON DELETE CASCADE;
alter table public.agent_sessions add constraint agent_sessions_data_mode_check CHECK ((data_mode = ANY (ARRAY['live'::text, 'mock'::text, 'historical'::text])));
alter table public.agent_sessions add constraint agent_sessions_duration_seconds_check CHECK (((duration_seconds IS NULL) OR (duration_seconds > 0)));
alter table public.agent_sessions add constraint agent_sessions_status_check CHECK ((status = ANY (ARRAY['running'::text, 'paused'::text, 'stopped'::text, 'completed'::text, 'failed'::text])));
alter table public.agent_sessions add constraint agent_sessions_trading_mode_check CHECK ((trading_mode = ANY (ARRAY['autonomous'::text, 'replay'::text])));
alter table public.integration_connections add constraint integration_connections_pkey PRIMARY KEY (id);
alter table public.integration_connections add constraint integration_connections_user_id_provider_environment_key UNIQUE (user_id, provider, environment);
alter table public.integration_connections add constraint integration_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.integration_connections add constraint integration_connections_environment_check CHECK ((environment = ANY (ARRAY['data'::text, 'paper'::text, 'practice'::text, 'ai'::text, 'live'::text])));
alter table public.integration_connections add constraint integration_connections_provider_check CHECK ((provider = ANY (ARRAY['twelve_data'::text, 'alpaca'::text, 'oanda'::text, 'polygon'::text, 'ibkr'::text, 'openai'::text])));
alter table public.integration_connections add constraint integration_connections_status_check CHECK ((status = ANY (ARRAY['not_tested'::text, 'connected'::text, 'error'::text, 'disabled'::text])));
alter table public.intelligence_settings add constraint intelligence_settings_pkey PRIMARY KEY (user_id);
alter table public.intelligence_settings add constraint intelligence_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.intelligence_settings add constraint intelligence_settings_auto_refresh_minutes_check CHECK (((auto_refresh_minutes >= 5) AND (auto_refresh_minutes <= 1440)));
alter table public.intelligence_settings add constraint intelligence_settings_max_agent_orders_per_minute_check CHECK (((max_agent_orders_per_minute >= 1) AND (max_agent_orders_per_minute <= 20)));
alter table public.intelligence_settings add constraint intelligence_settings_max_research_age_minutes_check CHECK (((max_research_age_minutes >= 5) AND (max_research_age_minutes <= 1440)));
alter table public.intelligence_settings add constraint intelligence_settings_minimum_confidence_check CHECK (((minimum_confidence >= (0)::numeric) AND (minimum_confidence <= (1)::numeric)));
alter table public.intelligence_settings add constraint intelligence_settings_minimum_directional_agreement_check CHECK (((minimum_directional_agreement >= (0)::numeric) AND (minimum_directional_agreement <= (1)::numeric)));
alter table public.intelligence_settings add constraint intelligence_settings_minimum_distinct_domains_check CHECK (((minimum_distinct_domains >= 1) AND (minimum_distinct_domains <= 20)));
alter table public.intelligence_settings add constraint intelligence_settings_minimum_seconds_between_agent_order_check CHECK (((minimum_seconds_between_agent_orders >= 0) AND (minimum_seconds_between_agent_orders <= 300)));
alter table public.intelligence_settings add constraint intelligence_settings_minimum_sources_check CHECK (((minimum_sources >= 1) AND (minimum_sources <= 25)));
alter table public.intelligence_settings add constraint intelligence_settings_orchestration_mode_check CHECK ((orchestration_mode = ANY (ARRAY['automatic'::text, 'single_model'::text])));
alter table public.intelligence_settings add constraint intelligence_settings_search_context_size_check CHECK ((search_context_size = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
alter table public.market_agent_votes add constraint market_agent_votes_pkey PRIMARY KEY (id);
alter table public.market_agent_votes add constraint market_agent_votes_run_id_agent_name_key UNIQUE (run_id, agent_name);
alter table public.market_agent_votes add constraint market_agent_votes_run_id_fkey FOREIGN KEY (run_id) REFERENCES market_research_runs(id) ON DELETE CASCADE;
alter table public.market_agent_votes add constraint market_agent_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.market_agent_votes add constraint market_agent_votes_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
alter table public.market_agent_votes add constraint market_agent_votes_stance_check CHECK ((stance = ANY (ARRAY['bullish'::text, 'bearish'::text, 'neutral'::text])));
alter table public.market_data_health add constraint market_data_health_pkey PRIMARY KEY (id);
alter table public.market_data_health add constraint market_data_health_user_id_symbol_interval_provider_key UNIQUE (user_id, symbol, "interval", provider);
alter table public.market_data_health add constraint market_data_health_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.market_data_health add constraint market_data_health_age_seconds_check CHECK ((age_seconds >= 0));
alter table public.market_data_health add constraint market_data_health_stale_after_seconds_check CHECK ((stale_after_seconds > 0));
alter table public.market_instruments add constraint market_instruments_pkey PRIMARY KEY (id);
alter table public.market_instruments add constraint market_instruments_asset_type_check CHECK ((asset_type = ANY (ARRAY['equity'::text, 'forex'::text, 'crypto'::text, 'fund'::text, 'index'::text, 'commodity'::text, 'option'::text])));
alter table public.market_instruments add constraint market_instruments_session_kind_check CHECK ((session_kind = ANY (ARRAY['exchange'::text, 'forex'::text, 'crypto'::text])));
alter table public.market_instruments add constraint market_instruments_sessions_check CHECK ((jsonb_typeof(sessions) = 'array'::text));
alter table public.market_research_runs add constraint market_research_runs_pkey PRIMARY KEY (id);
alter table public.market_research_runs add constraint market_research_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.market_research_runs add constraint market_research_runs_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES paper_wallets(id) ON DELETE SET NULL;
alter table public.market_research_runs add constraint market_research_runs_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
alter table public.market_research_runs add constraint market_research_runs_horizon_check CHECK ((horizon = ANY (ARRAY['intraday'::text, 'swing'::text, 'position'::text, 'macro'::text])));
alter table public.market_research_runs add constraint market_research_runs_mode_check CHECK ((mode = ANY (ARRAY['quick'::text, 'deep'::text])));
alter table public.market_research_runs add constraint market_research_runs_official_source_count_check CHECK ((official_source_count >= 0));
alter table public.market_research_runs add constraint market_research_runs_overall_sentiment_check CHECK (((overall_sentiment >= ('-1'::integer)::numeric) AND (overall_sentiment <= (1)::numeric)));
alter table public.market_research_runs add constraint market_research_runs_signal_check CHECK ((signal = ANY (ARRAY['BUY'::text, 'SELL'::text, 'HOLD'::text])));
alter table public.market_research_runs add constraint market_research_runs_source_count_check CHECK ((source_count >= 0));
alter table public.market_research_runs add constraint market_research_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])));
alter table public.market_research_sources add constraint market_research_sources_pkey PRIMARY KEY (id);
alter table public.market_research_sources add constraint market_research_sources_run_id_url_key UNIQUE (run_id, url);
alter table public.market_research_sources add constraint market_research_sources_run_id_fkey FOREIGN KEY (run_id) REFERENCES market_research_runs(id) ON DELETE CASCADE;
alter table public.market_research_sources add constraint market_research_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.market_research_sources add constraint market_research_sources_credibility_score_check CHECK (((credibility_score >= (0)::numeric) AND (credibility_score <= (1)::numeric)));
alter table public.market_research_sources add constraint market_research_sources_relevance_score_check CHECK (((relevance_score >= (0)::numeric) AND (relevance_score <= (1)::numeric)));
alter table public.market_research_sources add constraint market_research_sources_source_class_check CHECK ((source_class = ANY (ARRAY['official'::text, 'regulator'::text, 'central_bank'::text, 'exchange'::text, 'major_media'::text, 'company'::text, 'research'::text, 'other'::text])));
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_market_instrument_id_fkey FOREIGN KEY (market_instrument_id) REFERENCES market_instruments(id);
alter table public.orders add constraint orders_session_id_fkey FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.orders add constraint orders_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES paper_wallets(id) ON DELETE CASCADE;
alter table public.orders add constraint orders_asset_type_check CHECK ((asset_type = ANY (ARRAY['equity'::text, 'forex'::text, 'crypto'::text, 'fund'::text, 'index'::text, 'commodity'::text, 'option'::text])));
alter table public.orders add constraint orders_order_type_check CHECK ((order_type = ANY (ARRAY['market'::text, 'limit'::text, 'stop'::text, 'stop_limit'::text, 'trailing_stop'::text])));
alter table public.orders add constraint orders_origin_check CHECK ((origin = ANY (ARRAY['manual'::text, 'assisted'::text, 'agent'::text])));
alter table public.orders add constraint orders_quantity_check CHECK ((quantity > (0)::numeric));
alter table public.orders add constraint orders_side_check CHECK ((side = ANY (ARRAY['BUY'::text, 'SELL'::text])));
alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'partially_filled'::text, 'filled'::text, 'cancelled'::text, 'rejected'::text])));
alter table public.paper_wallets add constraint paper_wallets_pkey PRIMARY KEY (id);
alter table public.paper_wallets add constraint paper_wallets_user_id_key UNIQUE (user_id);
alter table public.paper_wallets add constraint paper_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.paper_wallets add constraint paper_wallets_agent_allocation_check CHECK ((agent_allocation >= (0)::numeric));
alter table public.paper_wallets add constraint paper_wallets_base_currency_check CHECK ((base_currency = ANY (ARRAY['CAD'::text, 'USD'::text, 'EUR'::text, 'GBP'::text, 'JPY'::text, 'AUD'::text])));
alter table public.paper_wallets add constraint paper_wallets_initial_capital_check CHECK ((initial_capital >= (0)::numeric));
alter table public.paper_wallets add constraint paper_wallets_trading_mode_check CHECK ((trading_mode = ANY (ARRAY['manual'::text, 'assisted'::text, 'autonomous'::text, 'replay'::text])));
alter table public.positions add constraint positions_pkey PRIMARY KEY (id);
alter table public.positions add constraint positions_closing_order_id_fkey FOREIGN KEY (closing_order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.positions add constraint positions_market_instrument_id_fkey FOREIGN KEY (market_instrument_id) REFERENCES market_instruments(id);
alter table public.positions add constraint positions_opening_order_id_fkey FOREIGN KEY (opening_order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.positions add constraint positions_session_id_fkey FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL;
alter table public.positions add constraint positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.positions add constraint positions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES paper_wallets(id) ON DELETE CASCADE;
alter table public.positions add constraint positions_asset_type_check CHECK ((asset_type = ANY (ARRAY['equity'::text, 'forex'::text, 'crypto'::text, 'fund'::text, 'index'::text, 'commodity'::text, 'option'::text])));
alter table public.positions add constraint positions_entry_price_check CHECK ((entry_price > (0)::numeric));
alter table public.positions add constraint positions_origin_check CHECK ((origin = ANY (ARRAY['manual'::text, 'assisted'::text, 'agent'::text])));
alter table public.positions add constraint positions_quantity_check CHECK ((quantity > (0)::numeric));
alter table public.positions add constraint positions_side_check CHECK ((side = ANY (ARRAY['BUY'::text, 'SELL'::text])));
alter table public.positions add constraint positions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (user_id);
alter table public.profiles add constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_currency_check CHECK ((currency = ANY (ARRAY['CAD'::text, 'USD'::text, 'EUR'::text, 'GBP'::text, 'JPY'::text, 'AUD'::text])));
alter table public.runtime_diagnostics add constraint runtime_diagnostics_pkey PRIMARY KEY (id);
alter table public.runtime_diagnostics add constraint runtime_diagnostics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.trade_logs add constraint trade_logs_pkey PRIMARY KEY (id);
alter table public.trade_logs add constraint trade_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL;
alter table public.trade_logs add constraint trade_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.trade_logs add constraint trade_logs_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES paper_wallets(id) ON DELETE CASCADE;
alter table public.training_runs add constraint training_runs_pkey PRIMARY KEY (id);
alter table public.training_runs add constraint training_runs_session_id_fkey FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL;
alter table public.training_runs add constraint training_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.training_runs add constraint training_runs_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES paper_wallets(id) ON DELETE SET NULL;
alter table public.training_runs add constraint training_runs_check CHECK ((end_date >= start_date));
alter table public.training_runs add constraint training_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])));
alter table public.watchlist_items add constraint watchlist_items_pkey PRIMARY KEY (id);
alter table public.watchlist_items add constraint watchlist_items_user_id_symbol_key UNIQUE (user_id, symbol);
alter table public.watchlist_items add constraint watchlist_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.watchlist_items add constraint watchlist_items_asset_type_check CHECK ((asset_type = ANY (ARRAY['equity'::text, 'forex'::text, 'crypto'::text, 'fund'::text, 'index'::text, 'commodity'::text, 'option'::text])));
alter table public.worker_configuration add constraint worker_configuration_pkey PRIMARY KEY (name);

-- ============ INDEX ============

CREATE UNIQUE INDEX agent_sessions_one_active_autonomous_user ON public.agent_sessions USING btree (user_id) WHERE ((trading_mode = 'autonomous'::text) AND (status = ANY (ARRAY['running'::text, 'paused'::text])));
CREATE INDEX agent_sessions_wallet_idx ON public.agent_sessions USING btree (wallet_id);
CREATE INDEX agent_sessions_worker_due_idx ON public.agent_sessions USING btree (status, next_cycle_at, started_at) WHERE (trading_mode = 'autonomous'::text);
CREATE INDEX sessions_user_status_idx ON public.agent_sessions USING btree (user_id, status, started_at DESC);
CREATE INDEX integration_connections_user_idx ON public.integration_connections USING btree (user_id, provider, environment);
CREATE INDEX market_agent_votes_run_idx ON public.market_agent_votes USING btree (run_id);
CREATE INDEX market_agent_votes_user_idx ON public.market_agent_votes USING btree (user_id);
CREATE INDEX market_data_health_user_symbol_idx ON public.market_data_health USING btree (user_id, symbol, received_at DESC);
CREATE UNIQUE INDEX market_instruments_provider_venue_key ON public.market_instruments USING btree (provider_symbol, COALESCE(mic_code, ''::text));
CREATE INDEX market_instruments_region_idx ON public.market_instruments USING btree (market_region, sort_order);
CREATE INDEX market_research_runs_user_status_idx ON public.market_research_runs USING btree (user_id, status, created_at DESC);
CREATE INDEX market_research_runs_user_symbol_created_idx ON public.market_research_runs USING btree (user_id, symbol, created_at DESC);
CREATE INDEX market_research_runs_wallet_idx ON public.market_research_runs USING btree (wallet_id) WHERE (wallet_id IS NOT NULL);
CREATE INDEX market_research_sources_run_idx ON public.market_research_sources USING btree (run_id);
CREATE INDEX market_research_sources_user_created_idx ON public.market_research_sources USING btree (user_id, created_at DESC);
CREATE INDEX orders_market_instrument_id_idx ON public.orders USING btree (market_instrument_id) WHERE (market_instrument_id IS NOT NULL);
CREATE INDEX orders_session_idx ON public.orders USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX orders_user_market_region_idx ON public.orders USING btree (user_id, market_region, submitted_at DESC);
CREATE INDEX orders_user_origin_submitted_idx ON public.orders USING btree (user_id, origin, submitted_at DESC);
CREATE INDEX orders_user_status_idx ON public.orders USING btree (user_id, status, submitted_at DESC);
CREATE INDEX orders_wallet_idx ON public.orders USING btree (wallet_id);
CREATE INDEX positions_closing_order_id_idx ON public.positions USING btree (closing_order_id) WHERE (closing_order_id IS NOT NULL);
CREATE INDEX positions_market_instrument_id_idx ON public.positions USING btree (market_instrument_id) WHERE (market_instrument_id IS NOT NULL);
CREATE UNIQUE INDEX positions_one_open_symbol_per_user ON public.positions USING btree (user_id, symbol) WHERE (status = 'open'::text);
CREATE INDEX positions_open_agent_monitor_idx ON public.positions USING btree (user_id, opened_at) WHERE ((origin = 'agent'::text) AND (status = 'open'::text));
CREATE INDEX positions_opening_order_idx ON public.positions USING btree (opening_order_id) WHERE (opening_order_id IS NOT NULL);
CREATE INDEX positions_session_idx ON public.positions USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX positions_user_market_region_idx ON public.positions USING btree (user_id, market_region, opened_at DESC);
CREATE INDEX positions_user_status_idx ON public.positions USING btree (user_id, status, opened_at DESC);
CREATE INDEX positions_wallet_idx ON public.positions USING btree (wallet_id);
CREATE INDEX runtime_diagnostics_user_created_idx ON public.runtime_diagnostics USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX trade_logs_entry_hash_key ON public.trade_logs USING btree (entry_hash) WHERE (entry_hash IS NOT NULL);
CREATE INDEX trade_logs_order_idx ON public.trade_logs USING btree (order_id) WHERE (order_id IS NOT NULL);
CREATE INDEX trade_logs_position_idx ON public.trade_logs USING btree (position_id) WHERE (position_id IS NOT NULL);
CREATE INDEX trade_logs_session_idx ON public.trade_logs USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX trade_logs_user_created_idx ON public.trade_logs USING btree (user_id, created_at DESC);
CREATE INDEX trade_logs_wallet_idx ON public.trade_logs USING btree (wallet_id) WHERE (wallet_id IS NOT NULL);
CREATE INDEX training_runs_session_idx ON public.training_runs USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX training_runs_user_created_idx ON public.training_runs USING btree (user_id, created_at DESC);
CREATE INDEX training_runs_wallet_idx ON public.training_runs USING btree (wallet_id) WHERE (wallet_id IS NOT NULL);

-- ============ FONCTIONS ============

CREATE OR REPLACE FUNCTION public.block_diagnostic_agent_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.claim_autonomous_session_cycle(p_session_id uuid, p_lease_seconds integer DEFAULT 240)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_claimed boolean := false;
begin
  update public.agent_sessions
  set worker_lease_until = now() + make_interval(secs => greatest(30, least(600, p_lease_seconds))),
      last_worker_heartbeat_at = now(),
      last_cycle_status = 'running',
      last_cycle_message = 'Analyse serveur en cours.'
  where id = p_session_id
    and trading_mode = 'autonomous'
    and data_mode = 'live'
    and status = 'running'
    and (ends_at is null or ends_at > now())
    and (worker_lease_until is null or worker_lease_until <= now())
    and (next_cycle_at is null or next_cycle_at <= now());

  v_claimed := found;
  return v_claimed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_integration_credentials_admin(p_user_id uuid, p_provider text, p_environment text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
declare
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.integration_connections
  where user_id = p_user_id
    and provider = p_provider
    and environment = p_environment;

  if v_secret_id is null then
    return false;
  end if;

  delete from public.integration_connections
  where user_id = p_user_id
    and provider = p_provider
    and environment = p_environment;

  delete from vault.secrets where id = v_secret_id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_paper_intelligence_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_data_mode text := coalesce(new.metadata->>'dataMode', 'mock');
  v_risk_settings jsonb;
  v_block_stale boolean := true;
  v_require_research boolean := true;
  v_intelligence_enabled boolean := true;
  v_min_confidence numeric := 0.68;
  v_max_orders_per_minute integer := 2;
  v_min_seconds_between_orders integer := 20;
  v_recent_order_count integer := 0;
  v_last_order_at timestamptz;
  v_health public.market_data_health;
  v_research public.market_research_runs;
begin
  -- Manual paper orders remain under direct user control. Historical/mock training
  -- deliberately avoids current-news look-ahead and does not use this live gate.
  if new.origin not in ('agent', 'assisted') or v_data_mode <> 'live' then
    return new;
  end if;

  select risk_settings
    into v_risk_settings
  from public.paper_wallets
  where id = new.wallet_id
    and user_id = new.user_id;

  v_block_stale := coalesce((v_risk_settings->>'blockStaleData')::boolean, true);
  v_require_research := coalesce((v_risk_settings->>'requireAiResearch')::boolean, true);

  select enabled,
         minimum_confidence,
         max_agent_orders_per_minute,
         minimum_seconds_between_agent_orders
    into v_intelligence_enabled,
         v_min_confidence,
         v_max_orders_per_minute,
         v_min_seconds_between_orders
  from public.intelligence_settings
  where user_id = new.user_id;

  v_intelligence_enabled := coalesce(v_intelligence_enabled, true);
  v_min_confidence := coalesce(v_min_confidence, 0.68);
  v_max_orders_per_minute := greatest(1, coalesce(v_max_orders_per_minute, 2));
  v_min_seconds_between_orders := greatest(0, coalesce(v_min_seconds_between_orders, 20));

  -- A server-side cadence guard protects against duplicate browser timers,
  -- multiple tabs and concurrent agent cycles. Assisted orders remain human-approved.
  if new.origin = 'agent' then
    select count(*), max(submitted_at)
      into v_recent_order_count, v_last_order_at
    from public.orders
    where user_id = new.user_id
      and origin = 'agent'
      and submitted_at > now() - interval '1 minute'
      and status not in ('rejected', 'cancelled');

    if v_recent_order_count >= v_max_orders_per_minute then
      raise exception 'Cadence autonome atteinte : maximum % ordres paper par minute.', v_max_orders_per_minute
        using errcode = 'P0001';
    end if;

    if v_last_order_at is not null
       and now() - v_last_order_at < make_interval(secs => v_min_seconds_between_orders) then
      raise exception 'Temporisation autonome active : attends % secondes entre deux ordres paper.', v_min_seconds_between_orders
        using errcode = 'P0001';
    end if;
  end if;

  if v_block_stale then
    select *
      into v_health
    from public.market_data_health
    where user_id = new.user_id
      and symbol = new.symbol
    order by received_at desc
    limit 1;

    if v_health.id is null then
      raise exception 'Données réelles non validées pour %. Actualise une source de prix réelle avant cette entrée paper.', new.symbol
        using errcode = 'P0001';
    end if;

    if v_health.stale
       or now() - v_health.received_at > make_interval(secs => greatest(v_health.stale_after_seconds, 120))
       or now() - v_health.latest_candle_at > make_interval(secs => greatest(v_health.stale_after_seconds, 120)) then
      raise exception 'Données périmées pour %. Nouvelle entrée IA paper refusée.', new.symbol
        using errcode = 'P0001';
    end if;
  end if;

  if v_require_research and v_intelligence_enabled then
    select *
      into v_research
    from public.market_research_runs
    where user_id = new.user_id
      and symbol = new.symbol
      and status = 'completed'
      and generated_at is not null
      and expires_at > now()
    order by generated_at desc
    limit 1;

    if v_research.id is null then
      raise exception 'Recherche IA actuelle requise pour % avant une entrée paper assistée ou autonome.', new.symbol
        using errcode = 'P0001';
    end if;

    if coalesce((v_research.result->'qualityGate'->>'passed')::boolean, false) is not true then
      raise exception 'Le garde-fou de qualité IA n’est pas satisfait pour %. Entrée paper refusée.', new.symbol
        using errcode = 'P0001';
    end if;

    if v_research.signal is null or v_research.signal = 'HOLD' then
      raise exception 'Le consensus IA actuel pour % est HOLD. Entrée paper refusée.', new.symbol
        using errcode = 'P0001';
    end if;

    if v_research.confidence is null or v_research.confidence < v_min_confidence then
      raise exception 'Confiance IA insuffisante pour % (% < %).', new.symbol,
        round(coalesce(v_research.confidence, 0) * 100, 1), round(v_min_confidence * 100, 1)
        using errcode = 'P0001';
    end if;

    if v_research.signal <> new.side then
      raise exception 'Le consensus IA % pour % contredit l’ordre paper %.', v_research.signal, new.symbol, new.side
        using errcode = 'P0001';
    end if;

    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'researchRunId', v_research.id,
      'researchSignal', v_research.signal,
      'researchConfidence', v_research.confidence,
      'researchGeneratedAt', v_research.generated_at,
      'researchExpiresAt', v_research.expires_at,
      'intelligenceGate', 'passed',
      'maxAgentOrdersPerMinute', v_max_orders_per_minute,
      'minimumSecondsBetweenAgentOrders', v_min_seconds_between_orders
    );
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enrich_order_market_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.enrich_position_market_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.execute_agent_paper_trade(p_user_id uuid, p_session_id uuid, p_symbol text, p_side text, p_entry_price numeric, p_stop_loss numeric, p_take_profit numeric, p_quantity numeric, p_research_run_id uuid, p_market_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.expire_autonomous_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_count integer;
begin
  update public.agent_sessions
  set status = 'completed',
      stopped_at = coalesce(stopped_at, ends_at, now()),
      last_cycle_status = 'completed',
      last_cycle_message = 'Durée écoulée; session fermée automatiquement par le serveur.',
      worker_lease_until = null,
      next_cycle_at = null
  where trading_mode = 'autonomous'
    and status in ('running','paused')
    and ends_at is not null
    and ends_at <= now();

  get diagnostics v_count = row_count;

  update public.paper_wallets w
  set trading_mode = 'manual', updated_at = now()
  where w.trading_mode = 'autonomous'
    and not exists (
      select 1 from public.agent_sessions s
      where s.wallet_id = w.id
        and s.trading_mode = 'autonomous'
        and s.status in ('running','paused')
        and (s.ends_at is null or s.ends_at > now())
    );

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_autonomous_session_cycle(p_session_id uuid, p_status text, p_message text, p_symbol text DEFAULT NULL::text, p_next_seconds integer DEFAULT 120)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  update public.agent_sessions
  set last_worker_heartbeat_at = now(),
      last_cycle_at = now(),
      last_cycle_status = left(coalesce(p_status, 'unknown'), 40),
      last_cycle_message = left(coalesce(p_message, ''), 500),
      last_symbol = nullif(left(coalesce(p_symbol, ''), 24), ''),
      next_cycle_at = case
        when status = 'running' then now() + make_interval(secs => greatest(30, least(1800, p_next_seconds)))
        else null
      end,
      cycle_count = cycle_count + 1,
      worker_lease_until = null
  where id = p_session_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_integration_credentials(p_user_id uuid, p_provider text, p_environment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
declare
  v_credentials jsonb;
begin
  select ds.decrypted_secret::jsonb
    into v_credentials
  from public.integration_connections c
  join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
  where c.user_id = p_user_id
    and c.provider = p_provider
    and c.environment = p_environment;

  return v_credentials;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.manage_agent_paper_position(p_user_id uuid, p_position_id uuid, p_market_price numeric, p_trailing_stop_pct numeric DEFAULT 0.75, p_force_close boolean DEFAULT false, p_force_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_agent_position_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.origin = 'agent' then
    new.initial_stop_loss := coalesce(new.initial_stop_loss, new.stop_loss);
    new.high_watermark := coalesce(new.high_watermark, new.entry_price);
    new.low_watermark := coalesce(new.low_watermark, new.entry_price);
    new.trailing_stop_pct := coalesce(new.trailing_stop_pct, 0.75);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_immutable_trade_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_agent_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.reject_trade_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception 'Le journal de trading est immutable: UPDATE et DELETE sont interdits.'
    using errcode = '42501';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_market_session(p_session_kind text, p_timezone text, p_sessions jsonb, p_at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_integration_test_result(p_user_id uuid, p_provider text, p_environment text, p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  update public.integration_connections
  set status = case when p_success then 'connected' else 'error' end,
      last_tested_at = now(),
      last_error = case when p_success then null else left(coalesce(p_error, 'Erreur inconnue'), 500) end,
      updated_at = now()
  where user_id = p_user_id
    and provider = p_provider
    and environment = p_environment;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.store_integration_credentials(p_user_id uuid, p_provider text, p_environment text, p_label text, p_account_reference text, p_credentials jsonb)
 RETURNS integration_connections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
declare
  v_connection public.integration_connections;
  v_secret_id uuid;
  v_secret_name text;
begin
  -- Authorization is enforced with EXECUTE privileges. In a SECURITY DEFINER
  -- function, current_user is the function owner and cannot identify the
  -- PostgREST caller reliably.
  if p_user_id is null then
    raise exception 'Utilisateur requis.' using errcode = '22023';
  end if;
  if p_provider not in ('twelve_data','alpaca','oanda','polygon','ibkr','openai') then
    raise exception 'Fournisseur non permis.' using errcode = '22023';
  end if;
  if p_environment not in ('data','paper','practice','ai','live') then
    raise exception 'Environnement non permis.' using errcode = '22023';
  end if;
  if p_credentials is null or jsonb_typeof(p_credentials) <> 'object' then
    raise exception 'Les identifiants doivent être un objet JSON.' using errcode = '22023';
  end if;
  if octet_length(p_credentials::text) > 16384 then
    raise exception 'Identifiants trop volumineux.' using errcode = '22023';
  end if;

  select * into v_connection
  from public.integration_connections
  where user_id = p_user_id
    and provider = p_provider
    and environment = p_environment;

  v_secret_name := 'quantfarm_' || replace(p_user_id::text, '-', '') || '_' || p_provider || '_' || p_environment;

  if found then
    v_secret_id := v_connection.vault_secret_id;
    perform vault.update_secret(
      v_secret_id,
      p_credentials::text,
      v_secret_name,
      'QuantFarm AI credentials; server access only.'
    );
  else
    v_secret_id := vault.create_secret(
      p_credentials::text,
      v_secret_name,
      'QuantFarm AI credentials; server access only.'
    );
  end if;

  insert into public.integration_connections (
    user_id, provider, environment, label, account_reference, vault_secret_id,
    status, last_tested_at, last_error, updated_at
  ) values (
    p_user_id, p_provider, p_environment, nullif(trim(p_label), ''),
    nullif(trim(p_account_reference), ''), v_secret_id,
    'not_tested', null, null, now()
  )
  on conflict (user_id, provider, environment) do update set
    label = excluded.label,
    account_reference = excluded.account_reference,
    vault_secret_id = excluded.vault_secret_id,
    status = 'not_tested',
    last_tested_at = null,
    last_error = null,
    updated_at = now()
  returning * into v_connection;

  return v_connection;
end;
$function$
;

-- ============ DECLENCHEURS ============

CREATE TRIGGER orders_block_diagnostic_agent_orders BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION block_diagnostic_agent_orders();
CREATE TRIGGER orders_enforce_paper_intelligence_gate BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION enforce_paper_intelligence_gate();
CREATE TRIGGER orders_enrich_market_context BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION enrich_order_market_context();
CREATE TRIGGER orders_prevent_duplicate_agent_order BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_agent_order();
CREATE TRIGGER positions_enrich_market_context BEFORE INSERT ON public.positions FOR EACH ROW EXECUTE FUNCTION enrich_position_market_context();
CREATE TRIGGER positions_prepare_agent_lifecycle BEFORE INSERT ON public.positions FOR EACH ROW EXECUTE FUNCTION prepare_agent_position_lifecycle();
CREATE TRIGGER trade_logs_block_update_delete BEFORE DELETE OR UPDATE ON public.trade_logs FOR EACH ROW EXECUTE FUNCTION reject_trade_log_mutation();
CREATE TRIGGER trade_logs_prepare_immutable BEFORE INSERT ON public.trade_logs FOR EACH ROW EXECUTE FUNCTION prepare_immutable_trade_log();

-- ============ SECURITE AU NIVEAU DES LIGNES ============

alter table public.agent_profiles enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.integration_connections enable row level security;
alter table public.intelligence_settings enable row level security;
alter table public.market_agent_votes enable row level security;
alter table public.market_data_health enable row level security;
alter table public.market_instruments enable row level security;
alter table public.market_research_runs enable row level security;
alter table public.market_research_sources enable row level security;
alter table public.orders enable row level security;
alter table public.paper_wallets enable row level security;
alter table public.positions enable row level security;
alter table public.profiles enable row level security;
alter table public.runtime_diagnostics enable row level security;
alter table public.trade_logs enable row level security;
alter table public.training_runs enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.worker_configuration enable row level security;

-- ============ POLITIQUES RLS ============

create policy agents_owner_all
on public.agent_profiles
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy sessions_owner_all
on public.agent_sessions
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy integration_owner_select
on public.integration_connections
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy intelligence_settings_owner_insert
on public.intelligence_settings
for insert to authenticated
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy intelligence_settings_owner_select
on public.intelligence_settings
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy intelligence_settings_owner_update
on public.intelligence_settings
for update to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy market_agent_votes_owner_select
on public.market_agent_votes
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy market_data_health_owner_select
on public.market_data_health
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy market_instruments_authenticated_select
on public.market_instruments
for select to authenticated
using ((enabled = true));

create policy market_research_runs_owner_select
on public.market_research_runs
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy market_research_sources_owner_select
on public.market_research_sources
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy orders_owner_all
on public.orders
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy wallets_owner_all
on public.paper_wallets
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy positions_owner_all
on public.positions
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy profiles_owner_all
on public.profiles
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy runtime_diagnostics_user_select
on public.runtime_diagnostics
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy logs_owner_insert
on public.trade_logs
for insert to authenticated
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy logs_owner_select
on public.trade_logs
for select to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

create policy training_owner_all
on public.training_runs
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy watchlist_owner_all
on public.watchlist_items
for all to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

create policy worker_configuration_no_client_access
on public.worker_configuration
for select to authenticated
using (false);

-- ============ PRIVILEGES ============

grant delete on public.agent_profiles to authenticated;
grant insert on public.agent_profiles to authenticated;
grant references on public.agent_profiles to authenticated;
grant select on public.agent_profiles to authenticated;
grant trigger on public.agent_profiles to authenticated;
grant truncate on public.agent_profiles to authenticated;
grant update on public.agent_profiles to authenticated;
grant delete on public.agent_profiles to service_role;
grant insert on public.agent_profiles to service_role;
grant references on public.agent_profiles to service_role;
grant select on public.agent_profiles to service_role;
grant trigger on public.agent_profiles to service_role;
grant truncate on public.agent_profiles to service_role;
grant update on public.agent_profiles to service_role;
grant delete on public.agent_sessions to authenticated;
grant insert on public.agent_sessions to authenticated;
grant references on public.agent_sessions to authenticated;
grant select on public.agent_sessions to authenticated;
grant trigger on public.agent_sessions to authenticated;
grant truncate on public.agent_sessions to authenticated;
grant update on public.agent_sessions to authenticated;
grant delete on public.agent_sessions to service_role;
grant insert on public.agent_sessions to service_role;
grant references on public.agent_sessions to service_role;
grant select on public.agent_sessions to service_role;
grant trigger on public.agent_sessions to service_role;
grant truncate on public.agent_sessions to service_role;
grant update on public.agent_sessions to service_role;
grant select on public.integration_connections to authenticated;
grant delete on public.integration_connections to service_role;
grant insert on public.integration_connections to service_role;
grant references on public.integration_connections to service_role;
grant select on public.integration_connections to service_role;
grant trigger on public.integration_connections to service_role;
grant truncate on public.integration_connections to service_role;
grant update on public.integration_connections to service_role;
grant delete on public.intelligence_settings to authenticated;
grant insert on public.intelligence_settings to authenticated;
grant references on public.intelligence_settings to authenticated;
grant select on public.intelligence_settings to authenticated;
grant trigger on public.intelligence_settings to authenticated;
grant truncate on public.intelligence_settings to authenticated;
grant update on public.intelligence_settings to authenticated;
grant delete on public.intelligence_settings to service_role;
grant insert on public.intelligence_settings to service_role;
grant references on public.intelligence_settings to service_role;
grant select on public.intelligence_settings to service_role;
grant trigger on public.intelligence_settings to service_role;
grant truncate on public.intelligence_settings to service_role;
grant update on public.intelligence_settings to service_role;
grant select on public.market_agent_votes to authenticated;
grant delete on public.market_agent_votes to service_role;
grant insert on public.market_agent_votes to service_role;
grant references on public.market_agent_votes to service_role;
grant select on public.market_agent_votes to service_role;
grant trigger on public.market_agent_votes to service_role;
grant truncate on public.market_agent_votes to service_role;
grant update on public.market_agent_votes to service_role;
grant select on public.market_data_health to authenticated;
grant delete on public.market_data_health to service_role;
grant insert on public.market_data_health to service_role;
grant references on public.market_data_health to service_role;
grant select on public.market_data_health to service_role;
grant trigger on public.market_data_health to service_role;
grant truncate on public.market_data_health to service_role;
grant update on public.market_data_health to service_role;
grant select on public.market_instruments to authenticated;
grant delete on public.market_instruments to service_role;
grant insert on public.market_instruments to service_role;
grant references on public.market_instruments to service_role;
grant select on public.market_instruments to service_role;
grant trigger on public.market_instruments to service_role;
grant truncate on public.market_instruments to service_role;
grant update on public.market_instruments to service_role;
grant select on public.market_research_runs to authenticated;
grant delete on public.market_research_runs to service_role;
grant insert on public.market_research_runs to service_role;
grant references on public.market_research_runs to service_role;
grant select on public.market_research_runs to service_role;
grant trigger on public.market_research_runs to service_role;
grant truncate on public.market_research_runs to service_role;
grant update on public.market_research_runs to service_role;
grant select on public.market_research_sources to authenticated;
grant delete on public.market_research_sources to service_role;
grant insert on public.market_research_sources to service_role;
grant references on public.market_research_sources to service_role;
grant select on public.market_research_sources to service_role;
grant trigger on public.market_research_sources to service_role;
grant truncate on public.market_research_sources to service_role;
grant update on public.market_research_sources to service_role;
grant delete on public.orders to authenticated;
grant insert on public.orders to authenticated;
grant references on public.orders to authenticated;
grant select on public.orders to authenticated;
grant trigger on public.orders to authenticated;
grant truncate on public.orders to authenticated;
grant update on public.orders to authenticated;
grant delete on public.orders to service_role;
grant insert on public.orders to service_role;
grant references on public.orders to service_role;
grant select on public.orders to service_role;
grant trigger on public.orders to service_role;
grant truncate on public.orders to service_role;
grant update on public.orders to service_role;
grant delete on public.paper_wallets to authenticated;
grant insert on public.paper_wallets to authenticated;
grant references on public.paper_wallets to authenticated;
grant select on public.paper_wallets to authenticated;
grant trigger on public.paper_wallets to authenticated;
grant truncate on public.paper_wallets to authenticated;
grant update on public.paper_wallets to authenticated;
grant delete on public.paper_wallets to service_role;
grant insert on public.paper_wallets to service_role;
grant references on public.paper_wallets to service_role;
grant select on public.paper_wallets to service_role;
grant trigger on public.paper_wallets to service_role;
grant truncate on public.paper_wallets to service_role;
grant update on public.paper_wallets to service_role;
grant delete on public.positions to authenticated;
grant insert on public.positions to authenticated;
grant references on public.positions to authenticated;
grant select on public.positions to authenticated;
grant trigger on public.positions to authenticated;
grant truncate on public.positions to authenticated;
grant update on public.positions to authenticated;
grant delete on public.positions to service_role;
grant insert on public.positions to service_role;
grant references on public.positions to service_role;
grant select on public.positions to service_role;
grant trigger on public.positions to service_role;
grant truncate on public.positions to service_role;
grant update on public.positions to service_role;
grant delete on public.profiles to authenticated;
grant insert on public.profiles to authenticated;
grant references on public.profiles to authenticated;
grant select on public.profiles to authenticated;
grant trigger on public.profiles to authenticated;
grant truncate on public.profiles to authenticated;
grant update on public.profiles to authenticated;
grant delete on public.profiles to service_role;
grant insert on public.profiles to service_role;
grant references on public.profiles to service_role;
grant select on public.profiles to service_role;
grant trigger on public.profiles to service_role;
grant truncate on public.profiles to service_role;
grant update on public.profiles to service_role;
grant select on public.runtime_diagnostics to authenticated;
grant delete on public.runtime_diagnostics to service_role;
grant insert on public.runtime_diagnostics to service_role;
grant references on public.runtime_diagnostics to service_role;
grant select on public.runtime_diagnostics to service_role;
grant trigger on public.runtime_diagnostics to service_role;
grant truncate on public.runtime_diagnostics to service_role;
grant update on public.runtime_diagnostics to service_role;
grant insert on public.trade_logs to authenticated;
grant select on public.trade_logs to authenticated;
grant delete on public.trade_logs to service_role;
grant insert on public.trade_logs to service_role;
grant references on public.trade_logs to service_role;
grant select on public.trade_logs to service_role;
grant trigger on public.trade_logs to service_role;
grant truncate on public.trade_logs to service_role;
grant update on public.trade_logs to service_role;
grant delete on public.training_runs to authenticated;
grant insert on public.training_runs to authenticated;
grant references on public.training_runs to authenticated;
grant select on public.training_runs to authenticated;
grant trigger on public.training_runs to authenticated;
grant truncate on public.training_runs to authenticated;
grant update on public.training_runs to authenticated;
grant delete on public.training_runs to service_role;
grant insert on public.training_runs to service_role;
grant references on public.training_runs to service_role;
grant select on public.training_runs to service_role;
grant trigger on public.training_runs to service_role;
grant truncate on public.training_runs to service_role;
grant update on public.training_runs to service_role;
grant delete on public.watchlist_items to authenticated;
grant insert on public.watchlist_items to authenticated;
grant references on public.watchlist_items to authenticated;
grant select on public.watchlist_items to authenticated;
grant trigger on public.watchlist_items to authenticated;
grant truncate on public.watchlist_items to authenticated;
grant update on public.watchlist_items to authenticated;
grant delete on public.watchlist_items to service_role;
grant insert on public.watchlist_items to service_role;
grant references on public.watchlist_items to service_role;
grant select on public.watchlist_items to service_role;
grant trigger on public.watchlist_items to service_role;
grant truncate on public.watchlist_items to service_role;
grant update on public.watchlist_items to service_role;
grant delete on public.worker_configuration to service_role;
grant insert on public.worker_configuration to service_role;
grant references on public.worker_configuration to service_role;
grant select on public.worker_configuration to service_role;
grant trigger on public.worker_configuration to service_role;
grant truncate on public.worker_configuration to service_role;
grant update on public.worker_configuration to service_role;
