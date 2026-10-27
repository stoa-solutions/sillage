# Tester le DJ sans interface

## Boucle rapide, sans compte ni quota

Depuis la racine :

```sh
npm run test:dj
```

La suite couvre la politique des intentions, la sélection, les trois sources, les exclusions, les outils et les erreurs. `dj-agent-behavior.test.ts` traverse réellement `djTurn` et le SDK MCP en mémoire. Seules les frontières SQL, recherche, YouTube et HTTP fournisseur sont simulées. Elle vérifie notamment les appels aux sources, les identifiants transmis au modèle et les opérations retournées. Elle ne mesure pas la compréhension d’un vrai modèle Gemini.

Le transport natif possède sa propre suite sans UI :

```sh
npm run verify:macos
```

Elle exécute le cœur Swift : file, pause/reprise pendant une requête, annulation, réponse ancienne, préparation de suite et cache. Une requête HTTP au DJ ne remplace pas ces tests : pause, play, next et certaines références aux cartes sont interceptés dans l’app avant l’API.

## Vraies réponses du serveur et du modèle

Prévisualiser les cas sans réseau ni lecture de session :

```sh
npm run eval:dj
npm run eval:dj -- --suite external
```

Exécuter trois requêtes sur un compte de test avec un export privé `{ "url": "https://…", "token": "…" }` :

```sh
npm run eval:dj -- --live --connection-file /chemin/prive/connexion.json --max-requests 3
```

Le format `Session/session.json` de l’app est aussi accepté. Ce chemin est explicite : le script ne cherche pas de session tout seul. Alternative : `RECALL_API_URL` et `RECALL_API_TOKEN` dans l’environnement. Ne jamais committer un jeton ni le passer en argument. Les clés Gemini/YouTube restent sur le serveur.

Un seul cas après une correction :

```sh
npm run eval:dj -- --live --connection-file /chemin/prive/connexion.json --case library-order --max-requests 1
```

Le script appelle exactement `POST /v1/dj/chat`, comme l’app. Il conserve le contexte de chaque conversation, simule les effets de la réponse sur une file privée en mémoire, contrôle action/nombre/ordre/exclusions et écrit un rapport JSON + HTML dans `output/dj-eval/`. Il ne lance aucun son, n’importe rien et ne modifie aucune playlist. Les requêtes consomment cependant les quotas IA et YouTube ; chaque requête de chat peut provoquer plusieurs appels de modèle et d’outil. `--max-requests` plafonne les tours HTTP, pas les appels internes. Les scénarios sont séquentiels, sans réessai automatique.

Le lot `smoke` reste dans la bibliothèque et contient des titres du compte de Samuel. Pour un autre compte, fournir un fichier `--scenarios` avec ses propres titres et attentes. Le lot `external` consomme des recherches YouTube : ne pas le lancer lorsque Google a déjà signalé son quota quotidien. Les métriques `pass`, `fail`, `blocked`, `not_run` restent distinctes. Un quota connu bloque le scénario ; il n’est jamais compté comme une réussite.

Les rapports enregistrent le SHA serveur avant/après, le modèle, la durée, la réponse filtrée et les assertions. Un changement de version pendant l’exécution invalide la comparaison. Aucun en-tête, jeton, clé, prompt système ou signature de raisonnement n’est exporté. Les fichiers sont privés (`0600`) et ignorés par Git. Ce rapport n’embarque pas les outils internes. Ils sont désormais consultables séparément dans le Journal DJ (`GET /v1/dj/conversations`, puis tours et événements), avec les mêmes droits du compte. Les tests MCP déterministes et la simulation HTTP contrôlent séparément leur routage.

## Ajouter un cas et corriger une régression

1. Copier la formulation utilisateur exacte dans `scenarios.json` ou un fichier privé.
2. Définir le périmètre, le morceau courant, les IDs déjà en file et l’action attendue.
3. Pour un second tour « d’autres sauf ceux-là », utiliser `rejectPrevious: true` ; les cartes et l’historique du premier tour alimentent la requête suivante.
4. Exécuter le cas réel une fois, examiner réponse et écart. Ne pas modifier l’attente pour masquer un bug.
5. Reproduire le défaut dans les tests déterministes de la couche responsable, puis corriger le code ou le prompt.
6. Relancer la suite rapide, déployer la version testée et répéter seulement le cas réel concerné.

Codes de sortie : `0` toutes les assertions passent ; `1` écart de comportement ; `2` blocage, préparation invalide ou serveur changé. La pertinence musicale et la fluidité audio restent à juger séparément : cinq IDs valides ne prouvent pas une bonne sélection.


Le lot `--suite agents` rejoue trois contrats avec un agent de base (`agentId` du scénario) : Disquaire sur une envie d’énergie, Focus avec « sans le lancer », Archiviste en carte blanche. Il vérifie qu’un profil ne change ni l’action ni la taille ; le ton se lit dans le rapport.

Le lot `--suite journal-regressions` rejoue les quatre formulations issues du journal : énergie, carte blanche après une ancienne direction, « sans le lancer » et suite autour de Sean. Prévisualiser avant `--live` ; le lot consomme quatre tours HTTP et peut interroger YouTube. Les assertions contrôlent action, taille et exclusions ; une sélection de cinq titres ne prouve pas à elle seule la cohérence musicale.
