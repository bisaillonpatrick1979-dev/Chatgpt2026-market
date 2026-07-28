# QuantFarm AI — vérification de la plateforme

## Livré et branché

- Authentification et isolation RLS par utilisateur
- Portefeuille paper persistant
- Ordres manuels, assistés et autonomes persistants
- Sessions 10 minutes, 1 heure, 4 heures ou illimitées
- Kill switch persistant
- Risque maximal par transaction, perte maximale, maximum de positions
- Stop-loss et take-profit obligatoires ou calculés automatiquement
- Journal append-only avec chaîne SHA-256
- Journal placé sous les positions ouvertes
- Heures locales et conversion Alberta pour les marchés principaux
- Clés chiffrées dans Supabase Vault
- Test sécurisé Twelve Data, Polygon, Alpaca Paper, OANDA Practice et configuration IBKR
- Twelve Data enregistré dans Paramètres utilisé réellement par le graphique
- Environnements de courtage réels verrouillés

## Prochaines étapes avant tout argent réel

- Calendrier officiel des jours fériés et fermetures anticipées
- Routage paper complet vers Alpaca, OANDA et IBKR
- Réconciliation ordres, exécutions et positions du courtier
- WebSocket temps réel et surveillance des données périmées
- Backtests walk-forward, coûts, glissement et Monte-Carlo
- Alertes, quotas de fournisseurs et reprise après panne
- Double confirmation et période d’observation avant une éventuelle activation réelle

Aucune activation avec argent réel ne doit être ajoutée avant que ces étapes soient testées et auditées.
