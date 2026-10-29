export { insightsRoutes } from "./controllers/insights.controller.ts";
export {
  artistProfile,
  albumPage,
  searchArtists,
  videoInsights,
  INSIGHT_RULES,
  type InsightsSources,
  type CatalogArtist,
} from "./services/insights.service.ts";
export { defaultInsightsSources, catalogArtists } from "./insights.sources.ts";
