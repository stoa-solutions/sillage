# Playlist Recall pour Mac — version locale 1.1

App native SwiftUI pour macOS 14 ou plus récent, compilable pour Apple Silicon et Intel. Elle ne charge pas l’interface de l’extension : le micro, les contrôles et les réglages sont natifs. WebKit est réservé au lecteur officiel YouTube.

## Fonctionnalités et données

- Conversation avec Gemini 3.5 Flash-Lite par défaut pour la réactivité. Gemini 3.8 Flash et Argon sont sélectionnables, avec raisonnement faible.
- Clé Gemini et connexion serveur dans le Trousseau, non synchronisées par iCloud. Les champs ne réaffichent pas les secrets.
- Micro au clic via AVAudioEngine et Speech : français sur l’appareil lorsque pris en charge, sinon service Apple. Arrêt après une courte pause ou au second clic.
- Synthèse vocale Gemini, lecture WAV par AVAudioPlayer, voix macOS en secours. Baisse puis restauration du volume musical.
- Lecteur YouTube, pause, suivant, enchaînement, gestion des intégrations interdites et lien externe.
- Serveur privé facultatif : bibliothèque synchronisée et recherche vectorielle via le vrai point d’entrée MCP `/v1/mcp` pour le DJ.
- Mode local : import JSON Recall/yt-dlp et liens YouTube publics ou non répertoriés, playlists ordonnées et recherche FTS5. Réimporter un lien actualise la playlist. L’inférence vectorielle et la synchronisation périodique restent celles du serveur facultatif.
- Cache serveur et bibliothèque locale séparés dans SQLite, dans `~/Library/Application Support/Playlist Recall/`. Les anciens JSON sont conservés et migrés sans suppression.
- Exports limités aux vidéos : aucune clé ni connexion privée. L’app redistribuée ne contient ni catalogue personnel, ni clé, ni jeton.

Les appels Gemini directs sont facturés au projet de la clé de l’utilisateur ; ils ne passent pas par le plafond quotidien du VPS. Les conversations et métadonnées utiles sont transmises à Google. YouTube reçoit les identifiants lus. Le lecteur public est hébergé sur Recall Stoa et ne reçoit pas le jeton ou la clé Gemini. Aucun identifiant personnel n’est préconfiguré dans le paquet public.

Chaque serveur garde une bibliothèque commune à ses jetons, pas un compte isolé par personne. Ne pas distribuer le jeton personnel de Samuel avec l’app. Pour partager l’app, envoyer uniquement l’archive générée.

## Organisation

| Module | Rôle |
| --- | --- |
| `RecallKit/Models.swift` | Contrats, validation des imports et des sélections IA. |
| `RecallKit/LibraryStore.swift` | SQLite, FTS5, playlists, transactions et sources séparées. Tous les mots d’abord, puis n’importe lequel si rien ne correspond. |
| `RecallKit/SQLiteConnection.swift` | Connexion par opération, transactions, erreurs SQLite détaillées. |
| `RecallKit/YouTubePlaylistImporter.swift` | Liens, pages YouTube, quota et reprise sans secrets, valable 24 h. |
| `RecallKit/HTTPClient.swift` | API privée et client MCP HTTP authentifié. |
| `RecallKit/GeminiDJ.swift` | Dialogue avec outils, bornes de recherche et voix. |
| `RecallMac/KeychainStore.swift` | Secrets natifs. |
| `RecallAudio/Microphone.swift` | Autorisation, capture, dictée et arrêt. |
| `RecallMac/Player.swift` | WebKit et messages du lecteur strictement contrôlés. |
| `RecallMac/Session.swift` | Clés, source active (Mac ou serveur), messages d’erreur et d’information. |
| `RecallMac/LibraryModel.swift` | Navigation, imports, synchronisation serveur et export. |
| `RecallMac/DJModel.swift` | Conversation, file de lecture, micro. |
| `RecallMac/VoiceOutput.swift` | Voix Gemini, voix macOS de secours, atténuation du lecteur. |
| `RecallMac/RecallApp.swift` | Cycle de vie, fenêtres, Sparkle ; relie les modèles au changement de source. |

Seule `Session` change la source. Ce changement annule les imports, synchronisations et réponses du DJ en cours ; leurs résultats tardifs sont ignorés. Les lignes de résultats et de file sont identifiées par position, car une playlist ou la file peut répéter une vidéo.

Les accès au Trousseau sont lancés hors du thread de l’interface, afin qu’une demande macOS ne bloque pas la fenêtre. Une compilation locale ad hoc peut nécessiter de réautoriser le nouveau binaire à lire les clés existantes. Une identité Developer ID stable sera nécessaire pour rendre la distribution publique plus fluide.

## Développement

Prérequis : macOS, outils de ligne de commande Apple avec Swift 5.10 ou ultérieur, Node.js pour les tests de l’API. Sparkle 2.10.0 est épinglé via Swift Package Manager.

```sh
npm run test:macos
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
