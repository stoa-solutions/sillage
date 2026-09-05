# Playlist Recall

Extension Chrome locale pour retrouver une vidéo à partir d'un souvenir, de mots-clés ou de sa durée. Interface en français, panneau latéral et bibliothèque dans un onglet. La version personnelle contient la playlist importée et son index sémantique.

## Installation locale

1. Ouvrez `chrome://extensions` dans Chrome.
2. Activez **Mode développeur**.
3. Cliquez sur **Charger l'extension non empaquetée** et sélectionnez le dossier `extension` de ce projet.
4. Épinglez **Playlist Recall** puis cliquez sur son icône. Le bouton d'agrandissement ouvre la bibliothèque dans un onglet.

Laissez le dossier `extension` en place : Chrome l'utilise directement. Après une nouvelle compilation, cliquez sur **Actualiser** dans la fiche de l'extension.

## Rechercher et importer

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

Placez votre export dans `public/data/library.json` avant de générer l'index personnel. La compilation produit `.output/chrome-mv3`. La commande `package:local` vérifie les ressources et crée le dossier `extension` à charger dans Chrome.

Le modèle multilingue E5, ses fichiers ONNX et le runtime WASM sont préparés dans `public/models` et `public/ort`. Le script de préparation télécharge les ressources publiques une fois. Le calcul s'effectue ensuite dans un Web Worker avec des ressources empaquetées.

## Données et confidentialité

Les playlists et vecteurs sont stockés dans IndexedDB, dans le profil Chrome qui a chargé l'extension. Aucun service d'inférence, compte, secret API ou télémétrie n'est utilisé. Les miniatures sont chargées depuis `i.ytimg.com` et cliquer un résultat ouvre YouTube. La recherche textuelle et sémantique peut fonctionner hors ligne ; l'affichage des miniatures et la lecture demandent une connexion.

La version personnelle empaquetée contient vos métadonnées et vos vecteurs. Ces fichiers sont ignorés par Git. Ne partagez pas ce dossier si vous souhaitez garder votre bibliothèque privée. Désinstaller l'extension peut supprimer sa bibliothèque : exportez une sauvegarde auparavant.

Les dates d'écoute ne sont pas disponibles. Cette version ne synchronise pas automatiquement YouTube. Des entrées dont YouTube n'a pas renvoyé les métadonnées restent identifiées comme telles.

## Architecture

- `src/import.ts` : validation et normalisation des deux formats d'entrée.
- `src/db.ts` : import transactionnel, bibliothèque et vecteurs persistants.
- `src/search.ts` : extraction de contraintes de durée, recherche lexicale, cosinus et fusion des rangs.
- `src/embedding-worker.ts` : modèle E5 local et calcul séquentiel hors du thread d'interface.
- `src/App.tsx` : import, indexation avec reprise, recherche et affichage.
- `entrypoints/background.ts` : ouverture du panneau Chrome.

Sources techniques : [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Transformers.js](https://huggingface.co/docs/transformers.js), [E5 multilingue](https://huggingface.co/intfloat/multilingual-e5-small), [WXT](https://wxt.dev/).
