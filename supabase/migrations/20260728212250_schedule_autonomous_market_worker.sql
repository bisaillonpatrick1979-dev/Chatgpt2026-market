DO $$
begin
  if not exists (select 1 from vault.secrets where name = 'quantfarm_project_url') then
    perform vault.create_secret('https://samukekuucaibcxkvsff.supabase.co', 'quantfarm_project_url', 'URL du projet pour le travailleur autonome');
  end if;
end $$;

DO $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'quantfarm-autonomous-market-worker' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end $$;

select cron.schedule(
  'quantfarm-autonomous-market-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'quantfarm_project_url' limit 1) || '/functions/v1/autonomous-market-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autonomous_worker_secret' limit 1)
      ),
      body := jsonb_build_object('source', 'supabase-cron', 'requestedAt', now())
    ) as request_id;
  $$
);