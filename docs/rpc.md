# Fonctions RPC

État relevé dans la production `samukekuucaibcxkvsff` le 11 août 2026, par lecture de
`pg_proc`. Toutes ces fonctions vivent dans le schéma `public`. Leur définition
faisant foi se trouve dans `supabase/migrations/`.

## Règle d'autorisation

Aucune de ces fonctions n'est appelable depuis le navigateur. Le contrôle repose sur le
privilège `EXECUTE` : `revoke all ... from public, anon, authenticated` puis
`grant execute ... to service_role`. Seules les fonctions Edge, qui détiennent la clé
`service_role`, peuvent les invoquer.

À noter pour la revue de sécurité : les migrations initiales vérifiaient en plus
`current_user <> 'service_role'` dans le corps des fonctions. La migration
`20260728080844` a retiré cette vérification, avec cette justification laissée en
commentaire dans le code — dans une fonction `SECURITY DEFINER`, `current_user` est le
propriétaire de la fonction et n'identifie pas l'appelant PostgREST de façon fiable. La
garantie repose donc sur le privilège `EXECUTE` seul. C'est correct, mais cela veut dire
qu'un futur `grant execute ... to authenticated` ouvrirait la porte sans autre filet.

## Exécution et gestion des positions paper

### `execute_agent_paper_trade`

```
execute_agent_paper_trade(
  p_user_id uuid, p_session_id uuid, p_symbol text, p_side text,
  p_entry_price numeric, p_stop_loss numeric, p_take_profit numeric,
  p_quantity numeric, p_research_run_id uuid, p_market_context jsonb
) returns jsonb
```

`SECURITY DEFINER`, `search_path = pg_catalog, public`, `EXECUTE` réservé à `service_role`.

Ouvre une position paper de façon atomique. C'est le point de passage obligé de toute
entrée autonome, et il porte l'essentiel des règles de risque déterministes.

Portes vérifiées, dans l'ordre, chacune levant une exception qui annule toute la
transaction :

1. Direction dans `BUY`/`SELL`, prix, quantité, stop et cible strictement positifs.
2. Session `autonomous` + `live` + `running`, verrouillée `for update`, non expirée.
3. Portefeuille existant, verrouillé `for update`, `kill_switch` inactif.
4. Recherche IA (`market_research_runs`) existante, `completed`, non expirée, et dont
   `result->'qualityGate'->>'passed'` vaut vrai.
5. Signal de la recherche identique à la direction demandée.
6. Instrument présent dans `market_instruments`.
7. Marché ouvert, sauf si `blockClosedMarkets` est explicitement désactivé.
8. Aucune position déjà ouverte sur le symbole.
9. Nombre de positions ouvertes sous `maxPositions` (défaut 5).
10. Risque de l'ordre — `|entrée − stop| × quantité` — sous `agent_allocation × riskPerTradePct/100`,
    avec `riskPerTradePct` borné à 0,5 % maximum.
11. Exposition agent cumulée sous `agent_allocation`.
12. Encaisse suffisante pour un achat.

Effets de bord, tous dans la même transaction : insertion d'un `orders` déjà `filled`,
insertion de la `positions`, mise à jour de `paper_wallets.cash_balance`, écriture d'un
`trade_logs`. Retourne un objet JSON décrivant l'ordre, la position, la place de marché
et l'encaisse résultante.

Appelée par : `market-intelligence` (cycle automatique) et `autonomous-market-worker`.

### `manage_agent_paper_position`

```
manage_agent_paper_position(
  p_user_id uuid, p_position_id uuid, p_market_price numeric,
  p_trailing_stop_pct numeric default 0.75, p_force_close boolean default false,
  p_force_reason text default null, p_metadata jsonb default '{}'
) returns jsonb
```

`SECURITY DEFINER`, `EXECUTE` réservé à `service_role`.

Marque une position agent au prix courant et la ferme si une sortie est atteinte.
Verrouille la position et le portefeuille (`for update`).

Logique de sortie, déterministe et entièrement en SQL :

- Suivi des extrêmes `high_watermark` / `low_watermark`.
- Après un gain d'au moins la moitié du risque initial, un stop suiveur s'active à
  `trailing_stop_pct` du meilleur niveau atteint (borné entre 0,05 % et 10 %).
- Après un gain d'au moins un risque complet, le stop remonte au moins au point mort.
- Le stop effectif est le plus protecteur entre le stop initial et le stop dynamique.
- Fermeture si la cible est franchie, si le stop effectif est touché, ou si
  `p_force_close` est vrai (fin de session).

À la fermeture : ordre de sens inverse déjà `filled`, position passée à `closed` avec
`realized_pnl` et `exit_reason`, encaisse mise à jour, entrée au journal. Sans fermeture,
la fonction met seulement à jour les repères et retourne `closed: false`.

Appelée par : `autonomous-position-manager`.

## Cycle du travailleur autonome

### `claim_autonomous_session_cycle`

```
claim_autonomous_session_cycle(p_session_id uuid, p_lease_seconds integer default 240) returns boolean
```

`SECURITY DEFINER`, `EXECUTE` réservé à `service_role`.

Pose un bail sur une session et retourne `true` si l'appelant l'a obtenu. C'est le verrou
qui empêche deux exécutions concurrentes de traiter la même session — nécessaire puisque
la tâche cron se déclenche chaque minute alors qu'un cycle peut durer plus longtemps.

La mise à jour ne réussit que si la session est `autonomous` + `live` + `running`, non
expirée, sans bail en cours, et dont `next_cycle_at` est échu. La durée est bornée entre
30 et 600 secondes. Le défaut de la fonction est 240 secondes, mais
`autonomous-market-worker` passe explicitement **420 secondes**.

### `finish_autonomous_session_cycle`

```
finish_autonomous_session_cycle(
  p_session_id uuid, p_status text, p_message text,
  p_symbol text default null, p_next_seconds integer default 120
) returns void
```

`SECURITY DEFINER`, `EXECUTE` réservé à `service_role`.

Libère le bail et planifie le cycle suivant. Écrit `last_cycle_at`, `last_cycle_status`
(tronqué à 40 caractères), `last_cycle_message` (500 caractères), `last_symbol`, incrémente
`cycle_count` et remet `worker_lease_until` à `null`. `next_cycle_at` n'est fixé que si la
session est encore `running` — sinon il est mis à `null`. Le délai est borné entre 30 et
1800 secondes.

Cadences utilisées par le travailleur : 60 s après un cycle normal ou une pause
d'inactivité, 180 s après une erreur, 300 s si l'intelligence est désactivée ou le
kill switch actif.

### `expire_autonomous_sessions`

```
expire_autonomous_sessions() returns integer
```

`SECURITY DEFINER`, `EXECUTE` réservé à `service_role`.

Ferme les sessions autonomes dont `ends_at` est dépassé et retourne le nombre de sessions
fermées. Repasse ensuite en `manual` tout portefeuille marqué `autonomous` qui n'a plus
de session active — c'est le filet qui empêche un portefeuille de rester en mode
autonome sans travailleur derrière.

Appelée au début de chaque passage de `autonomous-market-worker`.

## Secrets et intégrations

### `get_integration_credentials`

```
get_integration_credentials(p_user_id uuid, p_provider text, p_environment text) returns jsonb
```

`SECURITY DEFINER`, `search_path = pg_catalog, public, vault`, `EXECUTE` réservé à `service_role`.

Déchiffre les identifiants stockés dans Vault en joignant `integration_connections` à
`vault.decrypted_secrets`. **Cette fonction est le seul chemin de lecture des secrets, et
son résultat ne doit jamais être retourné au navigateur.** Les fonctions Edge s'en servent
pour obtenir les clés OpenAI et Twelve Data au moment de l'appel, sans jamais les exposer.

### `store_integration_credentials`

```
store_integration_credentials(
  p_user_id uuid, p_provider text, p_environment text,
  p_label text, p_account_reference text, p_credentials jsonb
) returns public.integration_connections
```

`SECURITY DEFINER`, `EXECUTE` réservé à `service_role`.

Crée ou met à jour le secret Vault (`vault.create_secret` / `vault.update_secret`) puis
enregistre les métadonnées dans `integration_connections`. Valide le fournisseur,
l'environnement, le type JSON et la taille (16 ko maximum). Le nom du secret suit le
motif `quantfarm_<uuid sans tirets>_<fournisseur>_<environnement>`. Toute écriture remet
le statut à `not_tested`.

### `delete_integration_credentials_admin`

```
delete_integration_credentials_admin(p_user_id uuid, p_provider text, p_environment text) returns boolean
```

`SECURITY DEFINER`, `EXECUTE` réservé à `service_role`.

Supprime la ligne `integration_connections` puis le secret Vault correspondant. Retourne
`false` si rien n'était enregistré.

### `set_integration_test_result`

```
set_integration_test_result(
  p_user_id uuid, p_provider text, p_environment text,
  p_success boolean, p_error text default null
) returns void
```

`SECURITY DEFINER`, `EXECUTE` réservé à `service_role`.

Consigne le résultat d'un test de connexion : statut `connected` ou `error`,
`last_tested_at`, et message d'erreur tronqué à 500 caractères.

## Fonction utilitaire

### `resolve_market_session`

```
resolve_market_session(p_session_kind text, p_timezone text, p_sessions jsonb, p_at timestamptz default now()) returns text
```

`SECURITY INVOKER`, `STABLE`, exécutable par `authenticated`.

Retourne le libellé de la séance en cours pour un instrument : `24/7` pour le crypto, la
combinaison des places actives pour le forex (`Sydney + Tokyo`, …) ou
`Fermé hebdomadaire`, et pour les bourses le nom de la séance du calendrier ou `Fermé` /
`Hors séance`. Les libellés `Fermé`, `Hors séance` et `Fermé hebdomadaire` sont ceux que
`execute_agent_paper_trade` traite comme marché fermé — les modifier casserait cette porte.

**Limite connue :** cette fonction ne connaît que les fins de semaine. Les jours fériés et
les fermetures anticipées ne sont pas gérés (dette inscrite en phase 3 du plan de refonte).

## Fonctions de déclencheur

Ces fonctions ne s'appellent pas directement ; elles sont attachées à des déclencheurs.
Elles sont listées ici parce qu'elles portent des règles de risque.

| Fonction | Déclencheur | Rôle |
|---|---|---|
| `enforce_paper_intelligence_gate` | `before insert on orders` | Porte principale des ordres `agent`/`assisted` en `live` : cadence maximale, temporisation entre ordres, fraîcheur des données, recherche IA valide, garde-fou de qualité, confiance minimale, accord avec le signal |
| `prevent_duplicate_agent_order` | `before insert on orders` | Refuse une entrée si une position est déjà ouverte sur le symbole, sauf s'il s'agit d'un ordre de fermeture (`metadata.closingPositionId`) |
| `block_diagnostic_agent_orders` | `before insert on orders` | Bloque tout ordre issu d'une session marquée `diagnostic` |
| `enrich_order_market_context` | `before insert on orders` | Renseigne place de marché, MIC, fuseau, séance et fournisseurs à partir de `market_instruments` |
| `enrich_position_market_context` | `before insert on positions` | Même enrichissement, hérité de l'ordre d'ouverture quand il existe |
| `prepare_agent_position_lifecycle` | `before insert on positions` | Initialise `initial_stop_loss`, les repères haut/bas et `trailing_stop_pct` (0,75 % par défaut) |
| `prepare_immutable_trade_log` | `before insert on trade_logs` | Calcule `entry_hash` en SHA-256 en chaînant `previous_hash`, sous verrou consultatif par utilisateur |
| `reject_trade_log_mutation` | `before update or delete on trade_logs` | Lève systématiquement une exception : le journal est append-only |

## Fonctions supprimées

`save_integration_credentials(text,text,text,text,jsonb)` et
`delete_integration_credentials(text,text)` — appelables par `authenticated` — ont été
retirées par la migration `20260728040021`, qui a déplacé toute la gestion des secrets
côté serveur. Elles ne sont plus présentes en production.
