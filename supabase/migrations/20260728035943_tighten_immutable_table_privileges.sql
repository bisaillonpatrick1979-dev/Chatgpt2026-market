revoke all privileges on public.trade_logs from authenticated;
grant select, insert on public.trade_logs to authenticated;

revoke all privileges on public.integration_connections from authenticated;
grant select on public.integration_connections to authenticated;

revoke all privileges on public.trade_logs from anon;
revoke all privileges on public.integration_connections from anon;