# V2 — réalisation

Architecture approuvée le 7 octobre 2026. L’extension Chrome décrite ici a depuis été retirée du dépôt. Monorepo npm : extension, API/worker, contrats et moteur local partagés.

1. Préserver le paquet Chrome et migrer le code en workspaces.
2. Construire et tester stockage PostgreSQL/pgvector, tâches persistantes et synchronisation YouTube.
3. Intégrer l’indexation textuelle par passages et l’indexation des miniatures, mesurer les modèles réels.
4. Ajouter la connexion serveur, ajout de playlist, états de synchronisation et recherche dans l’extension ; garder le mode local.
5. Créer les services dédiés dans Dokploy, avec limites de ressources, sauvegarde et route HTTPS.
6. Importer la bibliothèque préservée, vérifier une synchronisation réelle, la pertinence et les services Stoa avant activation planifiée.

L’accès YouTube attend le choix du compte Google. Aucun secret ni export personnel ne sera versionné.
