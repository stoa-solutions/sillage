import { parseDJIntent, type DJIntent } from "./intent.ts";
import type { DjInput } from "./contracts.ts";

export interface TurnPlan {
  intent: DJIntent;
  trigger: "user" | "continuation";
  /** The listener lets the DJ choose; earlier wishes and failures are not constraints. */
  openChoice: boolean;
  /** The request refers to the track actually playing (« même style », a refill). */
  relative: boolean;
  /** How many fresh tracks an append must aim for. */
  targetCount?: number;
  selectionLimit: number;
  avoidRepeats: boolean;
  /** Search further than the playing artist, after an empty refill. */
  broaden: boolean;
  playback: DjInput["playbackContext"];
  grounded: boolean;
  externalSearch: boolean;
  scope: "library" | "youtube" | "all";
}

const openChoicePattern =
  /\b(ce que tu veux|comme tu veux|carte blanche|surprends moi|fais toi plaisir)\b/;
const refusedOpenChoice =
  /\bpas\s+(?:de\s+)?(?:ce que tu veux|comme tu veux|carte blanche)\b/;

function normalized(message: string) {
  return message
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ");
}

/**
 * Compute the turn's policy once, before any provider call. The model can
 * choose music, never the operation (replace, append, browse) or the source.
 */
export function planTurn(input: DjInput): TurnPlan {
  // The visible source selector is authoritative; message hints only serve older clients.
  const scope =
    input.scope ?? (/\byoutube\b/i.test(input.message) ? "youtube" : "library");
  // A typed « /suite 5 » is structured like a refill but keeps a typed request's priority.
  const trigger =
    input.trigger ?? (input.continuation ? "continuation" : "user");
  const base = { trigger, scope, externalSearch: scope !== "library" } as const;

  if (input.continuation) {
    const { count, broaden } = input.continuation;
    return {
      ...base,
      intent: "append",
      openChoice: false,
      relative: true,
      targetCount: count,
      selectionLimit: count,
      avoidRepeats: true,
      broaden,
      playback: input.playbackContext,
      grounded: Boolean(input.playbackContext?.current),
    };
  }

  const parsed = parseDJIntent(input.message);
  const relative = parsed.reference === "current";
  const targetCount =
    parsed.intent === "append" ? (parsed.count ?? 5) : undefined;
  const text = normalized(input.message);
  const openChoice =
    openChoicePattern.test(text) && !refusedOpenChoice.test(text);
  const playback =
    openChoice && !relative && input.playbackContext
      ? { ...input.playbackContext, direction: "" }
      : input.playbackContext;
  return {
    ...base,
    intent: parsed.intent,
    openChoice,
    relative,
    targetCount,
    selectionLimit: parsed.count ?? targetCount ?? 8,
    avoidRepeats: parsed.intent === "append" || relative,
    broaden: false,
    playback,
    grounded: relative && Boolean(playback?.current),
  };
}
