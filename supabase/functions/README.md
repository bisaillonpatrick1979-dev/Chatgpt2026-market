# Fonctions Edge

Code rapatrié depuis la production `samukekuucaibcxkvsff` le 11 août 2026. Cinq fonctions
sont actives. Aucune n'a été modifiée pendant l'extraction.

| Slug | `verify_jwt` | Version | Appelée par |
|---|---|---|---|
| `integration-manager` | `true` | 6 | Navigateur (session authentifiée) |
| `market-intelligence` | `true` | 4 | Navigateur (session authentifiée) |
| `autonomous-market-worker` | `false` | 1 | pg_cron, chaque minute |
| `ai-runtime-diagnostic` | `false` | 1 | Manuel (tâche cron retirée après usage) |
| `autonomous-position-manager` | `false` | 1 | pg_cron, chaque minute |

## Deux modes d'authentification

**`verify_jwt: true`** — La plateforme Supabase valide le JWT avant d'entrer dans la
fonction. Le code revalide ensuite explicitement par `auth.getUser()` avec un client
`anon` portant l'en-tête `Authorization`, puis n'utilise l'identité obtenue que pour
cadrer les appels faits avec la clé `service_role`. L'identifiant utilisateur ne vient
jamais du corps de la requête.

**`verify_jwt: false`** — Ces trois fonctions ne sont pas appelées par un humain mais par
`pg_cron`, qui n'a pas de session. Elles ne sont pas ouvertes pour autant : chacune exige
un en-tête `x-worker-secret`, en calcule le SHA-256 et le compare à
`worker_configuration.secret_hash` (ligne `autonomous_market_worker`, qui doit aussi être
`enabled = true`). Absence de secret : `401`. Secret invalide ou travailleur désactivé :
`403`.

Le secret en clair n'existe que dans Vault (`autonomous_worker_secret`) ; seule son
empreinte est en base. La table `worker_configuration` a RLS activé, aucun privilège pour
`anon` ni `authenticated`, et une politique explicite `using (false)` pour `authenticated`.

**Ce mécanisme ne doit pas être modifié.** Passer ces fonctions en `verify_jwt: true` les
rendrait inappelables par pg_cron et arrêterait le trading autonome.

## Variables d'environnement

Fournies automatiquement par la plateforme Supabase — rien à configurer à la main.

| Variable | `integration-manager` | `market-intelligence` | `autonomous-market-worker` | `ai-runtime-diagnostic` | `autonomous-position-manager` |
|---|---|---|---|---|---|
| `SUPABASE_URL` | oui | oui | oui | oui | oui |
| `SUPABASE_ANON_KEY` | oui | oui | — | — | — |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | oui | oui | oui | oui |

Les clés OpenAI et Twelve Data ne sont **pas** des variables d'environnement. Elles sont
chiffrées dans Vault, par utilisateur, et lues à l'exécution via
`get_integration_credentials`. Elles ne sont jamais retournées au navigateur.

## Rôle de chaque fonction

### `integration-manager`

Point d'entrée unique pour la gestion des connexions externes et la lecture des
chandelles. Quatre actions : `save`, `test`, `delete`, `market_data`.

L'environnement `live` est refusé au niveau de la fonction (`403`) en plus des contraintes
en base — Alpaca est cantonné à `paper`, OANDA à `practice`. Aucun ordre réel n'est
possible par ce chemin.

`market_data` interroge Twelve Data en `live` ou en `historical`, puis alimente
`market_data_health` en mode `live` seulement (fraîcheur, âge, seuil de péremption). C'est
cette table que les portes de risque consultent pour refuser une entrée sur données
périmées. Le mode `historical` n'écrit pas cette table, volontairement : le replay ne doit
pas se faire passer pour du temps réel.

Possède un `deno.json` qui active `strict: true`.

### `market-intelligence`

Orchestration de la recherche IA déclenchée depuis l'interface. Chaîne le modèle de
recherche puis, en mode `deep`, un modèle de synthèse qui joue le contradicteur final.
La recherche Web est restreinte à une liste de domaines autorisés.

Applique ensuite un garde-fou de qualité entièrement déterministe, calculé en TypeScript
et non par le modèle : nombre de sources, domaines distincts, présence d'au moins une
source officielle, crédibilité moyenne, confiance minimale, accord directionnel entre les
votes des spécialistes, fraîcheur des données. **Tout échec force `HOLD` et plafonne la
confiance à 0,49.** Le résultat est écrit dans `market_research_runs.result.qualityGate`,
que `execute_agent_paper_trade` revérifie côté base.

Refuse la recherche en mode `historical` : chercher des nouvelles du jour pour juger une
séance passée serait du lookahead.

Peut déclencher une exécution paper si — et seulement si — le cycle est automatique, une
session est active, le signal n'est pas `HOLD`, aucune porte n'a échoué et le kill switch
est inactif.

### `autonomous-market-worker`

Le cœur du trading autonome côté serveur. À chaque minute :

1. Valide le secret partagé.
2. Appelle `expire_autonomous_sessions`.
3. Prend jusqu'à quatre sessions `autonomous` + `live` + `running`.
4. Pour chacune, tente `claim_autonomous_session_cycle` avec un bail de **420 secondes** ;
   si le bail n'est pas obtenu, passe son tour.
5. Choisit un symbole dont la recherche a expiré et dont le marché est ouvert.
6. Récupère 180 chandelles de 5 minutes chez Twelve Data, calcule le contexte technique,
   met à jour `market_data_health`, et refuse au-delà de 750 secondes d'ancienneté.
7. Lance l'analyse IA, applique les mêmes portes de qualité déterministes.
8. Si tout passe, dimensionne la position — le minimum entre la quantité permise par le
   risque, 20 % de l'allocation agent et l'encaisse disponible — puis appelle
   `execute_agent_paper_trade`.
9. Ferme le cycle par `finish_autonomous_session_cycle` avec le prochain délai.

Toute erreur est capturée, journalisée dans `trade_logs`, et repousse le cycle suivant de
180 secondes.

### `autonomous-position-manager`

Surveille les positions agent ouvertes, jusqu'à cent par passage. Pour chacune : récupère
le dernier prix chez Twelve Data (avec un cache par symbole dans le passage), vérifie que
le marché est ouvert et que le prix a moins de 300 secondes, puis appelle
`manage_agent_paper_position`, qui décide seul de fermer ou non.

Force la fermeture quand la session est terminée et que `closeAgentsAtEnd` n'est pas
désactivé — dans ce cas les contrôles de marché ouvert et de fraîcheur sont contournés,
volontairement : une position ne doit pas rester ouverte parce que le marché a fermé.

Une erreur sur une position n'interrompt pas le traitement des autres.

### `ai-runtime-diagnostic`

Vérification ponctuelle que la clé OpenAI enregistrée répond bien sur l'API Responses.
Écrit le résultat dans `runtime_diagnostics`. Ne place aucun ordre et ne touche à aucune
position. Sa tâche cron a été retirée après le diagnostic du 28 juillet ; la fonction
reste déployée pour un appel manuel.

## Déploiement

```bash
supabase functions deploy <slug> --project-ref samukekuucaibcxkvsff
```

Les trois fonctions du travailleur exigent `--no-verify-jwt` si leur configuration devait
être recréée de zéro, faute de quoi pg_cron ne pourrait plus les appeler.

Aucun déploiement n'a été effectué pendant la phase 0 : ces fichiers sont une copie de ce
qui tourne déjà.
