# Enrichissement musical — pilote MusicBrainz

## Flux et frontières

Le worker existant vérifie chaque minute les vidéos synchronisées par YouTube. `MUSICBRAINZ_PILOT_IDS` contient au plus dix identifiants ; vide, aucun appel MusicBrainz. Aucun mode global n'est disponible dans cette version. Les données de la bibliothèque et les clés restent sur le serveur.

- `musicbrainz/matching.ts` : normalisation, comparaison titre/artistes/durée/version, crédits et provenance ; fonctions pures.
- `musicbrainz/client.ts` : accès public identifié, cache partagé PostgreSQL de 30 jours et verrou global. Chaque requête réseau garde le verrou jusqu'à 1,1 seconde après sa fin, y compris en erreur ; aucun appel pendant la recherche interactive.
- `musicbrainz/enrichment.ts` : sélection du pilote, file existante, résultat protégé par le bail du worker et l'identité YouTube lue avant la requête. Les erreurs réseau utilisent les reprises différées de la file ; elles ne deviennent pas des absences de résultat. Après épuisement des tentatives, nouvelle tentative au plus une fois par jour.

Une seule correspondance titre/artiste/version avec durée connue à huit secondes maximum est acceptée. Plusieurs enregistrements possibles donnent `ambiguous`. Les versions spéciales (COLORS, covers, type beats…) ne reçoivent pas les crédits de la version studio. Ces règles privilégient la précision ; elles laissent certains vrais morceaux non identifiés.

## Données et recherche

`videos.music_metadata` contient la source, la date, le statut, le MBID lorsqu'il est attribué, le score de comparaison (pas une probabilité), les artistes crédités et leurs rôles, les albums officiels répertoriés, les genres du morceau et séparément ceux de l'artiste. Un featuring nécessite un marqueur de crédit explicite MusicBrainz. Un album est une apparition répertoriée de l'enregistrement, pas une preuve que cette vidéo représente cette édition. Les originaux YouTube ne sont jamais réécrits.

Le trigger `recall_music_revision` invalide l'enrichissement quand titre/artiste/durée changent et ajoute sa révision à `content_hash`. Les autres rafraîchissements YouTube conservent les métadonnées. Le texte enrichi est réindexé par le pipeline existant, dont le contrôle anti-résultat périmé reste inchangé. L'index lexical séparé rend les albums et crédits immédiatement cherchables ; les styles de l'artiste ne sont pas présentés comme genres de tous ses morceaux.

Les informations publiques du catalogue peuvent être mutualisées. Les appartenances de playlists restent privées : recherche, export et MCP conservent leurs contrôles de propriétaire. Aucun nouvel endpoint public ou accès SQL n'est donné au DJ. Son MCP renvoie les informations enrichies et leurs limites.

L'app conserve ses surfaces et ses lignes partagées. Une ligne d'album/crédits et un bouton de détails MusicBrainz apparaissent uniquement pour les vidéos du pilote. Les statuts incertains restent visibles et n'empêchent pas la lecture. Le cache vidéo, la voix et la composition ne changent pas.

## Validation et arrêt

Tests : crédits Jewel Usain/Béesau/Hedges, versions concurrentes, type beats, plafond de dix, conservation YouTube, isolation entre deux comptes, recherches album/artiste invité, index enrichi, bail périmé, erreurs/reprises et cadence/cache entre deux clients.

Pour arrêter le pilote, vider `MUSICBRAINZ_PILOT_IDS` dans l'environnement privé du worker puis redéployer. Les tâches déjà en attente revérifient cette liste avant tout appel. Les informations déjà enregistrées restent consultables. Ne pas étendre la liste sans validation des dix résultats dans l'app. Les statuts terminés sont conservés pour ce pilote ; pas de ré-enrichissement périodique de toute la bibliothèque.

Les données centrales MusicBrainz sont CC0 ; genres et tags font partie des données supplémentaires CC BY-NC-SA 3.0. L'accès public sans clé est limité à une requête/seconde, avec User-Agent identifié ; revoir les conditions avant distribution commerciale. Sources : [API](https://musicbrainz.org/doc/MusicBrainz_API), [licences](https://musicbrainz.org/doc/About/Data_License).
