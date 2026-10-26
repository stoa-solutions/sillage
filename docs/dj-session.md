# Session DJ : commandes, composition et file

Le DJ propose des titres ; la session décide ce qui est effectivement joué. Une nouvelle fonctionnalité ne doit pas piloter le lecteur depuis une vue ou un prompt.

## Frontières

- `RecallKit/DJCommand` : interprétation stricte des commandes `/`, sans réseau. `/suite [1…8]` devient une demande de préparation ; les commandes de transport restent locales. Une commande inconnue affiche l’aide.
- `RecallKit/DJPlaybackContext` : instantané du morceau réel (ID, titre, chaîne, artistes et genres MusicBrainz certains) et dernière direction musicale. Aucune clé, aucun état partagé entre comptes.
- `RecallKit/DJComposition` : direction de la session et demandes de suite. Une référence relative ne remplace pas la dernière direction explicite ni ses restrictions.
- `server/dj-intent` : action attendue, indépendamment de la source. Préparer des « à suivre » ajoute ; jouer immédiatement remplace.
- `server/dj` : recherche MCP bornée, vérification des IDs, exclusions et une recherche complémentaire au maximum pour compléter une sélection courte. Les demandes relatives utilisent le contexte de lecture, sans les anciennes annonces potentiellement erronées.
- `server/dj-selection` : annonce des titres réellement retenus et de l’action validée. Une sélection courte est annoncée honnêtement.
- `RecallKit/PlaybackQueue` et `PlaybackIdentity` : dernier contrôle des répétitions (ID, enregistrement MusicBrainz ou artiste + titre nettoyés). La préparation manuelle suit les mêmes protections que l’automatique. Un clic Écouter / remplacement explicite permet de rejouer.
- `RecallKit/ListeningSession` : applique la réponse et produit les effets lecteur/voix. Les réponses périmées ne doivent pas remplacer une nouvelle décision.
- `RecallMac/DJModel` : exécute ces effets ; la vue affiche la session et les commandes.

## Règles et personnalisation

`GET /v1/dj/rules`, protégé par l’authentification habituelle, expose seulement le prompt de base. `/prompt` le consulte ; les règles dynamiques (action, contexte, outils) restent appliquées à chaque tour. Aucun secret ou réglage de compte n’est renvoyé.

Première étape : commandes et règles consultables. Les « skills » éditables ne sont pas encore implémentés. Une future préférence personnalisée doit être un preset borné (ambiance, langues, artistes à éviter, taille de suite) distinct du prompt système et des invariants de comptes, sources, doublons et lecture. Les contenus utilisateurs ne deviennent jamais du code exécutable.

Une file d’écoute n’est pas une playlist sauvegardée et aucune commande de cette version ne modifie YouTube ou « Mes découvertes ».

## Validation

Tests natifs : ancienne direction puis Omer Adam, suite relative avec artiste réel, préparation manuelle sans interruption, exclusion courant/file/historique, copie sous une autre vidéo, replay explicite, commandes invalides et transport sans IA. Tests serveur : contexte relatif sans ancienne annonce, action append malgré une réponse replace, rattrapage d’une sélection courte borné, exclusions ignorées par un modèle rejetées, accès authentifié au prompt sans secrets.

Limites : la comparaison des versions reste conservatrice ; les métadonnées ne sont pas une analyse sonore. Cinq titres est la cible par défaut, pas une garantie de disponibilité. Les données envoyées au modèle sont bornées ; le contrôle natif garde les répétitions connues sur toute la session.
