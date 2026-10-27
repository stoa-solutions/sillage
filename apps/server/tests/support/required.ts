/** Narrows a test value that an earlier step guarantees, failing loudly when it is missing. */
export function required<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}
