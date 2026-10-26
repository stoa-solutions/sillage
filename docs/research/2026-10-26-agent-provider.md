# Fournisseur IA et comportement du DJ

Recherche Exa du 26 octobre 2026 : 30 résultats demandés selon trois axes — interfaces multi-fournisseurs, compatibilité des appels d’outils, retours de développeurs. Les résultats ont été recoupés avec les documentations et un pilote local. Les témoignages ne constituent pas un benchmark.

## Décision proposée

Retenir **Vercel AI SDK avec le connecteur Google direct** pour la prochaine migration de transport. Aucun compte Vercel, passerelle hébergée ou remplacement des clés personnelles n’est nécessaire. Garder le contrat HTTP de l’app et les outils métier actuels. Ne pas remplacer tout l’agent par un framework.

Le code actuel n’emploie pas le SDK Gemini : `features/dj/provider.ts` envoie déjà des requêtes Chat Completions compatibles OpenAI. Une interface commune existe donc, mais nous entretenons nous-mêmes les enveloppes, signatures spécifiques, tours d’outils, annulations et erreurs. Un SDK maintenu réduit cette charge ; il ne corrige pas à lui seul le choix d’une action ou une recherche trop stricte.

| Option | Intérêt pour Sillage | Décision |
| --- | --- | --- |
| AI SDK + `@ai-sdk/google` | TypeScript, outils validés avec Zod, boucle multi-étapes, réponses structurées, annulation, fournisseurs interchangeables. Appel Google natif avec la clé du compte. | Premier choix pour un pilote puis une migration isolée. |
| LiteLLM | Normalisation et routage entre fournisseurs, compatible Chat Completions ; utile comme passerelle commune à plusieurs produits. | Ajouterait ici un service Python et son exploitation ; pas nécessaire pour ce seul serveur Node. |
| LangChain / LangGraph | Modèles interchangeables, outils et graphes d’exécution persistants plus complexes. | À reconsidérer si des workflows durables deviennent nécessaires. Plus de concepts que le besoin actuel. |
| Adaptateur HTTP actuel | Petit, connu, déjà couvert par des tests ; aucune nouvelle dépendance. | Conservé en production pendant la qualification du SDK. |

Sources techniques : [outils et boucle AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [connecteur Google](https://ai-sdk.dev/providers/ai-sdk-providers/google), [annulation et relances](https://ai-sdk.dev/docs/ai-sdk-core/settings), [LiteLLM Gemini](https://docs.litellm.ai/docs/providers/gemini), [modèles et outils LangChain](https://docs.langchain.com/oss/javascript/langchain/models).

## Ce que la recherche explique dans nos bugs

Le premier appel imposait `tool_choice=required`. Même un simple « voilà, c’est ça » devait donc appeler un outil. Ensuite la boucle remplaçait toute réponse sans sélection par le message générique « aucune sélection compatible ». Ces deux décisions contredisaient déjà le prompt qui autorisait la conversation ordinaire.

Le transport utilise maintenant `auto`. Le modèle distingue `kind=conversation`, `music` ou `information`. Une conversation sans opération garde sa réponse et laisse la lecture intacte ; une sélection musicale doit toujours référencer des résultats vérifiés. Une conclusion musicale sans aucune recherche reçoit un seul rappel, puis échoue explicitement plutôt que de tourner cinq fois. Les métadonnées des cartes récentes sont relues pour le compte courant, même si le titre est exclu d’une continuation parce qu’il joue déjà.

Les petites fautes ont également un chemin lexical borné, avant le recours aux vecteurs. Il reconnaît une insertion, suppression, substitution ou inversion adjacente et les apostrophes de crédits comme M’Dee. Aucun nom d’artiste n’est codé en dur. Les mêmes filtres de compte, playlist, disponibilité et exclusions s’appliquent. Cela améliore le rappel ; ce n’est pas un moteur phonétique universel.

La documentation [Google function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling) distingue le choix automatique des appels imposés. Le [signalement AI SDK #6589](https://github.com/vercel/ai/issues/6589) montre une incompatibilité réelle liée aux signatures Google, corrigée dans le connecteur. Ce cas ancien explique l’intérêt d’un adaptateur maintenu et de tests de contrat, sans prouver qu’un SDK est exempt de régressions. La [discussion Hacker News](https://news.ycombinator.com/item?id=43580012) apporte des retours d’usage sur Zod et la complexité des frameworks ; elle reste anecdotique.

## Pilote reproductible

Dans `pilots/ai-sdk-provider`, `ai@7.0.153` et `@ai-sdk/google@4.0.105` sont épinglés dans un paquet indépendant, hors des dépendances de production. Ces versions ont été vérifiées sur le registre npm lors de l’essai. Le serveur utilise Node 24, compatible avec le minimum Node 22 du connecteur testé.

Quatre scénarios passent sur le véritable SDK, avec réponses HTTP Google synthétiques :

1. Schéma Zod transmis, outil exécuté, résultat renvoyé au modèle ; signature opaque et identifiant d’appel conservés sur le second tour.
2. Réponse naturelle sans aucun appel d’outil.
3. Erreur 429 avec une seule requête lorsque `maxRetries=0`.
4. Annulation transmise au transport, sans nouvelle requête.

Le pilote ne fait aucun appel payant, n’utilise aucune clé réelle et ne lit aucune donnée utilisateur. Il valide l’adaptateur et la boucle, **pas la compréhension d’un vrai Gemini**. Il ne modifie ni le transport de production ni la synthèse vocale.

## Migration la plus courte

1. Introduire un adaptateur AI SDK derrière la frontière `provider.ts`, sélectionnable côté serveur ; conserver l’ancien adaptateur pour comparaison et retour arrière.
2. Déclarer chaque outil une seule fois avec son schéma ; adapter les outils MCP existants sans recopier leur recherche. Le choix `Mes playlists / YouTube / Partout` reste une donnée explicite du tour.
3. Utiliser le connecteur Google natif, la clé du compte et un identifiant de modèle configurable ; `auto`, arrêt après cinq étapes, budget d’outils explicite, `maxRetries=0`, annulation existante. Ne pas superposer deux boucles multi-étapes.
4. Garder le même résultat métier : réponse, action, titres, cartes, citations. Le lecteur n’annonce que l’opération effectivement validée.
5. Comparer les deux transports sur les mêmes conversations réelles : fautes et collaborateurs, confirmation, demande géographique, append de cinq titres, changement de source, informations et panne fournisseur. Mesurer résultat, outils appelés, latence et consommation, sans stocker les secrets ni des raisonnements internes.
6. Basculer le serveur uniquement après ces essais. La recherche actuelle ne suffit pas à promettre une meilleure précision ou une latence inférieure ; aucune réécriture Swift ni changement de design n’est nécessaire.

## Retour arrière

Le pilote est autonome et peut être supprimé sans effet sur l’app. Le correctif de conversation/recherche constitue un commit distinct du transport expérimental ; il ne requiert aucune migration SQL ni transformation des données. Une future migration de fournisseur doit conserver le contrat HTTP et la configuration actuelle tant que le comparatif réel n’est pas accepté.
