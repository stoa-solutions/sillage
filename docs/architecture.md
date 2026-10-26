# Architecture Recall 2.2

## Produit et limites

Recall comprend une app Mac, une extension Chrome et un serveur. Le Mac utilise uniquement la bibliothèque serveur. L’extension conserve un mode local historique indépendant.

La connexion Google crée un compte isolé : playlists, réglages Gemini, limites et calage des paroles sont propres au compte. Le catalogue public de vidéos et ses vecteurs sont mutualisés, mais les recherches filtrent les abonnements `user_playlists`. Chaque nouvelle requête SQL ou outil MCP doit conserver ce filtre. Les identifiants proposés par le modèle sont revalidés avant de quitter le serveur. Voir [accounts.md](accounts.md).

Le serveur peut accueillir plusieurs comptes ; cela ne prouve pas une capacité à grande échelle ni une redistribution notarisee. Les limites opérationnelles restent décrites ci-dessous.

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
| `apps/server/src/dj-prompt.ts` | Règles de sélection et de dialogue, indépendantes du transport fournisseur. |
| `apps/server/src/dj.ts` | Façade publique stable du DJ ; détails dans `features/dj/`. |
| `apps/server/src/music-mcp.ts` | Recherche dans la bibliothèque, lecture seule. |
| `apps/server/src/dj-voice.ts` | Adaptateur de synthèse vocale Gemini. |
| `apps/server/src/search.ts` | Classement lexical/vectoriel et pagination SQL. |
| API / worker / inference | Services indépendants : requêtes, tâches durables, calcul des vecteurs. |

Les routes injectent la configuration personnelle dans le chat et la voix. Elles ne modifient jamais `process.env` pour répondre à un utilisateur. L’ajout d’une clé ne touche pas celle du serveur ni un autre compte. Changer de modèle conserve la clé déjà enregistrée.

## Secrets

`DJ_SETTINGS_ENCRYPTION_KEY` contient 32 octets aléatoires encodés en 64 caractères hexadécimaux. Les clés personnelles sont chiffrées en AES-256-GCM, avec un nonce aléatoire et le propriétaire authentifié. La clé de chiffrement reste dans la configuration privée du serveur ; sauvegarder cette configuration avec la base. Changer cette clé sans migrer les secrets rend les anciennes clés illisibles.

Les endpoints ne renvoient jamais une clé personnelle. Le client la garde uniquement pendant la saisie, l’envoie au serveur choisi en HTTPS et efface le champ après enregistrement. Les exports de bibliothèque et le paquet redistribuable ne contiennent aucune configuration personnelle. Le Mac teste une nouvelle clé avant de la remplacer ; un quota peut néanmoins être épuisé lors d’un appel ultérieur.

Le stockage personnalisé refuse de fonctionner si sa clé de chiffrement est absente. La configuration serveur existante reste utilisable dans ce cas. Le client accepte HTTPS ou HTTP sur localhost ; il refuse les adresses avec identifiants, chemin, query ou fragment.

## Volume et évolution

La recherche classe les identifiants avant de charger les descriptions : au maximum les candidats lexicaux, sémantiques et titres explicites, au lieu de toute la bibliothèque. La navigation sans texte est paginée dans PostgreSQL. Les traitements longs restent dans la file PostgreSQL avec baux et reprise.

Les limites de concurrence et de débit HTTP sont encore propres à chaque processus API. Ajouter plusieurs API exige de les coordonner en base ou via un service partagé. Les limites de candidats et les requêtes vectorielles doivent être mesurées sur une bibliothèque plus grande avant de promettre un volume cible. Aucun benchmark de grande charge n’a encore été réalisé.

## App Mac native

L’app SwiftUI existe dans `apps/macos`. Son noyau `RecallKit` contient le client HTTP du serveur, la file de lecture et la session. Le module `RecallMac` contient les adaptateurs de session privée, micro Apple, WebKit et Sparkle. Voir [le guide Mac](macos.md).

Depuis la version 1.3, le Mac ne garde aucune bibliothèque : recherche, imports et tours de DJ passent par le serveur. Voir la décision [0002](adr/0002-server-only-mac-library.md), qui remplace [0001](adr/0001-native-local-library.md).

Le lecteur public accepte maintenant son propre parent HTTPS lorsqu’il est chargé au premier niveau dans la WebView native. Le pont natif ne traite que les événements de ce lecteur et n’expose aucune fonction de lecture des secrets.

Sparkle est intégré avec une clé publique épinglée et un flux HTTPS. La clé privée de signature reste dans le Trousseau. Aucun certificat Apple Developer ID n’est présent : la version actuelle est locale et la notarisation publique attend cette identité. Le téléchargement et le remplacement automatiques doivent être vérifiés avec une seconde version signée ; la configuration seule ne prouve pas ce scénario.

Sources : https://sparkle-project.org/documentation/ et https://developer.apple.com/developer-id/

## Ajouter une fonctionnalité sans mêler les couches

- **Règle pure** : `RecallKit` sur Mac, `packages/core` pour les contrats partagés, ou un module serveur pur (`dj-intent`, `search-relevance`). Tests sans réseau.
- **Effet externe** : un adaptateur ciblé (HTTPClient, outils MCP, voix, lecteur). Les secrets et autorisations restent aux frontières.
- **État de session** : `PlaybackQueue` gère ordre/historique, `DJComposition` les suites bornées et exclusions, `LyricsModel` le cache/calage par compte. L’UI affiche ces états ; elle ne refait pas leurs règles.
- **Temps de lecture** : `Player` possède l’horloge `PlaybackClock`. Les panneaux lisent la même position, même après fermeture/réouverture. Les déplacements natifs sont précis ; YouTube reste soumis aux limites de son lecteur et de son tampon.
- **Conversation** : les commandes explicites pause/reprise/suivant sont locales. Les autres demandes passent par une intention, la recherche MCP, la validation des candidats puis une action explicite (remplacer, ajouter, proposer).

Ne pas ajouter un framework d’agents ou un fournisseur pour une règle déterministe. Un nouveau fournisseur de classement doit rester derrière une interface, avec délai maximal, repli, mesures de pertinence et tests de séparation des comptes. Le modèle ne modifie jamais directement la file ni la base.

Démarrage et parcours de contribution : [developing.md](developing.md).


## Organisation interne du DJ serveur

```text
apps/server/src/
├── dj.ts                    # API publique conservée pour routes, tests et consommateurs
├── dj-routes.ts             # HTTP, authentification déjà établie, concurrence
├── dj-settings.ts           # secrets personnels et persistance
├── dj-voice.ts              # synthèse vocale ; ne charge pas la composition
└── features/dj/
    ├── contracts.ts         # schémas Zod d'entrée et de sélection
    ├── context.ts           # intention, référence musicale, messages du tour
    ├── catalog.ts           # résolution de titres précis, ordre et propriété
    ├── provider.ts          # format Gemini, validation de réponse, transport
    ├── quota.ts             # réservation atomique du budget par compte
    ├── errors.ts            # erreurs publiques sans secrets
    └── turn.ts              # orchestration bornée MCP → sélection → réponse
```

`turn` compose ces modules. `provider` connaît le format fournisseur, mais ne décide pas de la file ; `context` calcule les règles sans réseau ; `catalog` relit les titres pour le compte authentifié. Les modules internes n'importent jamais `dj.ts`, afin d'éviter une dépendance circulaire. Les points d'entrée existants restent stables : un rangement de fichiers ne doit pas imposer une migration aux clients.

La séparation est progressive. Les domaines recherche, comptes, playlists et paroles gardent leurs modules actuels tant qu'un changement concret ne justifie pas leur déplacement. Ne pas multiplier les dossiers `utils`, services génériques ou interfaces à une seule implémentation sans besoin de test ou d'évolution.

## Garde-fous automatisés

`npm run check:architecture` lit la syntaxe TypeScript : contrats partagés autonomes, aucun import serveur dans l'extension, aucun import client dans le serveur, pas d'effet réseau/configuration globale dans les règles pures du DJ, pas de retour des modules internes vers leur façade et pas de `any` dans cette feature. Le contrôle est intégré à `check`, donc à `verify:node` et à la CI. Ses propres tests vérifient notamment les imports dynamiques et les réexports.

La CI exécute trois validations distinctes : Node (frontières, types, comportement, build), Mac (compilation et scénarios natifs), PostgreSQL jetable (migrations, isolation des comptes et opérations persistantes). Les réponses tardives, les exclusions, les sélections partielles et les erreurs fournisseur restent des scénarios de comportement ; ne pas les remplacer par des tests qui recopient l'implémentation.

Ces contrôles ciblent des régressions connues ; ils ne prouvent ni l'absence de tout défaut, ni la qualité musicale d'une réponse réelle. Les changements de lecteur, de voix ou de parcours demandent toujours un essai dans l'app. Le déploiement reste une étape séparée.


## Politique du DJ et concurrence

Les décisions musicales, les résultats MCP et la lecture asynchrone ont des propriétaires distincts. Le contrat d’intention et les scénarios de non-régression sont décrits dans [Décisions du DJ](dj-behavior.md). Le prompt guide la recherche ; il ne peut pas annuler les contrôles d’action, de compte, de candidat ou la dernière pause utilisateur.
