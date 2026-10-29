# Architecture Sillage 2.2

## Produit et limites

Sillage comprend une app Mac et un serveur. Le Mac utilise uniquement la bibliothèque serveur.

La connexion Google crée un compte isolé : playlists, réglages Gemini, limites et calage des paroles sont propres au compte. Le catalogue public de vidéos et ses vecteurs sont mutualisés, mais les recherches filtrent les abonnements `user_playlists`. Chaque nouvelle requête SQL ou outil MCP doit conserver ce filtre. Les identifiants proposés par le modèle sont revalidés avant de quitter le serveur. Voir [accounts.md](accounts.md).

Le serveur peut accueillir plusieurs comptes ; cela ne prouve pas une capacité à grande échelle ni une redistribution notarisee. Les limites opérationnelles restent décrites ci-dessous.

## Frontières de code

| Module | Responsabilité |
| --- | --- |
| `packages/core` | Formats de bibliothèque, recherche pure et contrats du DJ. Aucun accès réseau ni secret. |
| `apps/server/src/modules/dj/controllers/dj.controller.ts` | Frontière HTTP du DJ, validation et bail par compte. |
| `apps/server/src/modules/dj/dj.config.ts` | Configuration par défaut du déploiement. |
| `apps/server/src/modules/dj/services/dj-settings.service.ts` (+ `.repository.ts`) | Configuration personnelle, chiffrement et persistance. |
| `apps/server/src/modules/dj/prompt.ts` | Règles de sélection et de dialogue, indépendantes du transport fournisseur. |
| `apps/server/src/modules/dj/index.ts` | Entrée publique du DJ ; détails dans `modules/dj/`. |
| `apps/server/src/modules/mcp/` | Outils MCP de recherche dans la bibliothèque, lecture seule. |
| `apps/server/src/modules/dj/services/dj-voice.service.ts` | Adaptateur de synthèse vocale Gemini. |
| `apps/server/src/modules/search/` | Classement lexical/vectoriel et pagination SQL. |
| API / worker / inference | Processus indépendants : requêtes, tâches durables, calcul des vecteurs. |

Les routes injectent la configuration personnelle dans le chat et la voix. Elles ne modifient jamais `process.env` pour répondre à un utilisateur. L’ajout d’une clé ne touche pas celle du serveur ni un autre compte. Changer de modèle conserve la clé déjà enregistrée.

## Secrets

`DJ_SETTINGS_ENCRYPTION_KEY` contient 32 octets aléatoires encodés en 64 caractères hexadécimaux. Les clés personnelles sont chiffrées en AES-256-GCM, avec un nonce aléatoire et le propriétaire authentifié. La clé de chiffrement reste dans la configuration privée du serveur ; sauvegarder cette configuration avec la base. Changer cette clé sans migrer les secrets rend les anciennes clés illisibles.

Les endpoints ne renvoient jamais une clé personnelle. Le client la garde uniquement pendant la saisie, l’envoie au serveur choisi en HTTPS et efface le champ après enregistrement. Les exports de bibliothèque et le paquet redistribuable ne contiennent aucune configuration personnelle. Le Mac teste une nouvelle clé avant de la remplacer ; un quota peut néanmoins être épuisé lors d’un appel ultérieur.

Le stockage personnalisé refuse de fonctionner si sa clé de chiffrement est absente. La configuration serveur existante reste utilisable dans ce cas. Le client accepte HTTPS ou HTTP sur localhost ; il refuse les adresses avec identifiants, chemin, query ou fragment.

## Volume et évolution

La recherche classe les identifiants avant de charger les descriptions : au maximum les candidats lexicaux, sémantiques et titres explicites, au lieu de toute la bibliothèque. La navigation sans texte est paginée dans PostgreSQL. Les traitements longs restent dans la file PostgreSQL avec baux et reprise.

Les limites de concurrence et de débit HTTP sont encore propres à chaque processus API. Ajouter plusieurs API exige de les coordonner en base ou via un service partagé. Les limites de candidats et les requêtes vectorielles doivent être mesurées sur une bibliothèque plus grande avant de promettre un volume cible. Aucun benchmark de grande charge n’a encore été réalisé.

## App Mac native

L’app SwiftUI existe dans `apps/macos`. Son noyau `SillageKit` contient le client HTTP du serveur, la file de lecture et la session. Le module `SillageMac` contient les adaptateurs de session privée, micro Apple, WebKit et Sparkle. Voir [le guide Mac](macos.md).

Depuis la version 1.3, le Mac ne garde aucune bibliothèque : recherche, imports et tours de DJ passent par le serveur. Voir la décision [0002](adr/0002-server-only-mac-library.md), qui remplace [0001](adr/0001-native-local-library.md).

Le lecteur public accepte maintenant son propre parent HTTPS lorsqu’il est chargé au premier niveau dans la WebView native. Le pont natif ne traite que les événements de ce lecteur et n’expose aucune fonction de lecture des secrets.

Sparkle est intégré avec une clé publique épinglée et un flux HTTPS. La clé privée de signature reste dans le Trousseau. Aucun certificat Apple Developer ID n’est présent : la version actuelle est locale et la notarisation publique attend cette identité. Le téléchargement et le remplacement automatiques doivent être vérifiés avec une seconde version signée ; la configuration seule ne prouve pas ce scénario.

Sources : https://sparkle-project.org/documentation/ et https://developer.apple.com/developer-id/

## Ajouter une fonctionnalité sans mêler les couches

- **Règle pure** : `SillageKit` sur Mac, `packages/core` pour les contrats partagés, ou un module serveur pur (`modules/dj/decision.ts`, `modules/search/search.relevance.ts`). Tests sans réseau.
- **Effet externe** : un adaptateur ciblé (HTTPClient, outils MCP, voix, lecteur). Les secrets et autorisations restent aux frontières.
- **État de session** : `PlaybackQueue` gère ordre/historique, `DJComposition` les suites bornées et exclusions, `LyricsModel` le cache/calage par compte. L’UI affiche ces états ; elle ne refait pas leurs règles.
- **Temps de lecture** : `Player` possède l’horloge `PlaybackClock`. Les panneaux lisent la même position, même après fermeture/réouverture. Les déplacements natifs sont précis ; YouTube reste soumis aux limites de son lecteur et de son tampon.
- **Conversation** : les commandes explicites pause/reprise/suivant sont locales. Les autres demandes passent par une intention, la recherche MCP, la validation des candidats puis une action explicite (remplacer, ajouter, proposer).

Ne pas ajouter un framework d’agents ou un fournisseur pour une règle déterministe. Un nouveau fournisseur de classement doit rester derrière une interface, avec délai maximal, repli, mesures de pertinence et tests de séparation des comptes. Le modèle ne modifie jamais directement la file ni la base.

Démarrage et parcours de contribution : [developing.md](developing.md).


## Serveur : données et modules

Le schéma PostgreSQL est décrit avec Drizzle dans un seul fichier, `apps/server/src/db/schema.ts`, découpé en sections par domaine (`accounts`, `library`, `search`, `jobs`, `listening`, `dj`, `taste`). Il décrit tout : colonnes `vector` de pgvector, colonnes `tsvector` générées, contraintes CHECK, index partiels et d’expression, avec les noms réels des contraintes. Les valeurs fixes sont des enums PostgreSQL (`job_kind`, `job_status`, `playlist_status`, `sync_run_status`, `listening_outcome`, `lyrics_status`, `ai_provider`, `user_dj_provider`, `discovery_scope`, `turn_trigger`, `turn_status`, `journal_origin`). Seuls le déclencheur `sillage_music_revision` et la configuration de recherche `sillage_simple` restent en SQL écrit à la main dans les migrations. Les requêtes utilisent le constructeur proche du SQL de Drizzle (`orm.select().from(...)`), typé de bout en bout ; aucun module n’écrit de SQL brut sur le pool.

Les migrations sont dans `apps/server/drizzle/` : `0000_baseline` (ancien schéma idempotent : une base existante l’applique sans changement, une base neuve est créée), puis `0001` à `0003` (passage des valeurs fixes en enums) et les suivantes ; `0008` supprime le compte historique d’avant la connexion Google. L’API applique les migrations en attente au démarrage (`src/boot.ts`), dans une transaction, sous un verrou consultatif de session pris sur une connexion dédiée avant la lecture du journal (`src/db/migrate.ts`). L’historique est dans le schéma PostgreSQL `drizzle`.

Le code serveur se range par module dans `src/modules/<module>/` : `auth`, `accounts`, `jobs`, `library`, `history`, `lyrics`, `insights`, `enrichment`, `discovery`, `search`, `indexing`, `mcp`, `dj` (avec le sous-module `dj/journal/`), `player`, `releases`, `system`. Chaque module suit la même anatomie :

- `controllers/<module>.controller.ts` : HTTP uniquement, routes déclarées avec `createRoute` (`@hono/zod-openapi`) ; la requête est validée et la documentation OpenAPI générée depuis la même déclaration ;
- `services/<module>.service.ts` : règles et orchestration ;
- `repositories/<module>.repository.ts` : accès à la base avec Drizzle, filtré par compte ;
- `types/<module>.schemas.ts` : contrats Zod de l’API, écrits indépendamment des tables ;
- fichiers nommés par responsabilité si besoin (`session.guard.ts`, `google.provider.ts`, `library.jobs.ts`, `lyrics.matching.ts`…) ;
- `index.ts` : seule entrée publique. Un module n’importe un autre module que par son `index.ts` ; `check:architecture` le vérifie.

`src/integrations/` contient les clients de services externes, sans règle métier : YouTube, YouTube Music (titres d’un artiste pour Découvrir, paroles, page d’artiste), Wikipedia et Wikidata (biographies), LRCLIB et lyrics.ovh (paroles), MusicBrainz, ListenBrainz (voisins d’écoute), SearXNG (recherche et informations du DJ) et le client du processus d’inférence. `src/shared/` contient ce qui n’appartient à aucun module (contexte de requête, conventions OpenAPI, empreintes et texte indexé dans `content.ts`). `src/shared/config.ts` valide l’environnement au démarrage de chaque processus (API, worker, inférence, migrations) et nomme les variables invalides. `src/app.ts` est seulement la racine de composition ; `src/boot.ts`, `src/worker.ts` et `src/inference.ts` sont les points d’entrée des processus. Le parcours de lecture du code est dans [server-tour.md](server-tour.md).

En production, l’image exécute un bundle JavaScript produit par esbuild (`apps/server/build.mjs`), sans compilation TypeScript au démarrage. La CI démarre cette image sur une base vide (`scripts/smoke-server-image.sh`).

Le serveur est un monolithe modulaire en trois processus (API, worker, inférence), dans une même image. **Une seule instance API** : les baux des tours DJ (`modules/dj/dj-lease.ts`) et la limite de débit par jeton (`modules/auth/session.guard.ts`) vivent dans la mémoire du processus, et le démarrage clôt tous les tours restés en cours. Avant toute duplication de l’API : baux DJ en PostgreSQL (propriétaire d’instance, échéance, renouvellement, refus d’une écriture tardive), nettoyage limité aux baux expirés et limite de débit partagée. Le worker peut déjà tourner en plusieurs exemplaires : la file utilise `FOR UPDATE SKIP LOCKED` et des baux par tâche.

## Organisation interne du DJ serveur

```text
apps/server/src/modules/dj/
├── index.ts                 # entrée publique (routes, tour, réglages, clôture au démarrage)
├── controllers/
│   └── dj.controller.ts     # HTTP : bail, journal, mémoire, codes d'erreur
├── services/
│   ├── dj-turn.service.ts   # orchestration : plan → catalogue → recherche → décision
│   ├── dj-quota.service.ts  # budget quotidien par compte
│   ├── dj-settings.service.ts # clés personnelles chiffrées
│   ├── dj-voice.service.ts  # synthèse vocale ; ne charge pas la composition
│   └── dj-check.service.ts  # test d'une clé et d'un modèle
├── repositories/            # dj-quota, dj-settings
├── types/
│   ├── dj.schemas.ts        # contrats OpenAPI des routes
│   └── dj.contracts.ts      # schémas Zod d'entrée et de sortie du modèle (règle pure)
├── dj-lease.ts              # un Tour par compte, plafond sur l'instance, échéance
│
│   # règles pures (vérifiées par check:architecture)
├── plan.ts                  # politique du Tour, suite structurée comprise
├── messages.ts              # messages envoyés au modèle, mémoire comprise
├── memory.ts                # résumé borné du journal de la conversation
├── decision.ts              # sortie du modèle → une seule décision motivée
├── reply.ts                 # texte visible, annoncé depuis l'action exécutée
├── composition.ts           # candidats du Tour, choix validé, reprise
├── evidence.ts              # lecture bornée des résultats d'outils
├── prompt.ts                # règles de dialogue
├── errors.ts                # erreurs publiques sans détail fournisseur
│
│   # adaptateurs
├── research.ts              # exécution des outils, preuves accumulées
├── provider.ts, ai-model.ts # AI SDK : Gemini, Claude
├── catalog.ts               # titres précis, ordre et propriété
├── dj.config.ts             # configuration IA d'un compte
└── journal/                 # traces, mémoire, clôture des tours au redémarrage (même rangement)
```

L’intention d’une phrase tapée est lue par `@sillage/core/intent` (pur, partagé). Les outils MCP sont dans `modules/mcp/` (`mcp.service.ts`, indices de recherche indépendants dans `mcp.retrieval.ts`) et la correspondance des titres dans `modules/search/music-matching.ts`.

`dj-turn.service` compose ces modules. `provider` connaît le format fournisseur, mais ne décide pas de la file ; `decision` est le seul endroit où une réponse du modèle devient une issue, et chaque issue porte une raison enregistrée au journal ; `catalog` relit les titres pour le compte authentifié. Le bail vit en mémoire du processus API, unique pour l’instant (voir « Volume et évolution »). Les fichiers internes du DJ n'importent jamais son `index.ts`, afin d'éviter une dépendance circulaire ; `check:architecture` le vérifie. Les routes HTTP restent stables : un rangement de fichiers ne doit pas imposer une migration aux clients.

Ne pas multiplier les dossiers `utils`, services génériques ou interfaces à une seule implémentation sans besoin de test ou d'évolution.

## Garde-fous automatisés

`npm run check:architecture` lit la syntaxe TypeScript : contrats partagés autonomes, aucun import client dans le serveur, pas d'effet réseau/configuration globale dans les règles pures du DJ, modules utilisés par leur `index.ts`, pas de retour des fichiers internes du DJ vers leur `index.ts` et pas de `any` dans le module DJ. Le contrôle est intégré à `check`, donc à `verify:node` et à la CI. Ses propres tests vérifient notamment les imports dynamiques et les réexports.

La CI exécute quatre validations distinctes : Node (frontières, types, comportement, build), Mac (compilation et scénarios natifs), PostgreSQL jetable (migrations, isolation des comptes et opérations persistantes) et image serveur (construction de l’image Docker, démarrage sur une base vide). Les réponses tardives, les exclusions, les sélections partielles et les erreurs fournisseur restent des scénarios de comportement ; ne pas les remplacer par des tests qui recopient l'implémentation.

Ces contrôles ciblent des régressions connues ; ils ne prouvent ni l'absence de tout défaut, ni la qualité musicale d'une réponse réelle. Les changements de lecteur, de voix ou de parcours demandent toujours un essai dans l'app. Le déploiement reste une étape séparée.


## Politique du DJ et concurrence

Les décisions musicales, les résultats MCP et la lecture asynchrone ont des propriétaires distincts. Le contrat d’intention et les scénarios de non-régression sont décrits dans [Décisions du DJ](dj-behavior.md). Le prompt guide la recherche ; il ne peut pas annuler les contrôles d’action, de compte, de candidat ou la dernière pause utilisateur.
