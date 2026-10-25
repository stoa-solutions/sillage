import { nextYouTubeQuotaReset } from "./youtube-errors.ts";

export type SearchFailureReason =
  | "daily_quota"
  | "rate_or_quota"
  | "unavailable"
  | "not_configured"
  | "access_denied"
  | "local_budget";
export interface SearchFailure {
  source: "youtube" | "library" | "search";
  reason: SearchFailureReason;
}

/** Public copy comes from known codes, never a provider response or model diagnosis. */
export function searchFailureMessage(
  failure: SearchFailure,
  now: number,
): string {
  if (failure.source === "library")
    return "La recherche dans tes playlists est momentanément indisponible. Réessaie dans un instant ; tes morceaux enregistrés sont conservés.";
  if (failure.source === "search")
    return "L’outil de recherche n’a pas répondu correctement. Réessaie dans un instant.";
  switch (failure.reason) {
    case "daily_quota": {
      const reset = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(nextYouTubeQuotaReset(now));
      return `Le quota quotidien YouTube du serveur est atteint. Renouvellement prévu le ${reset} (heure de Paris). Changer ta clé Gemini ne résoudra pas ce blocage.`;
    }
    case "rate_or_quota":
      return "YouTube limite temporairement les requêtes du serveur. Patiente un peu avant de réessayer ; l’heure de reprise n’est pas fournie.";
    case "not_configured":
      return "La recherche YouTube n’est pas configurée sur le serveur. L’administrateur doit configurer sa clé YouTube ; ta clé Gemini n’est pas en cause.";
    case "access_denied":
      return "YouTube refuse l’accès au serveur. L’administrateur doit vérifier sa clé YouTube, ses restrictions et l’activation de l’API.";
    case "local_budget":
      return "Le budget quotidien YouTube configuré dans Recall est atteint. L’administrateur peut ajuster ce budget ; cela n’augmente pas le quota Google.";
    default:
      return "La recherche YouTube est momentanément indisponible. Réessaie dans un instant ; aucun épuisement de quota n’a été confirmé.";
  }
}

/** Repeated calls to a failed source produce one notice per cause, not one per query. */
export function searchFailureSummary(
  failures: SearchFailure[],
  now: number,
): string {
  const unique = new Map(
    failures.map((failure) => [`${failure.source}:${failure.reason}`, failure]),
  );
  return [...unique.values()]
    .map((failure) => searchFailureMessage(failure, now))
    .join(" ");
}
