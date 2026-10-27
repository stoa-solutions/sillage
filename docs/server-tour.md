# Visite du serveur

Un parcours de lecture du serveur (`apps/server`), dans l’ordre où une requête le traverse. Il est complété à chaque lot de la refonte : les parties marquées « à venir » utilisent encore l’ancien rangement.

## Lancer le serveur en local

```sh
docker run -d --name sillage-dev-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sillage_dev -p 55432:5432 pgvector/pgvector:0.8.7-pg17
export DATABASE_URL=postgres://postgres:dev@localhost:55432/sillage_dev
npm run migrate -w @playlist-recall/server   # crée les tables
npm run dev:server                           # API sur http://127.0.0.1:3001
curl http://127.0.0.1:3001/health
```

La connexion Google demande `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `PUBLIC_URL` ; sans eux, `/auth/status` répond `{"google":false}`. Pour appeler `/v1/*` sans Google, créer un jeton personnel : `npx tsx apps/server/src/features/auth/token-cli.ts create /tmp/connexion.json` (le fichier contient le jeton, ne pas le committer).

`npm run docs:serve` ouvre la documentation OpenAPI locale.

## 1. Démarrage

1. `src/boot.ts` : applique les migrations (`db/migrate.ts`), clôt les tours DJ coupés par un redémarrage, puis charge `main.ts`.
2. `src/main.ts` : crée le serveur HTTP Node avec `createApp(pool)`.
3. `src/app.ts` : assemble l’application. Lire dans l’ordre : CORS et limite de taille, routes publiques (`/auth`, `/macos`, lecteur, `/health`), puis `app.use("/v1/*", sessionGuard(db))` : tout ce qui suit exige une session. Les features sont montées avec `app.route(...)`.

## 2. La base de données : `src/db/`

- `schema/` : une table = un `pgTable(...)`. Commencer par `accounts.ts` (`users`, `tokens`, `oauth_flows`, `oauth_grants`), puis `library.ts`. Les noms en base sont snake_case, les propriétés TypeScript camelCase. Les contraintes portent leur nom réel (`tokens_user_id_fkey`…) pour que les migrations futures les retrouvent.
- `client.ts` : `openDatabase()` crée un pool PostgreSQL et l’objet Drizzle `orm`. Le type `Database` expose les deux tant que tout n’est pas migré ; le code neuf n’utilise que `db.orm`.
- `migrate.ts` + `apps/server/drizzle/` : migrations SQL versionnées. `0000_baseline.sql` est l’ancien schéma, idempotent.

Une requête Drizzle se lit comme son SQL :

```ts
const [session] = await orm
  .select({ id: tokens.id, userId: tokens.userId })
  .from(tokens)
  .where(and(eq(tokens.hash, hash), isNull(tokens.revokedAt)));
// SELECT id, user_id FROM tokens WHERE hash = $1 AND revoked_at IS NULL
```

Le résultat est typé depuis le schéma : `session` vaut `{ id: string; userId: string } | undefined`.

## 3. Anatomie d’une feature : `src/features/auth/`

Toutes les features suivent ce modèle :

| Fichier | Rôle |
| --- | --- |
| `index.ts` | Ce que les autres parties du serveur ont le droit d’utiliser. |
| `routes.ts` | Les routes HTTP : chaque `createRoute(...)` déclare méthode, chemin, schémas d’entrée et de réponse, erreurs. Hono valide la requête avant le handler ; la doc OpenAPI vient de la même déclaration. |
| `contracts.ts` | Schémas Zod de l’API. Ils ne dérivent pas des tables : renommer une colonne ne change pas le contrat public. |
| `store.ts` | Toutes les lectures/écritures en base de la feature. Aucune règle HTTP ici. |
| autres | Une responsabilité par fichier : `google.ts` (fournisseur d’identité, remplaçable en test), `session.ts` (middleware Bearer), `return-page.ts` (HTML de retour), `token-cli.ts` (outil en ligne de commande). |

### Parcours : la connexion Google

1. Le Mac ouvre `GET /auth/google/start?challenge=…&app_state=…` (`routes.ts`, `startRoute`). La query est validée par `authStartInput`. `startFlow` (`store.ts`) enregistre l’empreinte du `state` et du cookie ; le navigateur part chez Google.
2. Google revient sur `/auth/google/callback`. `consumeFlow` supprime le flux **et** le renvoie en une requête (`DELETE … RETURNING`) : deux retours simultanés ne peuvent pas l’utiliser deux fois. `grantSignIn` crée ou met à jour le compte (`INSERT … ON CONFLICT (google_sub) DO UPDATE`) et un code de 90 secondes.
3. L’app appelle `POST /auth/exchange` avec ce code et son verifier PKCE. `exchangeGrant` consomme le code seulement si le challenge correspond, puis crée la session (`tokens`, 90 jours). Le serveur ne garde que l’empreinte du jeton.
4. Ensuite, chaque appel `/v1/*` passe par `sessionGuard` (`session.ts`) : jeton → session active → `c.set("userId")`, limite de 180 requêtes/minute, prolongation glissante.

### `src/features/accounts/`

`/v1/me`, `/v1/logout` et `/v1/account/claim-library`. À lire : `claimLegacyLibrary` dans `store.ts`. La transaction verrouille la ligne du compte historique (`SELECT … FOR UPDATE`) : si deux comptes tentent la reprise en même temps, le second attend puis voit la bibliothèque déjà prise. La preuve (un jeton historique valide) est vérifiée par la feature `auth`, passée en paramètre plutôt qu’importée de ses fichiers internes.

## 4. La bibliothèque et la file de tâches

### `src/features/jobs/` : une file générique

La file vit dans PostgreSQL (table `jobs`). Elle ne connaît aucune tâche en particulier :

- `store.ts`, `enqueue` : une tâche par clé (`dedupe_key`). Tant qu’une tâche de même clé attend ou tourne, `INSERT … ON CONFLICT` la renvoie au lieu d’en créer une seconde. L’index unique partiel `jobs_active_key` porte cette règle.
- `store.ts`, `claim` : prend la prochaine tâche due avec `SELECT … FOR UPDATE SKIP LOCKED` (deux workers ne prennent jamais la même) et lui donne un nouveau `leaseId`. Une tâche dont le bail a expiré (worker tué) est reprise ; le résultat tardif de l’ancien worker est refusé, car son `leaseId` ne correspond plus.
- `store.ts`, `finish` : terminée, réessayée plus tard (30 s, 60 s… jusqu’à 6 h) ou en échec après 5 essais.
- `runner.ts` : la boucle du worker, avec un registre `{ type de tâche → traitement }` et un battement qui prolonge le bail toutes les 30 s.

`src/worker.ts` assemble ce registre : chaque feature fournit les traitements des types qu’elle possède (`libraryJobHandlers` pour `sync` et `enrich`).

### `src/features/library/`

- `routes.ts` : `/v1/status`, `/v1/playlists` (liste, ajout, retrait, actualisation), `/v1/export`, `/v1/import`.
- `store.ts` : `followedBy` et `inLibraryOf`, les deux filtres qui isolent les comptes : une vidéo appartient à la bibliothèque d’un compte seulement si elle est active dans une playlist que ce compte suit. Toute lecture de la bibliothèque passe par eux.
- `sync.ts`, `syncPlaylist` : lit toute la playlist YouTube, puis dans une seule transaction (et seulement si le bail est toujours détenu) crée la génération suivante. Une entrée absente de deux synchronisations consécutives devient inactive.
- `enrich.ts` : métadonnées complètes par lots de 50 vidéos, photos de chaînes.
- `jobs.ts` : les traitements enregistrés auprès du worker et la synchronisation périodique.

### `src/integrations/`

Les clients de services externes, sans règle métier. `youtube/` compte chaque appel dans `quota_usage` et s’arrête avant le quota journalier de Google.

### `src/features/history/`, `lyrics/`, `enrichment/`, `discovery/`

- `history` : enregistre les écoutes par lots ; l’identifiant d’événement fourni par le Mac rend un renvoi sans effet (`ON CONFLICT DO NOTHING`). Pagination par curseur `(playedAt, id)`.
- `lyrics` : `lyrics.ts` décide (cache encore frais ? sinon LRCLIB, et en cas d’échec on garde l’ancien résultat) ; `matching.ts` choisit l’enregistrement LRCLIB sans réseau ; `store.ts` lit et écrit. Seules les vidéos de la bibliothèque du compte ont des paroles.
- `enrichment` : l’enrichissement MusicBrainz, par lots bornés et seulement pour les comptes inscrits (`MUSICBRAINZ_ACCOUNT_IDS`). Le résultat n’est publié que si la tâche tient toujours son bail et que la vidéo n’a pas changé entre-temps.
- `discovery` : recherche YouTube (ou SearXNG), « Mes découvertes » et l’accueil Découvrir. `home.ts` reçoit une fonction qui charge l’historique, ce qui le rend testable sans base.

### `src/integrations/`

`youtube/`, `lrclib/`, `musicbrainz/` (cache partagé et une requête par seconde pour tous les workers, sous verrou PostgreSQL), `searxng/` (recherche privée et sources d’information du DJ).

## 5. Les règles qui tiennent l’ensemble

- `npm run check:architecture` (`scripts/check-architecture.mjs`) : une feature n’importe une autre feature que par son `index.ts` ; le cœur partagé n’importe rien du serveur ; les règles pures du DJ n’ont pas d’effet.
- TypeScript très strict (`apps/server/tsconfig.json`) : `rows[0]` peut être `undefined`, une propriété optionnelle ne reçoit pas `undefined` explicitement, `process.env["X"]`.
- Tests : `apps/server/tests/*.test.ts` (sans base) et `*.integration.test.ts` (PostgreSQL jetable, un schéma par suite). `accounts.integration.test.ts` rejoue tout le parcours Google avec un faux fournisseur.

## 6. À venir

Recherche et indexation, outils MCP, DJ : encore dans `src/*.ts` et `src/features/dj/`, en SQL via `db.query`. Chaque lot les déplace dans ce modèle et complète cette page.
