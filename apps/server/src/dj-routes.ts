import { Hono } from "hono";
import { z } from "zod";
import { hash } from "./content.ts";
import type { Database } from "./db.ts";
import { djSpeech, djVoiceConfigured } from "./dj-voice.ts";
import { djInput, djTurn, DjUnavailable } from "./dj.ts";
import {
  personalDjConfig,
  djSettingsInput,
  saveDjSettings,
  settingsKey,
} from "./dj-settings.ts";
export type ApiEnvironment = { Variables: { installationId: string } };
export function createDjRoutes(db: Database) {
  const app = new Hono<ApiEnvironment>();
  app.get("/status", async (c) => {
    const config = await personalDjConfig(db, c.get("installationId"));
    return c.json({
      configured: config.configured,
      voice: djVoiceConfigured(config),
      model: config.model ?? null,
      personal: config.personal,
      settingsAvailable: Boolean(settingsKey()),
    });
  });
  app.post("/settings", async (c) => {
    const input = djSettingsInput.parse(await c.req.json());
    const result = await saveDjSettings(db, c.get("installationId"), input);
    if (result === "missing-key")
      return c.json(
        { error: "Renseigne ta clé Gemini une première fois." },
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
    await db.query("DELETE FROM dj_settings WHERE token_id=$1", [
      c.get("installationId"),
    ]);
    return c.json({ saved: true });
  });
  const djActive = new Set<string>();
  app.post("/chat", async (c) => {
    const input = djInput.parse(await c.req.json());
    const installation = hash(c.req.header("Authorization")!);
    if (djActive.has(installation))
      return c.json({ error: "Le DJ prépare déjà ta sélection." }, 429);
    if (djActive.size >= 2)
      return c.json(
        { error: "Le DJ est occupé. Réessaie dans un instant." },
        429,
      );
    djActive.add(installation);
    try {
      return c.json(
        await djTurn(
          db,
          input,
          c.req.raw.signal,
          await personalDjConfig(db, c.get("installationId")),
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
  app.post("/speech", async (c) => {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(600) })
      .parse(await c.req.json());
    const installation = hash(c.req.header("Authorization")!);
    if (djActive.has(installation) || djActive.size >= 2)
      return c.json({ error: "Le DJ prépare déjà une réponse." }, 429);
    djActive.add(installation);
    try {
      return c.json(
        await djSpeech(
          db,
          text,
          c.req.raw.signal,
          await personalDjConfig(db, c.get("installationId")),
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
