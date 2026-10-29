export { searchRoutes } from "./controllers/search.controller.ts";
export { search, type SearchInput } from "./services/search.service.ts";
export { librarySearchInput } from "./types/search.schemas.ts";
export {
  musicMatchRank,
  normalizeMusic,
  resolveExactRequest,
  versionPenalty,
} from "./music-matching.ts";
export * from "./search.relevance.ts";
