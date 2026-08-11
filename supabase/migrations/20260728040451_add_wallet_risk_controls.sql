alter table public.paper_wallets
  add column if not exists kill_switch boolean not null default false,
  add column if not exists risk_settings jsonb not null default jsonb_build_object(
    'riskPerTradePct', 0.25,
    'maxDailyLossPct', 2,
    'maxPositions', 5,
    'minAgentConfidence', 0.55,
    'closeAgentsAtEnd', true,
    'blockClosedMarkets', true
  );