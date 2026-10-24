# Architecture Recall 2.2

## Produit et limites

Recall comprend une app Mac avec bibliothèque locale, une extension et un serveur privé facultatif. Chaque déploiement serveur possède une bibliothèque partagée par ses jetons autorisés. Un jeton représente un accès à cette bibliothèque, pas un compte utilisateur isolé. La redistribution du client ne donne aucun accès à Stoa : chaque destinataire doit fournir son propre serveur et son jeton, ou utiliser la bibliothèque locale.

Cette version ne transforme pas Stoa en service public multiutilisateur. Il faudrait avant cela isoler playlists, vidéos, tâches, exports et quotas par propriétaire. Les réglages Gemini sont déjà isolés par jeton, mais la bibliothèque et le plafond quotidien restent ceux du serveur.

## Frontières de code

| Module | Responsabilité |
| --- | --- |
| `packages/core` | Formats de bibliothèque, recherche pure et contrats du DJ. Aucun accès réseau ni secret. |
| `apps/extension/src/server-client.ts` | Connexion HTTP et permission Chrome limitée au serveur choisi. |
| `apps/extension/src/dj-app.tsx` | Conversation et session de lecture. |
| `apps/extension/src/dj-settings.tsx` | Saisie de clé et modèle ; aucun stockage local de clé Gemini. |
| `apps/server/src/dj-routes.ts` | Frontière HTTP du DJ, validation et concurrence. |
| `apps/server/src/dj-config.ts` | Configuration par défaut du déploiement. |
| `apps/server/src/dj-settings.ts` | Configuration personnelle, chiffrement et persistance. |
| `apps/server/src/dj.ts` | Orchestration Gemini et outils MCP, configuration injectée par requête. |
| `apps/server/src/music-mcp.ts` | Recherche dans la bibliothèque, lecture seule. |
| `apps/server/src/dj-voice.ts` | Adaptateur de synthèse vocale Gemini. |
| `apps/server/src/search.ts` | Classement lexical/vectoriel et pagination SQL. |
| API / worker / inference | Services indépendants : requêtes, tâches durables, calcul des vecteurs. |

Les routes injectent la configuration personnelle dans le chat et la voix. Elles ne modifient jamais `process.env` pour répondre à un utilisateur. L’ajout d’une clé ne touche pas celle du serveur ni un autre jeton. Changer de modèle conserve la clé déjà enregistrée.

## Secrets

`DJ_SETTINGS_ENCRYPTION_KEY` contient 32 octets aléatoires encodés en 64 caractères hexadécimaux. Les clés personnelles sont chiffrées en AES-256-GCM, avec un nonce aléatoire et le propriétaire authentifié. La clé de chiffrement reste dans la configuration privée du serveur ; sauvegarder cette configuration avec la base. Changer cette clé sans migrer les secrets rend les anciennes clés illisibles.

Les endpoints ne renvoient jamais une clé personnelle. Le client la garde uniquement pendant la saisie, l’envoie au serveur choisi en HTTPS et efface le champ après enregistrement. Les exports de bibliothèque et le paquet redistribuable ne contiennent aucune configuration personnelle. Enregistrer une clé ne teste pas son quota chez Google ; le premier appel réel peut signaler un quota ou un accès insuffisant.

Le stockage personnalisé refuse de fonctionner si sa clé de chiffrement est absente. La configuration serveur existante reste utilisable dans ce cas. Le client accepte HTTPS ou HTTP sur localhost ; il refuse les adresses avec identifiants, chemin, query ou fragment.

## Volume et évolution

La recherche classe les identifiants avant de charger les descriptions : au maximum les candidats lexicaux, sémantiques et titres explicites, au lieu de toute la bibliothèque. La navigation sans texte est paginée dans PostgreSQL. Les traitements longs restent dans la file PostgreSQL avec baux et reprise.

Les limites de concurrence et de débit HTTP sont encore propres à chaque processus API. Ajouter plusieurs API exige de les coordonner en base ou via un service partagé. Les limites de candidats et les requêtes vectorielles doivent être mesurées sur une bibliothèque plus grande avant de promettre un volume cible. Aucun benchmark de grande charge n’a encore été réalisé.

## App Mac native

L’app SwiftUI existe dans `apps/macos`. Son noyau `RecallKit` sépare les formats, la recherche, le stockage local, le client HTTP/MCP et Gemini. Le module `RecallMac` contient les adaptateurs Trousseau, micro Apple, WebKit et Sparkle. Voir [le guide Mac](macos.md).

Le serveur vectoriel est facultatif : la version Mac 1.1 stocke vidéos et playlists dans SQLite avec recherche FTS5. Elle importe JSON et liens YouTube publics/non répertoriés avec clé personnelle. Le module Import récupère les pages et leur reprise, puis le module Bibliothèque valide une écriture atomique. Le cache serveur est une source séparée. Aucune inférence vectorielle locale ni OAuth pour playlists privées dans cette version. Voir la décision [0001](adr/0001-native-local-library.md).

Le lecteur public accepte maintenant son propre parent HTTPS lorsqu’il est chargé au premier niveau dans la WebView native. Le pont natif ne traite que les événements de ce lecteur et n’expose aucune fonction de lecture des secrets.

Sparkle est intégré avec une clé publique épinglée et un flux HTTPS. La clé privée de signature reste dans le Trousseau. Aucun certificat Apple Developer ID n’est présent : la version actuelle est locale et la notarisation publique attend cette identité. Le téléchargement et le remplacement automatiques doivent être vérifiés avec une seconde version signée ; la configuration seule ne prouve pas ce scénario.

Sources : https://sparkle-project.org/documentation/ et https://developer.apple.com/developer-id/
