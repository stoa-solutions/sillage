import { providerBaseUrl } from "./dj-config.ts";
import { djSystemPrompt } from "./dj-prompt.ts";
import { checkDj } from "./dj-check.ts";
import { Hono } from "hono";
import { z } from "zod";
import { AI_PROVIDER_IDS } from "@playlist-recall/core/dj";
import type { Database } from "./db.ts";
import { djSpeech, djVoiceConfigured } from "./dj-voice.ts";
import { djInput, djTurn, DjUnavailable } from "./dj.ts";
import {
  personalDjConfig,
  aiProviderStatus,
  resetDjSettings,
  djSettingsInput,
  saveDjSettings,
  settingsKey,
} from "./dj-settings.ts";
import { journalRoutes } from "./features/dj/journal/routes.ts";
import {
  beginJournal,
  publicJournalError,
} from "./features/dj/journal/store.ts";
export type ApiEnvironment = {
  Variables: { installationId: string; userId: string };
};
export function createDjRoutes(db: Database) {
  const app = new Hono<ApiEnvironment>();
  app.route("/", journalRoutes(db));
  app.get("/rules", (c) => c.json({ prompt: djSystemPrompt }));
  app.get("/status", async (c) => {
    const config = await personalDjConfig(db, c.get("userId"));
    return c.json({
      configured: config.configured,
      provider: config.provider === "anthropic" ? "anthropic" : "google",
      providers: await aiProviderStatus(db, c.get("userId")),
      voice: djVoiceConfigured(config),
      model: config.model ?? null,
      personal: config.personal,
      settingsAvailable: Boolean(settingsKey()),
    });
  });
  app.post("/settings", async (c) => {
    const input = djSettingsInput.parse(await c.req.json());
    const result = await saveDjSettings(db, c.get("userId"), input);
    if (result === "missing-key")
      return c.json(
        { error: "Renseigne la clé de ce fournisseur une première fois." },
        400,
      );
    if (result === "unavailable")
      return c.json(
        { error: "Le serveur doit activer le stockage sécurisé des clés." },
        503,
      );
    return c.json({ saved: true });
  });
  app.post("/settings/reset", async (c) => {
    const { provider } = z.object({ provider: z.enum(AI_PROVIDER_IDS).optional() }).parse(await c.req.json());
    await resetDjSettings(db, c.get("userId"), provider);
    return c.json({ saved: true });
  });
  const djActive = new Set<string>();
  app.post("/check", async (c) => {
    const input = djSettingsInput
      .safeExtend({ voice: z.boolean().default(false) })
      .parse(await c.req.json());
    const user = c.get("userId");
    if (djActive.has(user) || djActive.size >= 2)
      return c.json(
        { error: "Le DJ est occupé. Réessaie après sa réponse." },
        429,
      );
    djActive.add(user);
    try {
      const stored = await personalDjConfig(db, user, input.provider);
      const config = {
        ...stored,
        model: input.model,
        ...(input.apiKey
          ? {
              key: input.apiKey,
              configured: true,
              provider: input.provider,
              baseUrl: providerBaseUrl(input.provider),
            }
          : {}),
      };
      return c.json(await checkDj(db, config, user, input.voice));
    } finally {
      djActive.delete(user);
    }
  });
  app.post("/chat", async (c) => {
    const input = djInput.parse(await c.req.json());
    const installation = c.get("userId");
    const journal = await beginJournal(
      db,
      installation,
      c.get("installationId"),
      input,
    );
    c.header("X-Sillage-Trace-Id", journal.id);
    async function finish(
      status: Parameters<typeof journal.finish>[0],
      response: unknown,
      model?: string,
    ) {
      c.header(
        "X-Sillage-Journal",
        (await journal.finish(status, response, model))
          ? "saved"
          : "unavailable",
      );
    }
    if (djActive.has(installation)) {
      await finish("busy", {
        error: "Le DJ prépare déjà ta sélection.",
        status: 429,
      });
      return c.json({ error: "Le DJ prépare déjà ta sélection." }, 429);
    }
    if (djActive.size >= 2) {
      await finish("busy", {
        error: "Le DJ est occupé. Réessaie dans un instant.",
        status: 429,
      });
      return c.json(
        { error: "Le DJ est occupé. Réessaie dans un instant." },
        429,
      );
    }
    djActive.add(installation);
    let model: string | undefined;
    try {
      const config = await personalDjConfig(db, c.get("userId"));
      model = config.model;
      const response = await djTurn(
        db,
        input,
        c.req.raw.signal,
        config,
        c.get("userId"),
        journal.observe,
      );
      await finish("completed", response, model);
      return c.json(response);
    } catch (error) {
      await finish(
        c.req.raw.signal.aborted ? "canceled" : "error",
        publicJournalError(error),
        model,
      );
      if (error instanceof DjUnavailable)
        return c.json({ error: error.message }, error.status);
      throw error;
    } finally {
      djActive.delete(installation);
    }
  });
  app.post("/speech", async (c) => {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(600) })
      .parse(await c.req.json());
    const installation = c.get("userId");
    if (djActive.has(installation) || djActive.size >= 2)
      return c.json({ error: "Le DJ prépare déjà une réponse." }, 429);
    djActive.add(installation);
    try {
      return c.json(
        await djSpeech(
          db,
          text,
          c.req.raw.signal,
          await personalDjConfig(db, c.get("userId")),
          c.get("userId"),
        ),
      );
    } catch (error) {
      if (error instanceof DjUnavailable)
        return c.json({ error: error.message }, error.status);
      throw error;
    } finally {
      djActive.delete(installation);
    }
  });
  return app;
}
