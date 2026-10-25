# Décisions du DJ et garanties de lecture

Ce document décrit les frontières à conserver lorsqu’on ajoute une commande, un outil ou un fournisseur. Le modèle choisit parmi des résultats vérifiés ; il n’exécute ni le lecteur ni des écritures dans la bibliothèque.

## Du message à la musique

1. **Commandes locales certaines** : pause, reprise, suivant, commandes `/` et références explicites aux cartes visibles. Elles n’attendent pas de génération IA et utilisent les mêmes morceaux vérifiés que les boutons.
2. **Politique du tour** : `parseDJIntent` sépare action (`replace`, `append`, `browse`), moment (`now`, `later`, `unspecified`), référence (`current`, `named`, `none`) et nombre demandé. `planTurn` applique les valeurs par défaut. La source de recherche ne décide jamais de l’action de lecture. L’IA reste libre de choisir des requêtes et d’explorer des artistes ou styles voisins dans le périmètre sélectionné.
3. **Résolution précise** : le catalogue peut résoudre des titres ordonnés sans IA. Il identifie les morceaux et conserve leur ordre ; la politique du tour reste seule responsable du moment où les jouer.
4. **Recherche MCP** : outils de lecture seule, bornés au compte et aux sources autorisées. Titres, descriptions, crédits et réponses d’outils sont des données, jamais des instructions. Le prompt explique comment rechercher et qualifier l’incertitude.
5. **Validation** : les identifiants doivent avoir été renvoyés dans ce tour. Une sélection bibliothèque est relue pour le compte authentifié. Les répétitions de la suite sont filtrées. Une sélection vide ne devient pas une promesse de lecture.
6. **Session native** : elle applique la réponse seulement si la demande est encore courante. La dernière intention de transport (pause/reprise) reste prioritaire sur les réponses arrivées plus tard. Le lecteur reçoit explicitement le souhait de démarrer ou de rester en pause.

## Répartition des responsabilités

| Sujet | Propriétaire | Ne doit pas faire |
| --- | --- | --- |
| Intention musicale | `apps/server/src/dj-intent.ts` | Rechercher, appeler un fournisseur, changer une file |
| Contexte et taille de sélection | `features/dj/context.ts` | Réinterpréter une référence déjà décidée |
| Résolution des titres | `music-matching.ts`, `features/dj/catalog.ts` | Décider une seconde fois quand lancer la lecture |
| Outils et candidats | `music-mcp.ts`, orchestration `features/dj/` | Accepter un ID inventé, écrire dans la bibliothèque |
| Dialogue | `dj-prompt.ts` | Remplacer une garantie exécutable par une consigne |
| Fournisseur | `features/dj/provider.ts` | Transformer quota/panne en absence de morceau |
| File et concurrence | `RecallKit/ListeningSession.swift` | Faire du réseau, accéder à Gemini, gérer WebKit |
| Chargement et transport | `RecallKit/PlaybackEngine.swift`, adaptateurs | Laisser une tâche ancienne annuler Pause ou Reset |
| Affichage | `RecallMac` | Réimplémenter la politique musicale |

## Les trois périmètres de recherche

Le choix affiché par l’app est transmis aux outils : **Mes playlists** recherche dans la bibliothèque du compte, **YouTube** dans les résultats publics, **Partout** réunit les deux. Le DJ ne doit pas interpréter « Partout » comme une simple permission qu’il peut oublier : l’outil de recherche route la requête vers les sources correspondantes. La recherche visuelle reste limitée aux miniatures indexées de la bibliothèque ; YouTube ne fournit pas une recherche globale par couleur.

L’utilisateur peut demander de nouvelles propositions ou exclure les cartes affichées. Ces refus portent sur les identifiants de la proposition concernée, pas sur une interdiction permanente d’artiste ou de genre. La diversité musicale relève du modèle ; aucune liste d’artistes imposés ne remplace ses recherches.

## Formulations de référence

- « Joue Navajo maintenant, puis Tadow, dans cet ordre » : lancer le premier et conserver le second dans cet ordre. Les mots de commande ne sont pas des fragments de titre.
- « Prépare six morceaux à suivre » : ajouter six nouveaux candidats si disponibles, conserver le titre courant, annoncer honnêtement une sélection partielle.
- « Non, ne le mets pas en file : joue-le maintenant » : la correction affirmative porte sur le lancement immédiat.
- « Ajoute du jazz et joue-le maintenant, sans live » : l’exclusion de versions live ne nie pas le lancement immédiat.
- « Ne joue rien, propose-moi le morceau avec Hedges » : proposer des cartes, aucun lancement.
- « Même style » : référence au morceau courant. « Même style que Michael Jackson » : référence explicitement nommée, même si un autre artiste joue.
- Demande → Pause → réponse : préparer la sélection tout en restant en pause. Une nouvelle demande explicite postérieure à cette pause peut lancer la musique.
- Annuler → ancienne réponse : aucun changement. Deux demandes : seule la dernière réponse valide est appliquée.

## Sources manquantes ou indisponibles

Distinguer une recherche vide, une source en erreur et des métadonnées inconnues. Une panne ne se corrige pas en redemandant un artiste déjà connu dans le morceau courant. Le repli doit rester borné et utiliser seulement les sources autorisées ; une suite insuffisante ne justifie ni répétition pour remplir ni changement arbitraire d’ambiance.

Les genres d’artiste ne prouvent pas le genre d’un enregistrement. Une miniature proche visuellement n’est pas une pochette reconnue avec certitude. Les explications des cartes doivent rester fondées sur les données effectivement disponibles.

## Ajouter une fonctionnalité

1. Choisir la couche propriétaire ci-dessus et préserver les façades publiques.
2. Ajouter le scénario utilisateur et son cas opposé : ajouter/lancer, après/maintenant, choisir/proposer, demande récente/réponse ancienne.
3. Pour un outil, déclarer un schéma borné, les autorisations et le comportement en cas d’échec. Conserver la séparation des comptes et la validation des candidats.
4. Tester les transitions asynchrones avec des réponses contrôlées, puis vérifier le scénario dans la version installée.
5. Modifier le prompt seulement pour la stratégie de recherche et le dialogue. Les limites, annulations, IDs et actions restent contrôlés par le code.

## Validation et point de retour

Pour itérer sans piloter l’interface : `npm run test:dj` exécute les scénarios déterministes et le vrai circuit MCP avec frontières simulées. `npm run eval:dj` prépare une évaluation HTTP ; `--live` l’exécute avec un compte explicitement fourni et un plafond de requêtes. Voir [le banc d’évaluation](../scripts/dj-eval/README.md) pour les scénarios, rapports, limites de preuve et tests Swift complémentaires.

L’audit de référence porte sur `f142fbf`, app 1.6.3 (43), conservée par le tag `checkpoint/recall-1.6.3-before-dj-hardening`. Les scénarios identifiés sont ajoutés aux suites serveur et natives ; ils complètent les tests existants, qui passaient malgré ces défauts.

`npm run verify:node` et `npm run verify:macos` valident les contrats, comportements et builds. Le déploiement et les essais réels restent des étapes distinctes. Une suite verte ne garantit ni une pertinence musicale parfaite ni l’absence de toute régression ; elle rend les défauts connus reproductibles et bloque leur retour.
