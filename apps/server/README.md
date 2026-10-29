# Serveur Sillage

API Hono, worker de tâches et processus d’inférence, sur PostgreSQL (Drizzle). Pour une lecture guidée fichier par fichier : [docs/server-tour.md](../../docs/server-tour.md).

## Carte

```text
src/
├── boot.ts, main.ts     # API : migrations au démarrage, puis serveur HTTP
├── worker.ts            # file de tâches (synchronisation, index, enrichissement, paroles)
├── inference.ts         # calcul des vecteurs ; model-process.ts tourne en processus enfant
├── migrate.ts           # migrations seules (npm run migrate)
├── app.ts               # racine de composition : monte les routes des modules
├── db/
│   ├── schema.ts        # toute la base, une section par domaine
│   ├── client.ts        # pool et instance Drizzle
│   └── migrate.ts       # applique drizzle/*.sql
├── modules/<module>/    # une fonctionnalité : controller → service → repository
├── integrations/        # clients des services externes, sans règle métier
├── shared/              # configuration, empreintes, conventions OpenAPI
└── api-docs/            # génération et service de la doc OpenAPI
drizzle/                 # migrations SQL générées et leurs instantanés
tests/                   # *.test.ts sans base, *.integration.test.ts sur PostgreSQL
```

Les fichiers à la racine de `src/` sont les points d’entrée des processus : `build.mjs` et le `Dockerfile` en dépendent, ne pas les déplacer.

## Un module

| Fichier | Rôle |
| --- | --- |
| `<module>.controller.ts` | Routes HTTP, validation Zod, documentation OpenAPI. |
| `<module>.service.ts` | Règles métier, sans HTTP. |
| `<module>.repository.ts` | Requêtes Drizzle, toujours filtrées par le compte. |
| `<module>.schemas.ts` | Contrats Zod de l’API, indépendants des tables. |
| `index.ts` | Seule entrée publique du module (`check:architecture`). |

## Commandes

```sh
npm run dev:server                          # depuis la racine du dépôt
npm run db:generate -w @sillage/server -- --name <sujet>   # après une modification de src/db/schema.ts
npm run verify:node                         # vérification complète
TEST_DATABASE_URL=postgres://…/x_test npm run test:integration -w @sillage/server
```
