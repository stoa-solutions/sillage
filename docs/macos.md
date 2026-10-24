# Playlist Recall pour Mac — version locale 1.0

App native SwiftUI pour macOS 14 ou plus récent, compilable pour Apple Silicon et Intel. Elle ne charge pas l’interface de l’extension : le micro, les contrôles et les réglages sont natifs. WebKit est réservé au lecteur officiel YouTube.

## Fonctionnalités et données

- Conversation avec Gemini 3.5 Flash-Lite par défaut pour la réactivité. Gemini 3.8 Flash et Argon sont sélectionnables, avec raisonnement faible.
- Clé Gemini et connexion serveur dans le Trousseau, non synchronisées par iCloud. Les champs ne réaffichent pas les secrets.
- Micro au clic via AVAudioEngine et Speech : français sur l’appareil lorsque pris en charge, sinon service Apple. Arrêt après une courte pause ou au second clic.
- Synthèse vocale Gemini, lecture WAV par AVAudioPlayer, voix macOS en secours. Baisse puis restauration du volume musical.
- Lecteur YouTube, pause, suivant, enchaînement, gestion des intégrations interdites et lien externe.
- Serveur privé facultatif : bibliothèque synchronisée et recherche vectorielle via le vrai point d’entrée MCP `/v1/mcp` pour le DJ.
- Mode local : import JSON Recall ou yt-dlp, recherche dans les titres, artistes et métadonnées. Ce mode n’effectue pas d’inférence vectorielle embarquée et ne synchronise pas directement YouTube. Pour la synchronisation YouTube automatique, utiliser son serveur privé.
- Cache serveur et bibliothèque locale séparés dans `~/Library/Application Support/Playlist Recall/`. Les imports ne remplacent pas le cache serveur. L’ancien fichier `library.json`, s’il existe, est conservé et migré sans suppression.
- Exports limités aux vidéos : aucune clé ni connexion privée. L’app redistribuée ne contient ni catalogue personnel, ni clé, ni jeton.

Les appels Gemini directs sont facturés au projet de la clé de l’utilisateur ; ils ne passent pas par le plafond quotidien du VPS. Les conversations et métadonnées utiles sont transmises à Google. YouTube reçoit les identifiants lus. Le lecteur public est hébergé sur Recall Stoa et ne reçoit pas le jeton ou la clé Gemini. Aucun identifiant personnel n’est préconfiguré dans le paquet public.

Chaque serveur garde une bibliothèque commune à ses jetons, pas un compte isolé par personne. Ne pas distribuer le jeton personnel de Samuel avec l’app. Pour partager l’app, envoyer uniquement l’archive générée.

## Organisation

| Module | Rôle |
| --- | --- |
| `RecallKit/Models.swift` | Contrats, validation des imports, recherche locale et validation des sélections IA. |
| `RecallKit/LibraryStore.swift` | Persistance locale atomique et cache serveur séparé. |
| `RecallKit/HTTPClient.swift` | API privée et client MCP HTTP authentifié. |
| `RecallKit/GeminiDJ.swift` | Dialogue avec outils, bornes de recherche et voix. |
| `RecallMac/KeychainStore.swift` | Secrets natifs. |
| `RecallMac/Microphone.swift` | Autorisation, capture, dictée et arrêt. |
| `RecallMac/Player.swift` | WebKit et messages du lecteur strictement contrôlés. |
| `RecallMac/AppModel.swift` | État de session, annulation, file et coordination. |
| `RecallMac/RecallApp.swift` | Cycle de vie, fenêtres et Sparkle. |

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
