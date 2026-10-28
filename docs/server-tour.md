# Visite du serveur

Guide de lecture du serveur (`apps/server`). Chaque section dit quel fichier ouvrir, dans quel ordre et pourquoi. Les chemins sont relatifs à `apps/server/` sauf mention contraire.

## Lancer le serveur en local

```sh
docker run -d --name sillage-dev-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sillage_dev -p 55432:5432 pgvector/pgvector:0.8.7-pg17
export DATABASE_URL=postgres://postgres:dev@localhost:55432/sillage_dev
npm run dev:server        # tsx watch src/boot.ts : migre la base, puis API sur http://127.0.0.1:3001
curl http://127.0.0.1:3001/health
```

`npm run dev:server` applique les migrations en attente au démarrage : pas d’étape séparée. `npm run migrate -w @playlist-recall/server` fait la même chose sans démarrer l’API. Le worker et l’inférence se lancent avec `npm run dev:worker -w @playlist-recall/server` et `npm run dev:inference -w @playlist-recall/server`.

La connexion Google demande `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `PUBLIC_URL` ; sans eux, `/auth/status` répond `{"google":false}`. Pour appeler `/v1/*` sans Google, créer un jeton personnel : `npx tsx apps/server/src/modules/auth/token.cli.ts create /tmp/connexion.json` (le fichier contient le jeton, ne pas le committer). `npm run docs:serve` ouvre la documentation OpenAPI locale.

Une variable invalide arrête le processus au démarrage, avec le nom de la variable (`src/config.ts`).

## 1. Le trajet d’une requête

Ouvrir dans cet ordre :

1. `src/boot.ts` : `checkEnvironment("api")`, `migrate(pool)`, `closeInterruptedTurns(pool)` (les tours DJ restés « en cours » ont été coupés par un redémarrage), puis import de `main.ts`.
2. `src/main.ts` : serveur HTTP Node sur `createApp(pool)` ; `SIGTERM` ferme le serveur puis le pool.
3. `src/app.ts` : la racine de composition, sans règle métier. CORS, limite de corps (30 Mio), routes publiques (`/auth`, `/health`, lecteur `/dj/player`, `/macos`), puis `app.use("/v1/*", sessionGuard(db))` : tout ce qui est monté ensuite exige une session. Le `onError` final traduit JSON invalide et erreurs de validation en 400, le reste en 500 sans détail.
4. `src/modules/auth/session.guard.ts` : jeton Bearer → session active → `c.set("userId")` et `installationId` ; 180 requêtes/minute par jeton, en mémoire du processus ; réponses `no-store`.
5. Le contrôleur du module (`<module>.controller.ts`) : déclare les routes, valide, appelle le service, met en forme la réponse HTTP.
6. Le service (`<module>.service.ts`) : règles et orchestration.
7. Le dépôt (`<module>.repository.ts`) : requêtes Drizzle, toujours filtrées par le compte.

Les autres processus partagent `src/db/` et les modules : `src/worker.ts` (file de tâches), `src/inference.ts` + `src/model-process.ts` (vecteurs E5 et SigLIP dans un processus enfant), `src/migrate.ts` (migrations seules).

## 2. Anatomie d’un module : `src/modules/<module>/`

| Fichier | Rôle |
| --- | --- |
| `<module>.controller.ts` | HTTP uniquement. Chaque `createRoute(...)` (`@hono/zod-openapi`) déclare méthode, chemin, schémas d’entrée et de réponse, erreurs. Hono valide avant le handler ; la doc OpenAPI vient de la même déclaration. |
| `<module>.service.ts` | Règles et orchestration, sans HTTP. |
| `<module>.repository.ts` | Toutes les lectures/écritures en base du module, avec Drizzle. Aucune règle HTTP. |
| `<module>.schemas.ts` | Contrats de l’API en Zod. Ils ne dérivent pas des tables : renommer une colonne ne change pas le contrat public. |
| `index.ts` | Seule entrée publique. Un autre module n’importe que ce fichier (`check:architecture`). |
| autres | Une responsabilité par fichier, nommée par suffixe : `*.guard.ts`, `*.provider.ts`, `*.jobs.ts` (traitements du worker), `*.matching.ts` (correspondances pures), `*.config.ts`, `*.cli.ts`. |

Un module n’a que les fichiers dont il a besoin : `system`, `releases` et `player` n’ont qu’un contrôleur.

Les clients de services externes sont dans `src/integrations/` (sans règle métier) : `youtube/` (client, erreurs, miniatures ; chaque appel compté dans `quota_usage`), `lrclib/`, `musicbrainz/` (cache partagé, une requête par seconde pour tous les workers sous verrou PostgreSQL), `searxng/` (`discovery.ts` pour Découvrir, `information.ts` pour les sources du DJ), `inference/` (client HTTP du processus d’inférence).

`src/shared/` contient ce qui n’appartient à aucun module : `api-environment.ts` (variables de requête posées par l’authentification) et `openapi.ts` (`featureRouter`, `operation()`, `commonErrors`, `jsonBody`…).

## 3. Connexion et compte : `auth`, `accounts`

Ouvrir `modules/auth/auth.controller.ts`, puis `auth.service.ts` et `auth.repository.ts`. Parcours de la connexion Google :

1. Le Mac ouvre `GET /auth/google/start?challenge=…&app_state=…`. La query est validée par `authStartInput` (`auth.schemas.ts`). Le service enregistre l’empreinte du `state` et du cookie ; le navigateur part chez Google.
2. Google revient sur `/auth/google/callback`. Le flux est supprimé **et** renvoyé en une requête (`DELETE … RETURNING`) : deux retours simultanés ne peuvent pas l’utiliser deux fois. Le compte est créé ou mis à jour (`INSERT … ON CONFLICT (google_sub) DO UPDATE`) avec un code de 90 secondes.
3. L’app appelle `POST /auth/exchange` avec ce code et son verifier PKCE. Le code n’est consommé que si le challenge correspond ; la session (`tokens`, 90 jours) est créée. Le serveur ne garde que l’empreinte du jeton.

Autres fichiers : `google.provider.ts` (fournisseur d’identité, remplacé par un faux en test), `session.guard.ts` (section 1), `return-page.ts` (page de retour), `token.cli.ts` (jetons personnels en ligne de commande).

`modules/accounts/` : `/v1/me`, `/v1/logout`, `/v1/account/claim-library`. À lire : la reprise de la bibliothèque historique dans `accounts.repository.ts`. La transaction verrouille la ligne du compte historique (`SELECT … FOR UPDATE`) : si deux comptes tentent la reprise en même temps, le second voit la bibliothèque déjà prise. La preuve (un jeton historique valide) vient de `auth` par son `index.ts`.

## 4. File de tâches : `jobs` et le worker

La file vit dans PostgreSQL (table `jobs`) et ne connaît aucune tâche en particulier. Ouvrir `modules/jobs/jobs.repository.ts` :

- `enqueue` : une tâche par clé (`dedupe_key`). Tant qu’une tâche de même clé attend ou tourne, `INSERT … ON CONFLICT` la renvoie. L’index unique partiel `jobs_active_key` porte cette règle.
- `claim` : prend la prochaine tâche due avec `FOR UPDATE SKIP LOCKED` et lui donne un nouveau `leaseId`. Une tâche dont le bail a expiré est reprise ; le résultat tardif de l’ancien worker est refusé.
- `finish` : terminée, réessayée plus tard (30 s, 60 s… jusqu’à 6 h) ou en échec après 5 essais.

Puis `jobs.worker.ts` (boucle, registre `{ type → traitement }`, battement qui prolonge le bail) et `src/worker.ts`, qui assemble ce registre : chaque module fournit les traitements des types qu’il possède (`libraryJobHandlers`, `indexingJobHandlers`, `enrichMusic`). Sans clé YouTube, les types YouTube sont exclus. Plusieurs workers peuvent tourner en parallèle.

## 5. Bibliothèque : `library`

- `library.controller.ts` : `/v1/status`, `/v1/playlists` (liste, ajout, retrait, actualisation), `/v1/export`, `/v1/import`.
- `library.repository.ts` : `followedBy` et `inLibraryOf`, les deux filtres qui isolent les comptes. Une vidéo appartient à la bibliothèque d’un compte seulement si elle est active dans une playlist que ce compte suit. Toute lecture de la bibliothèque passe par eux.
- `playlist-sync.service.ts` + `playlist-sync.repository.ts` : lit toute la playlist YouTube, puis dans une seule transaction (et seulement si le bail est toujours détenu) crée la génération suivante. Une entrée absente de deux synchronisations consécutives devient inactive.
- `video-metadata.service.ts` : métadonnées complètes par lots de 50 vidéos, photos de chaînes, puis index.
- `library.jobs.ts` : traitements enregistrés auprès du worker et synchronisation périodique (`SYNC_ENABLED`).

## 6. Écoute et métadonnées : `history`, `lyrics`, `enrichment`, `discovery`

- `history` : écoutes par lots ; l’identifiant d’événement fourni par le Mac rend un renvoi sans effet (`ON CONFLICT DO NOTHING`). Pagination par curseur `(playedAt, id)`.
- `lyrics` : `lyrics.service.ts` décide (cache encore frais ? sinon LRCLIB ; en cas d’échec, l’ancien résultat reste) ; `lyrics.matching.ts` choisit l’enregistrement LRCLIB sans réseau. Seules les vidéos de la bibliothèque du compte ont des paroles.
- `enrichment` : MusicBrainz par lots bornés, seulement pour les comptes inscrits (`MUSICBRAINZ_ACCOUNT_IDS`) ou le pilote. Le résultat n’est publié que si la tâche tient toujours son bail et que la vidéo n’a pas changé. Correspondances pures dans `enrichment.matching.ts`.
- `discovery` : recherche YouTube (ou SearXNG), « Mes découvertes » et l’accueil Découvrir. `discovery-home.service.ts` reçoit une fonction qui charge l’historique, ce qui le rend testable sans base.

## 7. Recherche, index et MCP : `search`, `indexing`, `mcp`

- `search` : `search.service.ts` classe d’abord les identités exactes (album, noms complets, titres), puis combine lexical et vectoriel ; `search.repository.ts` porte les filtres, dont le compte, toujours appliqués avant le classement ; `search.relevance.ts` (tolérance aux fautes, motifs passés en paramètres SQL) et `music-matching.ts` (correspondance artiste + titre) sont purs.
- `indexing` : passages E5 et vecteurs SigLIP 2 des miniatures, calculés par le processus d’inférence (`integrations/inference`). Un résultat tardif est ignoré si le texte ou la miniature a changé entre-temps. Pas de routes : seulement `indexing.jobs.ts` pour le worker.
- `mcp` : `/v1/mcp`, transport MCP stateless authentifié par le même jeton. `mcp.service.ts` déclare les outils en lecture seule (`music_search`, `library_search`, `library_browse`, `seekInformation`…) ; `mcp.retrieval.ts` sépare l’identité cherchée des alternatives ; `mcp.repository.ts` relit les titres du compte. Le DJ utilise ces mêmes outils par une connexion MCP en mémoire.

## 8. Le DJ : `dj` et `dj/journal`

Ouvrir dans cet ordre :

1. `dj.controller.ts` : `/v1/dj/chat`, `/speech`, `/check`, `/settings`, `/settings/reset`, `/status`, `/rules` ; prend le bail du Tour (`dj-lease.ts`, un Tour par compte et un plafond sur l’instance, en mémoire) et monte `journal/`.
2. `dj-turn.service.ts` : un Tour = plan → catalogue exact → recherche MCP → décision → réponse.
3. Les règles pures, sans réseau ni base (vérifiées par `check:architecture`) : `dj.contracts.ts`, `plan.ts` (l’intention vient de `@playlist-recall/core/intent`), `prompt.ts`, `messages.ts`, `memory.ts`, `decision.ts`, `reply.ts`, `errors.ts`, `evidence.ts`, `composition.ts`.
4. Les adaptateurs : `research.ts` (exécution des outils), `provider.ts` et `ai-model.ts` (AI SDK : Gemini, Claude, transport compatible), `catalog.ts` (titres exacts, ordre et propriété), `dj-quota.service.ts` + `dj-quota.repository.ts` (budget quotidien), `dj-settings.service.ts` + `dj-settings.repository.ts` (clés chiffrées par compte), `dj-voice.service.ts`, `dj-check.service.ts`, `dj.config.ts`.
5. `journal/` : sous-module avec la même anatomie (`journal.controller.ts`, `.service.ts`, `.repository.ts`, `.schemas.ts`), plus `journal.contracts.ts` et `journal.payload.ts`. Voir [dj-journal.md](dj-journal.md).

Les règles de décision sont décrites dans [dj-behavior.md](dj-behavior.md).

### Les agents du DJ : `dj-agents`

Un agent est un profil ajouté aux règles du DJ, jamais un remplacement : ton et préférences de sélection, sans toucher au format, aux outils, à la source, à l’intention, au nombre de titres ni aux exclusions.

1. `base-agents.ts` : les agents de base (`dj`, `disquaire`, `archiviste`, `focus`) et leur texte. `syncBaseAgents` les écrit dans `dj_agents` à chaque démarrage, après les migrations : retoucher un texte demande un commit et un déploiement, jamais une migration.
2. `dj-agents.controller.ts` : `GET/POST /v1/dj/agents`, `PUT/DELETE /v1/dj/agents/{id}` ; un compte ne voit et ne modifie que ses agents personnalisés (20 au maximum), les agents de base sont en lecture seule.
3. `dj-agents.service.ts` → `resolve()` : appelé par `/v1/dj/chat` avant le journal. Un `agentId` inconnu, étranger ou supprimé repasse sur l’agent par défaut (`fallback` au journal) : une suite envoyée avec une sélection périmée joue quand même.
4. `dj/messages.ts` → `rules(plan, profile)` place le profil entre `djSystemPrompt` et les règles du Tour, qui restent les dernières. Le journal garde l’agent, son nom et l’empreinte de ses instructions dans `plan.agent` ; `promptHash` reste celui du prompt de base.
5. La voix de l’agent s’entend dans `explanation` (après l’annonce écrite par le serveur) et dans `reply` des conversations. `profileReminder` la rappelle à la fin de la demande et de la composition finale : un petit modèle suit d’abord la consigne la plus récente. La réponse de `/v1/dj/chat` porte `agent: {id, name}` quand ce n’est pas le DJ par défaut ; le Mac l’affiche au-dessus de la bulle.

Limites : l’annonce « C’est parti : … » est écrite par le serveur, l’agent agit sur le choix, `explanation` et les réponses de conversation. Un titre exact trouvé dans le catalogue répond sans modèle, donc sans agent.

### Le goût de la personne : `taste`

Le DJ apprend ce que la personne aime à partir de ses 👍 / 👎 et de son historique d’écoute.

1. `taste.rules.ts` : **toutes les règles**, en fonctions pures. Une **écoute** est un titre fini, ou arrêté après 60 s (les anciennes écoutes sans durée ne comptent que finies) ; un **passage rapide** est arrêté avant 30 s. Score : J’aime +4, écouté +1, +1 par doublement des écoutes, −2 par passage rapide (3 au plus), Je n’aime pas −5 puis estompé. `tasteOf()` en tire une **catégorie** (Coup de cœur, Souvent écouté, Déjà écouté, Pas encore d’avis, Peu accroché, Écarté pour l’instant), une **affinité** 0–100 et une étiquette. `rankByTaste()` ordonne une recherche ouverte (écartés retirés, favoris en tête, une place sur quatre pour la découverte) et laisse une recherche ciblée dans son ordre. `artistTastes()` classe les artistes par moyenne prudente (trois titres neutres ajoutés), crédit MusicBrainz d’abord, puis une chaîne « X - Topic », puis le titre « Artiste - Titre » (artiste principal seul), sinon la chaîne nettoyée.
2. `taste.repository.ts` : `track_feedback`, `taste_settings`, les agrégats de `listening_history` (écoutes et passages rapides grâce à `listened_ms`) et `heardTracks()`, chaque titre écouté ou noté avec son titre de catalogue.
3. `taste.service.ts` → `rank()` : appelé par `music_search` (module `mcp`) après une fusion à ordre fixe (bibliothèque puis YouTube, en alternance). Un `artist` nommé rend la recherche ciblée. `overview()` alimente Bibliothèque → Mon goût. `DjInput.ranking = "search"` désactive le tri pour une évaluation A/B.
4. `taste.controller.ts` : `GET/PUT /v1/taste/feedback/{videoId}` (`like`, `dislike`, `none`), `GET /v1/taste/overview` et `GET/PUT /v1/taste/settings`.

Un 👎 n’est jamais définitif : il écarte le titre des propositions pendant le délai du compte, puis son poids baisse de moitié à chaque nouveau délai. Un titre demandé par son nom passe toujours : résolution exacte du catalogue avant toute recherche, et une recherche par artiste garde les titres écartés. Un 👍 ne modifie aucune playlist.

## 9. Lecteur, versions Mac, santé : `player`, `releases`, `system`

- `player` : page publique du lecteur YouTube (`/dj/player`, `.js`, `.css`) intégrée par le Mac, servie en HTTPS pour un référent valide. Aucun jeton dans cette page.
- `releases` : flux Sparkle et archives signées sous `/macos`, depuis `MAC_RELEASES_DIR`.
- `system` : `/health`, avec l’état de la base et le SHA déployé (`RELEASE_SHA`).

Ces trois modules servent des fichiers tels quels : leurs routes sont documentées par `createRoute` et servies par des handlers simples.

## 10. La base de données : `src/db/` et `drizzle/`

- `src/db/schema/` : un fichier par domaine (`accounts`, `library`, `search`, `jobs`, `listening`, `dj`, plus `columns.ts` et `legacy.ts`). Une table = un `pgTable(...)`, noms snake_case en base, camelCase en TypeScript, contraintes avec leur nom réel. Les valeurs fixes sont des enums PostgreSQL (`pgEnum`) : `job_kind`, `job_status`, `playlist_status`, `sync_run_status`, `listening_outcome`, `lyrics_status`, `ai_provider`, `user_dj_provider`, `discovery_scope`, `turn_trigger`, `turn_status`, `journal_origin`.
- `src/db/client.ts` : `openDatabase()` crée le pool et l’objet Drizzle `orm` ; `pool` est l’instance du processus. Les dépôts reçoivent `db.orm` ou une transaction (`Executor`).
- `src/db/migrate.ts` : prend un verrou consultatif de session (740071) sur une connexion dédiée **avant** que Drizzle lise son journal, puis applique les migrations en attente dans une transaction. Deux processus qui démarrent ensemble s’attendent.
- `drizzle/` : `0000_baseline` (ancien schéma idempotent : une base existante l’applique sans changement), `0001` enums des tâches et playlists, `0002` enums d’écoute et de paroles, `0003` enums du DJ, `0004` table `dj_agents` (structure seule ; les agents de base sont écrits au démarrage), `0005` goût : `track_feedback`, `taste_settings` et `listening_history.listened_ms`. Seuls le déclencheur `recall_music_revision` et la configuration de recherche `recall_simple` restent en SQL écrit à la main.

Une requête Drizzle se lit comme son SQL, et son résultat est typé depuis le schéma :

```ts
const [session] = await orm
  .select({ id: tokens.id, userId: tokens.userId })
  .from(tokens)
  .where(and(eq(tokens.hash, hash), isNull(tokens.revokedAt)));
// SELECT id, user_id FROM tokens WHERE hash = $1 AND revoked_at IS NULL
```

Ajouter une migration :

1. Modifier `src/db/schema/<domaine>.ts`.
2. `npm run db:generate -w @playlist-recall/server -- --name <sujet>` (aucune base nécessaire : drizzle-kit compare au dernier instantané de `drizzle/meta/`).
3. Relire le SQL : retirer la qualification `"public"` des types enum (chaque suite de test a son schéma), recréer valeurs par défaut et index partiels autour d’un changement de type, garder `IF EXISTS` sur les suppressions.
4. Vérifier l’équivalence : le `pg_dump --schema-only` d’une base créée par toutes les migrations et celui d’une base créée par drizzle-kit depuis le schéma seul ne diffèrent que par le déclencheur `recall_music_revision`.
5. `npm run test:integration` sur une base jetable `*_test`.

## 11. La documentation OpenAPI

Elle est générée entièrement depuis les routes. `src/api-docs/openapi.ts` construit l’application sans base et appelle `app.getOpenAPI31Document()`, puis ajoute seulement description, serveurs, tags et sécurité. `npm run docs:generate` écrit la spécification et les artefacts Postman ; `npm run docs:check` (dans `npm run check`) échoue s’ils ne sont plus à jour. `tests/api-docs.test.ts` vérifie que chaque route montée est documentée. Voir [api.md](api.md).

## 12. Les règles qui tiennent l’ensemble

- `npm run check:architecture` (`scripts/check-architecture.mjs`, à la racine) : un module n’importe un autre module que par son `index.ts` ; `packages/core` n’importe rien du serveur ; le serveur n’importe rien de `apps/macos` ; les règles pures du DJ n’ont pas d’effet, et le module DJ n’utilise pas `any`.
- TypeScript très strict (`tsconfig.json`) : `noUncheckedIndexedAccess` (`rows[0]` peut être `undefined`), `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` (`process.env["X"]`), `noImplicitReturns`… Traiter le cas absent plutôt que forcer le type.
- Tests : `tests/*.test.ts` sans base (`npm test`) ; `tests/*.integration.test.ts` sur un PostgreSQL jetable dont le nom finit par `_test`, chaque suite dans son propre schéma PostgreSQL migré (`npm run test:integration`). `accounts.integration.test.ts` rejoue le parcours Google avec un faux fournisseur ; `migrations.integration.test.ts` lance deux migrations simultanées.

## 13. En production

- `build.mjs` produit avec esbuild un bundle JavaScript dans `dist/` (`boot`, `main`, `worker`, `inference`, `model-process`, `migrate`, `modules/auth/token.cli`). Le Dockerfile multi-étapes ne garde que ce bundle, les dépendances de production et `drizzle/`. L’API démarre avec `node dist/boot.js` ; worker et inférence avec `dist/worker.js` et `dist/inference.js`.
- La CI (job `image`) construit cette image et lance `scripts/smoke-server-image.sh` sur une base vide : migrations au démarrage (deux fois), `/health` avec le SHA, `/v1/me` en 401, worker, inférence et fichiers du bundle.
- **Une seule API** : baux des Tours DJ et limite de débit sont en mémoire, et le démarrage marque les Tours en cours comme interrompus. Arrêter l’ancienne API avant de démarrer la nouvelle. Le worker peut avoir plusieurs exemplaires.

Déploiement et première installation : [operations.md](operations.md).
