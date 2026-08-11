alter table public.intelligence_settings
  add column if not exists specialist_model text not null default 'gpt-5.6-terra';

alter table public.intelligence_settings
  alter column research_model set default 'gpt-5.6-luna',
  alter column synthesis_model set default 'gpt-5.6-sol';

update public.intelligence_settings
set model = 'auto',
    orchestration_mode = 'automatic',
    research_model = 'gpt-5.6-luna',
    specialist_model = 'gpt-5.6-terra',
    synthesis_model = 'gpt-5.6-sol',
    deep_review_enabled = true,
    updated_at = now();