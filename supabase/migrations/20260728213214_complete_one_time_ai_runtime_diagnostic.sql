DO $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'quantfarm-ai-runtime-diagnostic' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end $$;

update public.agent_sessions
set status='completed',
    stopped_at=now(),
    last_cycle_status='diagnostic_passed',
    last_cycle_message='Diagnostic terminé : OpenAI gpt-5.6-luna répond correctement. Twelve Data doit être reconnecté pour les données réelles.',
    next_cycle_at=null,
    worker_lease_until=null
where settings->>'diagnostic'='true'
  and status in ('running','paused');

update public.paper_wallets
set trading_mode='manual', updated_at=now()
where trading_mode='autonomous'
  and not exists (
    select 1 from public.agent_sessions s
    where s.wallet_id=paper_wallets.id
      and s.status in ('running','paused')
  );