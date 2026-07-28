# Chatgpt2026 Market — QuantFarm AI

Plateforme privée de **paper trading uniquement**, conçue pour téléphone, tablette et ordinateur.

## Fonctions opérationnelles

- Modes manuel, assisté, autonome et replay historique
- Portefeuille, ordres, positions, sessions et limites persistés dans Supabase
- Sessions autonomes de 10 minutes, 1 heure, 4 heures ou illimitées
- Proposition IA avec approbation humaine en mode assisté
- Moteur autonome paper fondé sur tendance, volatilité, confiance minimale et budget de risque
- Kill switch persistant, perte maximale, nombre maximal de positions et risque maximal par transaction
- Fermeture automatique optionnelle des positions d’agents à la fin d’une session
- Graphiques TradingView Lightweight Charts
- Twelve Data via clé chiffrée enregistrée dans l’application, avec repli automatique sur les données fictives
- Heures locales et heures de l’Alberta pour NYSE/Nasdaq, TSX, Londres, Euronext, Tokyo, ASX, Forex et crypto
- Séance de Tokyo divisée correctement entre le matin et l’après-midi
- Journal de décisions placé immédiatement sous les positions ouvertes
- Journal append-only avec chaîne de hachage SHA-256; les mises à jour, suppressions et troncatures sont interdites
- Authentification Supabase et isolation des données avec Row Level Security
- Onglet Paramètres & API pour Twelve Data, Polygon, Alpaca Paper, OANDA Practice et la préparation IBKR Paper
- Secrets envoyés à une fonction Supabase authentifiée et chiffrés dans Supabase Vault
- Connexions et identifiants de courtage réels explicitement verrouillés

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

La clé publishable Supabase est prévue pour le navigateur; l’accès aux données est contrôlé par RLS. Les clés saisies dans l’onglet Paramètres ne sont jamais stockées dans le navigateur ni retournées par l’API.

## Déploiement Vercel

Ajouter `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans **Production**, **Preview** et **Development**. `TWELVE_DATA_API_KEY` est facultative, puisque chaque utilisateur peut enregistrer sa propre clé dans Vault.

Au premier compte créé, l’application initialise automatiquement :

- un portefeuille paper de 100 000 $ CA;
- une allocation d’agents de 10 000 $ CA;
- six profils d’agents spécialisés;
- un profil configuré sur `America/Edmonton`;
- les limites de risque sécuritaires par défaut.

## Supabase

Les données fonctionnelles utilisent `profiles`, `paper_wallets`, `agent_profiles`, `agent_sessions`, `orders`, `positions`, `trade_logs`, `watchlist_items`, `training_runs` et `integration_connections`. Toutes les tables exposées ont RLS activé. Les identifiants externes sont chiffrés dans Vault et manipulés seulement par la fonction Edge `integration-manager`.

## Limites honnêtes

- Le moteur autonome est un moteur d’expérimentation paper; aucune rentabilité n’est garantie ni démontrée.
- Le calendrier calcule les séances régulières et les changements d’heure, mais les jours fériés et fermetures anticipées doivent encore être confirmés par une source officielle avant une future exécution réelle.
- Alpaca et OANDA peuvent être authentifiés en environnement paper/practice, mais le routage des ordres externes n’est pas encore activé.
- IBKR nécessite Client Portal Gateway ou OAuth avant qu’un test complet et un routage paper puissent être ajoutés.
- Aucun ordre avec argent réel n’est permis dans cette version.
