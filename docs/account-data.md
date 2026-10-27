# Comptes, clés et bibliothèque

État du code vérifié le 25 octobre 2026, depuis `0be1f6c`. Ce document décrit l'implémentation, pas un audit de sécurité externe.

## Une identité, plusieurs appareils

Google fournit uniquement l'identité (openid, e-mail vérifié, profil), pas un accès aux playlists privées YouTube. `users.google_sub` identifie le compte durablement, indépendamment d'un changement d'e-mail. Le serveur vérifie audience, nonce et e-mail ; le retour à l'app utilise un code à usage unique (90 secondes) et PKCE. Le jeton Recall délivré expire après 90 jours. Déconnexion et révocation sont distinctes de la clé Gemini.

Chaque appel authentifié résout le jeton en `user_id`. Le serveur ne prend pas un propriétaire arbitraire envoyé par l'app. La recherche, les playlists, exports et outils du DJ filtrent par les appartenances `user_playlists`.

**Catalogue partagé, appartenances privées.** Deux personnes qui ajoutent la même playlist YouTube publique partagent ses métadonnées et index. Elles possèdent chacune leur lien vers cette playlist. Cela évite de payer plusieurs fois la synchronisation et l'indexation. Il n'y a pas une base par personne ni des politiques PostgreSQL RLS : l'isolation dépend des requêtes autorisées et de leurs tests entre comptes.

## Où vont les clés ?

1. La clé saisie dans le champ sécurisé est envoyée via HTTPS à l'API authentifiée. L'app peut la tester, puis efface le champ après enregistrement ; elle ne la met pas dans ses préférences ni dans le Trousseau.
2. Le serveur chiffre en **AES-256-GCM**, avec un nonce aléatoire de 12 octets et le UUID du compte comme données authentifiées (AAD). Copier le chiffré sur un autre compte ne suffit pas à le rendre utilisable.
3. `account_dj_settings` contient le chiffré et le modèle. La clé maître `DJ_SETTINGS_ENCRYPTION_KEY` reste dans l'environnement privé du serveur, séparée de la base et du paquet Mac.
4. Le serveur déchiffre uniquement pour appeler Google avec la clé du compte. Le statut envoyé à l'app indique si elle est configurée, sans renvoyer la clé. Retirer la clé supprime la ligne de configuration.

Ce n'est **pas du chiffrement de bout en bout** : le serveur peut lire la clé, et Google reçoit le chat, les titres/candidats nécessaires et les textes à prononcer. Un accès simultané à la base et à la clé maître permettrait de déchiffrer. Sauvegarde et rotation de cette clé maître doivent donc être gérées séparément avant une ouverture large du service.

La clé YouTube est une configuration commune du serveur. Elle sert aux playlists accessibles par lien ; la connexion Google Recall n'accorde aucun droit de lecture des playlists YouTube privées.

Sur le Mac, seul le **jeton révocable Recall** est conservé dans `session.json`, dossier 0700 et fichier 0600, exclu des sauvegardes par l'app. Il n'est pas chiffré par Recall : les applications exécutées sous le même utilisateur macOS peuvent le lire. C'est le compromis choisi pour ne plus demander le Trousseau. Les clips en cache et réglages visuels sont aussi locaux ; la bibliothèque de référence et les clés Gemini restent sur le serveur.

## Schéma relationnel

| Tables | Rôle et relations |
| --- | --- |
| `users` | UUID, identifiant Google unique, e-mail, nom ; ancien compte migrable. |
| `tokens` | Empreinte du jeton, propriétaire → users, expiration et révocation. Aucun jeton brut en base. |
| `user_playlists` | Clé composée (user_id, playlist_id), liens vers users et playlists. Frontière d'accès à la bibliothèque. |
| `playlists` | Identifiant YouTube, URL, titre, prochaine synchronisation, génération et statut. |
| `memberships` | Référence playlist + vidéo, position, génération vue, actif ; une occurrence dans une playlist. |
| `videos` | Identifiant YouTube unique, titre, chaîne, durée, description, miniature ; métadonnées musicales JSONB séparées. |
| `channels` | Photos de chaînes ; jointure logique sur videos.channel_id, sans contrainte FK SQL. |
| `passages` | (video_id, ordinal), texte indexé et vecteur 384 dimensions. |
| `images` | Une représentation vectorielle 768 dimensions par vidéo et révision de miniature. |
| `account_dj_settings` | Une configuration chiffrée + modèle par utilisateur. |
| `account_dj_usage` | Compteur par utilisateur/jour ; distinct du quota Google de sa clé. |
| `listening_history` | (user_id, event_id) : vidéo, titre et chaîne copiés, issue (terminé, passé, indisponible, remplacé), date de lecture. Sans lien vers `videos`, car un titre YouTube écouté n'est pas forcément dans la bibliothèque. |
| `lyrics` | Paroles publiques, lignes, source et écart de durée, par vidéo. |
| `lyrics_offsets` | Calage privé par couple (utilisateur, vidéo). |
| `jobs` | File persistante : sync, enrich YouTube, MusicBrainz, texte, image ; déduplication, bail, reprises. |
| `sync_runs` | Historique technique des synchronisations de playlists. |
| `musicbrainz_cache` | Réponses publiques par URL, datées ; mutualisation des lectures. |
| `oauth_flows`, `oauth_grants` | États de connexion temporaires, empreintes et challenges PKCE. |
| `quota_usage` | Consommation YouTube commune par jour. |
| `dj_usage`, `dj_settings` | Tables héritées du mode historique ; ne pas confondre avec les tables par compte. |
| `schema_migrations` | Versions appliquées par l’ancien script, avant Drizzle. |
| `drizzle.__drizzle_migrations` | Migrations Drizzle appliquées (`apps/server/drizzle`). |

La file de lecture, le chat et l'historique d'écoute de la session Mac ne constituent pas aujourd'hui une collection persistante synchronisée entre appareils en base. Ne pas promettre cette synchronisation sans un chantier dédié.

## Du lien à l'enrichissement

L'API valide le lien, crée/réutilise la playlist publique et l'attache au compte ; elle crée ensuite un job `sync`. Le worker récupère les entrées YouTube, leurs positions et les détails des vidéos. Une synchronisation incomplète ne supprime pas la bibliothèque existante. La synchronisation planifiée est toutes les six heures lorsqu'elle est activée ; les détails des vidéos sont renouvelés quotidiennement.

Les jobs texte et image calculent les index. Le pilote MusicBrainz se greffe **après les détails YouTube**, en arrière-plan, pour les dix identifiants du pilote ou les bibliothèques des comptes explicitement autorisés, par lots de dix tâches maximum. Le scheduler vérifie les tâches chaque minute. Aucun appel MusicBrainz ne ralentit directement une recherche dans l'app.

MusicBrainz : normalisation titre/artiste, vérification de version et de durée, correspondance unique avant attribution. Les cas ambigus ou exclus restent identifiés comme tels, sans inventer de genre. Albums, artistes invités et styles de l'artiste conservent leur source ; les genres de l'artiste ne deviennent pas automatiquement ceux de tous ses morceaux. Le JSON enrichi change la révision du texte et provoque sa réindexation. Les champs YouTube d'origine sont préservés.

L’extension progressive est activable par compte après validation du pilote. Voir [Enrichissement musical](music-enrichment.md).

## Frontières de code à conserver

Chemins relatifs à `apps/server/src/`.

- `modules/auth` (dont `session.guard.ts`, monté sur `/v1/*` dans `app.ts`) et `modules/accounts` : identité et autorisation ; jamais déléguées au modèle.
- `modules/dj/dj-settings.service.ts` + `.repository.ts` : chiffrement et accès par compte ; aucun déchiffrement dans une vue ou un export.
- `modules/library`, `modules/jobs`, `worker.ts` : import et travail différé ; reprise des erreurs sans bloquer l'app.
- `integrations/musicbrainz` et `modules/enrichment` : adaptateur fournisseur, correspondances pures (`enrichment.matching.ts`) et orchestration séparés.
- `modules/search` et `modules/mcp` : lecture des index existants, toujours bornée au compte.

Pour grandir : conserver les preuves de propriété à chaque nouvelle route, séparer cache public et état privé, instrumenter les jobs/latences et traiter toute nouvelle persistance de chat comme une donnée privée. RLS, rotation automatique de clé et historique multiappareils sont des pistes distinctes, pas des fonctions déjà livrées.

## Historique d'écoute et suppression de playlist

L'app envoie chaque lecture finie à `POST /v1/history`, par lots de 100 au plus, quelques secondes après. Chaque événement porte un identifiant créé sur le Mac : un envoi répété après une réponse perdue ne compte pas deux fois. En cas d'échec, l'app réessaie une minute plus tard ; jusqu'à 500 lectures attendent en mémoire, et celles qui n'ont pas été envoyées sont perdues si l'app est quittée. Au changement de compte, la file d'envoi est vidée avant la réinitialisation de la session, pour qu'aucune lecture n'atteigne un autre compte.

`GET /v1/history?limit=50&before=<date>` relit l'historique, du plus récent au plus ancien, et `DELETE /v1/history` l'efface pour le compte. Pour l'instant, rien ne le lit automatiquement : il servira plus tard aux suggestions de Découvrir.

`DELETE /v1/playlists/:id` retire seulement le lien `user_playlists` du compte. La playlist YouTube, son catalogue et les autres comptes restent intacts. Ses vidéos quittent la bibliothèque, sauf celles présentes dans une autre playlist du compte. « Mes découvertes », propre au compte, est en plus vidée pour qu'un ajout ultérieur reparte de zéro.
