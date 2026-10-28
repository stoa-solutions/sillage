# Sillage — noms, domaines et infrastructure

Un seul nom partout depuis le 28 octobre 2026 : Sillage. Le dépôt unique est `stoa-solutions/sillage`.

## Noms de référence

| Élément | Nom |
| --- | --- |
| Dépôt | `stoa-solutions/sillage`, branche `main` |
| Projet Google Cloud, écran de consentement, client OAuth | Sillage |
| Clé YouTube côté serveur | Sillage - serveur Stoa |
| Projet Dokploy | Sillage |
| Application Dokploy | Sillage — API et indexation (`sillage-app`) |
| Ressource PostgreSQL Dokploy | Sillage — PostgreSQL (`sillage-db`), base et rôle `sillage` |
| Réseau des données | `sillage-data` |
| Dossiers serveur | `/srv/sillage` (modèles, publications Mac), `/root/sillage` (outils et sauvegardes, root seulement) |
| API et connexion Google | `https://sillage.stoa.solutions`, retour `https://sillage.stoa.solutions/auth/google/callback` |
| Présentation publique | `https://stoa.solutions/sillage` |
| Sauvegardes quotidiennes | préfixe `sillage/daily`, 02:30 UTC, 30 versions |
| App Mac | `solutions.stoa.sillage`, schéma de retour `sillage://auth`, données dans `Application Support/Sillage` |
| Clé de signature des mises à jour | entrée Trousseau `sillage-macos-updates` |

L’ID Google `secure-path-512617-s5` reste celui du projet Sillage : Google ne permet pas de renommer un ID de projet.

[Le fichier Traefik](../deploy/sillage/traefik-compatibility.yml) est installé dans `/etc/dokploy/traefik/dynamic/sillage-compatibility.yml` ; il renvoie seulement la racine de `sillage.stoa.solutions` vers la page de présentation.

## Installations Mac antérieures à 1.9

Au premier lancement, `LegacyInstall` déplace une installation faite sous l’ancien identifiant : dossier Application Support (session, apparence, cache Studio), réglages, caches retirés. Rien d’existant n’est écrasé. macOS redemande une fois le micro et la reconnaissance vocale. `FormerIdentity` (SillageKit) regroupe les anciens noms lus par cette migration et par la reprise d’une session enregistrée sur l’ancienne origine ; les retirer ensemble quand plus aucune installation antérieure à 1.9 n’existe.

## Base de données

Les noms internes sont `sillage_simple` (recherche plein texte) et `sillage_music_revision()` (révision des métadonnées). « Mes découvertes » a l’identifiant `sillage-discoveries:<compte>`. Une nouvelle installation les crée par la migration de base ; aucune migration versionnée ne porte d’ancien nom.
