# Exploitation de Playlist Recall V2

## Production

API : `https://recall.stoa.solutions`. Projet Dokploy autonome, PostgreSQL 17/pgvector 0.8.7 dans une ressource séparée. Aucune publication du port PostgreSQL. Réseau `playlist-recall-data` géré par Dokploy ; inférence sur un réseau Compose interne. Seule l’API rejoint aussi le proxy Dokploy.

Les modèles sont préparés avec `python3 scripts/prepare-server-models.py` puis copiés et vérifiés dans `/srv/playlist-recall/models`. Ils ne sont ni versionnés ni téléchargés à chaque redémarrage. Le script vérifie les empreintes des poids SigLIP et réutilise les ressources E5 épinglées. Les images téléchargées sont bornées à 2 Mio et restent uniquement en mémoire ; seules leurs empreintes et vecteurs persistent.

Plafonds : API 192 Mio/0,5 CPU, worker 192 Mio/0,5 CPU, inférence 1 408 Mio/1,5 CPU, PostgreSQL 384 Mio/0,5 CPU. Total maximal déclaré : 2 176 Mio. L’inférence charge un seul encodeur à la fois dans un processus enfant et le libère après 60 secondes d’inactivité. Ce plafond remplace l’estimation initiale de la spécification après qualification locale. Vérifier aussi les mesures Linux avant activation.

## Configuration privée

`DATABASE_URL`, `YOUTUBE_API_KEY`, `SYNC_ENABLED`, `VISION_ENABLED`, `RELEASE_SHA` sont définis dans Dokploy. Ne pas les ajouter au dépôt ou au paquet d’extension. Restreindre la clé Google à YouTube Data API v3 et à l’IP sortante du VPS. Budget local : 8 000 unités/jour, comptées selon la journée YouTube America/Los_Angeles. Une absence de clé est affichée dans l’extension.

Créer un jeton avec `node --import tsx src/token.ts create /tmp/connexion.json` depuis le conteneur API. Transférer son contenu vers un fichier privé via la sortie redirigée de `docker exec` puis le retirer du conteneur (`docker cp` ne lit pas ce montage tmpfs sur ce serveur). Ne jamais afficher son contenu dans les journaux. `token.ts revoke UUID` révoque une installation. Seul un hash du jeton est enregistré en base.

## Déploiement et reprise

1. Exécuter `npm run check`, `npm test`, les tests PostgreSQL, puis `npm run package:local` pour l’extension.
2. Vérifier l’état de Stoa, les ressources disponibles et la dernière sauvegarde. Pousser le commit du monorepo privé.
3. Mettre `RELEASE_SHA` au SHA du commit testé. Déclencher le Compose via Dokploy ; migrations idempotentes sous verrou avant démarrage de l’API. Ne jamais supprimer les volumes de la base.
4. Attendre `composeStatus=done`, puis contrôler indépendamment `/health`, la version retournée, les conteneurs et leurs limites. Un statut Dokploy ne suffit pas.
5. Importer la sauvegarde existante, lancer une synchronisation manuelle et vérifier les comptes et résultats. Activer `SYNC_ENABLED=true` après réussite, puis constater une exécution créée par le planificateur.
6. Surveiller erreurs, file, CPU, mémoire et services Stoa pendant le remplissage initial.

Les tâches sont persistantes, dédupliquées, réessayées cinq fois avec temporisation. Un bail expiré reprend automatiquement. Le bouton **Réessayer** remet les derniers échecs en attente. Une collecte échouée conserve le dernier instantané ; les suppressions demandent deux collectes complètes. Les passages textuels sont remplacés dans une transaction et rejetés si la source a changé entre-temps.

Pour un retour arrière, arrêter le worker via Dokploy, redéployer le commit précédent et conserver la base. Utiliser une sauvegarde dans une ressource isolée si une migration incompatible devait être introduite. Le mode local et son ancien paquet dans `.runtime/before-v2/extension` restent disponibles ; garder le même chemin `extension/` pour l’identité Chrome. Ne pas désinstaller l’extension.

## Sauvegardes et restauration

Configurer la sauvegarde native Dokploy de la base dédiée vers la destination privée R2 existante, sous son propre préfixe `playlist-recall/daily`, chaque jour à 02:30 UTC, rétention 30 versions. Déclencher une sauvegarde manuelle et vérifier l’objet distant et une restauration isolée avec PostgreSQL 17/pgvector. Comparer les comptes de playlists, vidéos, appartenances et vecteurs. Ne jamais utiliser la base Stoa comme cible.

Les sauvegardes contiennent les liens non répertoriés et les hash de jetons : garder les objets privés. Les secrets Dokploy et les modèles ne sont pas dans l’export de métadonnées de l’extension. Le guide de déploiement et les modèles épinglés permettent de reconstruire l’application ; la base sauvegardée contient aussi la file et les index.

## Reprise du 24 octobre 2026

Le worker avait disparu alors que l’API et l’inférence étaient saines. Recréer le service `worker` du Compose existant rétablit les traitements ; `restart: unless-stopped` conserve le redémarrage après incident ou reboot. Ne pas se fier à `/health` seul : contrôler aussi le conteneur worker et la progression des tâches.

Les miniatures HTTP 404/410 sont désormais enregistrées comme indisponibles, sans cinq tentatives inutiles. Une vérification reste possible après 24 heures ; les erreurs transitoires restent réessayées. Sans clé YouTube, le worker traite les index mais laisse les synchronisations et enrichissements en attente sans consommer leurs tentatives.

La connexion existante de l’extension est migrée vers `chrome.storage.local`, avec conservation du jeton aux rechargements et mises à jour. Elle ne contient pas la clé YouTube. Le jeton serveur n’expire pas automatiquement ; il reste révocable. Une coupure réseau ne supprime pas la connexion.

Les playlists sont actualisées toutes les six heures lorsque `SYNC_ENABLED=true` et la clé est configurée. L’interface consulte le serveur toutes les dix secondes. Le paquet Chrome chargé depuis `extension/` reste une extension locale : le remplacer puis le recharger dans Chrome met son code à jour ; cela ne constitue pas une distribution automatique via le Chrome Web Store.

YouTube Data API v3 est activée dans le projet personnel `secure-path-512617-s5` (Playlist Recall). La clé « Playlist Recall - serveur Stoa » est limitée à cette API et à l’IPv4 sortante `109.199.114.247`, vérifiée depuis le conteneur API. La valeur reste dans l’environnement privé Dokploy et `/root/playlist-recall/application.env` ; `SYNC_ENABLED=true`. Ne pas copier la clé dans l’extension. Si l’adresse du VPS change, adapter sa restriction IP dans Google Cloud.

## Mode DJ — 2.1

Le bouton de connexion est masqué dès qu’une connexion existe. Depuis le panneau latéral, le mode DJ s’ouvre dans `library.html?mode=dj`, un onglet visible adapté aux permissions du micro ; la connexion existante est restaurée sans saisie. Le mode DJ ajoute un chat, une dictée au clic et des réponses vocales optionnelles. La clé IA reste dans Dokploy : `DJ_API_KEY`, `DJ_BASE_URL`, `DJ_MODEL`, `DJ_DAILY_REQUEST_LIMIT` (100 tours ou réponses vocales par jour par défaut). Le chat utilise le point d’entrée compatible Chat Completions de Gemini, avec le modèle `gemini-4-argon` et la clé Gemini CAEX, réutilisée sur demande du propriétaire (raisonnement moyen, budget de sortie adapté). La voix utilise `gemini-3.8-flash-lite-tts`. La dictée emploie la reconnaissance vocale de Chrome ; elle demande l’autorisation du micro au premier usage. Le navigateur ne conserve pas les échanges en base côté serveur.

L’agent utilise un vrai client MCP relié au serveur `recall-music-library` : `library_search` (recherche hybride existante) et `library_overview` (catalogue). Les outils sont en lecture seule. Le point d’entrée HTTP `/v1/mcp` est protégé par le même jeton que l’API. Aucun outil SQL libre, écriture ou accès réseau arbitraire n’est exposé. Les identifiants proposés par l’IA sont vérifiés contre les candidats effectivement renvoyés par MCP pendant le tour, puis relus dans la bibliothèque active avant lecture. Une réponse inventée est rejetée.

La file et le chat restent dans la mémoire de l’interface. La lecture utilise le lecteur officiel YouTube, chargé dans `/dj/player` sur l’origine HTTPS pour transmettre un référent valide. Les messages du lecteur vérifient l’origine et la fenêtre parente. Le premier démarrage peut demander un clic selon la politique de lecture automatique de Chrome. Les titres interdits en intégration sont sautés lorsqu’un suivant existe ; le dernier échec conserve le lien YouTube. Ce mode ne réalise ni extraction audio, ni analyse sonore du tempo, ni transitions de mixage. Quitter le mode DJ ferme son lecteur.

La clé Gemini personnelle existante du projet `gen-lang-client-0662751180` sert à l’IA, séparément de la clé YouTube du projet Recall. Ne pas modifier ses restrictions en place sans vérifier ses autres usages. Les conversations et la petite sélection de métadonnées envoyée aux outils sont transmises au fournisseur IA ; la clé n’est jamais incorporée au paquet Chrome.
