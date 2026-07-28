# Security model

1. Browser access uses only the Supabase publishable key.
2. Row Level Security restricts every trading row to its owner.
3. Provider secrets are never stored in React state after save and never returned to the browser.
4. Secrets are encrypted in Supabase Vault.
5. The authenticated Edge Function validates the user's JWT before a server-role RPC can read or replace a secret.
6. The immutable trade journal accepts INSERT and SELECT only for authenticated users.
7. Hash chaining and mutation-rejection triggers protect the audit trail.
8. The kill switch blocks all new positions while allowing closures.
9. Broker-live credentials and real-money execution are rejected by the Edge Function.
10. Autonomous sessions have explicit duration, allocation and risk limits.
