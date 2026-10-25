# Design de l’app Mac

Référence commune pour toute nouvelle vue Mac, Découvrir comprise. Plan validé par Samuel le 25 octobre 2026. Une app propre et moderne : mêmes composants partout, peu de texte, et des écrans qui s’enchaînent sans rupture.

## Principes

- **Un seul modèle de morceau.** Bibliothèque, À suivre, Historique et les résultats de Découvrir montrent la même ligne. On reconnaît un morceau au premier coup d’œil, où qu’il soit.
- **Le titre, pas le nom de fichier.** On affiche « Beds Are Burning » et « Midnight Oil », jamais « Midnight Oil - Beds Are Burning » au-dessus de « MidnightOilVEVO ». Le découpage artiste et titre suit les mêmes règles que les paroles côté serveur (`lyrics.ts`).
- **Une action principale par écran.** Les explications longues vont dans l’aide au survol (`.help`), pas sous chaque champ.
- **Le mouvement montre ce qui change** : un nouveau morceau, un changement de mode ou d’onglet. Pas d’animation décorative. Avec « Réduire les animations », tout passe en fondu court ou sans animation.
- **Une seule scène, deux profondeurs.** L’app est sombre dans les deux modes. Toutes les pages reposent sur la même scène, sous une barre d’outils transparente : en Studio, le clip (atténué hors de la page DJ) ; en Compact, la pochette floutée du morceau. Les panneaux partagent `glassPanel`, avec deux contextes définis dans `Surfaces.swift` : `.immersive` pour le DJ, `.reading` pour Bibliothèque et Découvrir (chat et mini-lecteur compris). En lecture, fond sombre à 86 % et clip atténué à 55 % ; avec Réduire la transparence, panneaux opaques et aucun clip visible derrière les pages de lecture. Le DJ Studio garde son clip net.
- **Le vert est une action, pas une décoration.** `Color.recall` sert au bouton de lecture, à la progression, à la ligne chantée et aux boutons principaux. Les bascules (Studio, Voix du DJ, Enchaîner), les suggestions et les sélecteurs segmentés restent neutres : blanc quand actif, gris sinon (`GlassToggleStyle`, `ToolbarToggleStyle`, `neutralSelection`).

## Repères

| Élément | Valeur |
|---|---|
| Espacements | 4, 8, 12, 16, 24, 32 |
| Rayons | 6 (miniature de ligne), 10 (lecteur, cartes), 20 (panneaux flottants) |
| Titre Studio | 40 gras, deux lignes au plus |
| Titre d’écran | `.largeTitle` gras (Bibliothèque, Réglages) |
| Titre de section | `.headline`, en casse de phrase : « En cours », « À suivre (3) » |
| Corps | `.body` ; secondaire en `.callout` ou `.caption` avec `.secondary` |
| Accent | `Color.recall` : bouton principal, ligne chantée, état actif |

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

## Enchaînements

- **Accueil** : trois écrans qui glissent dans une feuille de taille fixe, avec trois points de progression en haut.
  1. Compte Google : « Continuer avec Google ».
  2. Clé Gemini : un champ et « Activer mon DJ » ; le lien « Obtenir ma clé » ouvre AI Studio.
  3. Première playlist : un champ pour coller le lien et « Importer ». À la fin, on arrive dans la Bibliothèque, où l’import progresse.

  Une étape déjà faite est sautée. « Plus tard » reste discret en bas. Les erreurs s’affichent sous le champ concerné.
- **Bibliothèque → DJ** : lire un morceau bascule sur DJ. Le titre arrive avec l’animation NowPlaying, la file s’ouvre sur « À suivre ».
- **Compact ⇄ Studio** : bouton « Studio » sobre dans la barre d’outils, visible sur toutes les pages. Fondu de 300 ms entre les scènes pendant que la fenêtre s’anime à sa nouvelle largeur ; l’onglet courant ne change pas.
- **Onglets du panneau** (DJ, À suivre, Historique, Paroles) : fondu court. Chaque onglet garde sa position de défilement.
- **À suivre** : réordonner en glissant les lignes (`onMove`), et retirer au balayage ou par le menu « ⋯ ». La ligne « Ensuite : … » sous le lecteur disparaît, puisque l’onglet fait le même travail.
- **Réglages** : quatre sections courtes (Compte, DJ, Voix, Studio). Une phrase au plus par section ; le reste passe en aide au survol.

## Vérification

Chaque écran est vérifié en Compact et en Studio, clair et sombre, avec « Réduire les animations », au clavier et avec VoiceOver. Les captures avant et après sont jointes à l’intégration.
