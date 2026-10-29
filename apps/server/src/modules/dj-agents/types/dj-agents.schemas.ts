import { z } from "@hono/zod-openapi";

export const agentInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    instructions: z.string().trim().min(1).max(1500),
  })
  .openapi("DjAgentInput");
export const agentIdParam = z.object({ id: z.uuid() });
export const agentBody = z
  .object({
    /** The base agent's key (`focus`) or the custom agent's uuid: what the DJ request sends. */
    id: z.string(),
    name: z.string(),
    instructions: z.string(),
    base: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("DjAgent");
export const agentListBody = z
  .object({ defaultId: z.string(), agents: z.array(agentBody) })
  .openapi("DjAgents");
