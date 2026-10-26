# Enrichissement musical — traitement progressif MusicBrainz

## Flux et frontières

Le worker vérifie chaque minute les vidéos synchronisées par YouTube. `MUSICBRAINZ_PILOT_IDS` conserve le pilote de dix identifiants. `MUSICBRAINZ_ACCOUNT_IDS` autorise explicitement des UUID de comptes : seuls leurs morceaux actifs deviennent éligibles. Les deux listes vides désactivent les appels. Les données de la bibliothèque et les clés restent sur le serveur.

Le planificateur remplit une file de dix tâches MusicBrainz au maximum, réessais différés compris, sous verrou partagé. Il ne crée pas des milliers de tâches à la fois. Le worker revérifie l’autorisation et l’appartenance avant chaque traitement. La cadence réseau globale reste inférieure à une requête par seconde. Les imports et index texte gardent leur priorité ; aucune heure de fin n’est garantie. Les nouveaux morceaux deviennent éligibles après leurs détails YouTube.

- `musicbrainz/matching.ts` : normalisation, comparaison titre/artistes/durée/version, crédits et provenance ; fonctions pures.
- `musicbrainz/client.ts` : accès public identifié, cache partagé PostgreSQL de 30 jours et verrou global. Chaque requête réseau garde le verrou jusqu'à 1,1 seconde après sa fin, y compris en erreur ; aucun appel pendant la recherche interactive.
- `musicbrainz/enrichment.ts` : sélection du pilote, file existante, résultat protégé par le bail du worker et l'identité YouTube lue avant la requête. Les erreurs réseau utilisent les reprises différées de la file ; elles ne deviennent pas des absences de résultat. Après épuisement des tentatives, nouvelle tentative au plus une fois par jour.

Une seule correspondance titre/artiste/version avec durée connue à huit secondes maximum est acceptée. Plusieurs enregistrements possibles donnent `ambiguous`. Les versions spéciales (COLORS, covers, type beats…) ne reçoivent pas les crédits de la version studio. Ces règles privilégient la précision ; elles laissent certains vrais morceaux non identifiés.

## Données et recherche

`videos.music_metadata` contient la source, la date, le statut, le MBID lorsqu'il est attribué, le score de comparaison (pas une probabilité), les artistes crédités et leurs rôles, les albums officiels répertoriés, les genres du morceau et séparément ceux de l'artiste. Un featuring nécessite un marqueur de crédit explicite MusicBrainz. Un album est une apparition répertoriée de l'enregistrement, pas une preuve que cette vidéo représente cette édition. Les originaux YouTube ne sont jamais réécrits.

Le trigger `recall_music_revision` invalide l'enrichissement quand titre/artiste/durée changent et ajoute sa révision à `content_hash`. Les autres rafraîchissements YouTube conservent les métadonnées. Le texte enrichi est réindexé par le pipeline existant, dont le contrôle anti-résultat périmé reste inchangé. L'index lexical séparé rend les albums et crédits immédiatement cherchables ; les styles de l'artiste ne sont pas présentés comme genres de tous ses morceaux.

Les informations publiques du catalogue peuvent être mutualisées. Les appartenances de playlists restent privées : recherche, export et MCP conservent leurs contrôles de propriétaire. Aucun nouvel endpoint public ou accès SQL n'est donné au DJ. Son MCP renvoie les informations enrichies et leurs limites.

L'app conserve ses surfaces et ses lignes partagées. Une ligne d'album/crédits et un bouton de détails MusicBrainz apparaissent pour les vidéos traitées. Les statuts incertains restent visibles et n'empêchent pas la lecture. Le cache vidéo, la voix et la composition ne changent pas.

## Validation et arrêt

Tests : crédits Jewel Usain/Béesau/Hedges, versions concurrentes, type beats, plafond de dix, conservation YouTube, isolation entre deux comptes, recherches album/artiste invité, index enrichi, bail périmé, erreurs/reprises et cadence/cache entre deux clients.

Pour arrêter un compte, retirer son UUID de `MUSICBRAINZ_ACCOUNT_IDS` dans la configuration privée puis redéployer API et worker. Vider aussi `MUSICBRAINZ_PILOT_IDS` pour arrêter le pilote. Les tâches en attente revérifient l’éligibilité avant tout appel. Les informations déjà enregistrées restent consultables. Les statuts terminés sont conservés ; pas de ré-enrichissement périodique automatique.

## Suivi dans l’app

`GET /v1/library/enrichment`, authentifié, compte les vidéos distinctes du compte résolu depuis le jeton. Un paramètre utilisateur ne change jamais ce périmètre. Le suivi distingue traités, correspondances certaines, ambiguïtés, absences, vidéos indisponibles, attente YouTube, tâches en cours, reprises et échecs. « Traité » ne signifie pas « enrichi ». Les dernières tâches seulement sont comptées, sans afficher leurs erreurs brutes.

Bibliothèque rafraîchit ces compteurs toutes les dix secondes tant que la vue est ouverte. Une coupure signale que les derniers compteurs peuvent être anciens. Changer de compte efface le suivi et annule la requête précédente. Le worker continue sans l’app ouverte.

Le 25 octobre, le pilote de dix a donné quatre correspondances certaines (dont Incapable, Jewel Usain/Béesau/Hedges), trois ambiguïtés et trois versions exclues, sans échec technique. la personne a explicitement autorisé l’extension prudente à son compte après avoir reçu ces résultats.

Les données centrales MusicBrainz sont CC0 ; genres et tags font partie des données supplémentaires CC BY-NC-SA 3.0. L'accès public sans clé est limité à une requête/seconde, avec User-Agent identifié ; revoir les conditions avant distribution commerciale. Sources : [API](https://musicbrainz.org/doc/MusicBrainz_API), [licences](https://musicbrainz.org/doc/About/Data_License).
