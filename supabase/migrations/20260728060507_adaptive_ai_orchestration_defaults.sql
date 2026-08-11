alter table public.intelligence_settings
  add column if not exists orchestration_mode text not null default 'automatic'
    check (orchestration_mode in ('automatic','single_model')),
  add column if not exists research_model text not null default 'gpt-5-mini',
  add column if not exists synthesis_model text not null default 'gpt-5.1',
  add column if not exists deep_review_enabled boolean not null default true,
  add column if not exists minimum_distinct_domains integer not null default 4
    check (minimum_distinct_domains between 1 and 20),
  add column if not exists minimum_directional_agreement numeric not null default 0.60
    check (minimum_directional_agreement between 0 and 1);

alter table public.intelligence_settings
  alter column model set default 'auto',
  alter column search_context_size set default 'medium',
  alter column auto_refresh_minutes set default 15,
  alter column max_research_age_minutes set default 20,
  alter column minimum_sources set default 6,
  alter column minimum_confidence set default 0.68;

update public.intelligence_settings
set model = 'auto',
    orchestration_mode = 'automatic',
    research_model = 'gpt-5-mini',
    synthesis_model = 'gpt-5.1',
    deep_review_enabled = true,
    search_context_size = 'medium',
    auto_refresh_minutes = 15,
    max_research_age_minutes = 20,
    minimum_sources = greatest(minimum_sources, 6),
    minimum_confidence = greatest(minimum_confidence, 0.68),
    minimum_distinct_domains = greatest(minimum_distinct_domains, 4),
    minimum_directional_agreement = greatest(minimum_directional_agreement, 0.60),
    require_official_source = true,
    updated_at = now();

create index if not exists market_agent_votes_user_idx
  on public.market_agent_votes(user_id);
create index if not exists market_research_runs_wallet_idx
  on public.market_research_runs(wallet_id)
  where wallet_id is not null;
