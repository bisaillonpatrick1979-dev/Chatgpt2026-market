# Chatgpt2026 Market — QuantFarm AI

MVP de terminal de **paper trading uniquement**, conçu pour fonctionner sur téléphone et tablette.

## Fonctions incluses

- Modes manuel, assisté, autonome et replay historique
- Portefeuille paper entièrement modifiable
- Allocation distincte pour les agents IA
- Sessions autonomes de 10 minutes, 1 heure, 4 heures ou illimitées
- Graphiques en chandelles avec TradingView Lightweight Charts
- Données Twelve Data côté serveur avec repli automatique sur des données simulées
- Positions, lots, stop-loss, take-profit et profit/perte
- Statut indicatif des marchés mondiaux en heure de l’Alberta
- Journal des décisions et exécutions
- Aucune intégration à un courtier réel dans ce MVP

## Démarrage local

```bash
npm install
npm run dev
```

Ouvrir `http://localhost:3000`.

## Twelve Data

Créer un fichier `.env.local` :

```env
TWELVE_DATA_API_KEY=votre_cle
```

La clé reste utilisée par la route serveur `/api/market-data` et n’est jamais envoyée au navigateur.

## Déploiement Vercel

Ajouter la variable `TWELVE_DATA_API_KEY` dans les variables d’environnement du projet Vercel, puis redéployer.

## Limites actuelles

- Le moteur autonome est une démonstration paper basée sur un signal de moyennes mobiles; il ne constitue pas une stratégie rentable prouvée.
- Le calendrier affiche les séances régulières selon le fuseau de chaque marché, sans encore intégrer tous les jours fériés et fermetures anticipées.
- Le portefeuille est conservé dans l’état du navigateur pendant la session; Supabase et les comptes utilisateurs seront ajoutés dans une phase suivante.
