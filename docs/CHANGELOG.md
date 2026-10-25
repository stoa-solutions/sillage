# Changelog

## Non publié

- Qualité du DJ : banc de régression sans interface (intentions, vrai circuit MCP, sources et exclusions), évaluations HTTP du modèle réel avec rapports privés, durées et distinction entre échec comportemental et quota fournisseur.
- DJ : corrige une demande ordonnée séparée par « maintenant, puis » qui pouvait créer un morceau vide et empêcher le lancement malgré deux titres trouvés ; défaut reproduit par l’évaluation HTTP.
- Mac : évite le blocage du chat après plusieurs cartes de découverte en stabilisant la mise en page et le défilement ; design conservé.

- DJ : recherche unifiée selon Mes playlists, YouTube ou Partout ; les deux sources sont interrogées en parallèle dans Partout. Les demandes d’alternatives gardent les cartes récentes comme repère et excluent les propositions explicitement refusées, sans imposer d’artiste ni de style.
- DJ : décision de lecture centralisée (action, moment, référence et nombre), corrections des négations et demandes ordonnées ; contexte musical explicite prioritaire et repli de recherche borné sans inventer une panne des sources.
- Mac : dernière pause respectée malgré les réponses tardives, annulation du chargement YouTube, arrêt de l’ancienne annonce lors d’un changement de titre ; commandes naturelles de lecture élargies et scénarios de régression issus de l’audit.

- Mac : réduit les rafraîchissements de lecture sans dégrader l’horloge des paroles ; nettoyage des observateurs et du pont WebKit, chargement YouTube différé jusqu’au premier titre.
- Connexion Google : retour vers l’app qui a démarré la connexion, reconnexion sans déconnexion préalable et page de retour explicite dans le navigateur avec bouton de reprise.

- App 1.6.2 : panneau DJ modernisé. Onglets à icônes avec compteur de la file, réponses du DJ avec son avatar, bulles discrètes pour tes messages, indicateur de recherche dans la conversation, suggestions en pastilles, champ de saisie avec source, micro et envoi, commandes « / » en liste. L’onglet Historique montre les écoutes enregistrées sur ton compte, groupées par jour.

- App 1.6.1 : « Écoutes récentes » dans la Bibliothèque affiche l’historique enregistré sur le serveur, groupé par jour (écouté, passé, heure), avec relecture, ajout à la suite et effacement confirmé.

- Historique d’écoute enregistré sur le serveur pour chaque compte (titre, issue, date), sans doublon si un envoi est répété ; base des futures suggestions de Découvrir. Bibliothèque : retirer une playlist depuis son menu ou un clic droit, avec confirmation ; YouTube et les autres comptes ne changent pas.
- Architecture : DJ serveur séparé en contrat, contexte, catalogue, fournisseur typé, quota et orchestration ; façade publique conservée. Contrôles de frontières dans la validation Node, tests PostgreSQL en CI et guide de contribution enrichi.

- App 1.5.9 : Bibliothèque façon Spotify (playlists à gauche, en-tête avec lecture et aléatoire, liste dense chargée au défilement, actions au survol, enrichissement résumé en une pastille). Découvrir façon Raycast et YouTube Music : barre de recherche qui cherche pendant la frappe, recherches récentes et idées de départ, meilleur résultat mis en avant, vidéos YouTube en cartes. Accueil sobre aux couleurs Stoa, mis en page comme Studio.

- DJ : dernier tour sans outil pour conclure la composition ; une sélection partielle vérifiée est conservée si le modèle continue à chercher au-delà de la limite.

- Composition : préparation manuelle et automatique sans rejouer les titres déjà écoutés/en file, y compris un même artiste/titre sous une autre vidéo. Cinq titres visés par défaut, une seule recherche complémentaire si la sélection est trop courte ; manque de résultats signalé. Menu `/`, commandes `/suite 1…8`, `/suivant`, `/pause`, `/reprendre`, `/aide`, `/prompt` (règles de base en lecture seule).

- DJ : « prépare-moi des à suivre » conserve la lecture. Les demandes « même style / comme ça » reçoivent le morceau et l’artiste réellement en cours dans un contexte séparé ; les anciennes annonces ne servent plus de référence. Les annonces de sélection décrivent l’action validée et les titres retenus.

- DJ : les références aux cartes (« le trois », « les trois ») pilotent directement les titres affichés, dans leur ordre. Le contexte conserve les propositions ; « joue directement » prime sur « ajoute ». Une sélection vide ne peut plus annoncer un démarrage. Commandes « mets Play » et « mets la suivante » locales, design conservé.

- MusicBrainz : extension progressive par compte, file bornée à dix tâches et correspondances prudentes conservées. Bibliothèque affiche les morceaux traités, enrichis, ambigus, sans correspondance et les reprises ; suivi actualisé sans interrompre la lecture.

- Apparence : fond Stoa au repos, image personnelle copiée sur ce Mac, voile sombre réglable et aperçu. Réglages organisés en Apparence, DJ et voix, Lecture, Compte ; aucun changement de fond pendant un morceau.
  Si l’image intégrée manque, l’app démarre avec un fond neutre.

- App Mac : session d’écoute et module de lecture (architecture). La musique démarre immédiatement, puis le clip téléchargé prend le relais en fondu, à la même qualité en Compact et en Studio (Studio devient un choix d’affichage). Les trois titres suivants sont préparés à l’avance ; option « Lecteur YouTube seulement ». Corrigé : une pause par le chat suivie d’une reprise au bouton ne bloque plus la suite automatique ; une suite demandée pendant la connexion attend le compte au lieu d’écrire dans le champ de saisie. Contrôles natifs par scénarios pour la session et la bascule entre lecteurs.

- Recherche : les noms d’albums connus restent des recherches précises, même avec des mots comme « où » ; leurs occurrences complètes dans les descriptions YouTube sont conservées, sans les voisins sémantiques hors sujet.

- App 1.5.4 : pilote MusicBrainz limité à dix morceaux côté worker. Crédits/featurings et albums cherchables, métadonnées accessibles au DJ, détails sourcés dans les lignes existantes ; genres de morceau et styles d’artiste restent distincts. Correspondances ambiguës conservées sans attribution, aucune extension automatique à la bibliothèque.

- Paroles : déplacement précis dans le clip Studio, navigation YouTube sans recharger le titre, horloge partagée avec le lecteur, calage fin par dixième de seconde. Surlignage par ligne sans prétendre à un alignement mot par mot.
- Développement : guide de démarrage et architecture actualisés (comptes, recherche, DJ, lecteur et limites de montée en charge).

- App 1.5.3 : « pause », « reprends » et « next » dans le chat ou la dictée pilotent directement le lecteur, y compris pendant une recherche ; les demandes de morceaux portant ces mots restent des recherches.

- DJ : recherche avant de demander une précision, propositions vérifiées pour les souvenirs vagues et featurings, recherche visuelle des miniatures disponible via MCP. Les choix ambigus restent des cartes sans interrompre la lecture ; un fragment de titre se recherche en texte.

- Paroles : à la demande de Samuel, aucun texte au centre du clip. Le bouton Paroles ouvre le panneau latéral synchronisé ; le calage et le clic sur une ligne restent disponibles.

- Relecture croisée : paroles et calage isolés après changement de compte, source des suites liée à la dernière direction musicale, annonces vocales nettoyées identiques à leur préparation ; une seule source commune dans Découvrir.

- App 1.5.2 : Découvrir, son chat DJ et Bibliothèque ont un fond sombre stable ; le clip reste discret derrière les pages de lecture. Surfaces et fonds centralisés dans Surfaces.swift, respect de Réduire la transparence et Réduire les animations ; les actions de bibliothèque restent visibles.

- Contrôle final 1.5.1 : préparation du clip visible dans le mini-lecteur, actions À suivre/réorganisation toujours accessibles, état « Dans ta bibliothèque » confirmé en vert ; un suffixe de vidéo comme « | Open Mic » ne remplace plus le titre du morceau.

- App 1.5.1 : intégration du design commun de Claude (surfaces translucides, vidéo Studio dans tous les onglets, lignes de morceaux partagées et accueil en trois étapes). Découvrir s’ouvre assez large pour garder recherche et chat lisibles ; les commandes du chat expliquent la différence entre lancer et ajouter à la suite.

- Chat DJ : la source (YouTube / playlists / Partout) est indépendante de l’intention. Une demande de lecture lance maintenant, « à la suite » ajoute sans interrompre, « cherche » propose des cartes. « Suivant » agit immédiatement sans attendre l’IA ; une recherche tardive ne remplace plus ce choix. Les recherches seules ne changent pas la direction musicale des suites automatiques. Les suites respectent la source choisie, avec exclusion des morceaux déjà joués/en file aussi sur YouTube et au plus deux tentatives.

- DJ Découvrir : conserve la sélection choisie par le modèle même s’il utilise le champ habituel de lecture ; ne réintroduit pas tous les candidats dans les cartes.

- Découvrir : identité visuelle distincte pour un morceau présent dans les deux sources ; le filtre de playlist conserve la bonne ligne et ses actions.

- Réglages : une clé refusée par Google avec une réponse 400 reçoit le même message explicite que les refus 401/403.

- Découvrir : recherche YouTube limitée à la musique ; aperçu de trois résultats privés pour garder les découvertes visibles en mode Partout.

- Découvrir : recherche groupée dans les playlists du compte et sur YouTube, pagination YouTube, cartes dans le chat et ajout explicite dans Mes découvertes. Recherche et ajout partagent les mêmes services, sans modifier la file tant qu’aucune action de lecture n’est choisie.
- Clé Gemini : vérification avant remplacement et test du DJ et de la voix depuis Réglages, sans enregistrer la clé testée. Le karaoké et l’onglet Paroles sont conservés dans l’app 1.5.0.


### Mode karaoké (ticket #3)

- Onglet « Paroles » dans le panneau de session : ligne chantée remplie progressivement, défilement automatique, clic sur une ligne pour y aller, boutons « Plus tôt / Plus tard » mémorisés par compte et par vidéo. En Studio, bouton « Karaoké » qui affiche les lignes en grand sur le clip.
- Serveur : `GET /v1/lyrics/:videoId` et `POST /v1/lyrics/:videoId/offset`. Paroles LRCLIB cherchées depuis le titre YouTube, version la plus proche en durée, gardées 30 jours (absences réessayées après 7 jours), appels identifiés, en série, respectant `Retry-After`. Migration additive : tables `lyrics` et `lyrics_offsets`.
- Lecteur YouTube intégré : la vidéo remplit enfin le cadre (le style injecté était refusé par la politique de sécurité de la page).

- App Mac 1.4.8 (23) : direction musicale séparée du chat, six demandes récentes conservées, historique réel et file ordonnée transmis au DJ. La dernière demande a priorité et peut interrompre une recherche en cours. Une suite vide ou répétée déclenche au maximum une recherche différente, ouverte à des artistes proches si les contraintes le permettent, puis attend une relance explicite. Les identifiants déjà rencontrés restent exclus des suites automatiques toute la session, même après les 200 entrées d’historique visibles ; rejouer un titre explicitement reste possible. Les annonces ne citent plus les titres éliminés comme répétitions.

- App Mac 1.4.7 (22) : panneau Compact/Studio repliable, onglets DJ / À suivre / Historique, file complète réordonnable par flèches sans changer le titre en cours. Lecture immédiate d’un titre futur sans perdre les autres ; historique de session des titres terminés, passés, remplacés et indisponibles.
- Suivant reste disponible pendant une recherche : la demande attend la réponse si la file est vide. La suite est recherchée une fois dans les trente dernières secondes du dernier titre ; une réponse vide ou une erreur propose de réessayer. Les clips indisponibles sont passés avec une limite de trois échecs consécutifs. La relance transmet l’envie précédente dans le contexte, sans la faire interpréter comme une nouvelle liste de titres. Annulation et changement de compte ignorent les réponses tardives ; préchargement du clip et de la voix actualisé après réordonnancement.

- App Mac 1.4.6 (20) : recherche directe artiste/titre sans inférence, tolérance aux petites fautes et préfixes, rejet des correspondances partielles inventées, vérification des genres pour les recherches d’ambiance ; les souvenirs décrits en langage naturel restent orientés vers la recherche sémantique.
- Voix : une seule annonce suivante préparée en mémoire dans les vingt dernières secondes, si la voix et l’enchaînement sont actifs ; réutilisée au passage suivant, effacée au changement de compte ou de demande.
- Studio : 1080p par défaut, option jusqu’à 4K sur les Mac décodant l’AV1 ; cache séparé par qualité (2/6 Go), pochette plein cadre et indicateur de préparation conservés jusqu’à la lecture native, sans petit lecteur intermédiaire. Le morceau suivant est préchargé. Changer de mode ou de qualité conserve la position et la pause. Design Compact/Studio conservé ; résolution réellement décodée affichée dans Réglages. Les annotations [4K] ne bloquent plus les demandes de titres exacts.

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
