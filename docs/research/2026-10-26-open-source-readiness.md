# Sillage - préparation de l’ouverture du code

Audit du **26 octobre 2026**, référence Git `09dfcca`, app installée **1.7.9 (70)**. Analyse du code, du paquet local et des points d’entrée publics, complétée par une recherche sur les documentations officielles. Aucun appel d’inférence avec une clé réelle, aucune création de compte, aucune publication ou modification de l’app.

## Verdict

La refonte de Claude est intégrée et le paquet Mac existe. La base permet de préparer une bêta publique, mais **le téléchargement grand public et le support Claude ne sont pas encore livrés**. Rendre le dépôt public ne terminera ni l’installation, ni l’auto-hébergement, ni la configuration des fournisseurs.

**Décision de Samuel pour la prochaine intégration : utiliser un package multi-fournisseurs connu, avec les outils pris en charge par ce package.** Le choix proposé et retenu pour le plan est **AI SDK de Vercel**, via ses connecteurs directs. Le transport actuel reste en place tant que la migration n’est pas validée.

## État vérifié

| Élément | Preuve et état |
| --- | --- |
| Intégration de Claude | Changelog et `docs/design.md` couvrent la direction Atelier, les thèmes, le Compact, les vues partagées, le mini-clip et les finitions du build 70. La recette UI antérieure est consignée par Claude ; elle n’est pas rejouée dans cet audit. |
| Version installée | Info.plist de l’app : 1.7.9 / 70 ; exécutable universel `x86_64 arm64`, cible macOS 14. |
| Signature locale | `codesign --verify --deep --strict` passe. Autorité locale de développement, sans TeamIdentifier Apple. `spctl --assess` rejette ce paquet. |
| Archive | ZIP universel de 7 480 102 octets, manifeste `notarized=false`, `signing=local certificate`. SHA-256 `da2f49caa177712554bba711189a927cdc436b1419df31952cec4bfdaba6817a`. |
| Contenu de l’archive | 399 entrées ; aucun nom correspondant aux fichiers sensibles recherchés : session, environnement, credentials, connexion ou clé privée. Ce contrôle de noms ne prouve pas l’absence de tout secret dans tous les octets du paquet. |
| Mise à jour publique | Appcast HTTPS accessible, **aucun item**. L’URL de la dernière archive renvoie **404**. Sparkle est configuré ; la dernière release n’est pas publiée. |
| Installateur | Le script sait créer un DMG avec glisser vers Applications ; le manifeste contrôlé ne fournit pas de DMG pour cette livraison. |
| Connexion | L’API publique annonce Google configuré. Le client possède un accueil en trois étapes et un retour OAuth/PKCE. La connexion d’un compte Google externe neuf n’a pas été testée. |
| Clé personnelle | L’accueil et les réglages n’acceptent actuellement que Gemini. Clé chiffrée AES-256-GCM par compte côté serveur, jamais retournée par l’API ; elle ne reste donc pas seulement sur le Mac. |
| Claude | Non exposé dans l’UI et non pris en charge nativement par le transport actuel. Un endpoint configurable n’est pas une preuve de compatibilité. |
| Dépôt | GitHub toujours privé ; pas de licence du projet à la racine, ni de guide de contribution ou politique de sécurité publique repérés. |
| Précontrôle de l’historique | 175 commits accessibles parcourus, lignes ajoutées et retirées, cinq familles de motifs de clés ; aucun motif trouvé. Contrôle ciblé, pas audit exhaustif des secrets ou données personnelles. |
| API en ligne | `/health` répond, SHA `e6ca0bfbad51f03cfa4c7f0258c1e2ce9e5eec5c`, distinct de la référence du client. Aucun déploiement effectué ici. |

## AI SDK : une interface commune, des connecteurs directs

Utiliser `ai` avec `@ai-sdk/google` et `@ai-sdk/anthropic`. Ajouter `@ai-sdk/mcp` si l’adaptation du client MCP existant le justifie. Le SDK couvre le transport de modèles, les appels d’outils, les schémas, les étapes, le streaming et l’annulation selon les capacités de chaque fournisseur. Il ne remplace pas nos règles métier ni les identifiants des services. [AI SDK - introduction](https://ai-sdk.dev/docs/introduction), [outils](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools).

Les fabriques de connecteurs reçoivent explicitement la clé du compte. Ne pas utiliser involontairement une simple chaîne de modèle qui sélectionne AI Gateway par défaut : **pas de passerelle ni de compte Vercel requis pour l’accès direct**. Le serveur Hono actuel reste l’hébergement. [Connecteur Anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic), [connecteur Google](https://ai-sdk.dev/providers/ai-sdk-providers/google).

Le pilote déjà versionné utilise `ai@7.0.153`, `@ai-sdk/google@4.0.105` et Zod, dans un paquet séparé des dépendances de production. Il a été réinstallé avec son verrou et **rejoué pendant cet audit** : quatre cas passent avec réponses HTTP synthétiques, sans clé réelle ni appel modèle.

1. Aller-retour outil et conservation de la signature Google et de l’identifiant d’appel.
2. Réponse naturelle sans appel d’outil.
3. Erreur 429 sans relance cachée.
4. Annulation propagée au transport.

Cela valide un mécanisme du SDK, pas la qualité musicale ou la latence d’un modèle réel. Voir le [pilote](pilots/ai-sdk-provider/README.md) et la [recherche existante](2026-10-26-agent-provider.md).

### Intégration proposée

- Introduire l’adaptateur derrière `apps/server/src/features/dj/provider.ts`, sans réécrire la recherche et la file. Garder une seule boucle d’étapes : remplacer l’enveloppe de transport, sans empiler deux agents autonomes.
- Déclarer une fois les outils et leurs schémas, puis adapter les outils MCP et les services déjà existants. Garder le périmètre du compte et la portée Mes playlists / YouTube / Partout dans chaque exécution.
- Enregistrer fournisseur, modèle et identifiant de clé par compte. La migration conserve les réglages Gemini actuels et leurs secrets ; aucun changement silencieux de fournisseur facturé.
- Adapter la vérification des clés, les erreurs et la liste de modèles à chaque fournisseur. Conserver validation Zod, limites d’étapes, quota et annulation. Vérifier les modèles accessibles au projet plutôt que promettre que chaque nom sera disponible à tous.
- Garder le contrat métier du DJ et revalider les morceaux avant l’opération de lecture. Un SDK ne doit pas permettre au modèle d’annoncer une action non exécutée.
- Ajouter le choix de fournisseur et de modèle dans l’accueil et les réglages Mac, avec test, remplacement et suppression de la clé. Le comportement doit être explicite pour clé invalide, quota épuisé, modèle inaccessible et panne.

Anthropic propose aussi une couche compatible OpenAI, mais elle ignore notamment `response_format` et `strict`. Changer seulement l’URL de l’actuel `/chat/completions` ne garantit donc pas le JSON attendu. Le connecteur direct est la voie préférée. [Documentation Anthropic](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk).

### La voix est un choix distinct

Aujourd’hui le raisonnement et la voix cloud passent par Gemini ; la voix macOS existe aussi. La cible est **Claude + voix macOS avec une seule clé Anthropic**, ou Gemini + voix Gemini selon le choix de l’utilisateur. Une deuxième clé Google ne doit pas être une obligation cachée du choix Claude. Vérifier aussi qu’aucun appel vocal Gemini n’est tenté dans cette configuration.

Une session de l’app Claude ne constitue pas une clé API. La Console et ses droits/crédits doivent être vérifiés ; les offres pouvant évoluer, ne pas promettre qu’un abonnement rend automatiquement tous les appels API gratuits. Même principe pour les quotas du projet Gemini. [Support Claude](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan), [clés Gemini](https://ai.google.dev/gemini-api/docs/api-key), [facturation Gemini](https://ai.google.dev/gemini-api/docs/billing/).

## Le parcours public à viser

**Télécharger Sillage → glisser dans Applications → ouvrir → connexion → première playlist → choisir son IA et tester sa clé.** La bibliothèque doit pouvoir être découverte sans rendre la configuration de l’IA inutilement bloquante. Le bouton Plus tard existe déjà ; il faut éprouver son parcours complet.

Pour la première bêta, proposer le serveur Stoa par défaut et un parcours avancé d’auto-hébergement. Le code actuel force le serveur Stoa dans `Session.connectGoogle()`. L’import d’une connexion personnalisée existe, mais ce n’est pas encore un accueil d’auto-hébergement simple.

L’instance hébergée doit annoncer clairement où vont la clé et les requêtes, fournir suppression de clé et déconnexion, et valider les quotas par compte. Ouvrir le code ne rend pas l’hébergement ou les quotas YouTube gratuits.

## Installation et compilation

### Pour un utilisateur

Le paquet doit recevoir une signature Developer ID et une notarisation, puis être vérifié après un vrai téléchargement sur un autre compte ou Mac. La signature Sparkle protège l’archive de mise à jour ; elle ne remplace pas les contrôles Gatekeeper. Le script possède déjà les étapes de signature, notarisation et agrafage : il manque la qualification de la vraie release avec les identifiants Apple appropriés. [Apple - notarisation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [Sparkle](https://sparkle-project.org/documentation/).

Le script signe actuellement avec `--deep` et sans option explicite d’horodatage : ne pas présumer que fournir un certificat suffira. Vérifier signature des composants imbriqués, horodatage, hardened runtime, notarisation acceptée et ticket agrafé, puis refaire l’installation téléchargée et la mise à jour entre deux versions.

Le code Studio cherche `yt-dlp` dans les chemins Homebrew ; ce programme et les outils nécessaires ne sont pas embarqués. Le premier lancement doit détecter les dépendances absentes, fonctionner proprement en lecteur YouTube seul et présenter le téléchargement comme option avancée, sans imposer Homebrew à tous. Ce parcours sans ces dépendances reste à tester.

### Pour un contributeur

Séparer un build de développement d’une release officielle. Aujourd’hui `npm run build:macos` tente de signer l’archive Sparkle avec le compte du mainteneur. Le drapeau `--skip-update-signature` existe pour un build local ; il ne doit pas être nécessaire de posséder la clé privée de Stoa pour compiler.

Prévoir un profil de développement sans mise à jour officielle automatique, une identité/session isolée et une procédure de clone vierge. L’app officielle, le bundle ID et le flux des utilisateurs existants restent compatibles. La procédure source seule ne nécessite pas la clé privée du mainteneur.

## Auto-hébergement : un second parcours à simplifier

Le Compose actuel est destiné à Dokploy : réseaux externes, PostgreSQL séparé, modèles sous un chemin hôte et montage de releases spécifique au serveur. `.env.example` ne couvre pas encore toutes les variables OAuth et les instructions sont centrées sur Stoa. Ce n’est pas un démarrage portable en une commande.

Ajouter un Compose d’exemple autonome avec PostgreSQL/pgvector, volumes nommés, modèles préparés et variables documentées ; conserver le déploiement Dokploy actuel. Documenter la configuration OAuth, les secrets de chiffrement, les sauvegardes et les fonctions optionnelles. Tester ce démarrage sur une machine sans les réseaux ni fichiers du mainteneur.

## Ouverture du dépôt

Choisir une licence de code avant l’ouverture, puis traiter les notices des dépendances et les droits des ressources. La notice actuelle de l’artwork n’accorde aucun droit indépendant sur la marque Stoa ; ne pas présenter tous les visuels comme automatiquement couverts par la future licence du code. Un dépôt visible sans licence n’offre pas les permissions attendues d’un projet open source. [GitHub - licence](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

Réécrire l’entrée du README pour Sillage et le parcours Mac, conserver l’extension comme partie du monorepo, ajouter contribution, sécurité, captures autorisées, exemples sans données personnelles et procédure de build. Les notes historiques et leurs mentions personnelles méritent une relecture avant publication, en complément du précontrôle ciblé des clés.

La CI actuelle vérifie Node, SQL et Mac, mais ne publie pas de release signée. Ajouter ensuite un processus de release contrôlé, avec archives, empreintes, notarisation et publication atomique de l’appcast. Le script actuel refuse déjà une release publique non notariée : conserver cette protection.

## Ordre de réalisation

1. **AI SDK et clés personnelles.** Connecteurs Google et Anthropic, outils existants, migration conservatrice, choix dans l’app et voix indépendante. Comparatif sur les mêmes scénarios de DJ.
2. **Premier lancement vierge.** Compte Google externe, ajout d’une playlist, une seule clé, lecture, file et continuation, puis retrait de la clé et reconnexion. Vérifier mode sans outils Homebrew.
3. **Release Mac.** Installation signée/notariée, DMG, téléchargement, mise à jour Sparkle et conservation de session/bibliothèque sur une machine propre.
4. **Ouverture du code.** Licence choisie, revue des fichiers/historique et notices, README Sillage, guide de contribution, exemples et build développeur sans clés du mainteneur.
5. **Auto-hébergement documenté.** Compose autonome et connexion à son serveur. Cela peut suivre la bêta hébergée, mais doit être présenté honnêtement comme un parcours distinct.

Le travail d’intégration métier du DJ est actif dans une autre branche. Le présent lot réserve uniquement ce rapport et ne modifie aucune de ses zones.

## Limites de cette vérification

Pas de nouvel utilisateur créé ; état de publication de la console OAuth non inspecté. Pas de test réel Claude, de mesure qualité/coût/latence, de notarisation, de DMG construit, d’installation sur un autre Mac ou de bascule Sparkle. Aucun changement de visibilité du dépôt, aucun déploiement, aucun mail ni publication. Ces étapes sont les critères de sortie du futur chantier, pas des actions déjà réalisées.
