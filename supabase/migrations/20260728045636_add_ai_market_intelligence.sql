-- Extend secure integration storage for the OpenAI research provider.
alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check,
  drop constraint if exists integration_connections_environment_check;

alter table public.integration_connections
  add constraint integration_connections_provider_check
    check (provider in ('twelve_data','alpaca','oanda','polygon','ibkr','openai')),
  add constraint integration_connections_environment_check
    check (environment in ('data','paper','practice','ai','live'));

create or replace function public.store_integration_credentials(
  p_user_id uuid,
  p_provider text,
  p_environment text,
  p_label text,
  p_account_reference text,
  p_credentials jsonb
)
returns public.integration_connections
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_connection public.integration_connections;
  v_secret_id uuid;
  v_secret_name text;
begin
  if current_user <> 'service_role' then
    raise exception 'Accès serveur requis.' using errcode = '42501';
  end if;
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
$$;

revoke all on function public.store_integration_credentials(uuid,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.store_integration_credentials(uuid,text,text,text,text,jsonb) to service_role;

-- Per-user source and research policy.
create table if not exists public.intelligence_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  model text not null default 'gpt-5.1',
  search_context_size text not null default 'high' check (search_context_size in ('low','medium','high')),
  auto_refresh_minutes integer not null default 30 check (auto_refresh_minutes between 5 and 1440),
  max_research_age_minutes integer not null default 45 check (max_research_age_minutes between 5 and 1440),
  minimum_sources integer not null default 4 check (minimum_sources between 1 and 25),
  minimum_confidence numeric not null default 0.60 check (minimum_confidence between 0 and 1),
  require_official_source boolean not null default true,
  allowed_domains text[] not null default array[
    'reuters.com','apnews.com','bloomberg.com','ft.com','wsj.com','cnbc.com',
    'sec.gov','federalreserve.gov','bankofcanada.ca','bls.gov','bea.gov',
    'ecb.europa.eu','bankofengland.co.uk','boj.or.jp','rba.gov.au',
    'nyse.com','nasdaq.com','tsx.com','asx.com.au','oecd.org','imf.org','worldbank.org'
  ]::text[],
  enabled_agents text[] not null default array[
    'Macro et banques centrales','Nouvelles et événements','Sentiment et consensus',
    'Fondamentaux et dépôts officiels','Régime technique','Contradicteur et risques','Chef de portefeuille'
  ]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.intelligence_settings enable row level security;
drop policy if exists intelligence_settings_owner_select on public.intelligence_settings;
drop policy if exists intelligence_settings_owner_insert on public.intelligence_settings;
drop policy if exists intelligence_settings_owner_update on public.intelligence_settings;
create policy intelligence_settings_owner_select on public.intelligence_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy intelligence_settings_owner_insert on public.intelligence_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy intelligence_settings_owner_update on public.intelligence_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.intelligence_settings from anon;
grant select, insert, update on public.intelligence_settings to authenticated;

create table if not exists public.market_research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.paper_wallets(id) on delete set null,
  symbol text not null,
  asset_type text not null default 'equity',
  interval text not null default '5min',
  horizon text not null default 'intraday' check (horizon in ('intraday','swing','position','macro')),
  mode text not null default 'quick' check (mode in ('quick','deep')),
  model text not null,
  status text not null default 'running' check (status in ('running','completed','failed','cancelled')),
  request_context jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  overall_sentiment numeric check (overall_sentiment between -1 and 1),
  confidence numeric check (confidence between 0 and 1),
  signal text check (signal in ('BUY','SELL','HOLD')),
  source_count integer not null default 0 check (source_count >= 0),
  official_source_count integer not null default 0 check (official_source_count >= 0),
  generated_at timestamptz,
  expires_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists market_research_runs_user_symbol_created_idx
  on public.market_research_runs(user_id, symbol, created_at desc);
create index if not exists market_research_runs_user_status_idx
  on public.market_research_runs(user_id, status, created_at desc);

alter table public.market_research_runs enable row level security;
drop policy if exists market_research_runs_owner_select on public.market_research_runs;
create policy market_research_runs_owner_select on public.market_research_runs
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.market_research_runs from anon, authenticated;
grant select on public.market_research_runs to authenticated;

create table if not exists public.market_research_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.market_research_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  title text,
  domain text not null,
  source_class text not null default 'major_media' check (source_class in ('official','regulator','central_bank','exchange','major_media','company','research','other')),
  credibility_score numeric not null default 0.70 check (credibility_score between 0 and 1),
  relevance_score numeric not null default 0.50 check (relevance_score between 0 and 1),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, url)
);

create index if not exists market_research_sources_run_idx on public.market_research_sources(run_id);
create index if not exists market_research_sources_user_created_idx on public.market_research_sources(user_id, created_at desc);

alter table public.market_research_sources enable row level security;
drop policy if exists market_research_sources_owner_select on public.market_research_sources;
create policy market_research_sources_owner_select on public.market_research_sources
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.market_research_sources from anon, authenticated;
grant select on public.market_research_sources to authenticated;

create table if not exists public.market_agent_votes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.market_research_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_name text not null,
  stance text not null check (stance in ('bullish','bearish','neutral')),
  confidence numeric not null check (confidence between 0 and 1),
  rationale text not null,
  created_at timestamptz not null default now(),
  unique (run_id, agent_name)
);

create index if not exists market_agent_votes_run_idx on public.market_agent_votes(run_id);
alter table public.market_agent_votes enable row level security;
drop policy if exists market_agent_votes_owner_select on public.market_agent_votes;
create policy market_agent_votes_owner_select on public.market_agent_votes
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.market_agent_votes from anon, authenticated;
grant select on public.market_agent_votes to authenticated;

-- Add research and stale-data controls without overwriting existing settings.
alter table public.paper_wallets
  alter column risk_settings set default jsonb_build_object(
    'riskPerTradePct', 0.25,
    'maxDailyLossPct', 2,
    'maxPositions', 5,
    'minAgentConfidence', 0.55,
    'closeAgentsAtEnd', true,
    'blockClosedMarkets', true,
    'blockStaleData', true,
    'staleAfterSeconds', 120,
    'requireAiResearch', false,
    'maxResearchAgeMinutes', 45
  );

update public.paper_wallets
set risk_settings = risk_settings || jsonb_build_object(
  'blockStaleData', coalesce(risk_settings->'blockStaleData', 'true'::jsonb),
  'staleAfterSeconds', coalesce(risk_settings->'staleAfterSeconds', '120'::jsonb),
  'requireAiResearch', coalesce(risk_settings->'requireAiResearch', 'false'::jsonb),
  'maxResearchAgeMinutes', coalesce(risk_settings->'maxResearchAgeMinutes', '45'::jsonb)
);

-- Seed settings for existing users.
insert into public.intelligence_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;