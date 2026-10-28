# Découvrir — vérification de livraison, 25 octobre 2026

final result: passed

## Références et périmètre

App native installée : **1.5.1, build 28, c51e665**. Design de Claude intégré par 092536b (cherry-pick de 877ae5c, auteur conservé), ajustements 9701c4e et c51e665. Claude confirme l'intégration et a fermé sa version de développement.

Source visuelle : `/Users/samuel/.codex/generated_images/01a16ef6-6a8f-70d3-8b00-09d81055be3d/exec-b9b91710-81b2-4c22-b2ea-3641680b4140.png` (maquette 3, 1484 × 1060 pixels, densité non spécifiée).

Capture finale : `/Users/samuel/.codex/visualizations/2026/10/24/01a16ef6-6a8f-70d3-8b00-09d81055be3d/sillage-discover-qa/discover-build28.jpg` (2668 × 1620 pixels Retina, fenêtre native 1334 × 810 points). Pas de viewport CSS. Les deux images ont été ouvertes dans le même appel de comparaison ; lecture à échelle d'affichage comparable, sans mesure pixel à pixel. Leur rapport largeur/hauteur diffère : la capture réelle affiche moins de résultats YouTube au-dessus du défilement. Cette limite est explicitement distinguée d'un débordement.

État : compte connecté, Studio actif, recherche Masego dans les deux sources, chat avec deux propositions réelles, Tadow en lecture. Les vidéos, miniatures et textes sont les données réelles, pas les images illustratives de la maquette.

## Comparaison visuelle

- **Typographie** : titre Découvrir fortement hiérarchisé (42 points), police système native cohérente avec les autres pages, titres/artistes séparés. Le suffixe « | A COLORS SHOW » est conservé plutôt que pris à tort pour le titre principal. Les détails des cartes et actions sont lisibles dans la capture et confirmés par l'arbre d'accessibilité ; aucune comparaison de région supplémentaire nécessaire pour ces contrôles.
- **Disposition** : deux panneaux translucides, recherche et filtres alignés, résultats à gauche, chat à droite, lecteur persistant en bas. Le panneau du chat de 350 points reste repliable. Les lignes remplacent les anciennes grandes cartes verticales. Le nombre de résultats visibles varie avec la hauteur disponible et les données ; aucun contrôle persistant n'est masqué.
- **Couleurs** : accent vert pour les actions et les états enregistrés ; sélecteurs gris et bouton Studio global conformément à la passe de Claude décrite dans docs/design.md. C'est une évolution intentionnelle de la maquette aux sélecteurs verts, pas une reproduction pixel parfaite.
- **Images** : vidéo réelle en arrière-plan, miniatures YouTube 16:9, durée et artiste lisibles. Les panneaux atténuent le clip pour garder le texte lisible. Aucune fausse miniature générée ou illustration substituée.
- **Contenu** : sources clairement distinctes, actions Écouter / À suivre / Ajouter, statut « Dans ta bibliothèque ». La réponse de recherche propose réellement des cartes sans prétendre lancer un titre. La source du chat est indépendante de celle de la recherche principale.

## Historique des corrections

1. Première implémentation : panneau gauche trop étroit, cartes trop verticales, faible ressemblance avec la maquette. Capture `sillage-discover-qa/discover-mixed.png`. Résultat bloqué.
2. Intégration du design de Claude, largeur initiale Découvrir 1180 points et minimum 900, titre 42, miniatures 140 ; capture `sillage-discover-qa/discover-1.5.1.png`. Structure rétablie. Restent actions cachées au survol, préparation invisible dans le mini-lecteur et mauvais découpage de certains titres.
3. c51e665 : actions persistantes, état de préparation/erreur dans le mini-lecteur, statut enregistré vert, découpage corrigé et fond vidéo explicitement étendu. Capture finale build28 ci-dessus. Aucun écart P0/P1/P2 restant dans le périmètre comparé au design commun actualisé.

## Vérifications réelles

- Joue Billie Jean puis Self Care : lecture immédiate et ordre demandé.
- Mets Disfruto maintenant sur YouTube : remplacement immédiat, vidéo officielle vérifiée.
- Ajoute Billie Jean puis Self Care à la suite sans couper : morceau courant conservé, deux titres ordonnés.
- Fin de Palpal : Trop beau démarre automatiquement ; « suivant » dans le chat lance 1000°C avec annonce Gemini.
- Build28 : Mystery Lady en cours ; Tadow déplacé devant Navajo par le menu, lecture courante inchangée ; Suivant lance Tadow et le chat affiche son annonce.
- Recherche mixte Masego : huit correspondances de bibliothèque et résultats YouTube. Demande de deux propositions dans le chat : deux cartes, Tadow continue (position 0:22 puis 0:31).
- Ajout réel depuis Découvrir et le chat, puis réajout : appartenance privée et déduplication vérifiées. Filtre Mes découvertes et pagination YouTube vérifiés.
- Build28 : déconnexion puis reconnexion Google sur le compte existant ; bibliothèque et clé conservées, aucune nouvelle saisie de clé.
- Build28 : Réglages → Tester le DJ et la voix : « Le DJ et la voix Gemini répondent avec cette clé. » Capture `sillage-discover-qa/gemini-build28.jpg`.
- Mauvaise clé de test refusée sans remplacer la clé enregistrée. Le nouvel onboarding conserve sa troisième étape après validation de la clé.
- Karaoké de Claude conservé ; paroles réelles Billie Jean vérifiées sur le parcours précédent.

## Validation technique et limites

83 tests unitaires Node (34 cœur + 49 serveur), TypeScript et build extension ; PostgreSQL : 63 réussis, un ignoré préexistant ; contrôles natifs : session de lecture, composition sur 240 titres sans boucle, cache, voix anticipée, paroles, neuf titres et cinq régressions de cycle micro. Ces derniers ne constituent pas une capture matérielle du microphone.

Serveur : `/health` sert 2d43a30dbd4831de54e52073827d07ccf5280d3b, dernier changement serveur. Les commits suivants concernent l'app native. Jobs Self Care créés à 10:25:27 UTC, texte terminé à 10:25:28 et image à 10:25:29 : progression réelle du worker.

Pas de nouveau compte Google créé pendant cette passe : isolation des comptes et nouveaux parcours couverts par les tests d'intégration, reconnexion réelle sur le compte existant. Pas de nouvelle validation exhaustive VoiceOver, Réduire les animations ou de distribution Apple notarialisée. Pas de promesse sur tous les contenus YouTube ou toutes les limites du fournisseur.

## Liste de livraison

- [x] Design commun Claude et Découvrir intégrés.
- [x] Intention de lecture indépendante de la source.
- [x] Lecture immédiate, ajout, recherche, Next et fin automatique vérifiés.
- [x] Réorganisation réelle sans interruption.
- [x] Google et test Gemini vérifiés dans la build installée.
- [x] Captures et limites consignées.
