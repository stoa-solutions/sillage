# Changelog

## Non publié

- Agents du DJ côté serveur : profils qui changent le ton et les préférences du DJ sans toucher à ses règles. Quatre agents de base (Le DJ, Le Disquaire, L’Archiviste, Focus) et agents personnalisés par compte dans `dj_agents` (`/v1/dj/agents`), choisis par `agentId` dans `/v1/dj/chat`, suites comprises. Un agent inconnu ou supprimé repasse sur l’agent par défaut ; le journal garde l’agent utilisé. Scénarios `--suite agents` dans le banc d’évaluation. Sur Mac : pastille d’agent dans la barre de chat et page Réglages → Agents (choisir, dupliquer, créer, modifier, supprimer) ; `/règles` montre le profil de l’agent choisi. Mettre à jour le serveur avant l’app : sans agents côté serveur, la pastille reste cachée.

- Sillage 1.8.3 (74) : nouvelle construction locale depuis main, incluant les derniers contrôles de barre des menus, la pastille d’écoute et les messages en attente. Les sauvegardes d’installation se conservent en ZIP pour ne plus apparaître comme des applications dans macOS ; le prototype d’agents reste sur sa branche de développement.

- Extension Chrome retirée du dépôt : le produit se compose du serveur et de l’app Mac. Les jetons personnels existants restent valides pour les scripts et le MCP.

- Serveur refondu, sans changement de données pour une base existante : schéma PostgreSQL décrit avec Drizzle et migrations versionnées appliquées au démarrage de l’API sous verrou ; valeurs fixes (tâches, playlists, écoutes, paroles, DJ) en enums PostgreSQL ; code rangé en modules (contrôleur, service, dépôt, schémas, `index.ts`), clients externes dans `integrations/` ; TypeScript très strict ; image Docker qui exécute un bundle esbuild ; documentation OpenAPI générée entièrement depuis les routes ; configuration vérifiée au démarrage de chaque processus, avec le nom des variables invalides ; image démarrée sur une base vide en CI ; contrainte d’une seule API documentée. Un JSON mal formé répond désormais 400 au lieu de 500.

- Refonte du Tour DJ : une seule décision par réponse du modèle, avec sa raison au journal. Une question n’est plus refusée comme « sélection illisible » parce qu’elle ressemble à un ordre ou que le modèle écrit `null` ; une identification sourcée garde ses mots et toutes les cartes proposées sont nommées. Un Tour à la fois par compte : les demandes tapées attendent leur tour sur le Mac (« En attente », retrait, « Envoyer maintenant »), la suite automatique passe après et n’est plus refusée en 429 ; attente d’une place au lieu d’un refus quand le DJ est très demandé ; 180 s de réflexion ; plus de Tour bloqué « en cours » après un redémarrage. Mémoire de conversation reconstruite depuis le journal (20 échanges, ce qu’un Tour interrompu avait exploré). Suite demandée en `continuation: {count, broaden}` plutôt qu’en phrase. Nouvel outil `library_browse` à la place de `library_overview` : titres par date d’ajout, playlist nommée, artiste ou genre. Code DJ regroupé dans `apps/server/src/modules/dj/`, modules de règles purs vérifiés par `check:architecture`.

- Sillage hors de sa fenêtre : arche Sillage dans la barre des menus (lecture, réponse du DJ, micro, demande écrite), raccourci global `⌥ ⇧ Espace` modifiable pour parler au DJ depuis n’importe quelle app (maintenir ou appui bref), pastille d’écoute animée sortant de l’encoche puis carte du morceau lancé (pochette, progression, lecture/suivant), choix Mes playlists / YouTube / Partout dans le menu, musique baissée pendant la dictée, Centre de contrôle et touches média. Nouvelle page Réglages → Bureau avec aperçu. Compact ne se redimensionne plus sous la hauteur de son contenu.

- Sillage 1.8.2 (73) : connexion Google et lecteur sur `sillage.stoa.solutions`, reprise des sessions hébergées existantes sans changer leur jeton ni la bibliothèque, configurations de serveurs personnels conservées.

- Sillage 1.8.1 (72) : préparation d’un DMG universel au nom Sillage, notice Gemini/Claude, quota personnel explicite dans l’accueil, signatures imbriquées de Sparkle et contrôles Apple obligatoires pour une publication publique. Les aperçus restent identifiés et les mises à jour automatiques sont désactivées sans configuration explicite.

- Sillage 1.8.0 (71) : choix Gemini ou Claude dans l’accueil et les réglages, clés conservées séparément, reprise d’une clé enregistrée sans nouvelle saisie et voix macOS avec Claude. Livraison du transport AI SDK natif côté serveur.

- DJ multi-fournisseurs avec AI SDK : connecteurs natifs Gemini et Claude, clés et modèles conservés séparément par compte, migration des réglages Gemini existants sans nouvelle saisie. Choix dans l’accueil et les réglages Mac, vérification avant remplacement, voix macOS avec Claude. Les outils MCP, la validation des morceaux et les limites du DJ restent en place. Aucun changement de fournisseur facturé automatique.

- Intelligence du DJ : recherche exploratoire et composition finale séparées, conservation des candidats et des sélections partielles, choix proposés si le modèle ne conclut pas. Recherche MCP avec artiste distinct des styles et jusqu’à deux formulations alternatives en parallèle, résultats entrelacés, tutoriels manifestes écartés des ambiances et erreurs partielles conservées. « Sans le lancer » reste une proposition ; taille demandée respectée et explication musicale séparée de l’annonce de la file. Aucun changement de design ni de lecteur. Régressions issues du journal et simulation HTTP Postman.

- Sillage 1.7.9 (70) : icônes sobres dans la Bibliothèque et Découvrir (tuiles neutres, symboles fins, simples glyphes pour les recherches et envies), paroles synchronisées sans vide au-dessus de la première ligne, « Reprendre le suivi » lisible, durées longues sur une ligne.

- Sillage 1.7.9 (69) : Studio adaptatif jusqu’à 760 de large (panneau DJ de 300 à 360, marges réduites, commandes en icônes au besoin) ; le titre et le chat ne sortent plus de la fenêtre.

- Sillage 1.7.9 (68) : relecture de la 67. Fenêtre sans maximum rigide (bannières et plein écran ne coupent plus la poche ; une poche repliée revient à sa hauteur après un redimensionnement), clic droit et « Ouvrir sur YouTube » sur toutes les lignes, ajout à Mes découvertes au menu et à VoiceOver, colonnes alignées dans les résultats, raccourcis de Découvrir visibles quand la barre latérale est masquée, bouton de retour à « Pour toi », barre latérale partagée avec la Bibliothèque.

- Sillage 1.7.9 (67) : Découvrir reprend le design de la Bibliothèque (barre latérale, en-tête, mêmes lignes, recommandations en liste). Onglets revenus dans le Compact (Studio en icône), redimensionnement borné (Compact jusqu’à 620, hauteur de la poche quand le panneau est replié), curseurs sans focus parasite au lancement.

- Sillage 1.7.9 (66) : alignement sur la planche « Atelier de lumière » à la demande de Samuel. Barre latérale à un tiers de la fenêtre (220 à 380 points), titre en lecture en orange en sombre comme en clair, poche Compact sans onglets (⌘1, ⌘2, ⌘3 pour DJ, Bibliothèque, Découvrir), commandes de la poche dans l’ordre de la planche.

- App 1.7.9 (58) : interface Sillage « Atelier de lumière » (cahier des charges UI) : apparence claire et sombre selon le système, vitre chaude sur la lumière Stoa (opaque avec Réduire la transparence), une seule palette contrôlée (textes ≥ 4,5:1, aussi mesurés sur le rendu). Compact à la taille de son contenu (≈ 520 × 224, panneau plafonné à 560, retour à sa place sans dérive). Bibliothèque et Découvrir d’un seul tenant : barre latérale, filtre en haut, en-tête compact, lignes en colonnes ; résultats de recherche en liste avec aperçu, recommandations en grille. Barre de lecture d’un bord à l’autre avec mini-clip (même lecteur, même audio ; pochette en repli).

- Journal DJ privé en PostgreSQL : conversations, demandes, réponses complètes, source choisie et effective, propositions, appels d’outils et durées, modèle et version serveur. Les actions et messages réellement affichés par le Mac sont corrélés aux tours du serveur, avec envois idempotents. Aucun anonymiseur de contenu ; clés configurées et jetons non collectés. Six routes authentifiées documentées dans Swagger/Postman, pagination et effacement par compte. App Mac 1.7.8 (57).

- Développement : accès personnel séparé pour Swagger et Postman via le serveur local, sans recopier de session de l’app ni ajouter de rôle administrateur global ; jeton privé, création idempotente et révocation indépendante.

- Mac 1.7.7 (build 56) : le panneau DJ de Découvrir se replie réellement, libère la place et propose sa réouverture. La recherche, la lecture et l’état partagé avec DJ sont conservés ; parcours de régression ajouté pour l’interface installée.

- Développement : documentation OpenAPI des routes serveur, collection Postman locale sans secrets et Swagger réservé au Mac du développeur ; connexion Google, isolation des comptes, clés Gemini et fonctionnement de Découvrir documentés.

- Mac 1.7.6 (build 55) : reconstruction universelle locale depuis main après intégration des correctifs serveur du DJ et de recherche ; identité Sillage et signature locale conservées.

- Recherche : les noms à apostrophe gardent aussi leur forme séparée issue de la dictée (« M’Dee », « MDee », « M Dee ») ; une correspondance exacte dans le titre d’un autre morceau n’écarte plus les collaborations créditées. Cas reproduit avec le modèle réel et couvert dans PostgreSQL.

- Mac 1.7.5 (build 54), Sillage — by Stoa : nouveau nom affiché, icône orange haute résolution pour Mac et Chrome, signature Stoa et accents visuels harmonisés. Identifiants de connexion, dossiers de données, exécutable et compatibilité des mises à jour conservés.

- DJ : les confirmations peuvent recevoir une réponse naturelle sans nouvelle recherche ni changement de lecture ; crédits récents relus pour le compte courant, rappel de recherche borné et priorité aux demandes musicales face aux indices géographiques. Recherche lexicale des petites fautes et apostrophes de noms avant les vecteurs, sans alias d’artiste codés en dur. Pilote AI SDK indépendant du transport de production.

- Expérience Mac isolée : MixLab utilise AudioKit 5.7.2 pour comparer passage direct, fondu de quatre secondes et transfert progressif des basses. Rendus hors ligne testés sur signaux 44,1/48 kHz et deux extraits déjà en cache. Aucun branchement au lecteur installé ; démonstrations, mesures et retour arrière documentés.

- Mac 1.7.4 : préparation des clips avec le moteur JavaScript Node installé explicitement indiqué à yt-dlp, sinon comportement Deno habituel. Les erreurs de préparation native sont visibles pendant la lecture YouTube et peuvent être retentées sans redémarrer le morceau. Circuit réel vérifié sur « Réseaux » de Niska en AV1 2160p, sans proxy ni cookie.

- Mac 1.7.3 : contraintes de fenêtre uniques (600 points en DJ Compact, 900 en Studio et dans les pages de lecture) ; fonds des commandes du haut inclus dans leur fondu, sans capsule système indépendante. Paroles en panneau latéral avec présentation commune du texte simple et synchronisé, arrivée sur la ligne en cours à l’ouverture, suivi suspendu au défilement manuel et reprise explicite. Prélecture partagée, cache mémoire limité à 32 titres, protection des corrections contre les réponses tardives et retour visible si leur enregistrement échoue. Tests de cycle de vie et rendus SwiftUI hors écran, sans interrompre l’app utilisée.

- Lecture : erreurs YouTube conservées avec leur code ; les problèmes d’accès, de réseau ou de configuration arrêtent la cascade et gardent le titre et la file. « Réessayer ce titre » relance la sélection actuelle ; les signaux tardifs d’un échec ne passent plus plusieurs morceaux. Le cache Studio classe ses erreurs sans exposer la sortie brute du téléchargeur. Aucun proxy activé.
- Chat : citations numériques reliées aux sources vérifiées, liens Markdown de référence et code respectés ; le texte reste sélectionnable. Préparation du clip affichée discrètement ; boutons sur une ligne ou deux rangées selon la place, sans libellés cassés ; hauteur du clip Compact adaptée pour garder le chat visible ; agrandissement Studio/Découvrir limité à l’écran disponible ; fondu Studio conservé. App Mac 1.7.2.

- Studio : efface aussi les fonds de verre partagés de la barre d’outils macOS pendant le fondu, sans déplacer le clip.

- Studio : commandes, titre, navigation et boutons de fenêtre s’effacent en douceur après trois secondes sans interaction, puis reviennent à la souris ou au clavier ; pause, chargement et pages de lecture gardent les commandes. Le chat ouvert reste visible, le dégradé du clip s’atténue et les animations respectent Réduire les animations.
- Lecteur YouTube natif : mode discret avec commandes et sous-titres non forcés, annotations désactivées et survol du lecteur évité ; les commandes Recall et le plein écran de la fenêtre restent disponibles. Certains éléments YouTube imposés à la pause restent possibles.
- Chat : rendu Markdown natif (titres, listes, citations, code, gras et liens sélectionnables) et suppression du message technique Google/DuckDuckGo en cas de repli réussi. App Mac 1.7.1.

- DJ : outil `seekInformation` pour les questions sur les artistes, morceaux et albums, avec recherche Web SearXNG, sources numérotées cliquables et lecture conservée. Google et DuckDuckGo restent accessibles sans proxy ; les pannes ou le recours à DuckDuckGo sont signalés.
- Découvrir : recherche de clips dans la catégorie Musique confirmée par YouTube et vérification des crédits d’artiste pour éviter les homonymes (livres audio, conférences ou titre portant seulement le nom d’un autre artiste) ; les imports généraux restent compatibles.
- Découvrir : propositions dès l’accueil à partir des écoutes du compte et des genres MusicBrainz, avec raison affichée, lecture, ajout à la suite, enregistrement et actualisation ; morceaux déjà écoutés ou dans la bibliothèque exclus. App Mac 1.7.0.

- Recherche YouTube : SearXNG privé partagé par Découvrir et le DJ, sans appel au quota Google de recherche. Les métadonnées et la disponibilité restent vérifiées par YouTube ; cache public avec appartenance recalculée par compte et erreurs explicites du moteur. Aucun changement du design.

- Recherche : erreurs explicites dans Découvrir et le chat DJ (source, quota quotidien, débit, configuration ou panne), heure prévue de renouvellement YouTube et distinction avec la clé Gemini personnelle. Les résultats partiels restent utilisables et leur limite est annoncée.

- DJ : distingue le quota quotidien YouTube des pannes temporaires, continue les recherches courtes dans les playlists en mode Partout et explique les résultats partiels. Une sélection partielle reste une demande de lecture ou d’ajout, sans devenir automatiquement des cartes à choisir. Les identifiants de playlists inventés sont signalés comme paramètres invalides, sans effacer les candidats déjà trouvés. Les recherches YouTube épuisées ne sont plus répétées jusqu’au renouvellement du quota ; les imports et métadonnées restent indépendants.

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
