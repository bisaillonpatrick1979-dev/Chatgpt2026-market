create extension if not exists pgcrypto;

-- Journal append-only avec chaîne de hachage.
alter table public.trade_logs
  add column if not exists previous_hash text,
  add column if not exists entry_hash text;

create unique index if not exists trade_logs_entry_hash_key
  on public.trade_logs(entry_hash)
  where entry_hash is not null;

create or replace function public.prepare_immutable_trade_log()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
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
    digest(
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
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create or replace function public.reject_trade_log_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Le journal de trading est immutable: UPDATE et DELETE sont interdits.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trade_logs_prepare_immutable on public.trade_logs;
create trigger trade_logs_prepare_immutable
before insert on public.trade_logs
for each row execute function public.prepare_immutable_trade_log();

drop trigger if exists trade_logs_block_update_delete on public.trade_logs;
create trigger trade_logs_block_update_delete
before update or delete on public.trade_logs
for each row execute function public.reject_trade_log_mutation();

drop policy if exists logs_owner_all on public.trade_logs;
drop policy if exists logs_owner_select on public.trade_logs;
drop policy if exists logs_owner_insert on public.trade_logs;

create policy logs_owner_select
on public.trade_logs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy logs_owner_insert
on public.trade_logs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

revoke update, delete on public.trade_logs from authenticated;
grant select, insert on public.trade_logs to authenticated;

-- Métadonnées des intégrations. Les secrets eux-mêmes sont chiffrés dans Vault.
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('twelve_data','alpaca','oanda','polygon','ibkr')),
  environment text not null check (environment in ('data','paper','practice','live')),
  label text,
  account_reference text,
  vault_secret_id uuid not null,
  status text not null default 'not_tested' check (status in ('not_tested','connected','error','disabled')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, environment)
);

create index if not exists integration_connections_user_idx
  on public.integration_connections(user_id, provider, environment);

alter table public.integration_connections enable row level security;

drop policy if exists integration_owner_select on public.integration_connections;
create policy integration_owner_select
on public.integration_connections
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.integration_connections from anon;
revoke insert, update, delete on public.integration_connections from authenticated;
grant select on public.integration_connections to authenticated;

create or replace function public.save_integration_credentials(
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
  v_user_id uuid := auth.uid();
  v_connection public.integration_connections;
  v_secret_id uuid;
  v_secret_name text;
begin
  if v_user_id is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if p_provider not in ('twelve_data','alpaca','oanda','polygon','ibkr') then
    raise exception 'Fournisseur non permis.' using errcode = '22023';
  end if;
  if p_environment not in ('data','paper','practice','live') then
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
  where user_id = v_user_id
    and provider = p_provider
    and environment = p_environment;

  v_secret_name := 'quantfarm_' || replace(v_user_id::text, '-', '') || '_' || p_provider || '_' || p_environment;

  if found then
    v_secret_id := v_connection.vault_secret_id;
    perform vault.update_secret(
      v_secret_id,
      p_credentials::text,
      v_secret_name,
      'QuantFarm AI credentials; never expose to the browser after save.'
    );
  else
    v_secret_id := vault.create_secret(
      p_credentials::text,
      v_secret_name,
      'QuantFarm AI credentials; never expose to the browser after save.'
    );
  end if;

  insert into public.integration_connections (
    user_id, provider, environment, label, account_reference, vault_secret_id,
    status, last_tested_at, last_error, updated_at
  ) values (
    v_user_id, p_provider, p_environment, nullif(trim(p_label), ''),
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

create or replace function public.delete_integration_credentials(
  p_provider text,
  p_environment text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_user_id uuid := auth.uid();
  v_secret_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  select vault_secret_id into v_secret_id
  from public.integration_connections
  where user_id = v_user_id
    and provider = p_provider
    and environment = p_environment;

  if v_secret_id is null then
    return false;
  end if;

  delete from public.integration_connections
  where user_id = v_user_id
    and provider = p_provider
    and environment = p_environment;

  delete from vault.secrets where id = v_secret_id;
  return true;
end;
$$;

create or replace function public.get_integration_credentials(
  p_user_id uuid,
  p_provider text,
  p_environment text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_credentials jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'Accès serveur requis.' using errcode = '42501';
  end if;

  select ds.decrypted_secret::jsonb
    into v_credentials
  from public.integration_connections c
  join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
  where c.user_id = p_user_id
    and c.provider = p_provider
    and c.environment = p_environment;

  return v_credentials;
end;
$$;

create or replace function public.set_integration_test_result(
  p_user_id uuid,
  p_provider text,
  p_environment text,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Accès serveur requis.' using errcode = '42501';
  end if;

  update public.integration_connections
  set status = case when p_success then 'connected' else 'error' end,
      last_tested_at = now(),
      last_error = case when p_success then null else left(coalesce(p_error, 'Erreur inconnue'), 500) end,
      updated_at = now()
  where user_id = p_user_id
    and provider = p_provider
    and environment = p_environment;
end;
$$;

revoke all on function public.save_integration_credentials(text,text,text,text,jsonb) from public, anon;
revoke all on function public.delete_integration_credentials(text,text) from public, anon;
revoke all on function public.get_integration_credentials(uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_integration_test_result(uuid,text,text,boolean,text) from public, anon, authenticated;

grant execute on function public.save_integration_credentials(text,text,text,text,jsonb) to authenticated;
grant execute on function public.delete_integration_credentials(text,text) to authenticated;
grant execute on function public.get_integration_credentials(uuid,text,text) to service_role;
grant execute on function public.set_integration_test_result(uuid,text,text,boolean,text) to service_role;