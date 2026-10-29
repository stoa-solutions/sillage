# Comptes Sillage

La connexion Google identifie un utilisateur par le `sub` vérifié du jeton OIDC,
jamais par une adresse fournie par le client. Les seuls scopes sont openid,
email et profile. Pas de permission YouTube, pas de refresh token Google conservé.

## Configuration

Créer un client OAuth « Application Web » dans le projet Google Sillage (`secure-path-512617-s5`).
URL de redirection : `https://sillage.stoa.solutions/auth/google/callback`.
Conserver aussi `https://sillage.stoa.solutions/auth/google/callback` pendant la compatibilité. Le démarrage OAuth sur l’ancienne origine est redirigé vers Sillage **avant** de poser le cookie ; les requêtes API et le lecteur intégrés restent servis sur les deux origines. Voir [la configuration du proxy](../deploy/sillage/traefik-compatibility.yml).
Renseigner `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL` dans
l’environnement privé du serveur. Le secret reste côté serveur. Activer le
stockage des clés avec `DJ_SETTINGS_ENCRYPTION_KEY` (32 octets hexadécimaux).
Ne pas remplacer cette clé de chiffrement sans migration des secrets existants.

La plateforme Google Auth doit autoriser les utilisateurs externes visés :
utilisateurs de test tant que l’app est en test, puis publication et validation
Google éventuelle selon sa configuration. L’app Mac n’embarque aucun secret.

## Frontières

Le catalogue public YouTube, ses métadonnées et les vecteurs sont mutualisés.
`user_playlists` porte les abonnements privés. Les API status, playlists,
search (lexicale, vectorielle, images, pagination et memberships), export et
MCP filtrent cet abonnement. Le DJ revalide les titres finaux dans ce périmètre.
Connaître un ID vidéo ne donne pas accès à une autre bibliothèque. Importer
explicitement le même lien public ou non répertorié ajoute cette playlist au
compte demandeur ; aucun abonnement d’un autre compte n’est exposé.

Code : `apps/server/src/modules/auth/` (connexion Google, échange PKCE,
`session.guard.ts` monté sur `/v1/*`, `token.cli.ts`) et
`apps/server/src/modules/accounts/` (profil, déconnexion). Filtres de bibliothèque : `followedBy` et
`inLibraryOf` dans `modules/library/library.repository.ts`. Tables dans
`apps/server/src/db/schema.ts` (section Accounts).

Les clés Gemini sont chiffrées AES-256-GCM avec l’ID du compte comme AAD.
Deux sessions du même compte retrouvent ses réglages. Aucun compte Google
sans clé ne bénéficie de la clé du serveur. Chat et voix utilisent la
clé de l’utilisateur ; le budget journalier est également par utilisateur.
Les clés ne sont jamais retournées par l’API. Retrait d’une clé et déconnexion
sont explicites. Les sessions opaques sont hachées côté DB, révoquées au logout,
expirent après 90 jours et sont prolongées avec l’usage (sous 60 jours restants).

Le navigateur porte un cookie CSRF Secure/HttpOnly/SameSite=Lax et un state
aléatoire à usage unique. Le jeton Google est vérifié par google-auth-library
(signature, audience, issuer, expiration), puis nonce et email_verified sont
contrôlés. Le retour à l’app ne contient qu’un code de 90 secondes, à usage
unique et lié au vérificateur PKCE S256 détenu par l’app. L’app contrôle son state.
Les réponses auth et API sont no-store. Les échecs n’exposent pas les réponses
Google ni les secrets.

## Migration et retour arrière

Chaque compte est un compte Google. Le compte « historique » d’avant la
connexion Google, dont la bibliothèque avait été reprise par un compte Google,
est supprimé par la migration `0008_remove_legacy_account`, avec ses jetons
restants et les tables `dj_settings` et `dj_usage` qui ne servaient plus. Cette
migration refuse de s’exécuter si ce compte possède encore des playlists ou un
historique non repris.

Sauvegarder PostgreSQL avant déploiement. Ne pas revenir à une ancienne API
sans filtrage après ouverture des comptes : elle exposerait le catalogue global
aux nouveaux jetons. Pour un rollback, désactiver la connexion publique et
révoquer les sessions Google avant de rétablir l’ancienne API, ou conserver
l’API multi-compte et revenir uniquement au client Mac précédent.

## Validation

`npm run check`, `npm test`, `npm run test:macos`.
La suite d’intégration exige une base jetable dont le nom finit par `_test` :
`TEST_DATABASE_URL=... npm run test:integration`.
Elle couvre deux comptes, vidéos communes, forçage d’IDs, recherche vectorielle,
MCP, export, clés, quotas, logout, expiration, PKCE, replay et migration.
Le fournisseur Google est simulé dans cette suite ; une connexion Google réelle
reste une validation distincte après configuration des identifiants.

## IA personnelle : Gemini et Claude

Le compte de connexion Google est indépendant du fournisseur du DJ. L’accueil et Réglages proposent Gemini ou Claude et le modèle. Ajouter sa propre clé API puis **Vérifier et enregistrer** ; une session Claude Pro n’est pas une clé de la Console Anthropic et ne garantit pas de crédits API.

Le serveur utilise AI SDK et ses adaptateurs natifs. Les clés sont chiffrées AES-256-GCM avec le contexte du compte dans `account_ai_credentials` ; la table historique est conservée comme miroir Google. La migration conserve le modèle et la clé existants. Chaque fournisseur garde ses réglages lorsque l’autre est activé. Une clé de compte n’utilise jamais la clé de l’administrateur en secours.

`GET /v1/dj/status` renvoie le fournisseur actif et les modèles proposés/configurations disponibles, sans secret. `POST /v1/dj/settings` accepte `provider`, `model` et une `apiKey` facultative après la première saisie. `provider` omis signifie Google pour les anciens clients. `/check` teste seulement le fournisseur demandé et ne sauvegarde rien. `/settings/reset` avec `provider` retire sa clé ; `{}` retire toutes les clés. Supprimer la clé active ne bascule pas sur une autre clé.

Avec Claude, les annonces utilisent la voix macOS, sans appel Google. Avec Gemini, la voix cloud reste facultative ; désactivée ou indisponible, la voix locale prend le relais. Les suggestions de modèles ne prouvent pas leur accès pour chaque projet : le test vérifie la clé et le modèle choisis. Les quotas et tarifs restent ceux du fournisseur.
