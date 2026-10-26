# Gemini pour Sillage — catalogue et compromis qualité/latence

Recherche primaire vérifiée le 26 octobre 2026 via Exa puis lecture des pages Google. Cette note décrit le catalogue documentaire public ; le catalogue retourné par la clé de Samuel et les résultats d’inférence sont vérifiés séparément par l’agent principal. Une présence dans `models.list` n’est pas une garantie de droit d’inférence, de quota disponible ou de prise en charge par notre transport.

## Décision appliquée et essais du compte

**Gemini 3.8 Flash en raisonnement faible est activé sur le compte de Samuel**, par une requête `/v1/dj/settings` contenant uniquement le modèle. L’API a répondu `saved: true`, puis `/v1/dj/status` a confirmé `gemini-3.8-flash`, `configured: true`, `voice: true`. La clé stockée et le modèle vocal n’ont pas changé.

| Demande réelle | 3.8 Flash low | 3.6 Flash par défaut |
| --- | --- | --- |
| De l’énergie pour avancer | 13,8 s · 4 titres | 8,5 s · 5 titres |
| Met ce que tu veux dans ma playlist | 12,9 s · 4 titres | 14,2 s · 4 titres |
| Propose Jewel Usain sans le lancer | 6,1 s · 1 carte, lecture conservée | 7,0 s · 1 carte, lecture conservée |
| Cinq nouveaux titres autour de Sean | 12,2 s · 5 titres ajoutés | 35,2 s · 5 titres ajoutés |

**4/4 contrats réussis pour chacun des deux modèles.** Le cas Sean ne réintroduit ni le morceau courant ni les deux titres déjà en file. 3.8 propose J9ueve, La Fève et Green Montana ; 3.6 propose Luther, Wallace Cleaver, Khali, Rounhaa et Yvnnis. La cohérence musicale est une proposition du modèle et reste subjective ; les tests ne prouvent pas une qualité d’écoute parfaite.

Mesures prises via le vrai orchestrateur déployé sur `c99424e`, ses outils MCP et PostgreSQL, avec le modèle remplacé uniquement dans la configuration de chaque essai. Aucune commande audio ni modification des playlists de Samuel. Ce ne sont ni des réponses simulées ni un essai du lecteur natif. Les appels Google, les recherches et le temps total sont séparés dans [les résultats bruts](./gemini-benchmark-2026-10-26.json). Une seule répétition par cas, recherches et caches différents : cette série indique un compromis utile, pas un classement statistique. Les réponses Google seules ont pris environ 1,6–4,5 s par appel pour 3.8 Flash.

Argon a réussi le cas énergie en 31,8 s via HTTP. Un autre tour natif de continuation a passé 74,55 s sur le premier appel au modèle, trouvé 17 candidats en 1,7 s puis dépassé le délai total de 90 s. La répétition de la suite HTTP sur 3.8 a été arrêtée au premier `429 Le DJ prépare déjà ta sélection`, car une demande de l’app occupait le compte ; les trois autres cas HTTP n’ont pas été lancés. Cela ne constitue pas une panne ni un quota épuisé du modèle. Les 8 réussites ci-dessus concernent l’orchestrateur directement, pas ces appels HTTP bloqués.

Le choix 3.8 combine modèle Flash stable récent, prise en charge des outils/JSON, et les quatre comportements observés. 3.6 reste un bon candidat ; son essai de suite plus lent vient surtout de recherches différentes et ne démontre pas qu’il est intrinsèquement plus lent.

## Comparaison documentaire

**Gemini 3.8 Flash avec `reasoning_effort: "low"` est le premier candidat au juste milieu.** Google le positionne comme son Flash le plus intelligent pour les agents ; il est stable, accepte les appels de fonctions et les sorties structurées. Gemini 3.6 Flash est l’autre candidat sérieux : stable, mêmes tarifs actuels, mais génération précédente et possibilité de descendre à `minimal`. Le résultat d’un benchmark de l’agent complet doit décider ; la documentation ne fournit aucune promesse de latence de bout en bout pour notre DJ. [3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)

Tous les modèles généralistes récents ci-dessous acceptent texte, image, vidéo, audio et PDF en entrée, et produisent du texte ; cela n’en fait pas des modèles de synthèse vocale. Leur choix est indépendant de la voix du DJ. Les modèles 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite et 3.1 Pro indiquent une limite d’entrée de 1 048 576 tokens et une limite de sortie de 65 536. Argon partage une fenêtre unifiée de 1 048 576 tokens et permet une sortie asynchrone longue dépassant la limite synchrone de 65 536. [Catalogue](https://ai.google.dev/gemini-api/docs/models), [Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon)

## Catalogue généraliste documenté : les choix pertinents pour le cerveau du DJ

Prix **Standard payants en dollars par million de tokens**, pour les entrées texte de Sillage, hors cache, Batch, Flex et Priority. La sortie inclut les tokens de raisonnement. Tarifs constatés au 26 octobre 2026. [Tarification Google](https://ai.google.dev/gemini-api/docs/pricing)

| ID exact | Statut documentaire | Entrée / sortie | Raisonnement / rôle |
| --- | --- | --- | --- |
| `gemini-4-argon` | Stable, octobre 2026 | 2 $ / 10 $ jusqu’au 30/11/2026 ; 4 $ / 20 $ dès le 01/12 | `low`, `medium` par défaut, `high`. Modèle phare pour raisonnement complexe. |
| `gemini-3.8-flash` | Stable, septembre 2026 | 0,75 $ / 3,75 $ jusqu’au 31/12/2026 ; 1,50 $ / 7,50 $ dès le 01/01/2027 | `low`, `medium` par défaut, `high`. **`minimal` n’est pas accepté**. Meilleur candidat équilibré. |
| `gemini-3.6-flash` | Stable, juillet 2026, génération précédente | 0,75 $ / 3,75 $ jusqu’au 31/12/2026 ; 1,50 $ / 7,50 $ dès le 01/01/2027 | `minimal`, `low`, `medium` par défaut, `high`. Candidat alternatif pour boucles rapides. |
| `gemini-3.5-flash-lite` | Stable, juillet 2026 | 0,30 $ / 2,50 $ | `minimal` par défaut, `low`, `medium`, `high`. Priorité à la latence et au volume. |
| `gemini-3.1-flash-lite` | Stable, mai 2026 | 0,25 $ / 1,50 $ | Raisonnement supporté, modèle léger précédent. Ne pas déduire les niveaux de la seule page de synthèse : la page compatibilité OpenAI mentionne `minimal`, `low`, `medium`, `high`. |
| `gemini-3.1-pro-preview` | Preview, février 2026 | 2 $ / 12 $ si entrée ≤ 200k ; 4 $ / 18 $ au-delà | `low`, `medium`, `high` par défaut. Raisonnement et usage précis d’outils. |
| `gemini-3.1-pro-preview-customtools` | Preview, variante du précédent | Mêmes prix que 3.1 Pro Preview | Optimisé pour outils personnalisés et bash ; pas une garantie d’amélioration du DJ musical. |
| `gemini-3-flash-preview` | Preview, ancien Flash | 0,50 $ / 3 $ | `minimal`, `low`, `medium`, `high` par défaut. Maintenu au catalogue, pas le choix neuf recommandé. |
| `gemini-2.5-flash` | Ancienne génération, accès restreint aux utilisateurs historiques | 0,30 $ / 2,50 $ | Raisonnement configurable. Google recommande les modèles récents aux nouveaux projets. |
| `gemini-2.5-flash-lite` | Ancienne génération, accès restreint aux utilisateurs historiques | 0,10 $ / 0,40 $ | Raisonnement désactivé par défaut ; coût très faible. |
| `gemini-2.5-pro` | Ancienne génération, accès restreint aux utilisateurs historiques | 1,25 $ / 10 $ si entrée ≤ 200k ; 2,50 $ / 15 $ au-delà | Raisonnement, modèle Pro précédent. |

Sources des capacités/niveaux/statuts : [catalogue](https://ai.google.dev/gemini-api/docs/models), [thinking](https://ai.google.dev/gemini-api/docs/thinking), [compatibilité OpenAI](https://ai.google.dev/gemini-api/docs/openai), [3.1 Pro et variante customtools](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview), [3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).

Le catalogue interrogé directement par l’agent principal retourne aussi `gemini-3.5-flash` et `gemini-3.7-flash`. **Ils sont dépréciés depuis le 8 octobre 2026 et automatiquement routés respectivement vers `gemini-3.6-flash` et `gemini-3.8-flash`** ; ce ne sont donc pas deux candidats indépendants à comparer. Utiliser directement les IDs cibles. [Changelog officiel](https://ai.google.dev/gemini-api/docs/changelog), [fiche 3.5](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash), [fiche 3.7](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)

Les alias comme `gemini-flash-latest`, `gemini-flash-lite-latest` ou `gemini-pro-latest` ne sont pas de nouvelles architectures de modèles. Ils changent de cible avec les sorties ; pour figer un comportement et comparer des essais, préférer un ID stable explicite. [Conventions de versions](https://ai.google.dev/gemini-api/docs/models)

## Autres modèles documentés : catalogue complet par usage

Ces modèles ont une fonction distincte ; les ajouter à la liste « cerveau du DJ » rendrait le réglage trompeur. Liste issue de l’index Google, complétée par la variante customtools de sa fiche détaillée. [Catalogue officiel](https://ai.google.dev/gemini-api/docs/models)

| Usage | IDs documentés |
| --- | --- |
| Dialogue vocal temps réel | `gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-3.1-flash-live-preview` (ancien preview), `gemini-2.5-flash-native-audio-preview-12-2025` (ancien) |
| Synthèse de la voix | `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, `gemini-3.1-flash-tts-preview` (ancien preview), `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts` |
| Transcription et traduction en direct | `gemini-3.5-transcribe`, `gemini-3.5-transcribe-live`, `gemini-3.5-live-translate-preview` |
| Génération/modification d’image | `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image` |
| Vidéo générée | `gemini-omni-1.1-flash` |
| Musique générée | `lyria-3.5`, `lyria-3-clip-preview`, `lyria-3-pro-preview`, `lyria-realtime-exp` |
| Agents de recherche / agent autonome | `deep-research-preview-04-2026`, `deep-research-max-preview-04-2026`, `antigravity-preview-09-2026` |
| Embeddings pour recherche | `gemini-embedding-2-preview`, `gemini-embedding-001` |
| Robotique / raisonnement spatial spécialisé | `gemini-robotics-er-2-preview` |

Ne sont pas des options utilisables : Google marque comme arrêtés `gemini-robotics-er-1.6-preview`, `gemini-2.5-computer-use-preview-10-2025`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-3.1-flash-lite-preview`, `gemini-3-pro-preview` et `imagen-4.0-generate`. Les anciens Veo 3.1 sont arrêtés depuis le 22 octobre 2026 selon la documentation de compatibilité. [Catalogue](https://ai.google.dev/gemini-api/docs/models), [compatibilité](https://ai.google.dev/gemini-api/docs/openai)

## Paramètres pour une intégration propre

Le transport compatible OpenAI de Google accepte `reasoning_effort: "low"` avec 3.8 Flash et les appels de fonctions. Ce réglage doit être cohérent avec le modèle : 3.8 n’accepte pas `minimal`. Ne pas envoyer simultanément `reasoning_effort` et `thinking_config`. Le niveau de raisonnement pilote qualité/latence ; baisser arbitrairement `max_output_tokens` peut couper le raisonnement et laisser une réponse vide tout en facturant les tokens déjà produits. [Compatibilité](https://ai.google.dev/gemini-api/docs/openai), [thinking](https://ai.google.dev/gemini-api/docs/thinking)

Pour comparer les modèles : utiliser mêmes demandes, même bibliothèque, mêmes candidats/exclusions, mêmes contrats de tools ; mesurer temps total, appels provider, tools, action finale, nombre de morceaux, doublons et cohérence. Ne pas choisir sur le seul débit de tokens. Une estimation de coût doit additionner tous les tours provider et les tokens de raisonnement, et non la seule réponse affichée.

La recommandation 3.8-low combine une inférence produit et les essais décrits en tête de cette note. Les pages Google ne garantissent pas notre latence de bout en bout.

## Catalogue exhaustif retourné par la clé : 60 identifiants

Instantané `models.list` paginé du 2026-10-26T15:24:39.792Z. [Contrat officiel de models.list](https://ai.google.dev/api/models#method:-models.list). [Instantané JSON](./gemini-models-2026-10-26.json). Les alias, previews et modèles spécialisés restent dans cette liste pour qu’elle soit exhaustive. Leur présence ne garantit pas qu’un appel aboutisse, qu’un quota soit disponible ou que leur endpoint convienne au DJ. Le catalogue brut et les pages documentaires peuvent différer sur les modèles arrêtés.

| Identifiant exact | Nom Google | Méthodes annoncées |
| --- | --- | --- |
| `gemini-2.5-flash` | Gemini 2.5 Flash | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-2.5-pro` | Gemini 2.5 Pro | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-2.5-flash-preview-tts` | Gemini 2.5 Flash Preview TTS | `countTokens`, `generateContent` |
| `gemini-2.5-pro-preview-tts` | Gemini 2.5 Pro Preview TTS | `countTokens`, `generateContent`, `batchGenerateContent` |
| `gemma-4-26b-a4b-it` | Gemma 4 26B A4B IT | `generateContent`, `countTokens` |
| `gemma-4-31b-it` | Gemma 4 31B IT | `generateContent`, `countTokens` |
| `gemini-flash-latest` | Gemini Flash Latest | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-flash-lite-latest` | Gemini Flash-Lite Latest | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-pro-latest` | Gemini Pro Latest | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash-Lite | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-2.5-flash-image` | Nano Banana | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3-flash-preview` | Gemini 3 Flash Preview | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3.1-pro-preview-customtools` | Gemini 3.1 Pro Preview Custom Tools | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3.1-flash-lite-preview` | Gemini 3.1 Flash Lite Preview | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3-pro-image-preview` | Nano Banana Pro | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3-pro-image` | Nano Banana Pro | `generateContent`, `countTokens`, `batchGenerateContent` |
| `nano-banana-pro-preview` | Nano Banana Pro | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3.1-flash-image` | Nano Banana 2 | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-nano-banana-2.1` | Nano Banana 2.1 | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3.5-flash` | Gemini 3.5 Flash | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-omni-flash-preview` | Gemini Omni Flash Preview | `generateContent`, `countTokens` |
| `gemini-omni-1.1-flash` | Gemini Omni 1.1 Flash | `generateContent`, `countTokens` |
| `gemini-3.5-transcribe` | Gemini 3.5 Transcribe | `generateContent`, `countTokens` |
| `gemini-3.6-flash` | Gemini 3.6 Flash | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3.7-flash` | Gemini 3.7 Flash | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-3.8-flash` | Gemini 3.8 Flash | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-4-argon` | Gemini 4 Argon | `generateContent`, `countTokens`, `batchGenerateContent` |
| `lyria-3-clip-preview` | Lyria 3 Clip Preview | `generateContent`, `countTokens` |
| `lyria-3-pro-preview` | Lyria 3 Pro Preview | `generateContent`, `countTokens` |
| `lyria-3.5` | Lyria 3.5 | `generateContent`, `countTokens` |
| `gemini-3.1-flash-tts-preview` | Gemini 3.1 Flash TTS Preview | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3.8-flash-tts` | Gemini 3.8 Flash TTS | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-3.8-flash-lite-tts` | Gemini 3.8 Flash Lite TTS | `generateContent`, `countTokens`, `batchGenerateContent` |
| `gemini-robotics-er-2-preview` | Gemini Robotics-ER 2 Preview | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-2.5-computer-use-preview-10-2025` | Gemini 2.5 Computer Use Preview 10-2025 | `generateContent`, `countTokens` |
| `antigravity-preview-05-2026` | Antigravity Agent Preview | `generateContent`, `countTokens` |
| `antigravity-preview-09-2026` | Antigravity Agent Preview | `generateContent`, `countTokens` |
| `antigravity-preview-latest` | Antigravity Agent Preview Latest | `generateContent`, `countTokens` |
| `deep-research-max-preview-04-2026` | Deep Research Max Preview (Apr-21-2026) | `generateContent`, `countTokens` |
| `deep-research-preview-04-2026` | Deep Research Preview (Apr-21-2026) | `generateContent`, `countTokens` |
| `deep-research-pro-preview-12-2025` | Deep Research Pro Preview (Dec-12-2025) [Rerouted] | `generateContent`, `countTokens` |
| `gemini-embedding-001` | Gemini Embedding 001 | `embedContent`, `countTextTokens`, `countTokens`, `asyncBatchEmbedContent` |
| `gemini-embedding-2-preview` | Gemini Embedding 2 Preview | `embedContent`, `countTextTokens`, `countTokens`, `asyncBatchEmbedContent` |
| `gemini-embedding-2` | Gemini Embedding 2 | `embedContent`, `countTextTokens`, `countTokens`, `asyncBatchEmbedContent` |
| `aqa` | Model that performs Attributed Question Answering. | `generateAnswer` |
| `gemini-3.5-transcribe-live` | Gemini 3.5 Transcribe Live | `bidiGenerateContent` |
| `gemini-2.5-flash-native-audio-latest` | Gemini 2.5 Flash Native Audio Latest | `countTokens`, `bidiGenerateContent` |
| `gemini-2.5-flash-native-audio-preview-09-2025` | Gemini 2.5 Flash Native Audio Preview 09-2025 | `countTokens`, `bidiGenerateContent` |
| `gemini-2.5-flash-native-audio-preview-12-2025` | Gemini 2.5 Flash Native Audio Preview 12-2025 | `countTokens`, `bidiGenerateContent` |
| `gemini-3.1-flash-live-preview` | Gemini 3.1 Flash Live Preview | `bidiGenerateContent` |
| `gemini-3.8-live` | Gemini 3.8 Live | `bidiGenerateContent` |
| `gemini-3.8-live-extended-thinking` | Gemini 3.8 Live Extended Thinking | `bidiGenerateContent` |
| `gemini-robotics-er-2-streaming-preview` | Gemini Robotics-ER 2 Streaming Preview | `bidiGenerateContent` |
| `gemini-3.5-live-translate-preview` | Gemini 3.5 Live Translate Preview | `bidiGenerateContent` |
| `lyria-realtime-exp` | Lyria Realtime Experimental | `bidiGenerateMusic` |
