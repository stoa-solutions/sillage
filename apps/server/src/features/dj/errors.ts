/** Safe public failure: provider payloads and credentials must never reach clients. */
export class DjUnavailable extends Error {
  constructor(
    message: string,
    public status: 429 | 502 | 503 = 503,
  ) {
    super(message);
  }
}
