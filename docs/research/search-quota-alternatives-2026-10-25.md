# Quota de recherche et alternatives — 25 octobre 2026

## Diagnostic et retour utilisateur

Le refus observé est celui du quota journalier de recherche YouTube du projet serveur (`defaultSearchListPerDayPerProject`). La clé Gemini personnelle pilote le modèle et sa voix : la remplacer ne débloque pas ce quota YouTube. Ne pas confondre un quota quotidien, un débit temporaire, le budget interne de Sillage et un problème d’accès/configuration.

Découvrir conserve le champ `error` compris par les applications déjà installées et ajoute `source`, `reason` et, pour le quota quotidien, `retryAt` (ISO UTC). Le message indique l’heure de renouvellement prévue, explicitement en heure de Paris. C’est une prévision selon la règle Google, pas la promesse que le fournisseur sera disponible. Le chat reçoit les mêmes causes via MCP ; une recherche partielle conserve ses résultats et explique la source manquante. Les causes sont dédupliquées et les diagnostics privés ne sont jamais affichés. Une source qui répond à nouveau cesse d’être annoncée comme indisponible.

## Obtenir plus de quota officiel

La [documentation Google actuelle](https://developers.google.com/youtube/data/determine_quota_cost), mise à jour le 15 octobre 2026, indique par défaut **100 appels search.list par jour**, un compartiment séparé pour videos.insert et 10 000 unités/jour pour les autres méthodes. Les pages supplémentaires consomment aussi un appel ; le renouvellement est à minuit Pacifique. Le quota effectivement accordé se consulte dans Google Cloud.

L’augmentation passe par le [formulaire d’audit et d’extension YouTube](https://developers.google.com/youtube/data/guides/quota_and_compliance_audits). Préparer les usages de Sillage, le nombre d’utilisateurs, les volumes de recherche observés, le cache et une démonstration représentative. Aucun formulaire n’a été soumis dans cette intervention et aucune augmentation n’est acquise.

## Alternatives libres

| Option | Ce qu’elle apporte | Limites pour Sillage |
| --- | --- | --- |
| SearXNG auto-hébergé | API HTTP JSON, moteur `youtube_noapi`, recherche de vidéos sans clé personnelle YouTube | Un service supplémentaire à maintenir ; dépend du site et de ses formats. Ne remplace pas la gestion autorisée des playlists privées. |
| yt-dlp | Recherche `ytsearch:` et extraction de métadonnées ; déjà utilisé par le cache Studio sur le Mac | Ce n’est pas un service serveur de recherche déjà installé dans Sillage. Isoler et borner les processus, gérer les changements d’extracteur et les échecs. |
| NewPipeExtractor | Extraction/recherche YouTube dans une bibliothèque Java | Ajoute un environnement JVM ou un service intermédiaire ; davantage d’intégration que SearXNG pour le serveur Node actuel. |

Sources primaires : [API SearXNG](https://github.com/searxng/searxng/blob/master/docs/dev/search_api.rst), [moteur YouTube SearXNG](https://github.com/searxng/searxng/blob/master/searx/engines/youtube_noapi.py), [yt-dlp](https://github.com/yt-dlp/yt-dlp#usage-and-options), [maintenance NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor/releases). L’API JSON doit être activée ; de nombreuses instances publiques la désactivent. Les versions d’extracteurs évoluent : aucun de ces outils ne garantit une recherche illimitée ou toujours disponible.

## Proposition pour Sillage (non implémentée)

Essayer une instance privée SearXNG comme adaptateur complémentaire derrière le contrat de découverte existant. Conserver les trois choix Mes playlists / YouTube / Partout : le choix technique du fournisseur ne doit pas compliquer le chat. Normaliser les résultats (ID YouTube, titre, chaîne, durée), dédupliquer, garder la provenance et distinguer « aucun résultat » d’une erreur. Réutiliser si nécessaire les métadonnées YouTube officielles, dont le quota est distinct de search.list ; cette validation reste susceptible d’échouer.

Avant activation : comparer une petite série de requêtes (Acid Coco, afro, Jewel/HEDGES, Omer Adam), latence, doublons, pertinence et disponibilité depuis le VPS. Ne pas utiliser une instance publique inconnue comme dépendance silencieuse. La demande d’extension officielle et l’amélioration du cache restent utiles même si cet essai est concluant. Aucun fournisseur alternatif n’a été installé ou activé ici.
