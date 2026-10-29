/**
 * A mistake in what the client sent. The API answers 400 with this message, written for the
 * person, and does not log it as a failure. Anything else thrown in a route is a 500.
 */
export class InvalidInput extends Error {
  override name = "InvalidInput";
}
