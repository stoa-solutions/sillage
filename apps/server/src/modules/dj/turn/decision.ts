import type { InformationSource } from "../../../integrations/searxng/index.ts";
import type { ComposedSelection } from "./composition.ts";
import type { Selection } from "../types/dj.contracts.ts";
import type { DiscoveryEvidence } from "./evidence.ts";
import type { TurnPlan } from "./plan.ts";
import type { Findings } from "../ai/research.ts";

/**
 * The single place where a provider's answer becomes an outcome. Each branch
 * names its reason, which the journal records: a refused answer is explained.
 */
export type Decision =
  | {
      kind: "answer";
      reason: "conversation" | "sourced" | "unsourced" | "sources-down";
      reply: string;
      sources?: InformationSource[];
    }
  | {
      kind: "propose";
      reason: "browse" | "ambiguous" | "identified";
      cards: DiscoveryEvidence[];
      explanation?: string | undefined;
      /** A sourced identification keeps the model's own words. */
      reply?: string;
      sources?: InformationSource[];
    }
  | {
      kind: "play";
      /** fallback: the model chose nothing; the server plays what the turn found. */
      reason: "selection" | "fallback";
      action: "replace" | "append";
      ids: string[];
      explanation?: string | undefined;
    }
  | { kind: "nothing"; reason: "no-match" }
  | { kind: "retry"; reason: Retry; prompt: string }
  | { kind: "fail"; reason: "no-search"; message: string };

export type Retry = "search-first" | "cite-sources" | "quota-intent" | "expand";

export interface DecisionState {
  plan: TurnPlan;
  findings: Findings;
  /** Validated candidates gathered so far. */
  candidates: number;
  round: number;
  finalRound: boolean;
  /** Each retry is offered at most once per turn. */
  used: ReadonlySet<Retry>;
  /** Validate the provider's IDs against this turn's evidence. */
  select: (output: Selection) => ComposedSelection;
  /** What a playback request plays when the model chose nothing (see Composition.fallback). */
  fallback?: () => ComposedSelection | undefined;
}

const prompts = {
  "search-first":
    "Cherche les indices de ma demande avec music_search avant de conclure ou de demander un titre exact. Propose les candidats vérifiés si plusieurs conviennent.",
  "cite-sources":
    "Pour une information factuelle, cherche d’abord une source avec seekInformation, puis réponds en citant ses identifiants. Si la question porte seulement sur notre échange, réponds avec kind=conversation.",
  "quota-intent": (intent: string) =>
    `L’intention de la demande est ${intent}. Le quota d’une source ne transforme pas cette demande en recherche de cartes. Une recherche ultérieure vide n’efface pas les candidats déjà trouvés dans les réponses précédentes. Si ces candidats correspondent à l’envie, renvoie une sélection partielle avec action=${intent} et trackIds pour l’exécuter. Garde keep seulement si une vraie ambiguïté musicale nécessite mon choix ou si aucun candidat ne convient. N’invente aucun titre.`,
  expand: (found: number, target: number) =>
    `La sélection n’a que ${found} nouveau(x) titre(s) admissible(s). Complète jusqu’à ${target} avec une autre recherche compatible avec le morceau courant, sans reprendre les excludeIds. Renvoie la sélection totale dans l’ordre. Si le catalogue est insuffisant, garde seulement les titres vérifiés ; n’invente pas.`,
};

const hasIds = (output: Selection) =>
  output.trackIds.length > 0 || output.discoveryIds.length > 0;

function cited(output: Selection, findings: Findings) {
  return [...new Set(output.citationIds)]
    .filter((id) => findings.information.has(id))
    .map((id) => findings.information.get(id)!);
}

function retry(state: DecisionState, reason: Retry, prompt: string) {
  return !state.finalRound && !state.used.has(reason)
    ? ({ kind: "retry", reason, prompt } as const)
    : undefined;
}

/** A spoken answer that changes nothing: a conversation or a sourced fact. */
function answer(output: Selection, state: DecisionState): Decision | undefined {
  const { findings } = state;
  if (findings.informationRequested) {
    const sources = cited(output, findings);
    if (sources.length)
      return { kind: "answer", reason: "sourced", reply: output.reply, sources };
    return {
      kind: "answer",
      reason: findings.informationFailed ? "sources-down" : "unsourced",
      reply: "",
      sources: [],
    };
  }
  if (output.kind === "conversation")
    return { kind: "answer", reason: "conversation", reply: output.reply };
  if (output.kind === "information")
    return (
      retry(state, "cite-sources", prompts["cite-sources"]) ?? {
        kind: "answer",
        reason: "unsourced",
        reply: "",
        sources: [],
      }
    );
  return undefined;
}

/**
 * What the turn found, played when the model chose nothing on a real playback request.
 * Composition.fallback decides which candidates qualify; undefined keeps the model's answer.
 */
function playFound(state: DecisionState): Decision | undefined {
  const found = state.fallback?.();
  return found && found.action !== "keep" && found.ids.length
    ? { kind: "play", reason: "fallback", action: found.action, ids: found.ids }
    : undefined;
}

export function decide(output: Selection, state: DecisionState): Decision {
  const { plan, findings } = state;

  // 1. Nothing to play or show: the answer is the text itself. The planned
  //    intent never turns a question into a playback failure.
  if (output.action === "keep" && !hasIds(output)) {
    const spoken = answer(output, state);
    // A model that found the listener's favourites for « mets-moi ce que j'aime » and then
    // only chats still owes the music it was asked for.
    if (spoken?.reason === "conversation") return playFound(state) ?? spoken;
    if (spoken) return spoken;
  }

  // 2. A musical conclusion needs evidence from this turn.
  if (!findings.searched && !findings.informationRequested)
    return (
      (state.round === 0 &&
        retry(state, "search-first", prompts["search-first"])) || {
        kind: "fail",
        reason: "no-search",
        message:
          "Je n’ai pas pu rechercher ces indices. Réessaie ; ta musique continue.",
      }
    );

  // 3. A source's quota can make the model hesitate; let it reconsider once.
  if (
    findings.youtubeDailyQuota &&
    plan.intent !== "browse" &&
    output.action === "keep" &&
    state.candidates > 0
  ) {
    const again = retry(state, "quota-intent", prompts["quota-intent"](plan.intent));
    if (again) return again;
  }

  // 4. Cards to choose from: a browse request, or the model's own proposal.
  if (plan.intent === "browse" || (output.action === "keep" && hasIds(output))) {
    const { cards } = state.select(output);
    if (!cards.length) return { kind: "nothing", reason: "no-match" };
    const sources = cited(output, findings);
    return sources.length
      ? {
          kind: "propose",
          reason: "identified",
          cards,
          reply: output.reply,
          sources,
        }
      : {
          kind: "propose",
          reason: plan.intent === "browse" ? "browse" : "ambiguous",
          cards,
          explanation: output.explanation,
        };
  }

  // 5. A selection to execute, within the planned operation.
  // An announced operation without tracks still reaches the renderer, which
  // refuses to announce a start it cannot execute.
  const composed = state.select(output);
  // A playback request answered with music but no choice at all (keep, or an action without
  // tracks): play what the turn found rather than leave the listener with nothing.
  if (output.kind === "music" && !hasIds(output)) {
    const found = playFound(state);
    if (found) return found;
  }
  if (composed.action === "keep") return { kind: "nothing", reason: "no-match" };
  const target = plan.targetCount;
  if (
    target &&
    composed.ids.length < target &&
    state.round < 3 &&
    findings.toolCalls <= 6
  ) {
    const again = retry(
      state,
      "expand",
      prompts.expand(composed.ids.length, target),
    );
    if (again) return again;
  }
  return {
    kind: "play",
    reason: "selection",
    action: composed.action,
    ids: composed.ids,
    explanation: composed.explanation,
  };
}
