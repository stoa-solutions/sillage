import { djSystemPrompt } from "./dj-prompt.ts";
import { djIntent, playbackAction } from "./dj-intent.ts";
import { LEGACY_USER } from "./accounts.ts";
import { z } from "zod";
import { djConfig, type DjConfig } from "./dj-config.ts";
export { djConfig } from "./dj-config.ts";
import type { Database } from "./db.ts";
import {
  connectMusicMcp,
  musicTracks,
  requestedTracks,
  type DjTrack,
} from "./music-mcp.ts";

export const djInput = z.object({
  scope: z.enum(["library", "youtube", "all"]).optional(),
  message: z.string().trim().min(1).max(1500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(12)
    .default([]),
  excludeIds: z
    .array(z.string().regex(/^[\w-]{11}$/))
    .max(100)
    .default([]),
});
const selection = z.object({
  discoveryIds: z
    .array(z.string().regex(/^[\w-]{11}$/))
    .max(8)
    .optional(),
  reply: z.string().min(1).max(1500),
  trackIds: z.array(z.string().regex(/^[\w-]{11}$/)).max(8),
  action: z.enum(["replace", "append", "keep"]),
});
export class DjUnavailable extends Error {
  constructor(
    message: string,
    public status: 429 | 502 | 503 = 503,
  ) {
    super(message);
  }
}


export function djDailyBudget(userId: string, now = Date.now()): number | null {
  let override: unknown;
  try {
    override = JSON.parse(process.env.DJ_ACCOUNT_DAILY_LIMITS ?? "{}")[userId];
  } catch {
    /* Invalid overrides retain the shared default. */
  }
  if (override && typeof override === "object") {
    const timed = override as {
      limit?: unknown;
      unlimitedUntil?: unknown;
      unlimited?: unknown;
    };
    if (timed.unlimited === true) return null;
    if (
      typeof timed.unlimitedUntil === "string" &&
      Date.parse(timed.unlimitedUntil) > now
    )
      return null;
    override = timed.limit;
  }
  const configured =
    typeof override === "number" && Number.isFinite(override) && override > 0
      ? override
      : Number(process.env.DJ_DAILY_REQUEST_LIMIT) || 100;
  return Math.floor(Math.max(1, Math.min(1000, configured)));
}
export async function reserveDj(db: Database, userId = LEGACY_USER) {
  const budget = djDailyBudget(userId);
  const used = await db.query(
    `INSERT INTO account_dj_usage(user_id,day,requests) VALUES($2,CURRENT_DATE,1)
    ON CONFLICT(user_id,day) DO UPDATE SET requests=account_dj_usage.requests+1 WHERE $1::int IS NULL OR account_dj_usage.requests<$1 RETURNING requests`,
    [budget, userId],
  );
  if (!used.rowCount)
    throw new DjUnavailable(
      `Le plafond quotidien de Recall (${budget} demandes et réponses vocales) est atteint. Ce plafond est distinct du quota Google ; la lecture de ta file reste disponible.`,
      429,
    );
}
export async function djTurn(
  db: Database,
  input: z.infer<typeof djInput>,
  signal?: AbortSignal,
  config: DjConfig = djConfig(),
  userId = LEGACY_USER,
) {
  const intent = djIntent(input.message);
  const externalSearch =
    input.scope === "youtube" ||
    input.scope === "all" ||
    /\byoutube\b/i.test(input.message);
  const requested =
    externalSearch || intent === "browse" || /\bplaylist\b/i.test(input.message)
      ? null
      : await requestedTracks(db, input.message, userId);
  if (requested) {
    if (requested.missing.length)
      return {
        reply: `Je n’ai pas identifié précisément : ${requested.missing.join(" ; ")}. Précise le titre ou l’artiste ; je garde ta file actuelle.`,
        action: "keep" as const,
        tracks: [],
        source: "catalog" as const,
      };
    const tracks = await musicTracks(
      db,
      requested.tracks.map((t) => t.id),
      userId,
    );
    if (tracks.length !== requested.tracks.length)
      return {
        reply:
          "Un des titres n’est plus disponible. Je garde ta file actuelle.",
        action: "keep" as const,
        tracks: [],
        source: "catalog" as const,
      };
    const append = intent === "append" || requested.append;
    return {
      reply: `${append ? "J’ajoute à la suite" : "C’est parti"} : ${tracks.map((t) => t.title).join(", puis ")}.`,
      action: append ? ("append" as const) : ("replace" as const),
      tracks,
      source: "catalog" as const,
    };
  }
  if (!config.configured)
    throw new DjUnavailable(
      "Le mode DJ attend la configuration de son IA côté serveur. Ta bibliothèque reste disponible.",
    );
  await reserveDj(db, userId);
  const mcp = await connectMusicMcp(
    db,
    input.excludeIds,
    userId,
    externalSearch,
  );
  const candidates = new Map<string, DjTrack>();
  const discoveries = new Map<string, { video: DjTrack; inLibrary: boolean }>();
  const messages: any[] = [
    {
      role: "system",
      content:
        djSystemPrompt +
        ` INTENTION DU TOUR : ${intent}. La source de recherche ne change jamais l'intention. replace = lance maintenant et remplace la file, y compris une simple envie comme « du Michael Jackson stp ». append = ajoute à la fin sans interrompre. browse = propose des cartes sans toucher à la lecture, action=keep, trackIds=[], discoveryIds avec les IDs sélectionnés. Respecte strictement les exclusions nommées (ex. « pas Rock With You »), même si l'outil les renvoie. Si aucun résultat ne convient ou si une précision est nécessaire, action=keep et aucune sélection. Pour une playlist nommée, identifie son ID avec library_overview puis passe playlistId à library_search.` +
        (externalSearch
          ? ` Source demandée : ${input.scope ?? "youtube"}. youtube_search est disponible ; utilise-le pour YouTube, et library_search aussi pour Partout. Tu peux lancer les résultats publics vérifiés par youtube_search sans les enregistrer dans la bibliothèque. Aucun ajout à la bibliothèque sans clic explicite. Pour replace/append, renvoie les IDs dans trackIds, pas discoveryIds. La réponse décrit cette action, ne dis pas seulement « voici des résultats » si tu lances la musique.`
          : " Source : mes playlists uniquement. Consulte library_search."),
    },
    ...input.history,
    { role: "user", content: input.message },
  ];
  const timeout = AbortSignal.any([
    AbortSignal.timeout(90000),
    ...(signal ? [signal] : []),
  ]);
  let toolCalls = 0;
  let searched = false;
  try {
    const listed = await mcp.client.listTools();
    const tools = listed.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    for (let turn = 0; turn < 5; turn++) {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: timeout,
        headers: {
          "Content-Type": "application/json",
          ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          tools,
          tool_choice: turn === 0 ? "required" : turn < 4 ? "auto" : "none",
          max_completion_tokens:
            config.model === "gemini-4-argon" ? 32768 : 4096,
          ...(["gemini-4-argon", "gemini-3.8-flash"].includes(
            config.model ?? "",
          )
            ? { reasoning_effort: "low" }
            : {}),
          // Gemini rejects JSON response mode when function calling is forced.
          ...(turn > 0 ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!response.ok)
        throw new DjUnavailable(
          response.status === 429
            ? "L’IA du DJ est momentanément occupée. Ta musique reste disponible."
            : "L’IA du DJ ne répond pas pour le moment. Réessaie dans un instant.",
          response.status === 429 ? 429 : 502,
        );
      const body = (await response.json()) as any;
      const message = body.choices?.[0]?.message;
      if (!message)
        throw new DjUnavailable(
          "La réponse du DJ est incomplète. Réessaie.",
          502,
        );
      const calls = message.tool_calls;
      if (Array.isArray(calls) && calls.length) {
        if (calls.length > 4 || toolCalls + calls.length > 8)
          throw new DjUnavailable(
            "Le DJ n’a pas trouvé sa sélection cette fois. Précise l’ambiance.",
            502,
          );
        messages.push({
          role: "assistant",
          content: message.content ?? null,
          tool_calls: calls,
          ...(message.extra_content
            ? { extra_content: message.extra_content }
            : {}),
        });
        for (const call of calls) {
          toolCalls++;
          if (!listed.tools.some((t) => t.name === call.function?.name))
            throw new DjUnavailable(
              "Le DJ a demandé un outil indisponible.",
              502,
            );
          let args: unknown;
          try {
            args = JSON.parse(call.function.arguments);
          } catch {
            throw new DjUnavailable(
              "La recherche musicale du DJ est invalide.",
              502,
            );
          }
          const result = await mcp.client.callTool(
            {
              name: call.function.name,
              arguments: args as Record<string, unknown>,
            },
            undefined,
            { signal: timeout },
          );
          const content = result.content as { type: string; text?: string }[];
          const text = content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          if (!result.isError && call.function.name === "library_search") {
            searched = true;
            const data = JSON.parse(text);
            for (const track of data.tracks ?? [])
              candidates.set(track.id, track);
            for (const track of data.tracks ?? [])
              discoveries.set(track.id, { video: track, inLibrary: true });
          }
          if (!result.isError && call.function.name === "youtube_search") {
            searched = true;
            const data = JSON.parse(text);
            for (const item of data.results ?? []) {
              discoveries.set(item.video.id, item);
              candidates.set(item.video.id, item.video);
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: text.slice(0, 20000),
          });
        }
        continue;
      }
      // Some providers ignore required tool choice. One bounded reminder avoids
      // declaring music absent without ever searching the catalog.
      if (!searched && turn < 4) {
        messages.push({ role: "assistant", content: message.content ?? "" });
        messages.push({ role: "user", content: "Cherche les indices de ma demande avec library_search ou youtube_search avant de conclure ou de demander un titre exact. Propose les candidats vérifiés si plusieurs conviennent." });
        continue;
      }
      if (!searched)
        throw new DjUnavailable("Je n’ai pas pu rechercher ces indices. Réessaie ; ta musique continue.", 502);
      let output: z.infer<typeof selection>;
      try {
        output = selection.parse(JSON.parse(message.content));
      } catch {
        throw new DjUnavailable(
          "Le DJ n’a pas renvoyé une sélection lisible. Réessaie.",
          502,
        );
      }
      if (intent === "browse" || (output.action === "keep" && (output.discoveryIds?.length || output.trackIds.length))) {
        // Some providers still use the ordinary selection field. Preserve that
        // selection; never expand it to every retrieved candidate (which can
        // reintroduce titles the user explicitly excluded).
        const ids = output.discoveryIds?.length
          ? output.discoveryIds
          : output.trackIds;
        if (ids.some((id) => !discoveries.has(id)))
          throw new DjUnavailable(
            "Résultat de découverte non vérifié. Réessaie.",
            502,
          );
        return {
          reply: ids.length
            ? `Je te propose ${ids.length === 1 ? "ce morceau" : `ces ${ids.length} morceaux`}. Choisis celui que tu veux écouter.`
            : output.reply,
          action: "keep" as const,
          tracks: [],
          discoveries: ids.map((id) => discoveries.get(id)!),
        };
      }
      if (output.trackIds.some((id) => !candidates.has(id)))
        throw new DjUnavailable(
          "La sélection du DJ contenait un titre non vérifié. Réessaie.",
          502,
        );
      const action = playbackAction(intent, output.action);
      const ids = action === "keep" ? [] : [...new Set(output.trackIds)];
      // External tracks come only from this turn's authoritative tool results.
      // Library-only turns still revalidate account ownership before playback.
      const tracks = externalSearch
        ? ids.map((id) => candidates.get(id)!)
        : await musicTracks(db, ids, userId);
      // Never announce a start when the provider supplied no executable selection.
      if (action !== "keep" && !tracks.length)
        throw new DjUnavailable("Je n’ai pas obtenu de morceau à lancer. Choisis une carte proposée ou réessaie ; ta file est conservée.", 502);
      return {
        reply: output.reply,
        action: tracks.length ? action : "keep",
        tracks,
        source: "mcp" as const,
      };
    }
    throw new DjUnavailable(
      "Le DJ n’a pas terminé sa sélection. Réessaie.",
      502,
    );
  } catch (error) {
    if (error instanceof DjUnavailable) throw error;
    throw new DjUnavailable(
      "Le DJ est momentanément indisponible. Ta file de lecture est conservée.",
      502,
    );
  } finally {
    await mcp.close();
  }
}
