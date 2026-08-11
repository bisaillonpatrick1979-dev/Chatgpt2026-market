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
  -- Authorization is enforced with EXECUTE privileges. In a SECURITY DEFINER
  -- function, current_user is the function owner and cannot identify the
  -- PostgREST caller reliably.
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

create or replace function public.delete_integration_credentials_admin(
  p_user_id uuid,
  p_provider text,
  p_environment text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.integration_connections
  where user_id = p_user_id
    and provider = p_provider
    and environment = p_environment;

  if v_secret_id is null then
    return false;
  end if;

  delete from public.integration_connections
  where user_id = p_user_id
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

revoke all on function public.store_integration_credentials(uuid,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.delete_integration_credentials_admin(uuid,text,text) from public, anon, authenticated;
revoke all on function public.get_integration_credentials(uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_integration_test_result(uuid,text,text,boolean,text) from public, anon, authenticated;

grant execute on function public.store_integration_credentials(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.delete_integration_credentials_admin(uuid,text,text) to service_role;
grant execute on function public.get_integration_credentials(uuid,text,text) to service_role;
grant execute on function public.set_integration_test_result(uuid,text,text,boolean,text) to service_role;