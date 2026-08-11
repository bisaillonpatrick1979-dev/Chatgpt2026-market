create table if not exists public.runtime_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  component text not null,
  status text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.runtime_diagnostics enable row level security;
revoke all on public.runtime_diagnostics from anon, authenticated;
grant select on public.runtime_diagnostics to authenticated;
grant all on public.runtime_diagnostics to service_role;

drop policy if exists runtime_diagnostics_user_select on public.runtime_diagnostics;
create policy runtime_diagnostics_user_select
on public.runtime_diagnostics
for select to authenticated
using ((select auth.uid()) = user_id);

create index if not exists runtime_diagnostics_user_created_idx
  on public.runtime_diagnostics(user_id, created_at desc);