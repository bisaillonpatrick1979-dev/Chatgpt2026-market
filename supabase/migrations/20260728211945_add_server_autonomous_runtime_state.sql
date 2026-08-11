create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

alter table public.agent_sessions
  add column if not exists last_worker_heartbeat_at timestamptz,
  add column if not exists last_cycle_at timestamptz,
  add column if not exists last_cycle_status text,
  add column if not exists last_cycle_message text,
  add column if not exists last_symbol text,
  add column if not exists next_cycle_at timestamptz,
  add column if not exists cycle_count integer not null default 0,
  add column if not exists worker_lease_until timestamptz;

update public.agent_sessions
set status = 'completed',
    stopped_at = coalesce(stopped_at, ends_at, now()),
    last_cycle_status = 'completed',
    last_cycle_message = 'Session expirée et fermée automatiquement par le serveur.'
where status in ('running','paused')
  and ends_at is not null
  and ends_at <= now();

create unique index if not exists agent_sessions_one_active_autonomous_user
  on public.agent_sessions(user_id)
  where trading_mode = 'autonomous' and status in ('running','paused');

create index if not exists agent_sessions_worker_due_idx
  on public.agent_sessions(status, next_cycle_at, started_at)
  where trading_mode = 'autonomous';

create table if not exists public.worker_configuration (
  name text primary key,
  secret_hash text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.worker_configuration enable row level security;
revoke all on public.worker_configuration from anon, authenticated;
grant select on public.worker_configuration to service_role;

DO $$
declare
  v_secret text;
  v_secret_id uuid;
begin
  select id into v_secret_id from vault.secrets where name = 'autonomous_worker_secret' limit 1;
  if v_secret_id is null then
    v_secret := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(v_secret, 'autonomous_worker_secret', 'Secret interne du travailleur autonome QuantFarm');
  else
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'autonomous_worker_secret'
    limit 1;
  end if;

  insert into public.worker_configuration(name, secret_hash, enabled, updated_at)
  values ('autonomous_market_worker', encode(extensions.digest(v_secret::text, 'sha256'::text), 'hex'), true, now())
  on conflict (name) do update set
    secret_hash = excluded.secret_hash,
    enabled = true,
    updated_at = now();
end $$;

create or replace function public.expire_autonomous_sessions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
$$;

revoke all on function public.expire_autonomous_sessions() from public, anon, authenticated;
grant execute on function public.expire_autonomous_sessions() to service_role;

create or replace function public.claim_autonomous_session_cycle(
  p_session_id uuid,
  p_lease_seconds integer default 240
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
$$;

revoke all on function public.claim_autonomous_session_cycle(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_autonomous_session_cycle(uuid,integer) to service_role;

create or replace function public.finish_autonomous_session_cycle(
  p_session_id uuid,
  p_status text,
  p_message text,
  p_symbol text default null,
  p_next_seconds integer default 120
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
$$;

revoke all on function public.finish_autonomous_session_cycle(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.finish_autonomous_session_cycle(uuid,text,text,text,integer) to service_role;