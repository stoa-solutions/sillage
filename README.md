# Playlist Recall

Serveur personnel et app Mac pour retrouver une vidéo à partir d'un souvenir, de mots-clés ou de sa durée, et écouter sa bibliothèque avec un DJ conversationnel. Interface en français. Le serveur assure la synchronisation YouTube, les descriptions complètes, une recherche hybride PostgreSQL/pgvector et une recherche visuelle des miniatures.

## App Mac

Une app native SwiftUI est disponible dans `apps/macos` : chat DJ, micro Apple, voix Gemini, lecture YouTube et connexion Google persistante. Depuis la version 1.3, sa bibliothèque réside uniquement sur ton serveur privé : import YouTube par lien, recherche et pagination à distance, sans base musicale locale. Le paquet universel est généré par `npm run build:macos` ; il ne contient aucune connexion personnelle.

Cette première version est destinée aux essais locaux. Sparkle est intégré pour les mises à jour signées ; la distribution publique sans avertissement attend une signature et une notarisation Apple. Voir [le guide Mac](docs/macos.md) pour les fonctions, les limites, la compilation et la publication.

## Connexion au serveur

L’app Mac se connecte avec un compte Google. Vous pouvez ajouter une playlist publique ou non répertoriée, actualiser et suivre la collecte et l’indexation. La synchronisation automatique passe toutes les six heures lorsqu’elle est activée côté serveur.

Pour les scripts et le point d’entrée MCP, un jeton personnel révocable se crée dans le conteneur API avec `node dist/modules/auth/token.cli.js create <fichier privé>` (voir [l’exploitation](docs/operations.md)). Ce jeton est privé : ne le partagez pas.

Le mode **Textes et souvenirs** combine mots-clés et sens du texte. Le mode **Miniatures** utilise les encodeurs texte et image SigLIP 2 correspondants. Les filtres de durée, chaîne, publication et playlist s’appliquent avant le classement. Les descriptions longues sont découpées en passages E5 avec contexte.

## Configuration personnelle et redistribution

Dans **Réglages → Ton IA musicale**, chaque compte peut utiliser une clé Gemini personnelle et choisir le modèle. La clé est chiffrée sur le serveur, jamais incluse dans les exports ni renvoyée au client. Un changement de modèle ne demande pas de la ressaisir. Le serveur doit configurer `DJ_SETTINGS_ENCRYPTION_KEY` pour activer cette fonction.

Les comptes Google ont chacun leurs playlists et leur clé Gemini ; le catalogue public et les vecteurs sont mutualisés, avec filtrage par compte. Voir [les comptes](docs/accounts.md).

Voir [l’architecture et la trajectoire Mac](docs/architecture.md) pour les frontières de code, les secrets et les limites actuelles.

## Mode DJ

Décrivez votre mood dans le chat ou avec le micro : le DJ cherche dans votre bibliothèque par MCP et prépare une file de titres. La réponse vocale du DJ est optionnelle. Le chat et les métadonnées utiles à la sélection sont transmis à Gemini ; la clé reste sur le serveur.

La musique utilise le lecteur officiel YouTube. Certains titres restent indisponibles en intégration ; un lien permet de les ouvrir sur YouTube. Il s’agit d’une sélection qui enchaîne les titres, sans mixage audio ni mesure du tempo.

## Développement

Commencer par [le guide développeur](docs/developing.md) : carte du code, environnement isolé et parcours d’une fonctionnalité.

Node.js 24 ou plus récent. Règles de travail, validation et collaboration entre agents : [`AGENTS.md`](AGENTS.md). Index de la documentation : [`docs/README.md`](docs/README.md). `npm run verify` valide l’ensemble avant intégration dans `main`.

```sh
npm ci --legacy-peer-deps
npm run verify:node    # contrôles, tests et build du serveur
npm run verify:macos   # app Mac
```

Pour lancer une app Mac de développement sans toucher aux données personnelles : `RECALL_DATA_DIR=<dossier temporaire> swift run --package-path apps/macos RecallMac`. Le parcours du serveur est décrit dans [docs/server-tour.md](docs/server-tour.md).

## Données et confidentialité

Les recherches et métadonnées sont envoyées à votre serveur ; les modèles y calculent les vecteurs sur CPU. La clé YouTube reste côté serveur. La recherche seule n’utilise pas d’API d’IA payante. Le mode DJ fait appel à Gemini côté serveur, avec un plafond quotidien ; aucune télémétrie applicative n’est ajoutée. Les miniatures sont chargées depuis `i.ytimg.com` ; l'affichage des miniatures et la lecture demandent une connexion.

Les dates d'écoute ne sont pas disponibles. La synchronisation du serveur utilise uniquement l’API officielle YouTube pour les playlists publiques ou non répertoriées. Des entrées dont YouTube n'a pas renvoyé les métadonnées restent identifiées comme telles.

## Monorepo et exploitation

- `apps/server` : API Hono, file PostgreSQL avec baux/reprise, collecte officielle YouTube et processus d’inférence isolé.
- `apps/macos` : app SwiftUI cliente du serveur.
- `packages/core` : formats d’import, types, filtres et contrats partagés.
- `docker-compose.yml` : API, worker, inférence. PostgreSQL est une ressource Dokploy indépendante.

Voir [le guide d’exploitation](docs/operations.md). Les tests de base utilisent exclusivement une base jetable dont le nom finit par `_test` :

```sh
TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/playlist_recall_test npm run test:integration
```
