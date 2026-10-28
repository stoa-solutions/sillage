# Sillage — revue des agents DJ, 28 octobre 2026

Revue du serveur et de l’interface Mac, avec deux lectures indépendantes : Standards et Spec. Comparaison autorisée par Samuel depuis `0d305706040f92eaf59207e010986ee3a5bbabc1`, état de main avant les agents, jusqu’à `121d18d96a8fd80d0c268fc5cefec910fbd30ed0`. Les modifications Mac initialement non commitées ont été intégrées par Claude pendant la revue ; les fichiers testés correspondent à cette version finale. Aucun correctif produit appliqué par cette revue.

Références : AGENTS.md, docs/architecture.md, docs/accounts.md, docs/macos.md, docs/server-tour.md, docs/dj-behavior.md et GLOSSARY.md. Pas de ticket produit indépendant retrouvé : l’axe Spec évalue les engagements documentés dans cette branche.

## Standards

### P1 — Une réponse tardive réaffiche les agents privés du compte précédent

**Emplacement :** `apps/macos/Sources/SillageMac/DJAgentsModel.swift:41–45`, et les mutations après attente des opérations CRUD, lignes 53–89.

`reset()` vide les agents, mais n’annule ni n’invalide les requêtes. Une liste demandée avec le compte A peut terminer après le passage au compte B et remplacer `agents` par les noms et instructions privés de A. Les autres modèles utilisent déjà la génération de session. Cela enfreint l’isolation des comptes décrite dans `docs/architecture.md:7` et les attentes de tests sur réponses tardives, ligne 132. Il s’agit d’une fuite d’état dans l’interface, pas d’un contournement des filtres SQL.

**Reproduction déterministe :** exécution du véritable DJAgentsModel avec une frontière HTTP simulée et une continuation contrôlée : démarrer load sous A, basculer B et appeler reset, puis terminer la réponse A. Résultat : zéro agent après reset, puis `Agent A: Private A instructions` réapparaît sous B. La sonde échoue comme attendu. Données entièrement synthétiques.

**Correction :** capturer la génération de session au départ ; vérifier sa validité après chaque attente avant toute modification d’état ou d’erreur, et invalider les opérations au reset. Couvrir load, create, update et delete.

Pas d’autre violation non déjà couverte par les outils, ni de mauvaise abstraction suffisamment établie pour devenir un finding.

## Spec

### P2 — La limite de 20 agents peut être dépassée par des créations simultanées

**Emplacement :** `apps/server/src/modules/dj-agents/dj-agents.service.ts:65–68`.

`docs/server-tour.md:111` annonce 20 agents personnels maximum. Le comptage précède une insertion indépendante : plusieurs requêtes observent la même place libre. Le test existant ne couvre que des créations séquentielles.

**Reproduction HTTP et PostgreSQL réels :** dans une base jetable, créer 19 agents puis lancer huit POST simultanés pour le même compte synthétique. Réponses : trois HTTP 200 et cinq HTTP 409 ; **22 agents conservés**, au lieu de 20. Le contrôle `finalCount <= 20` échoue.

**Correction :** sérialiser le comptage et l’insertion par compte, dans une transaction avec verrou adéquat. Une transaction sans sérialisation ne suffit pas. Ajouter le scénario concurrent à la suite d’intégration.

### P2 — La liste des profils ne permet pas de parcourir tous les agents autorisés

**Emplacement :** `apps/macos/Sources/SillageMac/DJAgentsViews.swift:109–129` ; `SettingsView.swift:85`.

La colonne est un VStack non défilant dans une fenêtre de 850 × 750. Quatre profils de base et vingt profils personnels, les titres et le bouton de création dépassent la hauteur disponible. Les profils inférieurs deviennent hors cadre ou comprimés. Cela compromet l’administration de la capacité annoncée.

**Validation :** inspection de la hiérarchie complète, sans ScrollView englobant. Ce problème visuel n’a pas été reproduit dans l’app installée : la revue n’a pas modifié la bibliothèque ni ouvert une autre instance.

**Correction :** rendre cette liste défilante, avec une hauteur bornée et une sélection visible. Vérifier vingt profils, le dernier et le bouton de création au clavier et à la souris.

## Validation et limites

- `npm run verify:node` : réussi, dont 333 tests serveur ; contrôles de types, frontières, documentation générée et build réussis.
- `npm run test:integration` : 123 réussis, 6 ignorés, sur PostgreSQL 17 avec pgvector, dans une base jetable nommée `sillage_agents_review_test`.
- `npm run verify:macos` : packaging, compilation et suites natives réussis, y compris les nouveaux contrôles d’agent sélectionné et de repli.
- Deux sondes supplémentaires échouent et établissent les défauts de concurrence et de réponse tardive ci-dessus.
- Filtres de propriété serveur, profils de base en lecture seule et repli vers le profil par défaut vérifiés. Les profils complètent les règles du DJ sans remplacer les validations de source, de quantité et de candidats.
- Pas d’appel payant à un modèle, pas d’essai avec des identifiants réels, pas d’installation ou de déploiement durant cette revue. Un build vert n’est pas une preuve du parcours complet en production.

Preuves conservées dans Obsidian : `10 Produits/Sillage/Ouverture/Sources/dj-agents-review-2026-10-28/` (journaux, empreintes de l’instantané et sondes synthétiques).

**Bilan : Standards — 1 finding, gravité maximale P1 ; Spec — 2 findings, gravité maximale P2.**

## Suite donnée (Claude, 28 octobre)

- **P1 — réponse tardive** : `DJAgentsModel` porte une génération incrémentée par `reset()` ; chargement, création, modification et suppression ne touchent la liste ou l’erreur que si la génération n’a pas changé pendant l’appel. Pas de test automatique : le modèle vit dans la cible app, hors des suites natives.
- **P2 — 20 agents en concurrence** : `insertAgentWithin` verrouille la ligne du compte (`SELECT … FOR UPDATE`) avant de compter puis d’insérer, dans une transaction. Le scénario de la revue (19 agents puis 8 POST simultanés) est dans `dj-agents.integration.test.ts` : il échouait sur l’ancien code (3 créations acceptées) et passe (1 acceptée, 20 au total).
- **P2 — liste non défilante** : la colonne des agents défile, le bouton « Nouvel agent » reste visible et la sélection est ramenée à l’écran.
