/** Safe provider classification: never retain response bodies, project IDs or credentials. */
export class YouTubeError extends Error {
  constructor(
    public kind: "daily_quota" | "rate_limit" | "access_denied" | "unavailable",
    public status: number,
  ) {
    super(`YouTube ${kind} (HTTP ${status})`);
  }
}

export function youtubeError(status: number, body: unknown): YouTubeError {
  const error = (
    body as {
      error?: {
        errors?: { reason?: unknown }[];
        details?: {
          metadata?: { quota_limit?: unknown };
          violations?: { quotaLimit?: unknown }[];
        }[];
      };
    } | null
  )?.error;
  const reasons = Array.isArray(error?.errors)
    ? error.errors
        .map((item) => item?.reason)
        .filter((value): value is string => typeof value === "string")
    : [];
  const limits = Array.isArray(error?.details)
    ? error.details
        .flatMap((detail) => [
          detail?.metadata?.quota_limit,
          ...(Array.isArray(detail?.violations)
            ? detail.violations.map((violation) => violation?.quotaLimit)
            : []),
        ])
        .filter((value): value is string => typeof value === "string")
    : [];
  const daily =
    reasons.some((reason) =>
      /^(quotaExceeded|dailyLimitExceeded)$/.test(reason),
    ) ||
    ((status === 429 || reasons.includes("rateLimitExceeded")) &&
      limits.some((limit) => /PerDay|daily/i.test(limit)));
  return new YouTubeError(
    daily
      ? "daily_quota"
      : status === 429 || reasons.includes("rateLimitExceeded")
        ? "rate_limit"
        : status === 401 || status === 403
          ? "access_denied"
          : "unavailable",
    status,
  );
}

const pacificDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Pacific midnight always falls on a UTC hour; the timezone formatter handles DST. */
export function nextYouTubeQuotaReset(now: number): number {
  const today = pacificDay.format(now);
  const hour = 3_600_000;
  for (let offset = 1; offset <= 26; offset++) {
    const boundary = Math.floor(now / hour) * hour + offset * hour;
    if (pacificDay.format(boundary) !== today) return boundary;
  }
  throw new Error("Unable to determine YouTube quota reset");
}
