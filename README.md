# Chatgpt2026 Market — QuantFarm AI

Plateforme privée de **paper trading uniquement**, conçue pour téléphone, tablette et ordinateur.

## Sections de l’application

- **Terminal** : ordres internes paper, portefeuille, positions, sessions autonomes et contrôle du risque.
- **Intelligence IA** : recherche Web, nouvelles, macroéconomie, sentiment, votes multi-agents et sources auditables.
- **Laboratoire** : backtests, coûts, glissement, validation 70/30 et simulations Monte-Carlo.

## Fonctions opérationnelles

- Modes manuel, assisté, autonome et replay historique
- Portefeuille, ordres, positions, sessions et limites persistés dans Supabase
- Sessions autonomes de 10 minutes, 1 heure, 4 heures ou illimitées
- Proposition IA avec approbation humaine en mode assisté
- Moteur autonome paper fondé sur tendance, volatilité, confiance minimale et budget de risque
- Agent de recherche automatique actif pendant les sessions autonomes live paper
- Garde serveur bloquant les entrées IA qui ne respectent pas la recherche ou la fraîcheur des prix
- Kill switch persistant, perte maximale, nombre maximal de positions et risque maximal par transaction
- Fermeture automatique optionnelle des positions d’agents à la fin d’une session
- Graphiques TradingView Lightweight Charts
- Twelve Data via clé chiffrée enregistrée dans l’application, avec repli automatique sur les données fictives
- Détection de données périmées selon l’intervalle des chandelles
- Heures locales et heures de l’Alberta pour NYSE/Nasdaq, TSX, Londres, Euronext, Tokyo, ASX, Forex et crypto
- Séance de Tokyo divisée correctement entre le matin et l’après-midi
- Journal de décisions placé immédiatement sous les positions ouvertes
- Journal append-only avec chaîne de hachage SHA-256; les mises à jour, suppressions et troncatures sont interdites
- Authentification Supabase et isolation des données avec Row Level Security
- Secrets envoyés à une fonction Supabase authentifiée et chiffrés dans Supabase Vault
- Connexions et identifiants de courtage réels explicitement verrouillés

## Intelligence de marché IA

La route `/intelligence` permet de :

- enregistrer une clé OpenAI chiffrée dans Supabase Vault;
- lancer une recherche rapide ou approfondie;
- analyser les annonces officielles, banques centrales, régulateurs, bourses et médias financiers reconnus;
- calculer un sentiment entre -1 et +1 et un niveau de confiance;
- faire voter des agents spécialisés : macro, nouvelles, sentiment, fondamentaux, régime technique, contradicteur et chef de portefeuille;
- conserver les sources, les votes et le résultat de chaque recherche;
- imposer automatiquement un signal **HOLD** lorsque les sources, la présence d’une source officielle ou la confiance sont insuffisantes;
- bloquer la recherche Web actuelle pendant le replay historique afin d’éviter l’utilisation d’informations futures.

Pendant une session autonome en mode live paper, `BackgroundIntelligenceAgent` :

- vérifie que les connexions OpenAI et Twelve Data sont configurées;
- crée une liste de surveillance initiale lorsqu’elle est vide;
- fait tourner les symboles de la liste sans lancer plusieurs recherches simultanées;
- renouvelle uniquement les recherches expirées;
- transmet les prix, leur âge, SMA 5/20, ATR et plage récente aux agents;
- ne fonctionne jamais pendant le replay historique.

Avant l’insertion d’un ordre paper assisté ou autonome live, un déclencheur Supabase exige :

- une source de prix réelle validée et non périmée;
- une recherche IA terminée et non expirée;
- une confiance supérieure au seuil configuré;
- un signal BUY ou SELL correspondant exactement au côté de l’ordre;
- le refus de toute entrée lorsque le consensus est HOLD.

Les domaines autorisés, le nombre minimal de sources, la confiance minimale et la durée de validité d’une recherche sont configurables par utilisateur.

## Laboratoire de stratégies

La route `/laboratoire` comprend :

- suivi de tendance, retour à la moyenne et cassures;
- positionnement long ou court simulé;
- dimensionnement selon le risque;
- stop-loss et take-profit;
- frais et glissement exprimés en points de base;
- séparation 70 % ajustement / 30 % hors échantillon;
- rendement, drawdown, taux gagnant, profit factor et Sharpe expérimental;
- 500 séquences Monte-Carlo réordonnées;
- historique privé dans `training_runs`.

## Démarrage local

```bash
npm install
npm run dev
```

Ouvrir `http://localhost:3000`.

## Variables d’environnement

Créer un fichier `.env.local` :

```env
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=votre_cle_publishable

# Facultatif : source Twelve Data serveur de secours.
TWELVE_DATA_API_KEY=votre_cle
```

La clé publishable Supabase est prévue pour le navigateur; l’accès aux données est contrôlé par RLS. Les clés Twelve Data et OpenAI saisies dans l’application sont envoyées aux fonctions authentifiées, chiffrées dans Vault et ne sont jamais retournées au navigateur.

## Déploiement Vercel

Ajouter `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans **Production**, **Preview** et **Development**. `TWELVE_DATA_API_KEY` est facultative, puisque chaque utilisateur peut enregistrer sa propre clé dans Vault.

Au premier compte créé, l’application initialise automatiquement :

- un portefeuille paper de 100 000 $ CA;
- une allocation d’agents de 10 000 $ CA;
- les profils d’agents spécialisés;
- un profil configuré sur `America/Edmonton`;
- les limites de risque et de recherche sécuritaires par défaut.

## Supabase

Les données fonctionnelles utilisent notamment `profiles`, `paper_wallets`, `agent_profiles`, `agent_sessions`, `orders`, `positions`, `trade_logs`, `watchlist_items`, `training_runs`, `integration_connections`, `intelligence_settings`, `market_research_runs`, `market_research_sources`, `market_agent_votes` et `market_data_health`. Toutes les tables exposées ont RLS activé.

Fonctions Edge :

- `integration-manager` : secrets, tests de connexion, données Twelve Data et enregistrement de leur fraîcheur;
- `market-intelligence` : recherche Web OpenAI, garde-fous de qualité et persistance des résultats.

## Limites honnêtes

- Le moteur autonome et les plans IA sont des expériences paper; aucune rentabilité n’est garantie ni démontrée.
- Le calendrier calcule les séances régulières et les changements d’heure, mais les jours fériés et fermetures anticipées doivent encore être confirmés par une source officielle avant une future exécution réelle.
- Aucun ordre n’est transmis à Alpaca Paper, OANDA Practice ou IBKR Paper.
- Aucune réconciliation externe des ordres, exécutions ou positions de courtier n’est activée.
- Le jeu historique fictif sert à tester le moteur. Il ne remplace pas une base institutionnelle ajustée pour divisions, dividendes, changements de symbole et survivorship bias.
- Une recherche IA dépend de la qualité, de la disponibilité et du coût des fournisseurs externes.
- Aucun ordre avec argent réel n’est permis dans cette version.
