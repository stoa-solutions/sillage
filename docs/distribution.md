# Distribution Mac

L’application se connecte au serveur Stoa : Google pour créer sa session, puis Gemini ou Claude avec sa propre clé API. Il n’y a pas de clé YouTube, de session ou de clé IA incluse dans l’installateur. Les appels à l’IA utilisent le quota du fournisseur de l’utilisateur. La voix macOS reste disponible avec Claude.

## Préparer une version

Le paquet est un DMG universel Intel/Apple Silicon, macOS 14+. Son volume contient `Sillage.app`, un raccourci vers Applications et une notice. La construction exige le SDK macOS 26 pour l’interface ; la cible d’exécution reste macOS 14.

```sh
npm run verify:macos
MAC_SIGNING_IDENTITY=- npm run build:macos -- --dmg --skip-update-signature
```

Cette commande produit un **aperçu local**, marqué `distribution: preview` et `notarized: false`. Elle ne constitue pas une distribution publique reconnue par Apple. Ne pas conseiller de désactiver Gatekeeper. Les tests ne remplacent pas une ouverture du fichier téléchargé sur un second Mac.

## Version publique

Une adhésion Apple Developer active, un certificat **Developer ID Application** et les outils `notarytool` et `stapler` accessibles via `xcrun` sont nécessaires. Leur présence doit être vérifiée directement ; les Command Line Tools installés sur le Mac de préparation les fournissent déjà. La clé privée et les identifiants de notarisation restent dans le Trousseau, hors Git et hors du paquet.

Configurer localement `MAC_SIGNING_IDENTITY` avec l’identité Developer ID et `MAC_NOTARY_PROFILE` avec le nom du profil de notarisation. Puis, depuis `main`, avec le numéro de build incrémenté :

```sh
npm run build:macos -- --dmg --public-release
```

Le constructeur signe les binaires puis leurs conteneurs Sparkle de l’intérieur vers l’extérieur. Il active le hardened runtime et l’horodatage, soumet l’app à Apple, agrafe son ticket et vérifie Gatekeeper. Il recrée ensuite le ZIP, construit et signe le DMG, soumet ce DMG et vérifie son ticket. Les empreintes sont calculées **après** les tickets. `release.json` n’est écrit qu’après réussite ; un ancien manifeste est retiré avant toute tentative.

Sans certificat, profil ou outils Apple, `--public-release` refuse la publication avant la compilation. Une signature locale n’est jamais classée Developer ID.

## Télécharger depuis Stoa

1. Relire `release.json`, `SHA256SUMS.txt`, les signatures et les tickets dans `.output/macos/`.
2. Tester le DMG téléchargé dans une session Mac propre : copie dans Applications, lancement, connexion Google, ajout d’une clé personnelle, recherche et lecture. Contrôler également Google Auth Platform → Audience : l’application doit être accessible aux comptes prévus, pas seulement à une liste de test.
3. Créer la release GitHub `v<version>` sur `stoa-solutions/sillage`, avec le DMG, le ZIP et les empreintes. Aucun fichier privé ni session.
4. Dans le repo Stoa, lancer `pnpm sillage:prepare-download /chemin/vers/release.json`. Le script refuse les aperçus, vérifie taille/empreinte et réexécute les contrôles Apple sur le DMG avant de préparer les métadonnées du bouton. Vérifier que l’asset GitHub répond avant de publier le site.
5. Vérifier le véritable téléchargement HTTPS et l’empreinte reçue après publication du site.

Au 27 octobre 2026 : inscription de Stoa en cours de traitement, mais aucune adhésion active ni certificat de distribution disponible sur ce Mac. `notarytool` et `stapler` sont présents et exécutables. La connexion serveur annonce Google configuré ; cela ne prouve pas le parcours complet d’un compte extérieur. Aucun binaire public ni téléchargement sans avertissement ne doit être annoncé tant que les étapes Apple et ce parcours ne sont pas validés.

## Mises à jour

Désactivées par défaut. Pour activer Sparkle, fournir explicitement `MAC_UPDATE_FEED_URL` (HTTPS) et `MAC_UPDATE_PUBLIC_KEY` (publique), puis autoriser la signature Ed25519 de l’archive. `--skip-update-signature` désactive toujours les mises à jour. Aucun flux privé Stoa n’est repris automatiquement par une construction publique.

## Installation locale de développement

Les commandes de validation et d’assemblage sélectionnent explicitement le moteur SwiftPM `native` : Swift 6.4 change le moteur par défaut et l’emplacement des produits. L’assemblage utilise encore les chemins du moteur natif. Ne retirer ce choix qu’en adaptant et validant ensemble les chemins du binaire, des ressources et des tests.

Sur ce Mac, les Command Line Tools Swift 6.4 avec le SDK 27 échouent sur `SwiftUIMacros.StateMacro` (plugin absent). Le SDK 26.5 installé reste utilisable sans modifier l’app ni `xcode-select`. Pour la validation et la construction locales, sélectionner explicitement ce SDK dans chaque commande :

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk npm run verify:macos
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk python3 scripts/build-macos.py --skip-update-signature
```

Cette configuration locale ne valide ni une distribution Apple ni le prototype d’agents. Une installation Xcode complète et sa chaîne de signature restent à vérifier pour la sortie publique.

Conserver une seule app habituelle dans `~/Applications/Sillage.app`. Construire depuis le `main` du dépôt de développement après validation, puis fermer les anciennes copies avant de remplacer le bundle. Conserver l’identité de signature locale, le bundle ID et les données existantes. Les branches de prototype doivent utiliser un dossier `RECALL_DATA_DIR` temporaire ; elles ne remplacent pas cette installation.

Sauvegarder les anciens bundles en **ZIP vérifié**, jamais en `.app` décompressée dans un dossier d’archives : macOS peut indexer ces sauvegardes et les proposer comme des apps homonymes. Contrôler l’intégrité du ZIP avant de retirer le bundle archivé. Si nécessaire, désenregistrer seulement le chemin exact de l’ancienne copie avec `lsregister -u`, puis enregistrer le chemin canonique ; ne pas réinitialiser le registre global des applications.

Vérifier après installation le chemin du processus réellement lancé, la version/build, la signature et la bibliothèque dans l’app. Conserver le `sourceCommit` du manifeste avec les preuves d’installation. Un commit GitHub, un manifeste d’aperçu et une app installée sont trois états distincts ; vérifier chacun avant d’affirmer qu’ils sont à jour.

## Auto-hébergement

Le DMG hébergé Stoa ne nécessite pas de serveur à installer chez l’utilisateur. Compiler une version pour son propre serveur reste un autre parcours : PostgreSQL, OAuth Google/YouTube, chiffrement des réglages, origines du lecteur WebKit et adresse de connexion doivent être configurés. Les origines ne sont pas encore centralisées dans une interface de configuration. Le serveur privé et ses secrets ne font pas partie du dépôt public.

## Références

- [Apple — Distribution et signature](https://developer.apple.com/documentation/security/creating-distribution-signed-code-for-macos)
- [Apple — Packaging](https://developer.apple.com/documentation/security/packaging-mac-software-for-distribution)
- [Apple — Inscription](https://developer.apple.com/programs/enroll/)
- [Sparkle — Documentation](https://sparkle-project.org/documentation/)
