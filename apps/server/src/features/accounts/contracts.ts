import { z } from "zod";

export const claimLibraryInput = z.object({
  legacyToken: z.string().min(20).max(256),
});
