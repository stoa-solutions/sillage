# Playlist Recall pour Mac

État actuel : comptes et données sur serveur, session persistante sans Trousseau (1.4.1). Les sections ci-dessous conservent l’historique des versions ; la dernière section décrit le stockage actuel.

App native SwiftUI pour macOS 14 ou plus récent, compilable pour Apple Silicon et Intel. Elle ne charge pas l’interface de l’extension : le micro, les contrôles et les réglages sont natifs. WebKit est réservé au lecteur officiel YouTube.

## Fonctionnalités et données

- Conversation avec Gemini 3.5 Flash-Lite par défaut pour la réactivité. Gemini 3.8 Flash et Argon sont sélectionnables, avec raisonnement faible.
- Clé Gemini et connexion serveur dans le Trousseau, non synchronisées par iCloud. Les champs ne réaffichent pas les secrets.
- Micro au clic via AVAudioEngine et Speech : français sur l’appareil lorsque pris en charge, sinon service Apple. Arrêt après une courte pause ou au second clic.
- Synthèse vocale Gemini, lecture WAV par AVAudioPlayer, voix macOS en secours. Baisse puis restauration du volume musical.
- Lecteur YouTube, pause, suivant, enchaînement, gestion des intégrations interdites et lien externe.
- Serveur privé facultatif : bibliothèque synchronisée et recherche hybride via `/v1/search` pour le DJ, avec exclusion des titres en file.
- Mode local : import JSON Recall/yt-dlp et liens YouTube publics ou non répertoriés, playlists ordonnées et recherche FTS5. Réimporter un lien actualise la playlist. L’inférence vectorielle et la synchronisation périodique restent celles du serveur facultatif.
- Cache serveur et bibliothèque locale séparés dans SQLite, dans `~/Library/Application Support/Playlist Recall/`. Les anciens JSON sont conservés et migrés sans suppression.
- Exports limités aux vidéos : aucune clé ni connexion privée. L’app redistribuée ne contient ni catalogue personnel, ni clé, ni jeton.

Les appels Gemini directs sont facturés au projet de la clé de l’utilisateur ; ils ne passent pas par le plafond quotidien du VPS. Les conversations et métadonnées utiles sont transmises à Google. YouTube reçoit les identifiants lus, et ceux des miniatures affichées dans la bibliothèque (i.ytimg.com) ; les photos de chaîne viennent de yt3.ggpht.com. Le lecteur public est hébergé sur Recall Stoa et ne reçoit pas le jeton ou la clé Gemini. Aucun identifiant personnel n’est préconfiguré dans le paquet public.

Chaque serveur garde une bibliothèque commune à ses jetons, pas un compte isolé par personne. Ne pas distribuer le jeton personnel de Samuel avec l’app. Pour partager l’app, envoyer uniquement l’archive générée.

## Organisation

| Module | Rôle |
| --- | --- |
| `RecallKit/HTTPClient.swift` | API privée authentifiée, pages de recherche et résumé de la bibliothèque. |
| `RecallKit/DJ.swift` | Tour de DJ : `DJRequest` et `ServerDJ`, qui délègue le tour au serveur. |
| `RecallKit/ServerPlaylistImporter.swift` | Liens YouTube validés, import par le serveur et attente d’une synchronisation fraîche. |
| `RecallKit/ServerLibraryOverview.swift` | Nombre de vidéos et playlists du serveur. |
| `RecallKit/PlaybackQueue.swift` | File de lecture : remplacement, ajout, fin de morceau, continuation. |
| `RecallKit/CredentialFile.swift` / `GoogleCallback.swift` | Session privée hors Trousseau ; retour de connexion Google à usage unique. |
| `RecallKit/Models.swift` | Contrats et décodage des vidéos renvoyées par le serveur. |
| `RecallAudio/Microphone.swift` | Autorisation, capture, dictée et arrêt. |
| `RecallMac/Session.swift` / `SessionStore.swift` / `GoogleSignIn.swift` | Compte, connexion serveur et session. |
| `RecallMac/LibraryModel.swift` | Pages de la bibliothèque serveur, recherche et import par lien. |
| `RecallMac/DJModel.swift` / `VoiceOutput.swift` | Conversation, file, micro ; voix du serveur ou voix macOS de secours. |
| `RecallMac/Player.swift` | WebKit et messages du lecteur strictement contrôlés. |
| `RecallMac/RecallApp.swift` | Cycle de vie, fenêtres et Sparkle. |

La bibliothèque réside uniquement sur le serveur (décision [0002](adr/0002-server-only-mac-library.md)). Les lignes de résultats et de file sont identifiées par position, car une playlist ou la file peut répéter une vidéo.

Les accès au Trousseau sont lancés hors du thread de l’interface, afin qu’une demande macOS ne bloque pas la fenêtre. Une compilation locale ad hoc peut nécessiter de réautoriser le nouveau binaire à lire les clés existantes. Une identité Developer ID stable sera nécessaire pour rendre la distribution publique plus fluide.

## Développement

Prérequis : macOS, outils de ligne de commande Apple avec Swift 5.10 ou ultérieur, Node.js pour les tests de l’API. Sparkle 2.10.0 est épinglé via Swift Package Manager.

Les builds de développement partagent sinon la bibliothèque réelle : lancer les essais avec `RECALL_DATA_DIR=<dossier temporaire>`.

```sh
npm run verify:macos
swift build --package-path apps/macos -c release
python3 scripts/build-macos.py --universal
```

Les contrôles natifs sont un exécutable autonome, sans dépendance à XCTest ni obligation d’installer Xcode complet. Ils vérifient les formats, l’isolation des caches, les recherches longues/accentuées, les exclusions, les sélections inventées, les URL et le WAV.

La compilation produit `.output/macos/Playlist Recall.app`, une archive ZIP et `release.json`. La signature ad hoc permet les essais locaux ; elle ne constitue pas une notarisation Apple.

`--skip-update-signature` permet uniquement de préparer une archive de test si l’accès au Trousseau pour le signataire n’a pas encore été autorisé. Cette archive est refusée par le générateur de flux de mises à jour.

## Mises à jour

Sparkle vérifie automatiquement `https://recall.stoa.solutions/macos/appcast.xml`. Sa clé publique Ed25519 est incluse dans le paquet ; la clé privée de signature est stockée dans le Trousseau, compte `recall-macos-updates`. Ne jamais inclure la clé privée dans Git ou le paquet.

Le serveur retourne un flux vide tant qu’aucune version signée n’a été publiée : aucun faux succès de téléchargement ou d’installation n’est affirmé. Le menu « Rechercher des mises à jour… » utilise Sparkle. La validation d’une mise à jour exige aussi un essai réel avec une version ultérieure.

Pour une future version :

1. Incrémenter version et numéro de build dans la commande de compilation.
2. Compiler, autoriser `sign_update` à accéder à sa clé si macOS le demande, puis vérifier la signature.
3. Pour une publication publique, définir `MAC_SIGNING_IDENTITY` et un `MAC_NOTARY_PROFILE` déjà configuré dans le Trousseau. Le script soumet à Apple, vérifie le statut Accepted, agrafe puis valide le ticket avant de créer l’archive finale. Aucun compte ou certificat Apple Developer n’est actuellement configuré sur ce Mac.
4. Générer le flux depuis l’archive signée : `python3 scripts/prepare-macos-update.py`. L’option `--allow-local-beta` est réservée aux essais explicitement acceptés sans notarisation.
5. Copier l’archive puis le flux dans `/srv/playlist-recall/releases/` sur Stoa. Le flux doit être publié en dernier, de façon atomique. Le conteneur API ne dispose que d’un montage en lecture seule.
6. Vérifier depuis une ancienne version de l’app : détection, signature, téléchargement, remplacement, relancement et conservation du Trousseau et de la bibliothèque.

La configuration Sparkle n’est pas la preuve d’une mise à jour effectivement installée. La première version locale conserve les éventuelles confirmations de sécurité de macOS ; ne pas désactiver Gatekeeper.

Sources : https://sparkle-project.org/documentation/ et https://developer.apple.com/developer-id/


## Mesures réalisées pendant le développement

Sur un même petit catalogue réel fourni aux modèles, les réponses ont pris 3,80 s (Argon, raisonnement faible), 2,88 s (3.8 Flash, faible) et 1,57 s (3.5 Flash-Lite). Il s’agit d’un seul échantillon par modèle, pas d’un benchmark statistique.

Avec le client natif, le vrai serveur MCP et la bibliothèque complète, « Self Care » a été retrouvé en 10,34 s avec 3.8 Flash et 2,05 s avec Flash-Lite. Ces mesures incluent des états de cache potentiellement différents ; elles ne permettent pas d’attribuer tout l’écart au modèle. La voix native a renvoyé un WAV valide. La capture du micro et l’écoute réelle dans la fenêtre nécessitent encore la validation des autorisations macOS par l’utilisateur.

## Dictée : revue du 25 octobre 2026 (version locale 1.0.1)

L’ancienne app a reproduit « La dictée s’est interrompue » ; le chat et la lecture de Self Care fonctionnaient dans la même session. La cause précise renvoyée par Apple n’était pas exposée par l’ancien gestionnaire. Les défauts de cycle de vie suivants ont été corrigés :

- Annulation pendant une autorisation en attente : un second clic annule le démarrage, sans créer une deuxième session. Les retours tardifs sont ignorés.
- Fin de dictée : arrêt de la capture puis `endAudio()` et `finish()`, attente du résultat final (au maximum quatre secondes), un seul envoi au DJ. Annuler n’envoie rien.
- Moteur recréé à chaque session et validation du taux d’échantillonnage et du nombre de canaux matériels avant installation du tap.
- Reconnaissance locale Apple non forcée : la disponibilité déclarée ne garantit pas que les ressources françaises locales sont opérationnelles. Le service Apple peut traiter l’audio en ligne.
- États visibles : préparation, écoute avec texte partiel, finalisation ; bouton Annuler. Limite de 55 secondes et fin après trois secondes sans changement de transcription (heuristique de texte, pas un détecteur de silence audio).

`RecallAudio` isole la dictée de l’interface. `npm run test:macos` inclut cinq régressions de permissions/annulation, en plus des quatorze contrôles métier. Ces tests n’enregistrent pas de son et ne remplacent pas une validation matérielle.

La version universelle a été compilée, vérifiée et installée. Lors du test de la version corrigée, macOS attendait encore la permission ; aucune transcription humaine réussie n’a donc été constatée à ce stade. Essai restant : autoriser Microphone et Reconnaissance vocale pour Recall, dire une demande, vérifier les mots finaux et un seul envoi au DJ, puis répéter après annulation et changement d’entrée audio.

Références Apple :
- https://developer.apple.com/documentation/speech/sfspeechrecognitiontask
- https://developer.apple.com/documentation/speech/sfspeechaudiobufferrecognitionrequest
- https://developer.apple.com/documentation/AVFAudio/AVAudioEngine/inputNode

## Plein écran et identité locale (1.0.2)

Le lecteur active désormais `WKPreferences.isElementFullscreenEnabled`. Il est hébergé dans un conteneur NSView avec redimensionnement par masque d’autoresizing : SwiftUI contraint le conteneur, pas directement WKWebView. Cela applique le contournement du défaut de reparentage décrit dans https://www2.webkit.org/show_bug.cgi?id=313802. Le lecteur utilise aussi la hauteur disponible lorsque la fenêtre est agrandie.

L’entrée en plein écran de la fenêtre a été observée dans l’app. Le cycle vidéo plein écran puis retour reste à vérifier après installation de la version finale.

La signature ad hoc identifie une compilation par son hash : un changement de code peut donc redemander l’accès au Trousseau et au micro. Pour les essais sur ce Mac, une identité locale persistante est conservée dans le Trousseau ; seul son identifiant public est enregistré dans `~/.config/playlist-recall/local-signing.json`. Le script de compilation réutilise cette identité lorsque `MAC_SIGNING_IDENTITY` n’est pas fourni. Aucune clé privée n’est incluse dans le dépôt ou le ZIP et aucune confiance racine système n’est ajoutée. La signature locale ne remplace pas Developer ID ni la notarisation pour une distribution publique.

Une autorisation initiale peut rester nécessaire après le changement d’identité. Le choix « Toujours autoriser » dans la fenêtre du Trousseau permet de retenir l’accès à cette identité, sans donner l’accès aux autres apps. Le comportement entre deux versions effectivement signées reste à valider.

Références : https://developer.apple.com/documentation/webkit/wkpreferences/iselementfullscreenenabled et https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements

Validation locale : deux binaires reconstruits avec des changements de code ont présenté la même exigence désignée (identifiant de bundle et empreinte du certificat local), puis ont passé `codesign --verify --deep --strict`. La version finale 1.0.2 a été installée ; le Trousseau a été retrouvé et la synchronisation serveur observée après relancement. Cela valide la stabilité de l’identité ; l’absence totale de nouvelles fenêtres de mot de passe n’a pas encore été confirmée par l’utilisateur. Le test interactif du plein écran vidéo a été interrompu par des interactions utilisateur, donc son cycle entrée/sortie reste à confirmer.

## Version 1.1.2 — bibliothèque locale et liens YouTube

Dans Bibliothèque, choisir « Sur ce Mac ». Pour récupérer les données déjà synchronisées, le bouton « Garder une copie sur ce Mac » fusionne le cache serveur dans la bibliothèque locale, sans retirer la connexion serveur.

1. Ajouter sa clé **YouTube Data API** dans Réglages (distincte de la clé Gemini, enregistrée une seule fois dans le Trousseau). L’API doit être activée pour ce projet et les restrictions de la clé doivent permettre l’usage depuis le Mac ; une clé limitée à l’adresse IP du VPS ne fonctionnera pas ici.
2. Coller un lien `https://www.youtube.com/playlist?list=…` ou `watch?...&list=…`, puis « Importer sur ce Mac ».
3. Choisir la playlist dans le filtre pour retrouver son ordre. Les vidéos privées/supprimées sont ignorées et leur nombre est indiqué. Les playlists privées nécessiteraient OAuth et ne sont pas prises en charge.
4. En cas de quota, panne ou annulation, réutiliser le même lien pour reprendre. La playlist n’est enregistrée qu’une fois la récupération terminée. Réimporter un lien terminé actualise son contenu sans multiplier les fiches vidéo.

Le stockage est `library.sqlite` dans Application Support/Playlist Recall, avec tables de sources, vidéos, playlists, positions et index FTS5. Les anciens JSON restent présents pour récupération. Les points de reprise se trouvent dans `imports/` et ne contiennent aucune clé. Au-delà de 24 h, l’import repart de la première page : les jetons de page YouTube décrivent la playlist à un instant donné. Le groupe « Autres vidéos » d’un export redevient des vidéos sans playlist à l’import. Les exports conservent les collections et leur ordre, dans le format Recall.

L’écran et le DJ lisent les résultats locaux indexés, avec des pages de 100 résultats pour l’écran. Le compteur total est distinct de la page affichée. Aucun catalogue personnel n’est embarqué dans l’archive universelle. SQLite est celui de macOS : pas d’installation supplémentaire.

Validation : les contrôles métier/audio existants et `RecallLibraryTests` couvrent migration répétée, originaux préservés, appartenance multiple, ordre et répétitions, pagination, recherche accentuée/exclusions, rollback sur playlist invalide, isolation local/serveur, format export serveur, URL YouTube, absence de clé en query, quota/reprise et annulation/reprise. Un import synthétique de 10 000 vidéos a pris environ 0,3 s sur ce Mac ; ce n’est pas un benchmark réseau ni une garantie de volume. L’import réseau utilise un transport injecté dans ces tests ; un essai réel requiert une clé YouTube valide depuis le Mac.

Sources : https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list ; https://developers.google.com/youtube/registering_an_application ; https://www.sqlite.org/fts5.html

### Connexion privée consolidée (1.1.1)

Les trois anciennes entrées Trousseau (Gemini, serveur, YouTube) sont regroupées dans une seule entrée `credentials-v2`, appartenant à l’identité signée de Recall. Les accès et migrations sont sérialisés et le contenu reste en mémoire pendant la session. Les anciennes entrées sont conservées pour retour arrière, mais ne sont plus relues à chaque lancement après la migration. Une suppression explicite d’une clé retire également sa copie historique.

Sur ce Mac, la connexion connue a été installée dans cette entrée par un tube mémoire privé, sans fichier de clé ni secret dans l’archive. Un relancement normal de 1.1.1 a retrouvé la clé Gemini et l’adresse du serveur dans les réglages sans nouvelle étape de réimportation ni demande de mot de passe rencontrée pendant l’essai. Cela ne déverrouille pas le Trousseau global et ne dispense pas macOS de demander le mot de passe si la session/le Trousseau sont verrouillés.

Validation des données réelles : 2 690 vidéos locales et 2 690 vidéos dans le cache serveur, contrôle SQLite `quick_check=ok`, fichiers JSON d’origine et copie privée de migration conservés. La copie locale issue de l’ancien cache plat possède une collection historique ; les nouveaux imports et exports conservent leurs vraies playlists. La recherche FTS dans les données réelles retrouve Mac Miller.

La version et le numéro de build par défaut sont centralisés dans `apps/macos/version.json`. L’export inclut aussi les vidéos encore présentes dans la bibliothèque mais sorties de leurs playlists, dans « Autres vidéos ».

## DJ Apple local et installation 1.2.0

Le mode Apple est activé par défaut. Il exige macOS 26 et Apple Intelligence disponible ; la bibliothèque et Gemini optionnel restent compatibles macOS 14. Aucune requête Gemini ni synthèse vocale distante n’est effectuée en mode Apple. Foundation Models utilise deux schémas dynamiques : extraction de recherche puis sélection parmi un enum d’identifiants réels. Le filtrage d’un artiste/titre précis exige tous les mots dans le titre/chaîne, afin de ne pas substituer Chet Faker à Chet Baker absent. Les résultats restent vérifiés par Catalog.validateSelection. Il ne s’agit pas d’un index sémantique local ni d’une analyse audio. Les ambiances sont limitées par les métadonnées indexées.

Au démarrage en mode local Apple, aucun accès au Trousseau n’est nécessaire. Il est chargé à la demande dans Réglages ou lors d’un import par lien. Les anciennes clés restent conservées. Le micro utilise la reconnaissance Apple et la voix de réponse utilise AVSpeechSynthesizer ; la disponibilité hors ligne de la dictée dépend du Mac et des ressources installées.

Essai réel sur le Mac de développement (macOS 26.5.2) : sélection Mac Miller correcte depuis SQLite en environ 1,5–3 s ; Chet Baker et un artiste fictif absents produisent zéro titre après correction du filtrage. Ce sont des mesures ponctuelles, pas une garantie de latence. Les tests d’import couvrent pages, quota, annulation, reprise et expiration via transport injecté ; un import réel YouTube depuis le Mac reste à vérifier avec une clé YouTube valide.

Construire : `python3 scripts/build-macos.py --universal --dmg --skip-update-signature` pour une archive locale et un disque avec raccourci Applications et notice. Pour publier une mise à jour, omettre `--skip-update-signature` et terminer la signature Sparkle. Le DMG local ne supprime pas les avertissements Gatekeeper : Developer ID et notarisation sont requis pour la distribution publique fluide. Le script embarque uniquement le binaire, Sparkle, l’icône et une notice ; pas de bibliothèque ni de clés personnelles.

L’import officiel des playlists publiques/non répertoriées par lien demande une clé YouTube Data API personnelle, conservée au Trousseau. Il ne faut pas intégrer une clé de serveur dans l’archive redistribuée. L’authentification OAuth Google pour éviter la création manuelle de cette clé est une étape distincte, non livrée ici. Les playlists privées ne sont pas accessibles avec cette méthode.

Références : https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel ; https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models

## Retour au DJ Gemini, import via serveur et lecture 1.2.2

À la demande du propriétaire, Gemini et sa voix expressive redeviennent le parcours principal. Le modèle Apple reste optionnel, et le choix de la voix est indépendant du modèle. Sur ce Mac, les réglages sont Gemini 4 Argon, voix Gemini et bibliothèque serveur. Les clés déjà enregistrées sont réutilisées. Une nouvelle installation propose un accueil avec champ sécurisé de clé Gemini et import facultatif du fichier de connexion privé du serveur. Aucune clé CAEX ni connexion privée n’est incluse dans le paquet.

L’import par lien utilise `ServerPlaylistImporter` : contrôle de configuration YouTube, enregistrement de la demande, attente d’un `last_sync_at` réellement renouvelé, export de la seule playlist demandée et commit local transactionnel. La clé YouTube reste côté serveur. Une interruption de l’attente n’annule pas un travail déjà pris en charge par le serveur. Le bouton Actualiser YouTube lance une collecte réelle ; la bibliothèque serveur est relue toutes les minutes pendant que l’app reste ouverte. La collecte planifiée YouTube conserve sa cadence serveur de six heures.

Le compteur ne supprime plus les vidéos sans titre récupérable. Elles portent un libellé explicite et un marqueur `metadataUnavailable`, conservé dans les exports locaux ; le DJ ne les sélectionne pas. Lecture réelle constatée : 2 813 vidéos distinctes / 2 839 entrées de playlist, dont 123 sans titre récupérable. La synchronisation et l’import natif réels ont été vérifiés avec la playlist existante, et les mêmes nombres sont visibles dans SQLite et l’app.

La file de lecture est isolée dans `PlaybackQueue`. Une continuation ajoutée après la fin d’un morceau avance au premier nouveau titre ; une demande de remplacement repart de la nouvelle sélection. Le lecteur ignore une fin en double tant qu’un nouveau morceau n’a pas effectivement démarré. Les tests couvrent ajout pendant lecture, ajout après fin, réponse vide, remplacement et continuation automatique. Les messages de continuation sont également prononcés si la voix est activée (correction 1.2.2).

Validation réelle de Gemini 4 Argon et de la synthèse Gemini : Self Care, Ladders et Jet Fuel sélectionnés depuis le MCP, WAV valide de 319 076 octets, environ dix secondes pour ce scénario complet ponctuel. L’import réel natif a confirmé 2 813 vidéos et 2 839 entrées en environ trente secondes. Tests supplémentaires : attente de synchronisation, isolation d’une playlist dans l’export, vidéos sans titre conservées et annulation. Les tests de cycle micro restent des tests sans capture matérielle.


## Pagination et ajout de playlists (1.2.3)

La bibliothèque affiche des pages numérotées de 25, 50 ou 100 titres, le nombre de résultats, les commandes précédente/suivante et un accès direct à la dernière page. Un changement de recherche, de playlist ou de taille repart de la première page ; la synchronisation périodique conserve la page. Les totaux SQLite utilisent les mêmes filtres que les résultats et comptent les positions répétées d’une playlist. La recherche distante transmet offset/limit et utilise le total renvoyé par le serveur.

L’import YouTube capture la bibliothèque sélectionnée : « Ajouter au serveur » garde le mode serveur, « Ajouter sur ce Mac » conserve une copie locale après la collecte serveur. Le commit fusionne la playlist demandée sans supprimer les autres. Une fois terminé, le champ est vidé et la nouvelle playlist est sélectionnée. Le changement de source et la synchronisation sont désactivés pendant l’import. Les liens doivent être publics ou non répertoriés ; aucun accès OAuth aux playlists privées n’est ajouté.

Validation : tests SQLite de pages disjointes, dernière page, page vide, filtres FTS, positions répétées et ajout successif de deux playlists sans perte des précédentes. Dans l’app installée, dernière page 2801–2813/2813, recherche depuis cette page, filtre playlist 2839 entrées et pages de 25 vérifiés. Le réimport réel de la playlist existante a affiché « Playlist ajoutée au serveur : 2813 vidéos », avec source serveur maintenue. Deux pages de recherche distante Mac Miller ont renvoyé chacune 25 résultats distincts, total 223 au moment du test. Ce réimport ne constitue pas encore une preuve de l’ajout d’une deuxième playlist YouTube distincte en production.


## Bibliothèque exclusivement sur serveur (1.3.0)

L’app Mac n’utilise plus LibraryStore/SQLite. Elle ne lit et n’écrit aucune bibliothèque locale : les compteurs et listes viennent de status/playlists, les pages et recherches de search, et l’import attend la confirmation serveur sans télécharger l’export. La page consultée et la file sont conservées seulement en mémoire. HTTP utilise une session éphémère et le lecteur un stockage WebKit non persistant. Les clés restent au Trousseau et les préférences d’interface restent dans UserDefaults. Les anciens outils de migration locaux sont conservés dans RecallKit pour les tests et diagnostics historiques ; ils ne sont plus appelés par l’application.

L’interface retire le choix de source, la copie locale, l’import/export de fichiers musicaux et le DJ Apple. Gemini et sa voix sont conservés. Le DJ utilise le MCP et un complément de recherche paginée sur le serveur pour exclure les titres déjà en file. Un changement de connexion efface résultats, conversation et file en mémoire, et annule les requêtes précédentes. Cela prépare le client aux futurs comptes, sans prétendre que l’isolation multi-utilisateur du serveur existe déjà : les jetons du serveur actuel partagent toujours la bibliothèque.

Test réel : ajout depuis l’app de l’album Swimming, lien officiel YouTube obtenu via macmiller.lnk.to/swimming (OLAK5uy_m4OxKJ2yP_WXvaCsS29oby4It_AG7hm34). Le serveur confirme 13 entrées, et l’app montre les deux playlists. La playlist d’origine conserve exactement ses 2839 positions dans le même ordre. Total : 2823 vidéos distinctes (10 nouvelles, 3 déjà présentes). Le client natif sans SQLite a ensuite vérifié les deux playlists, deux pages disjointes, 80 candidats DJ et l’exclusion des titres précédents.

Sur le Mac de développement, les 2813 vidéos des anciennes copies locales et les anciens JSON ont été comparés au serveur : aucune vidéo exclusivement locale. Le dossier actif Application Support/Playlist Recall a été déplacé dans la Corbeille, de façon récupérable, avant l’ouverture de 1.3.0. La version ne doit pas le recréer. L’import et l’utilisation nécessitent une connexion Internet. Signature locale seulement ; notarisation et publication Sparkle restent distinctes.


Vérification après installation de 1.3.0 : l’interface affiche 2823 vidéos depuis le serveur et n’affiche plus le choix « Sur ce Mac ». Le dossier de bibliothèque locale n’est pas recréé après le chargement. Les réglages existants Gemini/voix sont conservés. La commande `RecallDiagnostics --server-sync <connexion privée> <lien>` permet de retester un import en production sans produire d’export ni de SQLite local.


## Connexion sans Trousseau (1.4.1)

Recall ne lit, ne migre et ne supprime plus aucun élément du Trousseau. Les anciennes entrées restent intactes. Seuls les jetons de session Recall révocables sont conservés dans `~/Library/Application Support/Playlist Recall/Session/session.json` (dossier 0700, fichier 0600, écriture atomique et verrou interprocessus, exclusion de sauvegarde). Ce fichier n’est pas chiffré et reste lisible par les applications de la même session macOS ; ce choix explicite privilégie l’absence de demandes de mot de passe. Aucune clé Gemini ou YouTube n’y est enregistrée. Bibliothèque, sélection et voix Gemini passent exclusivement par le serveur ; chaque compte Google utilise sa propre clé chiffrée côté serveur.

Aucune récupération automatique depuis le Trousseau : l’ancienne connexion peut être réimportée depuis son fichier privé existant, ou remplacée par la connexion Google. Une déconnexion retire le jeton local et révoque la session serveur. Google peut demander sa propre authentification lors d’une nouvelle connexion ; Recall ne peut pas supprimer les contrôles de Google. `RECALL_DATA_DIR` isole aussi le fichier de session pendant les tests. Le paquet distribué ne contient aucune session.


### Retour Google (1.4.2)

Le navigateur par défaut s’ouvre directement. Le lien `playlist-recall://auth` ne transporte qu’un code valable 90 secondes ; l’app ne l’échange qu’avec son vérificateur PKCE privé en mémoire. État aléatoire, validation stricte de l’URL, refus des doublons, consommation unique et expiration après 10 minutes protègent le retour. Aucun mot de passe Google n’est reçu par Recall. Cette voie remplace ASWebAuthenticationSession dont aucune fenêtre n’apparaissait sur le Mac de test.

## Studio personnel (optionnel)

Samuel a mis la distribution en attente et demandé un mode Studio pour son Mac.
Le DJ a deux affichages, choisis dans la barre d’outils. Compact : une colonne de 540 points
avec le lecteur YouTube, les contrôles et la conversation ; apparence du système. Studio : le
clip remplit la fenêtre sombre, la conversation flotte dans un panneau translucide. Studio ne
change que l’affichage ; la voix et l’enchaînement restent deux boutons du lecteur. Les clips publics
préparables sont lus avec AVPlayer en fond, avec préchargement du prochain titre.
Un téléchargement ou décodage impossible conserve le lecteur officiel YouTube.
Le téléchargement utilise l’installation Homebrew de yt-dlp et ffmpeg ; aucun cookie
Google, fichier de connexion ou paramètre du shell utilisateur n’est transmis.
Clips limités à 20 minutes, 720p H.264/AAC et 200 Mio après assemblage ; nettoyage
du cache vers 800 Mio en conservant les deux clips en usage. Le cache se trouve dans
`~/Library/Caches/Playlist Recall/Studio`, ou sous `RECALL_DATA_DIR` pour les essais.
Cette option crée seulement un cache vidéo : les playlists et clés restent côté serveur.
La distribution publique et les mises à jour automatiques ne sont pas publiées.


## Composition continue (1.4.8)

`DJComposition` conserve la direction musicale séparément des annonces affichées : les six dernières demandes, le titre en cours, les huit dernières issues de lecture et l’ordre des huit titres suivants constituent le contexte. La dernière demande prime en cas de conflit. Les métadonnées sont transmises comme données, pas comme instructions. Le chat visible reste borné à 24 messages, l’historique affiché à 200 entrées ; tout est en mémoire et réinitialisé au changement de compte.

`PlaybackQueue` garde aussi les identifiants rencontrés pendant toute la session, sans les oublier lorsque l’historique visible se réduit. Les réponses automatiques sont filtrées avant application et annonce ; les demandes explicites peuvent rejouer un titre. Les exclusions réseau privilégient la file actuelle puis les titres les plus récents, dans la limite de 100 identifiants du serveur. Le contrôle local couvre les identifiants plus anciens. Il ne reconnaît pas encore les rééditions du même enregistrement ayant des identifiants YouTube différents.

Chaque cycle de composition tente une sélection, puis au maximum une recherche élargie si rien de nouveau n’est accepté. L’élargissement respecte les restrictions explicites, mais peut découvrir des artistes proches au lieu de rester enfermé sur un artiste épuisé. Une erreur réseau n’est pas relancée automatiquement. Après un cycle vide ou annulé, les événements de progression et de fin ne relancent plus la recherche ; une nouvelle demande ou une relance manuelle la débloque. La suite est préparée dans les trente dernières secondes lorsqu’il reste au maximum un titre. Une nouvelle demande peut interrompre la préparation et invalide sa réponse tardive.
