drop policy if exists worker_configuration_no_client_access on public.worker_configuration;
create policy worker_configuration_no_client_access
on public.worker_configuration
for select to authenticated
using (false);