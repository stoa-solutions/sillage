# Changelog

## Non publié

- App Mac 1.4.6 (18) : recherche directe artiste/titre sans inférence, tolérance aux petites fautes et préfixes, rejet des correspondances partielles inventées, vérification des genres pour les recherches d’ambiance.
- Voix : une seule annonce suivante préparée en mémoire dans les vingt dernières secondes, si la voix et l’enchaînement sont actifs ; réutilisée au passage suivant, effacée au changement de compte ou de demande.
- Studio : 1080p par défaut, option jusqu’à 4K sur les Mac décodant l’AV1 ; cache séparé par qualité (2/6 Go), YouTube démarre pendant la préparation puis reprend en natif à la même position. Changer de mode ou de qualité conserve la position et la pause. Design Compact/Studio conservé.

- App Mac 1.4.5 (17) : installation locale du design actuel de main (Compact/Studio, volume, Voix du DJ, Enchaîner et photos de chaîne).

- DJ : possibilité administrateur de retirer durablement le plafond Recall pour un compte, sans modifier les limites des autres comptes ni celles du fournisseur IA.

### Correctif recherche et demandes DJ précises

- Les correspondances artiste + titre et les morceaux de l’artiste passent avant les type beats, mixes, reprises et versions alternatives non demandées.
- Les titres explicitement identifiés sont joués seuls, dans l’ordre demandé, sans compléter la file avec des suggestions ; une référence manquante conserve la file et demande une précision.
- Le plafond quotidien Recall est distingué du quota Google ; un plafond par compte et une dérogation temporaire avec expiration peuvent être définis sans modifier les autres comptes.

### App Mac : affichages Compact et Studio

- App Mac : deux affichages du DJ, Compact et Studio, dans la barre d’outils (le mode cinéma disparaît). Navigation DJ / Bibliothèque dans la barre d’outils, apparence du système hors Studio, chat translucide sur le clip, boutons Voix et Enchaîner visibles, bibliothèque avec miniatures, durée, avatar de chaîne et début de description ; Studio n’active plus la voix ni l’enchaînement. Pendant la préparation du clip, sa pochette floutée remplit l’écran avec un indicateur discret, puis le clip apparaît en fondu.
- App Mac : volume de la musique (curseur et coupure, commun aux deux lecteurs, rétabli après la voix du DJ) ; boutons « Voix du DJ » et « Enchaîner » nommés et remplis lorsqu’ils sont actifs.
- Photos de chaîne : l’enrichissement garde l’identifiant de chaîne, les photos sont récupérées par lots de 50 (une unité de quota YouTube) et conservées 30 jours ; la recherche renvoie `channelAvatarUrl`. L’app Mac ne les charge que depuis les hôtes d’images Google et garde l’initiale colorée en secours. Nécessite un redéploiement du serveur (migration additive : colonne `videos.channel_id`, table `channels`).

### Antérieur

- Import Recall : une playlist sans identifiant reçoit un identifiant stable ; les vidéos hors playlist sont exportées dans « Autres vidéos » et réimportées sans créer de playlist ; une entrée sans titre ne remplace plus une entrée titrée. Cas de référence dans `packages/core/fixtures/format`.
- Mode Studio personnel sur Mac : cache vidéo opt-in, lecture native en fond, préchargement du morceau suivant et retour au lecteur YouTube si le téléchargement échoue. Distribution et page de téléchargement mises en attente à la demande de Samuel.

- App Mac : code de bibliothèque locale retiré (SQLite, import par clé YouTube, DJ exécuté sur le Mac) ; décision 0002.
- Mode cinéma sombre avec lecteur agrandi, panneaux translucides et retour à la vue compacte ; accueil en deux étapes et accès direct à l’import pour une bibliothèque vide.

- Le DJ annonce les morceaux au bouton Suivant et pendant l’enchaînement automatique. Les annonces précédentes sont arrêtées lors des sauts rapides ; un indicateur confirme la lecture vocale. Désactiver l’enchaînement arrête bien la lecture à la fin du titre.

- Accueil Mac : confirmation visible de la clé Gemini enregistrée, récupération des playlists avec état de progression et fermeture de l’accueil lorsque le compte est prêt.

- Connexion Google : ouverture directe du navigateur et retour dans Recall, protégé par état aléatoire et échange PKCE à usage unique ; suppression de la fenêtre système invisible.

- App Mac : suppression complète des accès au Trousseau ; session serveur mémorisée dans un fichier privé, clés Gemini et voix utilisées exclusivement côté serveur.

- Comptes Google dans l’app Mac, bibliothèque exclusivement sur serveur, clés Gemini personnelles chiffrées et rattachement explicite de la bibliothèque historique. Recherche, MCP, DJ, export et quotas isolés par compte ; tests PostgreSQL à deux utilisateurs et protections OAuth/PKCE.


- App Mac : bibliothèque paginée avec pages numérotées ; l’import de playlist va dans la source choisie.
- App Mac : Gemini et Apple suivent le même tour de DJ, en deux appels : mêmes règles, mêmes plafonds, titres en file exclus sauf redemande, identifiants inventés écartés.
- App Mac : en mode serveur, le DJ cherche via `/v1/search` avec exclusions (un aller-retour par recherche au lieu de deux).
- Serveur : `/v1/search` accepte `excludeIds` et `availableOnly`.
- App Mac : DJ Apple sur l’appareil (macOS 26, Apple Intelligence), sans clé ni réseau pour le choix des titres.
- App Mac : accueil au premier lancement, installation locale d’abord ; import de playlist YouTube via le serveur connecté.
- App Mac : voix Gemini rétablie ; la file continue la demande en cours au lieu de repartir de zéro.
- App Mac : une vidéo répétée dans une playlist ou la file s’affiche correctement.
- App Mac : le DJ trouve des titres pour une ambiance décrite en plusieurs mots, même sans correspondance exacte.
- App Mac : un import YouTube interrompu reprend pendant 24 h, puis repart du début.
- App Mac : « Oublier ce serveur » dans les Réglages.
- App Mac : `RECALL_DATA_DIR` isole les essais de développement de la bibliothèque réelle.
- Dépôt : branche `main`, règles communes `AGENTS.md`, `npm run verify`, tableau `npm run board`, CI GitHub.
