# Changelog

## Non publié

- Import Recall : une playlist sans identifiant reçoit un identifiant stable ; les vidéos hors playlist sont exportées dans « Autres vidéos » et réimportées sans créer de playlist ; une entrée sans titre ne remplace plus une entrée titrée. Cas de référence dans `packages/core/fixtures/format`.
- App Mac : code de bibliothèque locale retiré (SQLite, import par clé YouTube, DJ exécuté sur le Mac) ; décision 0002.
- Mode cinéma sombre avec lecteur agrandi, panneaux translucides et retour à la vue compacte ; accueil en deux étapes et accès direct à l’import pour une bibliothèque vide. Page de téléchargement Mac et lien stable vers le DMG, avec statut de notarisation explicite.

- Le DJ annonce les morceaux au bouton Suivant et pendant l’enchaînement automatique. Les annonces précédentes sont arrêtées lors des sauts rapides ; un indicateur confirme la lecture vocale. Désactiver l’enchaînement arrête bien la lecture à la fin du titre.

- Accueil Mac : confirmation visible de la clé Gemini enregistrée, récupération des playlists avec état de progression et fermeture de l’accueil lorsque le compte est prêt.

- Connexion Google : ouverture directe du navigateur et retour dans Recall, protégé par état aléatoire et échange PKCE à usage unique ; suppression de la fenêtre système invisible.

- App Mac : suppression complète des accès au Trousseau ; session serveur mémorisée dans un fichier privé, clés Gemini et voix utilisées exclusivement côté serveur.

- Comptes Google dans l’app Mac, bibliothèque exclusivement sur serveur, clés Gemini personnelles chiffrées et rattachement explicite de la bibliothèque historique. Recherche, MCP, DJ, export et quotas isolés par compte ; tests PostgreSQL à deux utilisateurs et protections OAuth/PKCE.


- App Mac : bibliothèque paginée avec pages numérotées ; l’import de playlist va dans la source choisie.
- App Mac : Gemini et Apple suivent le même tour de DJ, en deux appels : mêmes règles, mêmes plafonds, titres en file exclus sauf redemande, identifiants inventés écartés.
- App Mac : en mode serveur, le DJ cherche via `/v1/search` avec exclusions (un aller-retour par recherche au lieu de deux).
- Serveur : `/v1/search` accepte `excludeIds` et `availableOnly`.
- App Mac : DJ Apple sur l’appareil (macOS 26, Apple Intelligence), sans clé ni réseau pour le choix des titres.
- App Mac : accueil au premier lancement, installation locale d’abord ; import de playlist YouTube via le serveur connecté.
- App Mac : voix Gemini rétablie ; la file continue la demande en cours au lieu de repartir de zéro.
- App Mac : une vidéo répétée dans une playlist ou la file s’affiche correctement.
- App Mac : le DJ trouve des titres pour une ambiance décrite en plusieurs mots, même sans correspondance exacte.
- App Mac : un import YouTube interrompu reprend pendant 24 h, puis repart du début.
- App Mac : « Oublier ce serveur » dans les Réglages.
- App Mac : `RECALL_DATA_DIR` isole les essais de développement de la bibliothèque réelle.
- Dépôt : branche `main`, règles communes `AGENTS.md`, `npm run verify`, tableau `npm run board`, CI GitHub.
