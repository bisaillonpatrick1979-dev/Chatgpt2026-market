# Supabase

Projet distant `samukekuucaibcxkvsff`, Postgres 17, région Canada Central (`ca-central-1`).

Depuis le rapatriement du 11 août 2026, **le dépôt contient l'intégralité du travail de
base de données**. Un projet Supabase peut être reconstruit à partir de ce dossier seul.

## Contenu

| Chemin | Rôle |
|---|---|
| `migrations/` | **Source de vérité.** Les 28 migrations de production, extraites telles quelles et vérifiées par empreinte MD5 contre `supabase_migrations.schema_migrations`. |
| `functions/` | Les 5 fonctions Edge actives, plus leur documentation (`functions/README.md`). |
| `schema.sql` | État consolidé du schéma, généré depuis le catalogue Postgres. **Référence de lecture seulement** — voir ci-dessous. |
| `variables.example` | Variables publiques attendues par l'application. |

Deux documents complètent l'ensemble à la racine du dépôt : `docs/rpc.md` pour les
fonctions RPC et `docs/cron.md` pour les tâches planifiées.

## schema.sql n'est pas la source de vérité

Ce fichier est une photographie du catalogue, utile pour lire le schéma d'un coup d'œil
sans dérouler 28 migrations. Il n'est pas conçu pour être exécuté : l'ordre des objets n'y
est pas garanti résolvable et il ne reflète aucun historique.

Pour reconstruire, appliquer `migrations/` dans l'ordre des versions.

## Reconstruire de zéro

```bash
supabase link --project-ref <nouveau-projet>
supabase db push
supabase functions deploy integration-manager
supabase functions deploy market-intelligence
supabase functions deploy autonomous-market-worker --no-verify-jwt
supabase functions deploy ai-runtime-diagnostic --no-verify-jwt
supabase functions deploy autonomous-position-manager --no-verify-jwt
```

Les trois fonctions du travailleur autonome **doivent** rester en `verify_jwt: false` :
elles sont appelées par pg_cron, qui n'a pas de session utilisateur, et se protègent par
un secret partagé haché SHA-256 vérifié contre `worker_configuration`. Voir
`functions/README.md`.

Les migrations créent elles-mêmes le secret du travailleur et l'URL du projet dans Vault.
Les clés OpenAI et Twelve Data, elles, sont propres à chaque utilisateur et se
réenregistrent depuis l'interface — elles ne sont jamais dans le dépôt.

## Vérifier que le dépôt correspond toujours à la production

```sql
select version, name, md5(statements[1]) as md5
from supabase_migrations.schema_migrations
order by version;
```

Comparer aux `md5sum` des fichiers de `migrations/`. Toute divergence signale une
migration appliquée hors dépôt, à rapatrier avant d'aller plus loin.
