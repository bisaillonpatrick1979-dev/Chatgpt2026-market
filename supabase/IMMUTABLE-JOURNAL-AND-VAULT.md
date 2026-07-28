# Supabase security additions

The connected Supabase project has these applied migrations:

- append-only `trade_logs` with SHA-256 hash chaining
- UPDATE, DELETE and TRUNCATE removed for authenticated users
- immutable mutation-rejection trigger
- `integration_connections` metadata protected by RLS
- API credentials encrypted in Supabase Vault
- server-only RPC functions for storing, testing and deleting credentials
- `paper_wallets.kill_switch` and `paper_wallets.risk_settings`
- authenticated Edge Function `integration-manager`

The Edge Function supports secure connection management and authenticated Twelve Data candle retrieval. It rejects live-broker credentials and live execution.
