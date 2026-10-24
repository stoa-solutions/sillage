# Recette V2 — 7 octobre 2026

## Livré et vérifié

- Monorepo privé `SamuelChojnacki/playlist-recall`, branche `main` (anciennement `codex/server-recall`).
- API HTTPS authentifiée, PostgreSQL 17/pgvector dédié, worker et calcul CPU isolé déployés dans Dokploy. Route `/health` relue indépendamment avec le SHA de release. Une requête de bibliothèque sans jeton renvoie 401.
- 2 792 vidéos et 2 818 appartenances importées depuis l’ancienne bibliothèque ; 2 666 titres avec passages textuels indexés. Le fichier local original est inchangé (empreinte vérifiée), ancien paquet V1 conservé dans `.runtime/before-v2/extension`.
- Les 13 fichiers des modèles ont la même empreinte avant et après transfert sur le VPS. Les véritables encodeurs E5 et SigLIP produisent respectivement 384 et 768 dimensions.
- 51 tests : 30 extension, 8 serveur, 13 PostgreSQL réels. Vérifications TypeScript et compilation du paquet Chrome réussies ; audit des dépendances de production sans vulnérabilité signalée.
- Cas couverts : pagination et doublons, authentification, contraintes numériques, échec sans perte du dernier instantané, disparition confirmée deux fois, import ancien préservant les détails enrichis, migration des positions déplacées, baux et reprise, rejet d’un ancien calcul, remplacement transactionnel des passages, miniature modifiée à URL stable, reprise des erreurs et planification à six heures.
- Chrome réel dans un profil de recette : import de connexion privée, recherche texte et visuelle, mode local, persistance après réouverture, raccourci clavier, affichages 1 440 et 390 pixels sans débordement. Polling observé à 8 requêtes sur trois cycles après correction, sans boucle.
- Sauvegarde native Dokploy vers R2, chaque jour à 02:30 UTC, rétention 30 versions. Objet `playlist-recall-db-ltxetq/playlist-recall/daily/2026-10-06T22-42-55-213Z.sql.gz` téléchargé (5 990 142 octets), décompressé et restauré via `pg_restore` dans un conteneur temporaire isolé. Comptes restaurés : 1 playlist, 2 792 vidéos, 2 818 appartenances, 2 666 passages et 16 images déjà prêtes à l’heure du dump. Conteneur de restauration supprimé après contrôle.
- Plafonds Docker relus : 192 Mio API, 192 Mio worker, 1 408 Mio calcul, 384 Mio DB. CPU calcul limité à 1,5. Aucun événement OOM sur les services de la release pendant la recette. Stoa HTTP 200 et ses services web/API, mail, newsletter et analytics toujours sains lors du contrôle.

## Pertinence et temps de réponse

Échantillon manuel de 24 requêtes connues sur les métadonnées historiques identiques : V1 23/24 cibles dans les cinq premiers, V2 23/24 après correction des mots-clés dans les phrases longues. Aucun gain sur descriptions n’est revendiqué à ce stade. `rain in Paris` reste en dehors des cinq premiers (V1 rang 6, V2 rang 10). La vidéo historique `swqpIE45v4c` est première pour « jazz romantique de plus d’une heure ».

Le modèle est déchargé pour respecter la mémoire. Une nouvelle requête pendant l’indexation visuelle entraîne un changement d’encodeur : environ 7–9 secondes mesurées dans cette situation ; les requêtes chaudes ou en cache descendent à environ 0,05–0,9 seconde. Ce coût doit être considéré avant d’augmenter la fréquence de collecte ou le nombre d’utilisateurs.

Recherche visuelle sur un index partiel, avec cibles identifiées sur leurs vraies miniatures :

| Souvenir | Rang de la cible |
| --- | ---: |
| un homme portant une casquette devant un fond rouge | 20 |
| un immeuble bleu de nuit | 1 |
| un chemin dans la forêt au soleil | 3 |
| des reflets abstraits verts et orange | 12 |

Les miniatures abstraites et les souvenirs de petits détails restent moins fiables. Le mode visuel affiche des suggestions ; il ne reconnaît pas l’audio. L’index complet des miniatures continue en arrière-plan dans la file persistante. Certaines anciennes vidéos ont une miniature YouTube 404 et peuvent finir en erreur d’image sans bloquer les autres.

## Étape encore bloquée

La clé YouTube n’est pas configurée. Le compte Google Cloud actif sur le Mac appartient à CAEX ; le choix entre ce compte et le compte personnel a été demandé à Samuel. Aucune ressource Google d’entreprise n’a été créée sans ce choix.

`SYNC_ENABLED=false` tant que la clé et la première collecte réelle ne sont pas validées. La bibliothèque importée conserve donc actuellement ses anciennes métadonnées (zéro description). La collecte paginée, l’enrichissement des descriptions et la tâche planifiée sont développés et testés sur fixtures, mais ne sont pas encore qualifiés sur la playlist YouTube actuelle. Après configuration : lancer la collecte complète, comparer les comptes, tester une requête fondée sur une description réelle, activer la planification puis constater une exécution due.

## Repères d’exploitation

- Projet : `CahXxpjWgyYYeSR3DAury` ; environnement : `ro60Ugc9wEnGd2GYLkN1s`.
- Compose : `zRyS7prIvUEikKdaU9UqH` ; service : `playlist-recall-app-wvpmwu`.
- PostgreSQL : `lFxXzna7NFSqUyr2ia0wN` ; service : `playlist-recall-db-ltxetq`.
- Sauvegarde : `5XFfsp_N5ueE4dJdPkBP8`.
- Configuration et scripts d’administration privés : `/root/playlist-recall` sur le VPS.
