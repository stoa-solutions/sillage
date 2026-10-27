import { z } from "@hono/zod-openapi";

const count = z.number().int();
export const enrichmentBody = z
  .object({
    total: count,
    processed: count,
    matched: count,
    ambiguous: count,
    not_found: count,
    unavailable: count,
    awaiting_youtube: count,
    queued: count,
    running: count,
    retrying: count,
    failed: count,
    batchSize: count,
    enabled: z.boolean(),
    checkedAt: z.iso.datetime(),
  })
  .openapi("Enrichment");
