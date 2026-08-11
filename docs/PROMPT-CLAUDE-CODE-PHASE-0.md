# Prompt d'exécution — Phase 0

Copier-coller ce bloc dans Claude Code, à la racine du dépôt, sur la branche `refonte/phase-0-patrimoine`.

---

## Contexte

Projet : **QuantFarm AI**, plateforme de paper trading Next.js 16 / React 19 / Supabase, déployée sur Vercel.
Projet Supabase : `samukekuucaibcxkvsff` (région `ca-central-1`).
Lis `PLAN-REFONTE.md` à la racine avant toute action — il contient l'audit complet et les frontières non négociables.

## Problème à résoudre

Le dépôt ne contient **aucune trace** du travail de base de données. `supabase/schema.sql` fait 373 octets et ne contient que des commentaires. En réalité, la production contient :

- 28 migrations appliquées le 28 juillet 2026 (~107 ko de SQL)
- 18 tables, toutes avec RLS
- 5 Edge Functions actives
- Plusieurs fonctions RPC et des tâches pg_cron

Si le projet Supabase disparaît, tout est perdu. **C'est la seule urgence.**

## Tâches

### 1. Rapatrier les migrations

Installe la CLI Supabase, relie le projet, puis récupère l'historique complet :

```bash
supabase link --project-ref samukekuucaibcxkvsff
supabase db pull
```

Si `db pull` échoue ou produit un résultat incomplet, extrais directement depuis la table système :

```sql
select version, name, array_to_string(statements, E'\n;\n') as sql
from supabase_migrations.schema_migrations
order by version;
```

Écris chaque migration dans `supabase/migrations/<version>_<nom>.sql`. Respecte l'ordre chronologique et les noms exacts. Les 28 versions vont de `20260728034138` à `20260728230221`.

### 2. Rapatrier les Edge Functions

Cinq fonctions à extraire vers `supabase/functions/<slug>/index.ts` :

| Slug | verify_jwt | Note |
|---|---|---|
| `integration-manager` | `true` | possède un `deno.json` à récupérer aussi |
| `market-intelligence` | `true` | |
| `autonomous-market-worker` | `false` | protégée par secret partagé `x-worker-secret` haché SHA-256 |
| `ai-runtime-diagnostic` | `false` | |
| `autonomous-position-manager` | `false` | |

```bash
supabase functions download <slug>
```

Crée `supabase/functions/README.md` documentant, pour chaque fonction : son rôle, son mode d'authentification, ses variables d'environnement et sa cadence d'appel.

**Important :** `verify_jwt: false` n'est pas une faille ici. Les trois fonctions concernées valident un secret partagé haché contre la table `worker_configuration`. Ne modifie pas ce mécanisme.

### 3. Générer le schéma consolidé

Produis `supabase/schema.sql` — l'état complet actuel, lisible par un humain : tables, colonnes, contraintes, index, politiques RLS, fonctions RPC, triggers, extensions.

Ce fichier sert de référence, pas de source de vérité. La source de vérité reste `supabase/migrations/`.

### 4. Documenter les RPC

Crée `docs/rpc.md`. Pour chaque fonction, documente signature, paramètres, valeur de retour, effets de bord et appelants :

- `execute_agent_paper_trade` — exécution atomique d'une position paper
- `get_integration_credentials` — lecture des secrets Vault, réservée au rôle service
- `claim_autonomous_session_cycle` — verrou avec bail de 420 s
- `finish_autonomous_session_cycle` — libération et planification du prochain cycle
- `expire_autonomous_sessions` — expiration des sessions échues

### 5. Documenter les tâches planifiées

Crée `docs/cron.md`. Interroge `cron.job` et documente chaque tâche : nom, cadence, fonction appelée, comportement en cas d'échec.

## Vérification avant de terminer

- [ ] `supabase/migrations/` contient 28 fichiers `.sql` non vides
- [ ] `supabase/functions/` contient 5 sous-dossiers avec leur `index.ts`
- [ ] `supabase/schema.sql` fait plus de 20 ko
- [ ] `docs/rpc.md` et `docs/cron.md` existent
- [ ] `npm run build` passe
- [ ] Aucun secret, clé ou jeton n'apparaît dans les fichiers ajoutés — vérifie avant de committer

## Règles

- Ne modifie **aucun** fichier applicatif dans cette phase. Extraction et documentation uniquement.
- N'applique aucune migration, ne déploie aucune fonction, ne touche pas à la production.
- Commits atomiques, messages en français.
- Ouvre une pull request vers `main` intitulée `Phase 0 — Rapatriement du patrimoine Supabase`.

## Si tu es bloqué

Les identifiants Supabase sont dans le tableau de bord du projet. Si la CLI ne peut pas se relier depuis l'environnement mobile, utilise l'API REST de gestion Supabase avec un jeton d'accès personnel, ou signale le blocage plutôt que d'inventer un contournement.
