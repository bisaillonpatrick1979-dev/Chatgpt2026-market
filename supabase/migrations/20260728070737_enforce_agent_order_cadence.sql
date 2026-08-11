alter table public.intelligence_settings
  add column if not exists max_agent_orders_per_minute integer not null default 2
    check (max_agent_orders_per_minute between 1 and 20),
  add column if not exists minimum_seconds_between_agent_orders integer not null default 20
    check (minimum_seconds_between_agent_orders between 0 and 300);

update public.intelligence_settings
set max_agent_orders_per_minute = 2,
    minimum_seconds_between_agent_orders = 20,
    updated_at = now();

create index if not exists orders_user_origin_submitted_idx
  on public.orders(user_id, origin, submitted_at desc);

create or replace function public.enforce_paper_intelligence_gate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
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
$function$;