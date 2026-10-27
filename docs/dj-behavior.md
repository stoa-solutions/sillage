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
| Intention musicale | `packages/core/src/intent.ts` | Rechercher, appeler un fournisseur, changer une file |
| Plan et taille de sélection | `modules/dj/plan.ts` | Réinterpréter une référence déjà décidée |
| Issue d’une réponse | `modules/dj/decision.ts` | Transformer une question en échec de lecture |
| Un Tour à la fois | `modules/dj/dj-lease.ts` | Refuser une demande tapée parce qu’une suite tourne |
| Résolution des titres | `modules/search/music-matching.ts`, `modules/dj/catalog.ts` | Décider une seconde fois quand lancer la lecture |
| Outils et candidats | `modules/mcp/`, orchestration `modules/dj/` | Accepter un ID inventé, écrire dans la bibliothèque |
| Dialogue | `modules/dj/prompt.ts` | Remplacer une garantie exécutable par une consigne |
| Fournisseur | `modules/dj/provider.ts` | Transformer quota/panne en absence de morceau |
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

## Agents

Un agent choisi par la personne ajoute un profil après les règles du DJ et avant celles du Tour. Il règle le ton et les préférences de sélection ; l’intention, la source, la taille demandée, les exclusions et la validation des identifiants restent décidées comme sans agent. L’annonce de la file reste écrite par le serveur. Voir `apps/server/src/modules/dj-agents/` et la [visite du serveur](server-tour.md).

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


## Recherche et composition depuis l’audit du journal du 26 octobre

Une carte blanche explicite (« mets ce que tu veux », « surprends-moi ») démarre une nouvelle direction. Les anciennes envies et anciens échecs ne sont pas réinjectés comme contraintes. Les restrictions de la demande actuelle, la source choisie et les exclusions restent applicables.

Le tour utilise ces modules aux responsabilités distinctes :

| Module | Responsabilité |
| --- | --- |
| `core/intent.ts` + `modules/dj/plan.ts` | Lire l’intention une fois, fixer la source, la référence et la taille. « Sans le lancer » retire l’opération interdite avant de chercher une action affirmative. |
| `modules/mcp/mcp.retrieval.ts` + `mcp.service.ts` | Transformer les indices structurés en recherches indépendantes, conserver compte et exclusions, entrelacer les résultats et transmettre les erreurs partielles. |
| `modules/dj/composition.ts` | Accumuler les candidats du tour, valider le choix, conserver la meilleure sélection partielle et construire le contexte final. Aucun réseau ni SQL. |
| `modules/dj/decision.ts` | Seul endroit où la réponse du modèle devient une issue : réponse, cartes, lecture, rien, relance unique ou échec. Une question reste une réponse quelle que soit l’intention prévue ; chaque issue a une raison écrite au journal (événement `decision`). |
| `modules/dj/dj-turn.service.ts` + `reply.ts` | Orchestrer les appels, relire l’appartenance avant lecture et annoncer l’action réellement renvoyée. Les cartes proposées sont toutes nommées ; une identification sourcée garde les mots du DJ. |

`music_search` reste compatible avec `query` seul. Deux champs optionnels rendent les indices moins ambigus : `artist` porte une identité connue, distincte des mots de style dans `query` ; `alternatives` contient au plus deux autres indices courts. Exemple : `{query:"sean rap français", artist:"sean"}` effectue un lookup sur `sean`, puis classe les résultats selon la requête complète. Les autres indices sont exécutés indépendamment, en parallèle, et non comme une liste de mots tous obligatoires. La recherche reste limitée aux mêmes sources et au même compte. `mode=image` garde sa requête visuelle unique ; ces indices ne sont pas des filtres visuels. Les formats manifestement non musicaux sont écartés des suggestions d’ambiance, sans exclure un morceau parce que ses métadonnées sont inconnues ; une demande explicite de tutoriel reste possible.

Les résultats de toutes les recherches du tour restent dans la composition. Le budget reste de cinq appels au modèle et huit appels d’outils au maximum. Le dernier appel est réservé à la sélection : il reçoit un échange neuf avec la demande, la référence actuelle, les candidats accumulés, les sources et la sélection partielle éventuelle, sans ancienne conversation d’outils susceptible d’inciter à chercher encore. Un événement `compose_final` permet de retrouver cette phase dans le journal.

Si le modèle ne conclut toujours pas, une sélection déjà validée est conservée avec son opération initiale. Sans sélection validée, les candidats restent des cartes à choisir : ils ne deviennent pas arbitrairement une file de lecture. Si aucun candidat n’existe, le DJ indique la limite observée. Une annulation reste prioritaire sur toute récupération.

Le JSON interne du modèle accepte `explanation`, facultatif : une phrase sur le rapprochement musical, sans promesse de transport ni de quantité. L’annonce déterministe précise d’abord les titres et l’action validés, puis cette explication est conservée. `reply` reste utilisé pour les informations et conversations ordinaires. Le contrat HTTP final et les clients existants restent compatibles ; aucun nouveau build Mac n’est nécessaire pour ce changement serveur.

Validation : tests de la négation avec pronoms, clôture après recherches répétées, maintien de choix immédiat/ajout, taille/ordre/exclusions, cartes au lieu d’un faux vide, artiste séparé du genre, résultats parallèles partiels et tutoriels. La simulation Postman fait traverser un vrai échange HTTP → modèle → MCP → PostgreSQL → sélection finale. Elle vérifie l’orchestration, pas le goût musical d’un vrai modèle ; la cohérence d’une suite reste à juger sur les réponses réelles et à l’écoute.
