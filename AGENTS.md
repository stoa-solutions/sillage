# Recall — règles du dépôt

Règles communes à Codex et Claude Code. Samuel travaille avec les deux en parallèle sur ce dépôt : chaque changement suit le protocole ci-dessous.

## Carte

| Zone | Rôle | Validation |
| --- | --- | --- |
| `packages/core` | Formats d’import, recherche pure, contrats du DJ. Aucun réseau ni secret. | `npm run verify:node` |
| `apps/server` | API Hono, worker à baux PostgreSQL, inférence, MCP, DJ. | `npm run verify:node` ; tout changement SQL ajoute `npm run test:integration` sur une base jetable `*_test` |
| `apps/macos` | App SwiftUI : `RecallKit` (cœur testable), `RecallMac` (UI, session privée, WebKit, Sparkle), `RecallAudio`. | `npm run verify:macos` |

Architecture et limites : `docs/architecture.md`. App Mac : `docs/macos.md`. Exploitation et déploiement : `docs/operations.md`. Vocabulaire du domaine : `GLOSSARY.md`. Index : `docs/README.md`.

## Protocole de collaboration

1. **Voir** : `git fetch` puis `npm run board`. Le tableau liste qui travaille sur quelle branche et quelles zones. Une zone déjà prise se coordonne avec Samuel avant d’y toucher. `packages/core`, `package-lock.json` et `docs/CHANGELOG.md` sont partagés : un seul agent à la fois.
2. **Réserver** : créer le worktree `../playlist-recall-wt/<agent>-<sujet>` sur la branche `<agent>/<sujet>` depuis `origin/main`, puis `npm run board -- claim <agent> <agent>/<sujet> <zones>`. Un worktree en HEAD détachée crée sa branche avant le premier commit. Le checkout principal reste sur `main`, propre.
3. **Travailler** : commits conventionnels `type(zone): résumé` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`), un sujet par branche. Tout changement visible ajoute une ligne à `docs/CHANGELOG.md`, section « Non publié ».
4. **Intégrer** : `git fetch`, `git rebase origin/main`, puis la validation de chaque zone touchée doit passer sur le commit rebasé. Ensuite `git push origin HEAD:main` (fast-forward ; s’il est refusé, recommencer l’étape 4). Une seule intégration à la fois ; jamais de force-push sur `main`.
5. **Libérer** : après le push confirmé, `npm run board -- release <branche>`, puis suppression du worktree et de la branche.

L’étape 4 est terminée quand `origin/main` contient le commit et que la validation a passé sur ce commit exact.

## Invariants

- **Secrets** : clés Gemini/YouTube, jetons serveur, configuration Dokploy et signature restent hors du dépôt, des exports et des paquets. Les fichiers de connexion privés ne sont jamais lus dans une réponse ni copiés.
- **Déploiement** : Dokploy construit `apps/server/Dockerfile` via `docker-compose.yml` ; ces chemins et noms de services sont un contrat. Un déploiement suit `docs/operations.md` jusqu’au bout : image, migrations, SHA servi par `/health`, progression du worker.
- **App Mac** : toutes les builds partagent la bibliothèque `~/Library/Application Support/Playlist Recall` et le fichier de session privé de Samuel. Les essais de développement passent `RECALL_DATA_DIR=<dossier temporaire>` ; les tests utilisent toujours un dossier temporaire. Seul `scripts/build-macos.py`, depuis `main`, produit une version publiée, avec le numéro de build de `apps/macos/version.json` incrémenté.
- **Données utilisateur** : une migration conserve les originaux et s’exécute dans une transaction. Un import incomplet ne remplace rien.

## Conventions

- Interface et documentation en français ; code, identifiants et commentaires en anglais.
- Swift : `xcrun swift-format format -i --configuration apps/macos/.swift-format <fichiers>`. TypeScript : suivre le style du fichier modifié ; pas de reformatage hors des lignes touchées.
- Les recherches et analyses produit vont dans `docs/research/` ; les plans et specs terminés dans `docs/history/`.
