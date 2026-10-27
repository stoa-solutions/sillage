export { searchRoutes } from "./search.controller.ts";
export { search, type SearchInput } from "./search.service.ts";
export { librarySearchInput } from "./search.schemas.ts";
export {
  musicMatchRank,
  normalizeMusic,
  resolveExactRequest,
  versionPenalty,
} from "./music-matching.ts";
export * from "./search.relevance.ts";
