# PLAN DE REFONTE — QuantFarm AI

> Document maître. Toute décision structurante s'inscrit ici avant d'être codée.
> Date d'ouverture : 11 août 2026
> Base retenue : `Chatgpt2026-market` (déployé, fonctionnel, 28 migrations en production)

---

## 1. Pourquoi cette base et pas une autre

Neuf dépôts de trading ont été créés entre juin et juillet 2026. Quatre méritaient un examen sérieux :

| Dépôt | Force principale | Verdict |
|---|---|---|
| **Chatgpt2026-market** | Produit complet et **déployé** : Terminal, Intelligence, Laboratoire, 18 tables, 5 Edge Functions, RLS partout, journal append-only SHA-256, Vault | **Base retenue** |
| Gpt_forex_manager | Gouvernance quantitative supérieure : 5 agents à portes séquentielles, Backtest Auditor adversarial | Greffe prévue (Phase 2) |
| forex-gestion | Meilleure architecture : monorepo Turbo, packages découplés, conventions français québécois | Conventions reprises |
| Gpt-market-agent | Meilleure hygiène : CI GitHub Actions, Vitest, audit de dépendances | Outillage repris (Phase 1) |

**Décision : aucun nouveau dépôt.** Un dixième départ reproduirait le cycle des neuf précédents. La valeur est déjà construite ; elle doit être consolidée, pas recommencée.

---

## 2. État réel constaté le 11 août 2026

### Ce qui fonctionne bien

- **18 tables**, RLS activé sur la totalité, isolation par `auth.uid()`
- **5 Edge Functions actives** en production
- **28 migrations** appliquées, historique cohérent
- **Portes de qualité sérieuses** dans le travailleur autonome : minimum de sources, domaines distincts, présence d'une source officielle, crédibilité moyenne, seuil de confiance, accord directionnel entre agents. Tout échec force `HOLD`.
- **Secrets bien gérés** : clés OpenAI et Twelve Data chiffrées dans Supabase Vault, jamais retournées au navigateur
- **Concurrence maîtrisée** : `claim_autonomous_session_cycle` avec bail de 420 s, `finish_autonomous_session_cycle`, exécution atomique via `execute_agent_paper_trade`
- **Travailleur protégé** malgré `verify_jwt: false` : secret partagé haché SHA-256 vérifié contre `worker_configuration`
- **Authentification déjà par mot de passe** (`signInWithPassword`) — aucun lien magique, contrairement à ce que laissait croire le README
- Audit de sécurité Supabase : **une seule alerte**, mineure

### Dettes critiques

| # | Dette | Gravité | Phase |
|---|---|---|---|
| D1 | **Le schéma SQL n'existe pas dans le dépôt.** `supabase/schema.sql` contient 373 octets de commentaires. Les 28 migrations (~107 ko) vivent uniquement dans Supabase. | **Critique** | 0 |
| D2 | **Les 5 Edge Functions ne sont pas versionnées.** Leur code source n'existe que sur les serveurs Supabase. | **Critique** | 0 |
| D3 | **Aucun test.** Pas de Vitest, pas de script `test`, pas de `typecheck`. | Élevée | 1 |
| D4 | **Aucune CI.** Pas de `.github/workflows`. Rien ne valide un commit. | Élevée | 1 |
| D5 | Clés Supabase codées en dur comme repli dans `lib/supabase-browser.ts`. | Moyenne | 3 |
| D6 | `default_watchlist` lu dans le travailleur sans figurer dans le `select` — toujours `undefined`, donc le filtre `!== false` passe systématiquement. Fonctionne par accident. | Moyenne | 3 |
| D7 | Protection contre les mots de passe compromis désactivée (HaveIBeenPwned). | Faible | 3 |
| D8 | Nom de dépôt (`Chatgpt2026-market`) sans rapport avec le produit (**QuantFarm AI**). | Faible | 4 |

**D1 et D2 constituent un risque de perte totale.** Si le projet Supabase est supprimé, suspendu ou corrompu, l'intégralité du travail du 28 juillet disparaît sans copie. Rien d'autre ne compte tant que ce n'est pas réglé.

---

## 3. Phases

### Phase 0 — Rapatrier le patrimoine `← FAIT le 11 août 2026`

Objectif : plus aucun actif ne vit uniquement sur les serveurs Supabase.

- [x] Extraire les 28 migrations vers `supabase/migrations/<version>_<nom>.sql`
- [x] Extraire les 5 Edge Functions vers `supabase/functions/<slug>/index.ts`
- [x] Générer `supabase/schema.sql` complet (état consolidé, pour référence humaine)
- [x] Documenter les fonctions RPC dans `docs/rpc.md` : `execute_agent_paper_trade`, `get_integration_credentials`, `claim_autonomous_session_cycle`, `finish_autonomous_session_cycle`, `expire_autonomous_sessions`
- [x] Documenter les tâches planifiées (pg_cron) et leur cadence

**Critère de sortie :** le projet Supabase peut être recréé de zéro à partir du dépôt seul.

**Résultat.** Les 28 migrations sont extraites et **vérifiées une à une par empreinte MD5**
contre `supabase_migrations.schema_migrations` : 28 sur 28 sont identiques au caractère
près à ce qui tourne en production. Le schéma consolidé fait 92 ko et couvre 18 tables,
toutes avec RLS. `npm run build` passe. Aucune migration appliquée, aucune fonction
déployée : extraction seule.

Réserve honnête sur les Edge Functions : contrairement aux migrations, Supabase ne conserve
pas d'empreinte du code source consultable, seulement celle du paquet compilé. Leur
extraction ne bénéficie donc pas de la même vérification automatique que le SQL.

Trois constats relevés au passage, à traiter aux phases prévues :

- **D6 confirmé au code.** Dans `autonomous-market-worker`, `default_watchlist` est lu sur
  les instruments alors qu'il est absent du `select` *et* du type `Instrument`. Le filtre
  `!== false` compare donc toujours `undefined` et laisse tout passer. Fonctionne par
  accident, comme prévu.
- **Autorisation des RPC.** La migration `20260728080844` a retiré les vérifications
  `current_user <> 'service_role'` du corps des fonctions ; la protection ne tient plus
  qu'au privilège `EXECUTE`. C'est correct aujourd'hui, mais un `grant execute` mal placé
  suffirait à ouvrir l'accès aux secrets. À couvrir par un test en phase 1.
- **Aucun `package-lock.json` versionné.** Bloquant pour une CI reproductible ; à régler en
  ouverture de phase 1.

### Phase 1 — Filet de sécurité

Objectif : rendre tout changement futur vérifiable.

- [ ] Ajouter Vitest, scripts `test` et `typecheck` dans `package.json`
- [ ] Tests sur la logique pure : `technicalContext`, `classify`, `credibility`, `sessionLabel`, `marketOpen`, dimensionnement de position
- [ ] Tests sur les portes de qualité : vérifier que chaque échec force bien `HOLD`
- [ ] CI GitHub Actions : lint + typecheck + tests + build sur chaque push
- [ ] Couverture visée : > 80 % sur la logique critique

**Critère de sortie :** un commit qui casse une porte de risque échoue en CI.

### Phase 2 — Greffe du Backtest Auditor

Objectif : importer la rigueur quantitative de `Gpt_forex_manager`.

- [ ] Porter l'auditeur adversarial : détection de lookahead, observations insuffisantes, hors-échantillon inadéquat, coûts omis, excès de paramètres, absence de correction pour tests multiples
- [ ] Imposer le statut `CANDIDATE_SURVIVED_PRELIMINARY` — jamais « rentable »
- [ ] Exiger un dossier de preuve versionné (horodatage, empreinte des données et du code) avant toute progression
- [ ] Brancher l'auditeur sur `training_runs` du Laboratoire existant

**Critère de sortie :** aucune stratégie ne peut être présentée comme validée sans avoir survécu à l'audit.

### Phase 3 — Durcissement

- [ ] Retirer les clés codées en dur (D5)
- [ ] Corriger `default_watchlist` (D6)
- [ ] Activer la protection contre les mots de passe compromis (D7)
- [ ] Session longue : JWT expiry à 7 jours dans Supabase
- [ ] Vérifier la disponibilité du modèle `gpt-5.6-luna` et prévoir un repli explicite
- [ ] Confirmer les jours fériés et fermetures anticipées auprès d'une source officielle

### Phase 4 — Consolidation du parc

- [ ] Archiver (ne pas supprimer) les 8 autres dépôts de trading après extraction de toute valeur
- [ ] Renommer le dépôt en `quantfarm-ai`
- [ ] README unique reflétant l'état réel

---

## 4. Frontières non négociables

Ces règles ne se relâchent à aucune phase.

1. **Paper trading exclusivement.** Aucune connexion à un courtier réel, aucun ordre en argent réel.
2. **Les règles de risque restent du code déterministe.** Un modèle de langage ne peut jamais relever un seuil, contourner une porte ni annuler un `HOLD`.
3. **Le journal reste append-only**, chaîné par SHA-256. Ni modification, ni suppression, ni troncature.
4. **Aucune promesse de rendement.** Une interface convaincante n'est pas une preuve d'avantage. Une stratégie n'est validée que par des tests hors échantillon reproductibles, une validation walk-forward, des coûts réalistes et des tests de résistance.
5. **Les secrets ne reviennent jamais au navigateur.** Vault et fonctions authentifiées uniquement.

---

## 5. Répartition du travail

| Rôle | Responsabilités |
|---|---|
| **Claude (chat)** | Architecture, décisions, revue de code, rédaction des specs et du présent plan, écriture directe via GitHub MCP, inspection de la base via Supabase MCP |
| **Claude Code** | Extraction en masse, exécution de `supabase db pull`, build, tests, refactor multi-fichiers, boucle correction/vérification jusqu'au vert |
| **Patrick** | Arbitrages produit, réglages Supabase et Vercel, validation terrain |

---

## 6. Conventions

- Commentaires et noms de variables : **français québécois**
- Noms de fichiers et de paquets : anglais (convention npm)
- TypeScript strict : `noImplicitAny`, `strictNullChecks`
- Aucun `console.log` en production
- Secrets : `.env.local` ignoré par git, interface Vercel pour la production
- Tests : Vitest, couverture > 80 % sur la logique critique
