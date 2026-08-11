# Tâches planifiées (pg_cron)

État relevé dans la production `samukekuucaibcxkvsff` le 11 août 2026.
Source de vérité : la table `cron.job`. Les tâches sont créées par les migrations
`20260728212250`, `20260728213015`, `20260728213214` et `20260728230221`.

## Tâches actives

| jobid | Nom | Cadence | Fonction appelée | Active |
|---|---|---|---|---|
| 1 | `quantfarm-autonomous-market-worker` | `* * * * *` (chaque minute) | `autonomous-market-worker` | oui |
| 3 | `quantfarm-autonomous-position-manager` | `* * * * *` (chaque minute) | `autonomous-position-manager` | oui |

## Tâche retirée volontairement

`quantfarm-ai-runtime-diagnostic` a été ordonnancée par la migration `20260728213015`
puis **désordonnancée** par `20260728213214`, une fois le diagnostic passé. La fonction
`ai-runtime-diagnostic` reste déployée et peut être rappelée manuellement au besoin.
Rejouer les migrations dans l'ordre reproduit exactement cette séquence : la tâche est
créée puis retirée, et n'existe pas à l'arrivée.

## Mécanique d'appel

Les deux tâches font la même chose : un `net.http_post` (extension `pg_net`) vers la
fonction Edge correspondante.

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'quantfarm_project_url' limit 1)
         || '/functions/v1/autonomous-market-worker',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autonomous_worker_secret' limit 1)
  ),
  body := jsonb_build_object('source', 'supabase-cron', 'requestedAt', now())
) as request_id;
```

Deux secrets Vault sont lus à chaque exécution :

| Secret Vault | Rôle |
|---|---|
| `quantfarm_project_url` | URL de base du projet, pour composer l'adresse de la fonction |
| `autonomous_worker_secret` | Secret partagé envoyé dans l'en-tête `x-worker-secret` |

Le secret est créé par la migration `20260728211945` (32 octets aléatoires) et son
empreinte SHA-256 est déposée dans `public.worker_configuration`. La fonction Edge
compare le haché du secret reçu à celui de la table : le secret en clair ne circule
jamais dans le dépôt ni vers le navigateur.

## Comportement en cas d'échec

Ni `pg_cron` ni `pg_net` ne réessaient : l'appel est asynchrone, la réponse HTTP n'est
pas inspectée par la tâche, et l'échec d'une minute est simplement remplacé par la
tentative de la minute suivante. La résilience repose donc entièrement sur la cadence
d'une minute et sur l'état persisté côté base.

Ce qui protège l'exécution :

- **Bail de cycle.** `claim_autonomous_session_cycle` pose un bail (420 secondes, valeur
  passée par le travailleur) avant tout traitement. Un second appel concurrent — ou la
  minute suivante alors que le cycle précédent tourne encore — repart sans rien faire.
- **Planification du prochain cycle.** `finish_autonomous_session_cycle` libère le bail et
  fixe `next_cycle_at`. Un cycle en erreur repousse le suivant de 180 secondes, un cycle
  normal de 60 secondes.
- **Bail expiré.** Si une fonction meurt sans appeler `finish_autonomous_session_cycle`,
  le bail expire de lui-même après 420 secondes et la session redevient réclamable.
- **Expiration des sessions.** Le travailleur appelle `expire_autonomous_sessions` à
  chaque passage, avant de traiter quoi que ce soit.

Diagnostiquer une tâche silencieuse : consulter `cron.job_run_details` pour l'appel SQL
lui-même, puis les journaux de la fonction Edge côté Supabase pour la suite. La colonne
`agent_sessions.last_cycle_status` et `last_cycle_message` donnent l'état du dernier
cycle vu par l'application.

## Reconstruction

Ces tâches ne sont pas recréées par le code applicatif : elles vivent dans les migrations.
Un projet Supabase reconstruit à partir de `supabase/migrations/` retrouve les deux
tâches actives, à condition que les extensions `pg_cron` et `pg_net` soient disponibles
et que les secrets Vault existent — `quantfarm_project_url` est créé par la migration,
`autonomous_worker_secret` est généré aléatoirement à la première application.
