create table if not exists public.market_data_health (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  interval text not null,
  provider text not null,
  latest_candle_at timestamptz not null,
  received_at timestamptz not null default now(),
  age_seconds integer not null default 0 check (age_seconds >= 0),
  stale_after_seconds integer not null default 120 check (stale_after_seconds > 0),
  stale boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, symbol, interval, provider)
);

create index if not exists market_data_health_user_symbol_idx
  on public.market_data_health(user_id, symbol, received_at desc);

alter table public.market_data_health enable row level security;
drop policy if exists market_data_health_owner_select on public.market_data_health;
create policy market_data_health_owner_select
on public.market_data_health
for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.market_data_health from anon, authenticated;
grant select on public.market_data_health to authenticated;

-- Live autonomous and assisted paper decisions require current research by default.
update public.paper_wallets
set risk_settings = risk_settings || jsonb_build_object(
  'blockStaleData', true,
  'requireAiResearch', true,
  'maxResearchAgeMinutes', coalesce(risk_settings->'maxResearchAgeMinutes', '45'::jsonb)
);

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
    'requireAiResearch', true,
    'maxResearchAgeMinutes', 45
  );

create or replace function public.enforce_paper_intelligence_gate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_data_mode text := coalesce(new.metadata->>'dataMode', 'mock');
  v_risk_settings jsonb;
  v_block_stale boolean := true;
  v_require_research boolean := true;
  v_intelligence_enabled boolean := true;
  v_min_confidence numeric := 0.60;
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

  select enabled, minimum_confidence
    into v_intelligence_enabled, v_min_confidence
  from public.intelligence_settings
  where user_id = new.user_id;

  v_intelligence_enabled := coalesce(v_intelligence_enabled, true);
  v_min_confidence := coalesce(v_min_confidence, 0.60);

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
      'intelligenceGate', 'passed'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_paper_intelligence_gate() from public, anon, authenticated;

drop trigger if exists orders_enforce_paper_intelligence_gate on public.orders;
create trigger orders_enforce_paper_intelligence_gate
before insert on public.orders
for each row execute function public.enforce_paper_intelligence_gate();