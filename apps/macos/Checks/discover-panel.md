# Repli du panneau Découvrir

Périmètre confirmé par la personne le 26 octobre 2026 : « Découvrir → replier le panneau → le rouvrir, puis changer d’onglet et revenir, en conservant la recherche et la lecture ».

## Comportement attendu

- Replier retire le panneau de conversation, libère sa largeur et laisse une commande explicite pour le rouvrir.
- Rouvrir retrouve le panneau existant. Sa sélection d’onglet et sa saisie restent en mémoire tant que Découvrir est affiché.
- Rechercher puis naviguer entre Bibliothèque, DJ et Découvrir conserve la recherche et l’état de repli partagé avec DJ.
- Le titre sélectionné et l’état lecture/pause ne changent pas pendant ce parcours.

## Contrôle dans l’application installée

`discover-panel.mjs` utilise uniquement les méthodes publiques de Computer Use. Il s’importe dans le REPL Computer Use, puis reçoit l’app liée par `cua.getApp`. Sans musique sélectionnée, appeler `verifyDiscoverPanel(app)`. Sinon fournir `nowPlaying` avec le titre et l’artiste tels qu’ils sont visibles dans le mini-lecteur.

Le test saisit « Mac Miller » sans envoyer de message au DJ ni lancer de morceau. Il vérifie le repli, la réouverture, les changements de page, la recherche et le lecteur, puis restaure la recherche et l’état initial de repli. Le rappel facultatif `record(name, ax, png)` conserve les preuves dans un dossier privé : les captures peuvent contenir des conversations personnelles et ne doivent pas être commitées.

Ce contrôle nécessite une session graphique sans interaction concurrente ; il ne fait pas partie de `verify:macos`, qui compile l’app et exécute les tests natifs hors interface. Vérifier aussi visuellement la place libérée, la lisibilité du bouton et le retour de l’onglet du panneau après réouverture.

Régression reproduite sur Sillage 1.7.6 (55) : le test échoue avec `Discover still shows the panel after Collapse`. L’état partagé de repli changeait, mais la présentation `panelOnly` affichait toujours le panneau et son cadre fixe.
