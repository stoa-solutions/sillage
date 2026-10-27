# Développer Recall

## Démarrer sans toucher aux données personnelles

Prérequis : Node 24+, Docker pour PostgreSQL de test ; sur Mac, outils Xcode/Swift. Lire AGENTS.md, créer un worktree et réserver les zones avant de modifier. Ne jamais copier les fichiers de connexion ou les clés dans ce worktree.

```sh
npm ci --legacy-peer-deps
npm run verify:node
npm run verify:macos
```

`verify:macos` compile et lance les contrôles sans capture micro réelle. Les tests ne prouvent pas le fonctionnement audio ou Google dans l’app. Pour une app de développement, définir `RECALL_DATA_DIR` vers un dossier temporaire avant `swift run --package-path apps/macos RecallMac` ; ne pas ouvrir un deuxième client sur les données personnelles par défaut.

Pour les tests SQL, créer un PostgreSQL jetable avec pgvector, définir `TEST_DATABASE_URL` vers une base terminant par `_test`, puis `npm run test:integration`. Ne jamais utiliser la base de production. Voir `.env.example` pour les variables serveur disponibles ; les modèles d’inférence ne sont pas requis par les tests simulés.

## Où faire le changement

| Besoin | Point d’entrée | Logique / validation |
| --- | --- | --- |
| Connexion et clé | `Session`, `GoogleSignIn`, `SettingsView` | `features/auth`, `features/accounts`, `dj-settings.ts`, tests comptes |
| Chercher une musique | `DiscoveryModel`, `LibraryModel` | `search.ts`, `search-relevance.ts`, MCP ; filtrage propriétaire obligatoire |
| Comprendre une demande | `DJModel.send` | commandes locales puis `features/dj/plan.ts`, `decision.ts` et `turn.ts` |
| Ordre et suite | `DJModel` | `PlaybackQueue`, `DJComposition`, tests session/composition |
| Voix | `VoiceOutput` | `PreparedSpeech`, `dj-voice.ts` ; annuler l’annonce d’un titre sauté |
| Vidéo et paroles | `Player`, `LyricsPanel` | `PlaybackClock`, `Lyrics`, `LyricsModel`, `dj-player.ts` |
| Apparence | vues de feature | `DesignSystem`, `Surfaces`, composants communs ; garder les paroles latérales |

Les noms Swift correspondent aux fichiers de `apps/macos/Sources/RecallKit` (règles testables) ou `RecallMac` (intégration/UI). Les modules TypeScript sont dans `apps/server/src`.

## Une fonctionnalité de bout en bout

1. Décrire son effet observable et le comportement en cas d’échec/annulation.
2. Étendre le contrat à la frontière, avec validation ; conserver les anciennes réponses si un client peut encore les utiliser.
3. Écrire la règle dans le cœur testable, l’effet réseau dans l’adaptateur et l’affichage dans la vue.
4. Tester un succès et les risques réels : réponse tardive, changement de compte, requêtes concurrentes ou file vide selon le cas.
5. Lancer les validations de la zone, puis contrôler le parcours dans l’app avec son vrai lecteur. Distinguer les tests simulés du test réel.
6. Rebaser, vérifier le commit final, intégrer selon AGENTS.md. Le guide operations.md couvre la production ; une compilation ne vaut pas déploiement.

## Base de données (Drizzle)

- Modifier une table dans `apps/server/src/db/schema/<domaine>.ts`, puis générer la migration : `npm run db:generate -w @playlist-recall/server -- --name <sujet>`. Pas besoin de base : drizzle-kit compare le schéma au dernier instantané de `apps/server/drizzle/meta/`. Relire le SQL produit et le committer avec l’instantané.
- Ce que Drizzle ne décrit pas (déclencheur `recall_music_revision`, configuration `recall_simple`) s’écrit à la main dans une migration créée par `npx drizzle-kit generate --custom --name <sujet>`.
- Le serveur applique les migrations au démarrage ; `npm run migrate -w @playlist-recall/server` le fait à la main. Les suites d’intégration migrent leur propre schéma PostgreSQL de la même façon.
- Une feature passe par `db.orm` dans son `store.ts`, avec le constructeur SQL de Drizzle ; jamais de SQL concaténé.
- `npm run build -w @playlist-recall/server` produit le bundle de production dans `apps/server/dist/` ; le développement reste en TypeScript direct (`tsx`).
- Le serveur compile en TypeScript très strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, accès `process.env["X"]`, etc.) : traiter le cas absent plutôt que forcer le type.

## Avant de vouloir scaler

Garder API, worker et inférence séparés. Mesurer latence p50/p95, pertinence des dix premiers résultats et coût fournisseur avant de changer d’architecture. Pour plusieurs instances API, déplacer les limites/concurrences en mémoire vers un mécanisme partagé. Les tâches longues restent dans la file PostgreSQL. Aucun objectif de charge n’est encore qualifié.


## Lire le projet et contribuer

1. Lire `GLOSSARY.md` pour distinguer catalogue, playlist, file d'écoute et historique.
2. Lire `docs/architecture.md`, puis suivre un seul parcours de bout en bout. Pour le chat : `features/dj/routes.ts` → `turn.ts` → `research.ts` (MCP) / `provider.ts` → `decision.ts` → `reply.ts` → `ListeningSession` sur Mac.
3. Trouver un test du même comportement avant d'ajouter une fonctionnalité. `dj-retrieval.test.ts` simule les recherches et les décisions ; `dj-provider.test.ts` vérifie la frontière Gemini ; `accounts.integration.test.ts` utilise PostgreSQL pour prouver la séparation des comptes.
4. Garder la façade publique stable. Un module porte un nom de responsabilité (contrat, contexte, catalogue, fournisseur), pas un nom générique comme `helpers`.

## Lisibilité et commentaires

L'indentation, les fins de ligne et le nettoyage des espaces sont définis par `.editorconfig`. Le Swift suit la configuration `apps/macos/.swift-format`. Suivre le style TypeScript du module touché ; éviter un reformatage global mêlé à une correction.

Un commentaire explique une contrainte, une décision ou un invariant : pourquoi le dernier tour du modèle n'a plus d'outils, pourquoi un titre est revalidé pour le compte, pourquoi une réponse tardive est ignorée. Il ne paraphrase pas chaque affectation. Les fonctions et les types portent le sens ; les entrées externes sont `unknown` puis validées, plutôt que `any`.

Pour un refactoring, conserver les tests de comportement existants et ajouter seulement les scénarios manquants aux frontières modifiées. Vérifier `npm run verify:node`, `npm run verify:macos` selon la zone, puis `npm run test:integration` sur une base jetable. Distinguer clairement : code intégré, tests locaux, CI distante, version installée et version serveur.
