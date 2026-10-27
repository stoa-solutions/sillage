import { Hono, type Context } from "hono";
import { z } from "zod";
import { AI_PROVIDER_IDS } from "@playlist-recall/core/dj";
import type { ApiEnvironment } from "../../shared/api-environment.ts";
import type { Database } from "../../db/index.ts";
import { checkDj } from "../../dj-check.ts";
import { providerBaseUrl } from "../../dj-config.ts";
import {
  aiProviderStatus,
  djSettingsInput,
  personalDjConfig,
  resetDjSettings,
  saveDjSettings,
  settingsKey,
} from "../../dj-settings.ts";
import { djSpeech, djVoiceConfigured } from "../../dj-voice.ts";
import { djInput } from "./contracts.ts";
import { DjUnavailable } from "./errors.ts";
import { journalRoutes } from "./journal/routes.ts";
import {
  beginJournal,
  loadConversationMemory,
  publicJournalError,
  type TurnStatus,
} from "./journal/store.ts";
import {
  TurnDeadline,
  TurnLeases,
  TurnRefused,
  TurnSuperseded,
} from "./lease.ts";
import { planTurn } from "./plan.ts";
import { djSystemPrompt } from "./prompt.ts";
import { djTurn } from "./turn.ts";

/** Writing the final journal status never holds a response for long. */
const JOURNAL_FINISH_MS = 5_000;

function unavailable(c: Context<ApiEnvironment>, error: unknown) {
  if (error instanceof DjUnavailable)
    return c.json({ error: error.message }, error.status);
  throw error;
}

export function createDjRoutes(
  db: Database,
  leases = new TurnLeases({
    capacity: Number(process.env.DJ_CONCURRENT_TURNS) || 2,
  }),
) {
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
    const { provider } = z
      .object({ provider: z.enum(AI_PROVIDER_IDS).optional() })
      .parse(await c.req.json());
    await resetDjSettings(db, c.get("userId"), provider);
    return c.json({ saved: true });
  });

  /** A settings check never interrupts the listener's own turn. */
  app.post("/check", async (c) => {
    const input = djSettingsInput
      .safeExtend({ voice: z.boolean().default(false) })
      .parse(await c.req.json());
    const user = c.get("userId");
    if (leases.busy(user))
      return c.json(
        { error: "Le DJ est occupé. Réessaie après sa réponse." },
        429,
      );
    let lease;
    try {
      lease = await leases.acquire(user, "user", c.req.raw.signal);
    } catch (error) {
      if (error instanceof TurnRefused)
        return c.json({ error: error.message }, 429);
      throw error;
    }
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
      lease.release();
    }
  });

  app.post("/chat", async (c) => {
    const input = djInput.parse(await c.req.json());
    const user = c.get("userId");
    const journal = await beginJournal(db, user, c.get("installationId"), input);
    c.header("X-Sillage-Trace-Id", journal.id);
    async function finish(
      status: TurnStatus,
      response: unknown,
      model?: string,
    ) {
      const saved = await Promise.race([
        journal.finish(status, response, model),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), JOURNAL_FINISH_MS),
        ),
      ]);
      c.header("X-Sillage-Journal", saved ? "saved" : "unavailable");
    }

    let lease;
    try {
      lease = await leases.acquire(
        user,
        planTurn(input).trigger,
        c.req.raw.signal,
      );
    } catch (error) {
      if (!(error instanceof TurnRefused)) throw error;
      const status = error.reason === "saturated" ? 503 : 409;
      await finish("busy", { error: error.message, status });
      return c.json({ error: error.message }, status);
    }

    let model: string | undefined;
    try {
      const config = await personalDjConfig(db, user);
      model = config.model;
      const memory = await loadConversationMemory(
        db,
        user,
        journal.conversationId,
        journal.id,
      );
      const response = await djTurn(
        db,
        input,
        lease.signal,
        config,
        user,
        journal.observe,
        memory,
      );
      await finish("completed", response, model);
      return c.json(response);
    } catch (error) {
      const reason = lease.signal.reason;
      if (reason instanceof TurnSuperseded) {
        await finish("superseded", { error: reason.message, status: 409 }, model);
        return c.json({ error: reason.message }, 409);
      }
      if (reason instanceof TurnDeadline) {
        const message = `${reason.message} Ta file de lecture est conservée.`;
        await finish("error", { error: message, status: 504 }, model);
        return c.json({ error: message }, 504);
      }
      await finish(
        c.req.raw.signal.aborted ? "canceled" : "error",
        publicJournalError(error),
        model,
      );
      return unavailable(c, error);
    } finally {
      // Release only after the final status is written, so the next turn's
      // memory sees how this one ended.
      lease.release();
    }
  });

  // Speech reads an existing reply aloud: it only counts against the daily quota.
  app.post("/speech", async (c) => {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(600) })
      .parse(await c.req.json());
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
      return unavailable(c, error);
    }
  });
  return app;
}
