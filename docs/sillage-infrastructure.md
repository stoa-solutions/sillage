# Sillage — noms, domaines et compatibilité

État vérifié le 27 octobre 2026. Le renommage de l’infrastructure conserve l’image serveur `f5c6ef00976461aa2f518cda519b7217b62884c2`. Il ne publie ni nouvelle app Mac ni nouvelle page Stoa.

## Noms de référence

| Élément | Nom actuel |
| --- | --- |
| Projet Google Cloud | Sillage |
| Écran de consentement Google | Sillage — by Stoa, branding approuvé |
| Client OAuth | Sillage |
| Clé YouTube côté serveur | Sillage - serveur Stoa |
| Projet Dokploy | Sillage |
| Application Dokploy | Sillage — API et indexation |
| Ressource PostgreSQL Dokploy | Sillage — PostgreSQL |
| Base PostgreSQL | `sillage` |
| API et connexion Google | `https://sillage.stoa.solutions` |
| Présentation publique | `https://stoa.solutions/sillage` |
| Sauvegardes quotidiennes | préfixe `sillage/daily`, 02:30 UTC, 30 versions |

L’ID Google `secure-path-512617-s5` et le numéro de projet restent identiques : Google ne permet pas de renommer l’ID. Aucun nouveau projet, identifiant OAuth ou secret n’a été créé.

## Anciennes installations

`recall.stoa.solutions` reste une origine HTTPS de compatibilité. Ne pas rediriger globalement ce domaine : les appels API authentifiés, le lecteur YouTube et ses contrôles d’origine doivent continuer à fonctionner.

Seul `GET /auth/google/start` sur cette ancienne origine redirige vers Sillage, en conservant la requête. La redirection intervient **avant** la création du cookie de connexion. Le cookie sécurisé est donc posé sur le domaine correspondant au retour Google. `PUBLIC_URL=https://sillage.stoa.solutions` est enregistré dans Dokploy et dans l’environnement effectif.

Les deux URI restent enregistrés dans le même client Google :

- `https://sillage.stoa.solutions/auth/google/callback`
- `https://recall.stoa.solutions/auth/google/callback`

Les domaines API sont gérés par Dokploy. [Le fichier de compatibilité Traefik](../deploy/sillage/traefik-compatibility.yml) est installé dans `/etc/dokploy/traefik/dynamic/sillage-compatibility.yml` ; il traite le démarrage OAuth historique et renvoie la racine du nouveau sous-domaine vers la page de présentation. Les redirections sont temporaires pour permettre un retour arrière.

Les deux origines sont autorisées explicitement par `ALLOWED_ORIGINS`, sans élargissement à un joker. La clé Google conserve ses restrictions à YouTube Data API v3 et à l’IP sortante du serveur.

## Identifiants techniques conservés

Les noms Docker générés, le volume PostgreSQL, le réseau `playlist-recall-data`, le rôle PostgreSQL `playlist_recall`, les dossiers `/srv/playlist-recall` et `/root/playlist-recall` restent stables. Les renommer n’est pas nécessaire au changement de marque et ferait intervenir les montages, les permissions et les sauvegardes existants.

Même règle côté Mac : conserver le bundle ID, le schéma `playlist-recall://auth`, les entrées Trousseau et les données Application Support tant qu’une migration dédiée n’est pas testée. La prochaine livraison peut utiliser directement le nouveau domaine de connexion ; les versions déjà installées suivent la redirection compatible.

### App Mac 1.8.2 (73)

La connexion Google et le lecteur utilisent directement `sillage.stoa.solutions`. À la lecture d’une session enregistrée ou à l’import d’une connexion, seule l’origine HTTPS historique `recall.stoa.solutions` (port par défaut) est remplacée en mémoire. Le jeton reste identique ; la session originale sur disque n’est pas réécrite au démarrage. Une reconnexion Google réussie enregistre normalement la nouvelle origine. Les serveurs personnels, les ports non standard et les identifiants de l’app restent inchangés.

Le contrôle des messages du lecteur vérifie l’origine HTTPS Sillage et la frame principale. La suite native couvre la continuité du jeton, l’isolation des serveurs personnels, le rejet des adresses invalides et des frames étrangères. La présence de ces tests ne remplace pas la vérification de connexion dans l’app installée.

`.env.example` décrit une **nouvelle installation**. Sur le serveur existant, conserver le rôle et l’hôte PostgreSQL historiques ; seule la base de la chaîne de connexion a été renommée en `sillage`. Ne pas remplacer l’environnement de production par l’exemple.

## Vérification réalisée

- Sauvegarde PostgreSQL au format custom, restauration dans une base jetable `sillage_rename_restore_test`, puis suppression de cette seule base de test.
- API et worker arrêtés pour le renommage ; même OID PostgreSQL et nombres de lignes identiques dans les 27 tables avant/après, avant redémarrage.
- Nom de base aligné dans Dokploy, `DATABASE_URL`, la configuration effective des conteneurs et `POSTGRES_DB` du service PostgreSQL.
- HTTPS, `/health`, `/auth/status`, protection de `/v1/me` sans jeton et accès authentifié avec un jeton existant vérifiés sur les deux domaines.
- Le départ OAuth historique arrive sur Sillage avec ses paramètres conservés ; le départ Sillage pose le cookie sécurisé et demande à Google le nouveau callback.
- Nouvelle sauvegarde native Dokploy terminée et objet distant non vide relu sous `sillage/daily`. Les sauvegardes historiques sous `playlist-recall/daily` sont conservées.

Ces vérifications ne remplacent pas une installation sur un autre Mac avec un nouveau compte. La signature Apple, la notarisation et cette recette restent distinctes.

## Retour arrière

Les instantanés privés, preuves de compteurs et sauvegarde restaurable sont conservés sur le serveur dans `/root/sillage/migrations/2026-10-27-rename/`, accès root seulement. Ne pas les copier dans Git.

Pour rétablir l’ancien nom : arrêter API/worker, vérifier l’absence de connexions à la base, renommer `sillage` en `playlist_recall`, puis rétablir ensemble la chaîne de connexion, `PUBLIC_URL`, le nom de base de la ressource Dokploy et la cible de sauvegarde. Retirer le seul fichier Traefik de compatibilité avant de rétablir le callback ancien. Recréer API/worker avec **l’image existante**, sans supprimer de volume. Vérifier l’accès authentifié, les compteurs, le worker et la prochaine sauvegarde. Ne pas restaurer une ancienne sauvegarde par-dessus les données actuelles pour un simple renommage.
