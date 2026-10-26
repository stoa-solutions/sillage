# Contribuer

Ouvrez une issue décrivant un cas reproductible, puis une pull request ciblée.
Utilisez des données fictives, une base de test jetable et un dossier `RECALL_DATA_DIR` temporaire.
Ne joignez pas de clés, sessions, cookies ou exports de bibliothèque privée.

Les contrôles Node sont `npm run verify:node`. Pour une modification native, lancez `npm run test:macos`
et vérifiez le comportement de l’app : lecture immédiate, file ordonnée et reprise séparément.
Ne remplacez pas la file ni la lecture si une recherche échoue.

Le code suit le style du fichier concerné. Gardez les changements de formatage séparés.
Swift : configuration `apps/macos/.swift-format`. Les contrats purs vont dans `packages/core`.
