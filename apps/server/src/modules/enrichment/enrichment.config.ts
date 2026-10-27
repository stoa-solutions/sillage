/** Pilot IDs remain supported alongside explicit account rollouts. */
export function pilotIds(): string[] {
  return [
    ...new Set(
      (process.env["MUSICBRAINZ_PILOT_IDS"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[\w-]{11}$/.test(s)),
    ),
  ].slice(0, 10);
}

/** Explicit account opt-in; never enables the public catalog globally. */
export function enrichmentAccounts(): string[] {
  return [
    ...new Set(
      (process.env["MUSICBRAINZ_ACCOUNT_IDS"] ?? "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter((id) =>
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id),
        ),
    ),
  ];
}
export const enrichmentBatchSize = 10;
