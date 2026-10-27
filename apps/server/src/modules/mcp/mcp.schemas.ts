import { z } from "@hono/zod-openapi";

export const rpcRequestBody = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number().int()]).optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("RpcRequest");
export const rpcResponseBody = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.string(), z.number().int(), z.null()]).optional(),
    result: z.unknown().optional(),
    error: z
      .object({ code: z.number().int(), message: z.string(), data: z.unknown() })
      .partial({ data: true })
      .optional(),
  })
  .openapi("RpcResponse", {
    description: "Enveloppe JSON-RPC 2.0 : result ou error, selon la méthode MCP.",
  });
