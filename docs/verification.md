# Vérification locale

Environnement : macOS, Node.js 24.15.0, Google Chrome 152.0.7977.82. Les essais navigateur utilisent des profils de test distincts du profil personnel.

## Contrôles effectués

- 30 tests automatisés : imports normalisés/yt-dlp, doublons et positions, métadonnées inconnues, filtres de durée, fusion lexicale/sémantique, persistance, invalidation des vecteurs, écritures obsolètes, seed atomique, validation des sorties du modèle et erreurs du worker.
- TypeScript strict et compilation de production WXT/Manifest V3.
- Chrome réel : chargement de la bibliothèque personnelle, recherche du jazz romantique avec durée supérieure à une heure, réouverture persistante, import invalide sans perte, import avec doublons, bornes de durée, export des deux playlists du profil de test.
- Contrôle visuel en grand écran et à 390 pixels ; absence de débordement horizontal et d'erreur JavaScript dans les parcours testés.
- Relecture indépendante : correction du contexte worker et du chargement initial atomique ; aucun défaut P1/P2 restant dans le code examiné.
- Cohérence du verrou de dépendances vérifiée avec `npm ci --dry-run`. Une réinstallation complète dans un dossier temporaire a été interrompue par des délais réseau ; les contrôles ci-dessus utilisent les dépendances locales disponibles.

## Acceptation sémantique finale

Validée dans le dossier final `extension`, avec un profil Chrome neuf et le réseau désactivé avant la première ouverture.

- Modèle ONNX, tokenizer et sentencepiece vérifiés par SHA-256 ; fichiers et runtime WASM embarqués.
- Première ouverture : 2 792 vidéos uniques et 2 666 vecteurs préchargés. Les 126 vidéos sans titre restent visibles sans vecteur inventé.
- `jazz romantique de plus d'une heure` : vidéo attendue classée première.
- `musique douce pour un dîner en amoureux`, filtre > 1 h : même vidéo classée première, sans mots du titre dans la requête française.
- Mesures sur cette machine, temporisation de saisie comprise : environ 1,3 s pour la première recherche et 0,3 s avec le modèle chargé. Ce ne sont pas des garanties pour d'autres machines.
- Rechargement hors ligne : bibliothèque et index conservés.
- Import de 12 vidéos de test, indexation locale puis pause après 8 vidéos traitées : 4 restent à indexer. Après fermeture/rechargement, la reprise termine les 4 restantes.
- Aucun appel externe d'inférence et aucune erreur JavaScript. Seules les tentatives de chargement des miniatures YouTube ont utilisé des URL externes ; elles ont échoué normalement hors ligne et affiché les visuels de remplacement.
- Nouvelle vérification visuelle du résultat final en 1440 × 1000 et 390 × 844, sans débordement horizontal.

Captures, mesures et scripts de navigateur sont conservés dans `output/playwright` (ignoré par Git car les résultats peuvent contenir des métadonnées personnelles).
