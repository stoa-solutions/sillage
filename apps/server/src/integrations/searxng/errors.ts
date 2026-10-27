export class SearxngError extends Error {
  constructor(
    public reason:
      "search_unavailable" | "search_blocked" = "search_unavailable",
  ) {
    super(reason);
  }
}
