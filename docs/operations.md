# Exploitation de Playlist Recall V2

## Production

API : `https://recall.stoa.solutions`. Projet Dokploy autonome, PostgreSQL 17/pgvector 0.8.7 dans une ressource séparée. Aucune publication du port PostgreSQL. Réseau `playlist-recall-data` géré par Dokploy ; inférence sur un réseau Compose interne. Seule l’API rejoint aussi le proxy Dokploy.

Les modèles sont préparés avec `python3 scripts/prepare-server-models.py` puis copiés et vérifiés dans `/srv/playlist-recall/models`. Ils ne sont ni versionnés ni téléchargés à chaque redémarrage. Le script vérifie les empreintes des poids SigLIP et réutilise les ressources E5 épinglées. Les images téléchargées sont bornées à 2 Mio et restent uniquement en mémoire ; seules leurs empreintes et vecteurs persistent.

Plafonds : API 192 Mio/0,5 CPU, worker 192 Mio/0,5 CPU, inférence 1 408 Mio/1,5 CPU, PostgreSQL 384 Mio/0,5 CPU. Total maximal déclaré : 2 176 Mio. L’inférence charge un seul encodeur à la fois dans un processus enfant et le libère après 60 secondes d’inactivité. Ce plafond remplace l’estimation initiale de la spécification après qualification locale. Vérifier aussi les mesures Linux avant activation.

## Configuration privée

`DATABASE_URL`, `YOUTUBE_API_KEY`, `SYNC_ENABLED`, `VISION_ENABLED`, `RELEASE_SHA` sont définis dans Dokploy. Ne pas les ajouter au dépôt ou au paquet d’extension. Restreindre la clé Google à YouTube Data API v3 et à l’IP sortante du VPS. Budget local : 8 000 unités/jour, comptées selon la journée YouTube America/Los_Angeles. Une absence de clé est affichée dans l’extension.

Créer un jeton avec `node --import tsx src/token.ts create /tmp/connexion.json` depuis le conteneur API. Copier le fichier dans un emplacement privé puis le retirer du conteneur. Ne jamais afficher son contenu dans les journaux. `token.ts revoke UUID` révoque une installation. Seul un hash du jeton est enregistré en base.

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
