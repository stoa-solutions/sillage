# Playlist Recall

Extension Chrome avec bibliothèque locale et serveur personnel pour retrouver une vidéo à partir d'un souvenir, de mots-clés ou de sa durée. Interface en français, panneau latéral et bibliothèque dans un onglet. La V2 ajoute la synchronisation YouTube, les descriptions complètes, une recherche hybride PostgreSQL/pgvector et une recherche visuelle des miniatures.

## Installation locale

1. Ouvrez `chrome://extensions` dans Chrome.
2. Activez **Mode développeur**.
3. Cliquez sur **Charger l'extension non empaquetée** et sélectionnez le dossier `extension` de ce projet.
4. Épinglez **Playlist Recall** puis cliquez sur son icône. Le bouton d'agrandissement ouvre la bibliothèque dans un onglet.

Laissez le dossier `extension` en place : Chrome l'utilise directement. Après une nouvelle compilation, cliquez sur **Actualiser** dans la fiche de l'extension.

## Connexion au serveur

Dans l’extension, cliquez sur **Connecter mon serveur**, puis **Importer la connexion** et choisissez le fichier privé fourni. Ce fichier contient votre jeton personnel : ne le partagez pas. Vous pouvez ensuite ajouter une playlist publique ou non répertoriée, actualiser et suivre la collecte et l’indexation. La synchronisation automatique passe toutes les six heures lorsqu’elle est activée côté serveur.

Le mode **Textes et souvenirs** combine mots-clés et sens du texte. Le mode **Miniatures** utilise les encodeurs texte et image SigLIP 2 correspondants. Les filtres de durée, chaîne, publication et playlist s’appliquent avant le classement. Les descriptions longues sont découpées en passages E5 avec contexte.

**Utiliser le mode local** retrouve la bibliothèque existante de cet ordinateur. Cette copie conserve la date de son dernier import ; elle ne contient pas automatiquement les nouvelles vidéos du serveur. **État des playlists → Copier ma bibliothèque locale vers le serveur** télécharge d’abord une sauvegarde et conserve l’original.

## Rechercher et importer en mode local

- Essayez `jazz romantique de plus d'une heure` ou `musique douce pour un dîner en amoureux`.
- Le filtre de durée s'applique aux secondes réelles, pas au sens du texte. Une durée inconnue est exclue lorsqu'un filtre de durée est actif.
- Le bouton **Importer** accepte l'export JSON normalisé de cette conversation, un export `yt-dlp --flat-playlist --dump-single-json`, ou une sauvegarde Playlist Recall.
- Réimporter la même playlist actualise ses entrées. Les autres playlists sont conservées. Les vecteurs dont les métadonnées n'ont pas changé sont réutilisés.
- **Indexer** calcule localement les vecteurs manquants. Chaque lot est enregistré ; une interruption permet de reprendre. La recherche par mots-clés reste utilisable pendant ce temps.
- Les résultats sont des pistes classées, pas des identifications certaines. La recherche sémantique utilise les textes disponibles ; elle n'écoute pas la musique et n'analyse pas les miniatures.

## Développement

Node.js 24 ou plus récent.

```sh
npm ci --legacy-peer-deps
npm run prepare:model
npm run prepare:seed
npm test
npm run check
npm run package:local
```

Placez votre export dans `apps/extension/public/data/library.json` avant de générer l'index personnel. La compilation produit `apps/extension/.output/chrome-mv3`. La commande `package:local` vérifie les ressources et crée le dossier `extension` à charger dans Chrome.

Le modèle multilingue E5, ses fichiers ONNX et le runtime WASM sont préparés dans `apps/extension/public/models` et `apps/extension/public/ort`. Le script de préparation télécharge les ressources publiques une fois. Le calcul s'effectue ensuite dans un Web Worker avec des ressources empaquetées.

## Données et confidentialité

Les playlists et vecteurs sont stockés dans IndexedDB, dans le profil Chrome qui a chargé l'extension. Le mode local n’utilise aucun service d’inférence distant. Le mode serveur envoie les recherches et métadonnées à votre VPS, avec un jeton révocable ; les modèles y calculent les vecteurs sur CPU. La clé YouTube reste côté serveur. Aucune API d’IA payante ni télémétrie n’est utilisée. Les miniatures sont chargées depuis `i.ytimg.com` et cliquer un résultat ouvre YouTube. La recherche textuelle et sémantique peut fonctionner hors ligne ; l'affichage des miniatures et la lecture demandent une connexion.

La version personnelle empaquetée contient vos métadonnées et vos vecteurs. Ces fichiers sont ignorés par Git. Ne partagez pas ce dossier si vous souhaitez garder votre bibliothèque privée. Désinstaller l'extension peut supprimer sa bibliothèque : exportez une sauvegarde auparavant.

Les dates d'écoute ne sont pas disponibles. La synchronisation du serveur utilise uniquement l’API officielle YouTube pour les playlists publiques ou non répertoriées. Des entrées dont YouTube n'a pas renvoyé les métadonnées restent identifiées comme telles.

## Architecture

- `apps/extension/src/import.ts` : validation et normalisation des deux formats d'entrée.
- `apps/extension/src/db.ts` : import transactionnel, bibliothèque et vecteurs persistants.
- `apps/extension/src/search.ts` : extraction de contraintes de durée, recherche lexicale, cosinus et fusion des rangs.
- `apps/extension/src/embedding-worker.ts` : modèle E5 local et calcul séquentiel hors du thread d'interface.
- `apps/extension/src/App.tsx` : import, indexation avec reprise, recherche et affichage.
- `apps/extension/entrypoints/background.ts` : ouverture du panneau Chrome.

Sources techniques : [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Transformers.js](https://huggingface.co/docs/transformers.js), [E5 multilingue](https://huggingface.co/intfloat/multilingual-e5-small), [WXT](https://wxt.dev/).

## Monorepo et exploitation

- `apps/extension` : WXT, React, IndexedDB et mode local conservé.
- `apps/server` : API Hono, file PostgreSQL avec baux/reprise, collecte officielle YouTube et processus d’inférence isolé.
- `packages/core` : formats d’import, types, filtres et modèle E5 partagés.
- `docker-compose.yml` : API, worker, inférence. PostgreSQL est une ressource Dokploy indépendante.

Voir [le guide d’exploitation](docs/operations.md). Les tests de base utilisent exclusivement une base jetable dont le nom finit par `_test` :

```sh
TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/playlist_recall_test npm run test:integration
```
