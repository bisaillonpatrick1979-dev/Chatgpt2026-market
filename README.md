# Chatgpt2026 Market — QuantFarm AI

Terminal de **paper trading uniquement**, conçu pour téléphone et tablette.

## Fonctions incluses

- Modes manuel, assisté, autonome et replay historique
- Portefeuille paper entièrement modifiable
- Allocation distincte pour les agents IA
- Sessions autonomes de 10 minutes, 1 heure, 4 heures ou illimitées
- Graphiques en chandelles avec TradingView Lightweight Charts
- Données Twelve Data côté serveur avec repli automatique sur des données simulées
- Positions longues et courtes, lots, stop-loss, take-profit et profit/perte
- Statut indicatif des marchés mondiaux en heure de l’Alberta
- Authentification Supabase par courriel et mot de passe
- Sauvegarde du portefeuille, des ordres, positions, agents, sessions et journaux dans Supabase
- Isolation des données par utilisateur avec Row Level Security
- Aucune intégration à un courtier réel dans ce MVP

## Démarrage local

```bash
npm install
npm run dev
```

Ouvrir `http://localhost:3000`.

## Variables d’environnement

Créer un fichier `.env.local` :

```env
TWELVE_DATA_API_KEY=votre_cle
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=votre_cle_publishable
```

`TWELVE_DATA_API_KEY` reste côté serveur. La clé publishable Supabase est conçue pour le navigateur; l’accès aux données est contrôlé par les politiques RLS de la base.

## Déploiement Vercel

Ajouter les trois variables dans **Production**, **Preview** et **Development**, puis redéployer.

Au premier compte créé, l’application initialise automatiquement :

- un portefeuille paper de 100 000 $ CA;
- une allocation d’agents de 10 000 $ CA;
- six profils d’agents spécialisés;
- un profil configuré sur le fuseau `America/Edmonton`.

## Supabase

Le projet utilise les tables `profiles`, `paper_wallets`, `agent_profiles`, `agent_sessions`, `orders`, `positions`, `trade_logs`, `watchlist_items` et `training_runs`. Toutes les tables exposées ont RLS activé et leurs politiques exigent que `auth.uid()` corresponde au propriétaire.

## Limites actuelles

- Le moteur autonome est une démonstration paper basée sur un signal de moyennes mobiles; il ne constitue pas une stratégie rentable prouvée.
- Le calendrier affiche les séances régulières sans encore intégrer tous les jours fériés et fermetures anticipées.
- Les cours Twelve Data sont rafraîchis à la demande; le flux WebSocket temps réel sera ajouté dans une phase suivante.
