# Local Playlist Recall Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independently owned embedding task; the controller implements the importer/search/UI and verifies integration. Never modify CAEX. Steps use checkbox syntax.

**Goal:** Deliver a working, local Chrome playlist search extension seeded with the user's playlist.

**Architecture:** Normalized playlist entries and deduplicated videos are persisted in IndexedDB. A Web Worker serves packaged E5 embeddings; keyword and semantic ranks merge after structured filtering. React hosts identical library UI in a side panel and tab.

**Tech Stack:** WXT, React, TypeScript, idb, Transformers.js, Vitest.

**Spec:** `docs/history/specs/2026-09-06-local-playlist-recall.md`

## Global Constraints
- Local inference and persistence only. No cloud backend, OAuth or secrets.
- Model and private seed assets are git-ignored and bundled in the personal build.
- Existing CAEX repository must remain untouched.
- Missing title/duration stay unknown; finite positive durations alone pass numeric filters.
- Cache identity includes model revision, text preparation version and text hash.

## Task 1: Import, persistence and retrieval
Files: src/types.ts, src/import.ts, src/search.ts, src/db.ts, tests/core.test.ts.
Interfaces: parseImport(input: unknown): LibraryImport; buildDocument(video: Video): string; searchLibrary(videos: Video[], memberships: Membership[], query: string, filters: SearchFilters, vectors?: Map<string, number[]>, queryVector?: number[]): SearchResult[].
- [ ] Write behavior tests before implementation. Hand-checked cases: 2 playlist occurrences -> 1 video / 2 memberships; missing duration excluded from >3600; exact 3600 excluded; unchanged text reuses vector; hostile supplied URL canonicalized from valid video ID; `jazz romantique` retrieves the supplied matching fixture through lexical/semantic fusion.
- [ ] Run `npm test`, observe missing implementation failures.
- [ ] Implement normalization and bounded validation, duration-expression parsing, BM25-style lexical rank and cosine/RRF, and transactional idb import.
- [ ] Run tests until passing.

## Task 2: Local embeddings
Files owned by delegate: src/embeddings.ts, src/embedding-worker.ts, scripts/prepare-model.mjs, scripts/seed-vectors.mjs, tests/embeddings.test.ts. Do not edit shared package/config files.
Interfaces: EmbeddingClient constructor optional status callback; embed(texts: string[], kind: 'query'|'passage'): Promise<number[][]>; dispose(): void. Status callback receives {phase: 'loading'|'ready'|'error', message: string}. Export MODEL_KEY constant from src/model.ts (controller creates it with delegate agreement).
- [ ] Implement consistent E5 prefixing, pooling/normalization, same model revision and q8 in browser and Node. Worker uses local packaged assets only and one inference request at a time. Include meaningful invalid-output/error tests.
- [ ] Preparation downloads model config/tokenizer/quantized ONNX weights from pinned Hugging Face revision into public/models, and copies required ORT WASM/runtime files to public/ort. Downloads must be resumable/reusable on rerun, not blind repeated network transfer.
- [ ] Seed script consumes public/data/library.json and produces public/data/vectors.json with modelKey, source text identity and per-video normalized vectors, using src/import.ts buildDocument once available. It must not invent metadata or drop unidentified source entries.
- [ ] Verify genuine local inference on French query and English passages; run all focused tests.

## Task 3: Extension and UI
Files: wxt.config.ts, entrypoints/background.ts, entrypoints/sidepanel/index.html, entrypoints/sidepanel/main.tsx, entrypoints/library/index.html, src/App.tsx, src/style.css, src/indexing.ts.
- [ ] Build a responsive French library with import/export controls, search, duration controls, playlist selector, visible result count and miniatures; display semantic/indexing/error state truthfully.
- [ ] On first use import personal seed and valid precomputed vectors atomically; later use persisted data. Never overwrite an existing library with the seed.
- [ ] Run index batches in a worker and save each batch; pause/cancel safely, serialize concurrent work and ignore stale queries/imports. Preserve keyword search when model cannot load.
- [ ] Build production extension and verify output includes only packaged JS/WASM/model paths.

## Task 4: Verification and delivery
Files: README.md, output/playwright artifacts, docs/verification.md.
- [ ] Load unpacked production extension in an isolated Chromium profile and exercise actual imports, query, >1h filtering, semantic paraphrase, persistence after reopen, invalid import and narrow layout.
- [ ] Record measured ranking and timing; inspect screenshot and console. Fix material errors and repeat only affected checks.
- [ ] Run unit tests, TypeScript check and production build. Obtain independent code review and address material findings.
- [ ] Copy production build to a visible `extension` folder and provide source plus exact loading instructions. No publication or changes to the user's normal Chrome profile.
