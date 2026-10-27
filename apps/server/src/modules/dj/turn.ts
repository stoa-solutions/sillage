import { LEGACY_USER } from "../accounts/index.ts";
import { djConfig, type DjConfig } from "../../dj-config.ts";
import type { Database } from "../../db/index.ts";
import { connectMusicMcp, musicTracks } from "../mcp/index.ts";
import type { DjTrack } from "@playlist-recall/core/dj";
import { catalogSelection } from "./catalog.ts";
import { Composition, type ComposedSelection } from "./composition.ts";
import { selection, type DjInput, type Selection } from "./contracts.ts";
import { decide, type Decision, type Retry } from "./decision.ts";
import { DjUnavailable } from "./errors.ts";
import { compactVideo } from "./evidence.ts";
import type { TraceObserver } from "./journal/contracts.ts";
import { EMPTY_MEMORY, type ConversationMemory } from "./memory.ts";
import { initialMessages } from "./messages.ts";
import { planTurn, type TurnPlan } from "./plan.ts";
import { completeTurn, MAX_ROUNDS } from "./provider.ts";
import { reserveDj } from "./quota.ts";
import {
  emptyReply,
  INFORMATION_UNAVAILABLE,
  INFORMATION_UNSOURCED,
  playReply,
  proposalReply,
  withSourceNote,
} from "./reply.ts";
import { Research, TURN_TOOL_LIMIT } from "./research.ts";

/** Used when a caller provides no lease: routes always pass the lease's signal. */
export const TURN_DEADLINE_MS = 180_000;

const REFORMULATE =
  "La recherche n’a pas fourni de nouveau candidat. Repars du mot musical employé par l’utilisateur, seul, sans ajouter playlist ou plusieurs genres dans la même requête. Essaie ensuite une graphie ou un genre pertinent séparément. Une source en erreur ne rend pas les autres sources indisponibles. Si YouTube indique daily_quota, explore la bibliothèque autorisée avec des requêtes courtes ; ne demande pas à l’utilisateur de répéter son envie. Respecte les exclusions de la demande et les cartes rejetées. Si les sources restent sans résultat, conserve la lecture.";

/** The turn's result as the HTTP route returns it. */
export interface TurnResult {
  reply: string;
  action: "replace" | "append" | "keep";
  tracks: DjTrack[];
  discoveries?: ComposedSelection["cards"];
  sources?: { id: number; title: string; url: string }[];
  source?: "mcp" | "web" | "catalog";
}

function readSelection(content: string | null): Selection {
  try {
    return selection.parse(JSON.parse(content ?? ""));
  } catch {
    throw new DjUnavailable(
      "Le DJ n’a pas renvoyé une sélection lisible. Réessaie.",
      502,
    );
  }
}

/**
 * One DJ turn: plan the request, try the exact-title catalog, then let the
 * provider research with tools until a single decision settles the outcome.
 * The provider never executes anything; the server validates and announces.
 */
export async function djTurn(
  db: Database,
  input: DjInput,
  signal: AbortSignal = AbortSignal.timeout(TURN_DEADLINE_MS),
  config: DjConfig = djConfig(),
  userId = LEGACY_USER,
  observe?: TraceObserver,
  memory: ConversationMemory = EMPTY_MEMORY,
): Promise<TurnResult> {
  const plan = planTurn(input);
  const started = Date.now();
  const requested = await catalogSelection(db, input, userId, plan);
  observe?.({
    kind: "catalog",
    name: "catalog_lookup",
    status: "ok",
    durationMs: Date.now() - started,
    output: requested ?? { matched: false },
  });
  if (requested) return requested;
  if (!config.configured)
    throw new DjUnavailable(
      "Le mode DJ attend la configuration de son IA côté serveur. Ta bibliothèque reste disponible.",
    );
  await reserveDj(db, userId);

  const composition = new Composition(input, plan);
  const base = initialMessages(
    input,
    plan,
    (await recentTracks(db, input, plan, userId)).map(compactVideo),
    memory,
  );
  const messages = [...base];
  const mcp = await connectMusicMcp(
    db,
    input.excludeIds,
    userId,
    plan.externalSearch,
    plan.scope,
    input.rejectedIds,
  );
  const tracksOf = (ids: string[]) =>
    plan.externalSearch
      ? Promise.resolve(composition.tracks(ids))
      : musicTracks(db, ids, userId);

  let research: Research | undefined;
  try {
    research = await Research.open(
      mcp.client,
      composition,
      signal,
      observe,
    );
    const used = new Set<Retry>();
    let reformulated = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const finalRound = round === MAX_ROUNDS - 1;
      if (finalRound)
        observe?.({
          kind: "policy",
          name: "compose_final",
          status: "ok",
          input: {
            candidates: composition.size,
            hasSelection: composition.hasSelection,
            scope: plan.scope,
          },
        });
      const message = await completeTurn(
        config,
        finalRound
          ? composition.finalMessages(
              base,
              [...research.information.values()],
              research.failures,
            )
          : messages,
        research.tools,
        round,
        signal,
        observe,
      );

      if (message.tool_calls?.length) {
        if (finalRound) break;
        messages.push({
          role: "assistant",
          content: message.content ?? null,
          tool_calls: message.tool_calls,
          ...(message.providerContent
            ? { providerContent: message.providerContent }
            : {}),
        });
        messages.push(...(await research.run(message.tool_calls)));
        // One free reformulation when the first searches found nothing.
        if (
          research.searched &&
          !composition.size &&
          !reformulated &&
          research.toolCalls < TURN_TOOL_LIMIT
        ) {
          reformulated = true;
          messages.push({ role: "user", content: REFORMULATE });
        }
        continue;
      }

      const decision = decide(readSelection(message.content), {
        plan,
        findings: research,
        candidates: composition.size,
        round,
        finalRound,
        used,
        select: (output) => composition.select(output),
      });
      observe?.({
        kind: "policy",
        name: "decision",
        status: "ok",
        output: { kind: decision.kind, reason: decision.reason },
      });
      if (decision.kind === "retry") {
        used.add(decision.reason);
        messages.push({ role: "assistant", content: message.content ?? null });
        messages.push({ role: "user", content: decision.prompt });
        continue;
      }
      return await render(decision, plan, research, tracksOf);
    }
    // The provider kept searching: conclude from what was verified so far.
    return await recover(composition, plan, research, tracksOf);
  } catch (error) {
    // A provider outage while expanding cannot erase a verified partial queue.
    // Cancellation, including the deadline, always wins over that recovery.
    if (composition.hasSelection && !signal.aborted) {
      const partial = await recover(composition, plan, research, tracksOf);
      if (partial.tracks.length) return partial;
    }
    if (error instanceof DjUnavailable) throw error;
    throw new DjUnavailable(
      "Le DJ est momentanément indisponible. Ta file de lecture est conservée.",
      502,
    );
  } finally {
    await mcp.close();
  }
}

/** Cards and the playing track can be referred to; hydrate their owned metadata. */
async function recentTracks(
  db: Database,
  input: DjInput,
  plan: TurnPlan,
  userId: string,
) {
  const ids = [
    ...new Set([
      ...input.discoveryContext.map(({ id }) => id),
      ...(plan.playback?.current ? [plan.playback.current.id] : []),
    ]),
  ].filter((id) => !input.rejectedIds.includes(id));
  return ids.length ? (await musicTracks(db, ids, userId)).slice(-8) : [];
}

function nothing(plan: TurnPlan, research?: Research): TurnResult {
  return {
    action: "keep",
    tracks: [],
    reply: emptyReply({
      failureSummary: research?.sourceNote(),
      currentTitle: plan.relative ? plan.playback?.current?.title : undefined,
      visualUnsupported:
        Boolean(research?.visualUnsupported) && !research?.failedSearches,
    }),
    source: "mcp",
  };
}

async function render(
  decision: Exclude<Decision, { kind: "retry" }>,
  plan: TurnPlan,
  research: Research,
  tracksOf: (ids: string[]) => Promise<DjTrack[]>,
): Promise<TurnResult> {
  const note = research.sourceNote();
  switch (decision.kind) {
    case "fail":
      throw new DjUnavailable(decision.message, 502);
    case "nothing":
      return nothing(plan, research);
    case "answer":
      return decision.reason === "conversation"
        ? { action: "keep", tracks: [], reply: decision.reply, source: "mcp" }
        : {
            action: "keep",
            tracks: [],
            reply:
              decision.reason === "sourced"
                ? decision.reply
                : decision.reason === "sources-down"
                  ? INFORMATION_UNAVAILABLE
                  : INFORMATION_UNSOURCED,
            sources: decision.sources ?? [],
            source: "web",
          };
    case "propose":
      return {
        action: "keep",
        tracks: [],
        discoveries: decision.cards,
        reply:
          decision.reply ??
          withSourceNote(
            proposalReply(decision.cards, decision.explanation),
            note,
          ),
        ...(decision.sources ? { sources: decision.sources } : {}),
      };
    case "play": {
      // External tracks come only from this turn's validated tool results;
      // library tracks are re-checked against the account before playback.
      const tracks = await tracksOf(decision.ids);
      if (!tracks.length)
        throw new DjUnavailable(
          "Je n’ai pas obtenu de morceau à lancer. Choisis une carte proposée ou réessaie ; ta file est conservée.",
          502,
        );
      return {
        action: decision.action,
        tracks,
        reply: withSourceNote(
          playReply(
            decision.action,
            tracks,
            plan.targetCount,
            decision.explanation,
          ),
          note,
        ),
        source: "mcp",
      };
    }
  }
}

/** Use the best verified checkpoint, or show the evidence as cards. */
async function recover(
  composition: Composition,
  plan: TurnPlan,
  research: Research | undefined,
  tracksOf: (ids: string[]) => Promise<DjTrack[]>,
): Promise<TurnResult> {
  const chosen = composition.recover();
  const tracks = await tracksOf(chosen.ids);
  const note = research?.sourceNote() ?? "";
  if (tracks.length && chosen.action !== "keep")
    return {
      action: chosen.action,
      tracks,
      reply: withSourceNote(
        playReply(chosen.action, tracks, plan.targetCount, chosen.explanation),
        note,
      ),
      source: "mcp",
    };
  if (chosen.cards.length)
    return {
      action: "keep",
      tracks: [],
      discoveries: chosen.cards,
      reply: withSourceNote(
        proposalReply(chosen.cards, chosen.explanation),
        note,
      ),
      source: "mcp",
    };
  return nothing(plan, research);
}
