export { lyricsRoutes } from "./controllers/lyrics.controller.ts";
export {
  lyricsFor,
  prefetchLyrics,
  setLyricsOffset,
  type LyricsSources,
  type VideoFacts,
} from "./services/lyrics.service.ts";
export { defaultLyricsSources } from "./lyrics.sources.ts";
export {
  chooseRecord,
  cleanTitle,
  lyricsQueries,
  normalize,
  parseLrc,
} from "./lyrics.matching.ts";
