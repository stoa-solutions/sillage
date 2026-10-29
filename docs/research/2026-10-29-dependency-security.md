# Dépendances — correctifs du 29 octobre 2026

Les onze alertes Dependabot ouvertes au début de l’intervention sont couvertes par les mises à jour ci-dessous. Aucun changement de comportement produit, de schéma SQL ou de données utilisateur.

| Alertes | Paquet | Avant | Après |
| --- | --- | --- | --- |
| 10–11 | Vitest et `@vitest/mocker` | 4.1.11 | 4.1.12 |
| 4–9 | Vite | 8.2.2 | 8.3.5 |
| 3 | source-map-js | 1.2.1 | 1.2.2 |
| 2 | esbuild indirect via Drizzle Kit | 0.18.20 | 0.25.12 |
| 1 | Zod du pilote AI SDK | 4.3.6 | 4.6.7 |

Le serveur utilisait déjà Zod 4.6.7. Les versions des dépendances d’exécution du verrou principal sont conservées ; seules celles de l’outillage et du pilote changent. Les dépendances transitives de Vitest et Vite sont résolues par npm dans leurs plages compatibles.

## Cas Drizzle Kit

Drizzle Kit 0.31.11, version stable disponible lors du contrôle, dépend encore de l’ancien chargeur `@esbuild-kit/esm-loader`, qui tire esbuild 0.18.20. Un `override` limité à `@esbuild-kit/core-utils` impose esbuild 0.25.12. Il ne modifie pas esbuild 0.28.2 utilisé pour construire le serveur.

Drizzle Kit est déclaré comme outil de développement à la racine. Avec npm 11.12.1, sa présence uniquement dans le workspace serveur laissait l’ancienne résolution en place et produisait un arbre signalé invalide par `npm ls`, même avec la règle à la racine. La déclaration à la racine permet à npm d’appliquer et de reconnaître la règle : `npm ls esbuild --all` passe et indique `overridden`. La commande existante `npm run db:generate -w @sillage/server` reste utilisable.

Le verrou a été recalculé avec npm. La génération Drizzle charge la configuration et le schéma TypeScript, puis produit les migrations des 28 tables dans un dossier temporaire, sans connexion à une base. Ni la version de Drizzle ni les migrations du dépôt ne changent.

## Vérifications

- Installation reproductible avec `npm ci --legacy-peer-deps`.
- `npm audit --audit-level=low` : aucune vulnérabilité dans le monorepo ni dans le pilote.
- `npm run verify:node` : types, documentation OpenAPI, frontières d’architecture, tests et compilation du serveur.
- Tests serveur hors base : 307 réussis.
- Tests PostgreSQL/pgvector sur une base jetable `sillage_test` : 138 réussis, 2 scénarios conditionnels ignorés.
- Pilote AI SDK : quatre scénarios synthétiques réussis (outils, réponse sans outil, erreur 429, annulation), sans clé ni appel à un modèle réel.
- `npm run verify:macos` : packaging, compilation et suites natives, dont l’isolation des agents.

Sur ce Mac, le SDK 27 des CommandLineTools ne fournit pas le plugin `SwiftUIMacros` requis. Une vue SwiftUI minimale reproduit l’erreur indépendamment du projet. La validation native passe avec le SDK 26.5 déjà installé : `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk npm run verify:macos`. Aucun changement global de l’environnement ni du code Mac.

La CI vérifie désormais les deux verrous par `npm audit` et rejoue le pilote AI SDK, en plus des contrôles existants. Ces vérifications ne constituent pas une nouvelle recette manuelle de l’app installée ni une publication d’installateur.

## Références

- [Vitest : correctif 4.1.12](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)
- [Vite / launch-editor : vérification du chemin Windows](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm)
- [source-map-js 1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
- [esbuild : origine des requêtes vers le serveur de développement](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)
- [Zod : bornes des collections avant traitement](https://github.com/colinhacks/zod/pull/6652)
- [npm : règles de remplacement des dépendances](https://docs.npmjs.com/cli/configuring-npm/package-json/#overrides)
