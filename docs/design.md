# Design de l’app Mac

Référence commune pour toute nouvelle vue Mac, Découvrir comprise. Plan validé par Samuel le 25 octobre 2026. Une app propre et moderne : mêmes composants partout, peu de texte, et des écrans qui s’enchaînent sans rupture.

## Principes

- **Un seul modèle de morceau.** Bibliothèque, À suivre, Historique et les résultats de Découvrir montrent la même ligne. On reconnaît un morceau au premier coup d’œil, où qu’il soit.
- **Le titre, pas le nom de fichier.** On affiche « Beds Are Burning » et « Midnight Oil », jamais « Midnight Oil - Beds Are Burning » au-dessus de « MidnightOilVEVO ». Le découpage artiste et titre suit les mêmes règles que les paroles côté serveur (`lyrics.ts`).
- **Une action principale par écran.** Les explications longues vont dans l’aide au survol (`.help`), pas sous chaque champ.
- **Le mouvement montre ce qui change** : un nouveau morceau, un changement de mode ou d’onglet. Pas d’animation décorative. Avec « Réduire les animations », tout passe en fondu court ou sans animation.
- **Clair et sombre, la même application** (cahier des charges UI Sillage, direction « Atelier de lumière », 26 octobre 2026). Le système choisit l’apparence, y compris en automatique ; les deux montrent les mêmes contenus aux mêmes endroits. Seule la scène Studio de la page DJ garde sa protection sombre (barre d’outils comprise) pour rester lisible sur n’importe quel clip.
- **Trois couches.** Le fond : l’image Stoa choisie dans Apparence, fixe et adoucie (`SillageBackdrop`), jamais de vidéo derrière les listes. La lecture : voile de papier ou de graphite sur la lumière Stoa diffuse et réchauffée (`sillageSurface(.reading)`, 0,88 en clair, 0,83 en sombre). Le bandeau d’outils et la barre latérale : voile plus léger (`.chrome`, `.sidebar`), le bandeau étant la même vitre que la page avec un filet. Les voiles sont réglés sur le rendu mesuré : texte secondaire ≥ 4,5:1 là où la lumière est la plus forte. Une seule surface par page, d’un bord à l’autre ; pas de carte de verre par ligne. Réduire la transparence rend tout opaque dans la même famille de couleurs ; Augmenter le contraste renforce voiles et filets.
- **Une seule source de couleurs.** `RecallKit/SillagePalette` porte les rôles du cahier (fond, lecture, texte, secondaire, petit texte d’action, focus, bouton principal et son pictogramme, sélection, filet) ; `Color.sillage(_:)` les rend adaptatifs. Les contrôles natifs vérifient les contrastes : textes ≥ 4,5:1 sur papier et graphite, pictogramme encre sur orange ≥ 4,5:1. L’orange Stoa sur graphite (4,44:1) ne porte jamais de petit texte : le titre en lecture reste craie en sombre, avec un repère orange (haut-parleur).
- **L’orange est une action.** Bouton principal : orange Stoa `#F15A24`, pictogramme encre, dans les deux apparences. `Color.recall` reste l’accent des liens et des petits textes (orange profond en clair). Les bascules, portées et onglets restent neutres : blanc ou craie avec texte encre quand actifs.

## Repères

| Élément | Valeur |
|---|---|
| Espacements | 4, 8, 12, 16, 24, 32 |
| Rayons | 6 (vignettes), 8 (lignes, champs), 12 (surfaces groupées), capsules natives |
| Texte | 13–14 corps, 12 secondaire, 22 titre de collection (semi-gras) ; typographie système |
| Compact | repos ≈ 520 × 192 (selon contenu), largeur 440 à 620, panneau ouvert plafonné à 560 |
| Lecture | préférée 1 080 × 760, barre latérale 210, barre de lecture 68 |
| Mouvement | pression 80–120 ms, panneau 180–220 ms, onglets 120–180 ms ; rien avec Réduire les animations |

La géométrie vit dans `RecallKit/RecallWindowLayout` (contrôles natifs : retour au format de poche sous le même bord haut, aucune dérive après dix replis, fenêtre toujours dans l’espace utile, taille de lecture mémorisée). `WindowSizer` l’applique seulement quand la présentation change : changer d’onglet de lecture ne redimensionne jamais.

Pour la recette, une copie de test peut s’ouvrir sur une page (`SILLAGE_QA_SECTION=dj|library|discover`) ou une recherche (`SILLAGE_QA_QUERY`), rendre le verre malgré Réduire la transparence (`SILLAGE_QA_TRANSPARENCY=1`, copie de test seulement), et l’apparence se force par argument (`-AppleInterfaceStyle Dark` ou `-NSRequiresAquaSystemAppearance YES`) : captures sans clic simulé.

Pas de libellés en capitales, pas de points médians en séparateur, pas de numéros devant les étapes ou les lignes quand l’ordre est déjà visible.

## Composants communs

À créer dans un fichier unique de composants (`DesignSystem.swift`) et à réutiliser partout.

- **TrackRow**, la ligne de morceau, avec de gauche à droite :
  - une miniature 16:9 (`i.ytimg.com/vi/<id>/mqdefault.jpg`), avec la durée en bas à droite ;
  - le titre nettoyé, une ligne ; dessous, l’avatar de la chaîne et l’artiste ;
  - à droite, des actions qui n’apparaissent qu’au survol : lire, plus un menu « ⋯ » (lire ensuite, ouvrir sur YouTube, retirer).
  - Variantes : `.library` (description courte en plus), `.queue` (poignée pour glisser), `.history` (statut : écouté, passé, indisponible).
- **SectionHeader** : titre de section en casse de phrase, compteur entre parenthèses, et une action à droite facultative.
- **EmptyState** : une icône SF Symbol, une phrase qui dit quoi faire, et un seul bouton. Exemples :
  - « La file est vide. » avec « Préparer la suite » ;
  - « Pas de paroles trouvées pour ce titre. » sans bouton.
- **StatusLine** : un seul endroit pour l’état en cours (le DJ cherche, l’écoute du micro, une préparation du clip, une erreur). Une ligne, avec un indicateur et une action « Annuler » si utile.
- **NowPlaying** : titre et artiste nettoyés. Quand le morceau change, l’ancien titre glisse vers le haut en fondu et le nouveau arrive par le bas, en 250 ms. La pochette passe en fondu.

## Lecteur, Compact et mini-clip

- **Un seul lecteur, un seul audio.** `VideoSurface` affiche le lecteur partagé là où la page le place : scène Studio, vignette du Compact ou mini-clip de la barre de lecture. Le déplacer ne recharge pas le média. En cas d’échec ou sans morceau, la pochette prend la place.
- **Compact** : une poche (vignette-clip, titre et artiste, lecture, suivant, position, volume), puis « DJ et file » qui ouvre le panneau dessous ; Voix du DJ, Enchaîner et le lien YouTube restent dans le menu « ⋯ » de cette barre, avec leur état. La fenêtre suit la hauteur de la poche (`CompactRestHeightKey`) sous un bord haut fixe ; panneau ouvert, 560 au plus. Barre d’outils réduite : onglets en petite taille, Studio en icône.
- **Barre de lecture** (Bibliothèque, Découvrir) : d’un bord à l’autre, hauteur 68 ; mini-clip, titre, lecture, suivant, position, volume ; un clic sur la vignette ouvre le DJ.

## Enchaînements

- **Accueil** : trois écrans dans une feuille de taille fixe, mis en page comme Studio : le fond choisi dans Apparence (Stoa par défaut) sous un voile encre, texte aligné à gauche, couleurs Stoa (encre `#20201e`, craie `#f5f3ee`, orange `#f15a24` réservé à la progression, au champ actif et aux erreurs). Trois traits de progression en haut, un seul bouton craie par écran.
  1. Compte Google : « Continuer avec Google ».
  2. Clé Gemini : un champ et « Activer mon DJ » ; le lien « Obtenir ma clé » ouvre AI Studio.
  3. Première playlist : un champ pour coller le lien et « Importer ». À la fin, on arrive dans la Bibliothèque, où l’import progresse.

  Une étape déjà faite est sautée. « Plus tard » reste discret en bas. Les erreurs s’affichent sous le champ concerné.
- **Bibliothèque** (Atelier) : une seule surface. Barre latérale de playlists (« Écoutes récentes », « Toutes les vidéos », puis les playlists ; « + » et actualisation en tête). À droite : le filtre en haut, puis un petit en-tête de collection (tuile 48, titre 22, nombre de vidéos, pastille d’enrichissement), le bouton rond de lecture, l’aléatoire et le menu. Liste dense `SongRow` en colonnes régulières : numéro (lecture au survol, haut-parleur pour le titre en cours), vignette 16:9, titre et artiste, actions au survol, durée ; un filet discret entre les lignes. Pages de 50 au défilement. Fenêtre étroite : la barre latérale devient un menu sur le titre.
- **Découvrir** (Atelier) : recherche en haut, qui cherche dès que la frappe s’arrête (450 ms), Échap efface ; portées en pastilles, menu de playlist et « DJ et file » qui ouvre le panneau DJ à droite à la demande. Avant la recherche : la grille de recommandations « À découvrir pour toi », les recherches récentes, des idées et les playlists. Résultats : une liste (vignette, titre sur deux lignes, artiste, durée, « Lire ensuite ») avec un aperçu à droite (pochette, titre, artiste, lecture, ajout à Mes découvertes). Un clic sélectionne et met à jour l’aperçu, un double clic ou Entrée lit, les flèches parcourent la liste ; l’aperçu se replie quand la liste deviendrait trop étroite. La suite se charge au défilement.
- **Bibliothèque → DJ** : lire un morceau bascule sur DJ. Le titre arrive avec l’animation NowPlaying, la file s’ouvre sur « À suivre ».
- **Compact ⇄ Studio** : bouton « Studio » sobre dans la barre d’outils, visible sur toutes les pages. Fondu de 300 ms entre les scènes pendant que la fenêtre s’anime à sa nouvelle largeur ; l’onglet courant ne change pas.
- **Onglets du panneau** (DJ, À suivre, Historique, Paroles) : fondu court. Chaque onglet garde sa position de défilement.
- **À suivre** : réordonner en glissant les lignes (`onMove`), et retirer au balayage ou par le menu « ⋯ ». La ligne « Ensuite : … » sous le lecteur disparaît, puisque l’onglet fait le même travail.
- **Réglages** : quatre sections courtes (Compte, DJ, Voix, Studio). Une phrase au plus par section ; le reste passe en aide au survol.

## Vérification

Chaque écran est vérifié en Compact et en Studio, clair et sombre, avec « Réduire les animations », au clavier et avec VoiceOver. Les captures avant et après sont jointes à l’intégration.

### Paroles

Les paroles restent dans le panneau latéral, jamais au centre du clip. Le raccourci Paroles ouvre cet onglet et déplie le panneau si nécessaire. La ligne chantée, son défilement, le clic pour se déplacer et le calage par compte sont conservés.

## Identité Sillage — by Stoa

Nom visible et icône approuvés le 26 octobre 2026. Le nom du produit est Sillage ; Stoa signe les supports de présentation. L’app conserve ses contrôles et polices système. Le signe est un artwork orange sculptural ; l’ICNS haute résolution est dans `apps/macos/Resources/Sillage.icns`, les exports Chrome dans `apps/extension/public/icon/`. Provenance : `assets/branding/sillage/`.

Le renommage reste visuel : bundle ID, chemins de données, Trousseau, schéma OAuth, noms d’archives Sparkle et dossier Chrome chargé restent inchangés. Le bundle produit porte `Sillage.app`. Aucun renommage du dépôt ou publication open source implicite.

## Écarts assumés avec le cahier (choix de Samuel, 26 octobre 2026)

Samuel a choisi de suivre la planche « Atelier de lumière » plutôt que le cahier sur trois points :
- barre latérale de la Bibliothèque à 34,5 % de la fenêtre (220 à 380 points) au lieu de 190 à 220 ;
- titre en lecture en orange Stoa sur graphite (4,44:1), toujours accompagné du haut-parleur ;
- (revenu le 26 octobre, à la demande de Samuel) la poche Compact garde ses onglets, en petite taille, avec Studio en icône ; ouvrir la Bibliothèque ou Découvrir agrandit la fenêtre à la taille de lecture. ⌘1, ⌘2 et ⌘3 restent disponibles.

## Découvrir comme la Bibliothèque (26 octobre 2026)

Même structure que la Bibliothèque : barre latérale (Pour toi, Récentes, Envies, Dans une playlist), recherche en haut, petit en-tête (tuile, titre, compte), puis les mêmes lignes `SongRow`. « Pour toi » liste les recommandations, la raison au survol et l’ajout à Mes découvertes en fin de ligne. Les résultats gardent la sélection cerclée d’orange et l’aperçu à droite quand la place le permet.

Fenêtre : ses limites sont celles du contenu (scène `.contentSize`). Compact s’élargit jusqu’à 620 et, panneau replié, garde exactement la hauteur de sa poche ; les pages de lecture se redimensionnent librement et retrouvent la taille choisie.
