# Sillage DJ simulation

## Purpose

Exercise the real DJ agent, its MCP client and PostgreSQL against a local Chat Completions stand-in. The handler follows the official Chat Completions response/tool-call envelope; it is authored here because the CLI is signed out and an owner's published mock could not be searched.

## Run

`postman simulation run postman/simulations/dj.sim.yaml --port 4905 --output ndjson`

Run the integration tests with `DJ_SIMULATION_URL=http://127.0.0.1:4905/model/v1` and `TEST_DATABASE_URL` pointing to an isolated `_test` database. Keep logs under `.runtime/` and never commit real API traffic.

## Assumptions

- The simulation proves HTTP/tool orchestration and error handling, not the quality of a real model's musical choices. Voice and YouTube are checked separately against their real services (observed 2026-10-24).
- A remote test DB reached through SSH needs the test runner's `--testTimeout=20000`; its round trips exceeded Vitest's five-second default on existing database tests (observed 2026-10-24).

## What didn't work

- Directory member paths failed in CLI 1.74.0; point at `config.yaml` and keep its manifest `version: 1` (observed 2026-10-24).

## Observations

<!-- begin:observations -->
- 2026-10-26 : scénario `SIMULATE_COMPOSITION` : quatre recherches réelles MCP/PostgreSQL puis composition finale depuis les candidats accumulés, en HTTP avec un vrai client fournisseur. Le handler accepte désormais `tools` absent pour la conclusion, comme le protocole Chat Completions. Une explication musicale survit à l’annonce déterministe de l’action. Aucun quota réel consommé par cette simulation.
- 2026-10-26: le mock suit désormais le contrat exposé `music_search` et son enveloppe `results[].video`, au lieu de l’ancien `library_search`. Les 99 tests PostgreSQL/intégration passent avec la simulation HTTP activée : lecture vérifiée, confirmation sans opération, rejet d’ID inventé et panne fournisseur explicite. Cela ne prouve pas la compréhension d’un modèle réel.
- 2026-10-24: the model member served the tool-calling and final-selection HTTP requests. The real MCP search returned database candidates. An invented ID was rejected with 502; a provider 503 became a safe error without exposing its credential. All 19 database/integration tests passed with the simulation enabled.
<!-- end:observations -->
