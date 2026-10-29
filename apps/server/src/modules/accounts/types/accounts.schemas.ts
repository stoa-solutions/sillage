import { z } from "@hono/zod-openapi";

export const accountBody = z
  .object({
    id: z.uuid(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    google: z.boolean(),
  })
  .openapi("Account");
