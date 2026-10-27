import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { InformationSource } from "../../integrations/searxng/index.ts";
import {
  searchFailureSummary,
  type SearchFailure,
} from "../discovery/index.ts";
import type { Composition } from "./composition.ts";
import { DjUnavailable } from "./errors.ts";
import { readToolEvidence } from "./evidence.ts";
import type { TraceObserver } from "./journal/contracts.ts";
import type { ChatMessage, ChatTool, ToolCall } from "./provider.ts";

const SEARCH_TOOLS = new Set([
  "library_search",
  "library_browse",
  "youtube_search",
  "music_search",
]);
/** Tool calls a single provider round may request, and a whole turn may spend. */
export const ROUND_TOOL_LIMIT = 4;
export const TURN_TOOL_LIMIT = 8;

/** What the research established so far; the decision reads it, never the raw tools. */
export interface Findings {
  searched: boolean;
  informationRequested: boolean;
  informationFailed: boolean;
  failedSearches: number;
  youtubeDailyQuota: boolean;
  visualUnsupported: boolean;
  toolCalls: number;
  information: ReadonlyMap<number, InformationSource>;
  failures: SearchFailure[];
}

/**
 * Runs the tools a provider asks for and accumulates their evidence. Tool
 * output is untrusted: only validated candidates reach the composition, and
 * transport errors are reported to the model as an unavailable source.
 */
export class Research implements Findings {
  searched = false;
  informationRequested = false;
  informationFailed = false;
  failedSearches = 0;
  youtubeDailyQuota = false;
  visualUnsupported = false;
  toolCalls = 0;
  readonly information = new Map<number, InformationSource>();
  private readonly failed = new Map<SearchFailure["source"], SearchFailure>();

  constructor(
    private readonly client: Client,
    readonly tools: ChatTool[],
    private readonly composition: Composition,
    private readonly signal: AbortSignal,
    private readonly observe?: TraceObserver,
  ) {}

  static async open(
    client: Client,
    composition: Composition,
    signal: AbortSignal,
    observe?: TraceObserver,
  ) {
    const listed = await client.listTools();
    const tools: ChatTool[] = listed.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    return new Research(client, tools, composition, signal, observe);
  }

  get failures() {
    return [...this.failed.values()];
  }

  /** A short note on degraded sources, appended to the visible reply. */
  sourceNote(now = Date.now()) {
    return searchFailureSummary(this.failures, now);
  }

  /** Validate a provider round's calls as a whole, then run them in order. */
  async run(calls: ToolCall[]): Promise<ChatMessage[]> {
    if (
      calls.length > ROUND_TOOL_LIMIT ||
      this.toolCalls + calls.length > TURN_TOOL_LIMIT
    )
      throw new DjUnavailable(
        "Le DJ n’a pas trouvé sa sélection cette fois. Précise l’ambiance.",
        502,
      );
    const results: ChatMessage[] = [];
    for (const call of calls) {
      this.toolCalls++;
      if (!this.tools.some((tool) => tool.function.name === call.function.name))
        throw new DjUnavailable("Le DJ a demandé un outil indisponible.", 502);
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        throw new DjUnavailable(
          "La recherche musicale du DJ est invalide.",
          502,
        );
      }
      results.push(await this.call(call.function.name, args, call.id));
    }
    return results;
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
    id: string,
  ): Promise<ChatMessage> {
    const started = Date.now();
    const isSearch = SEARCH_TOOLS.has(name);
    let status: "ok" | "partial" | "error" = "ok";
    let text: string;
    try {
      const result = await this.client.callTool(
        { name, arguments: args },
        undefined,
        { signal: this.signal },
      );
      const evidence = readToolEvidence(name, result);
      if (evidence.failedSources)
        status = evidence.items.length ? "partial" : "error";
      text =
        name === "seekInformation"
          ? this.recordInformation(evidence.text)
          : evidence.text;
      this.composition.add(evidence.items);
      if (evidence.isSearch) {
        this.searched = true;
        this.failed.delete("search");
      }
      this.failedSearches += evidence.failedSources;
      for (const source of evidence.recoveredSources) this.failed.delete(source);
      for (const failure of evidence.failures)
        this.failed.set(failure.source, failure);
      this.youtubeDailyQuota ||= evidence.youtubeDailyQuota;
      this.visualUnsupported ||= evidence.visualUnsupported;
    } catch (error) {
      status = "error";
      if (this.signal.aborted) {
        this.trace(name, id, status, started, args, { error: "canceled" });
        throw this.signal.reason ?? error;
      }
      this.recordUnavailable(name, isSearch);
      // Do not pass transport diagnostics or tool instructions to the model.
      text = JSON.stringify({
        error: "source_unavailable",
        source: name,
        tracks: [],
      });
    }
    this.trace(name, id, status, started, args, parsed(text));
    return { role: "tool", tool_call_id: id, content: text };
  }

  /** Number sources across the whole turn so citations stay unambiguous. */
  private recordInformation(text: string) {
    this.informationRequested = true;
    const data = JSON.parse(text);
    this.informationFailed = data.status !== "ok";
    const sources = (data.sources as InformationSource[]).map((source) => ({
      ...source,
      id: this.information.size + source.id,
    }));
    for (const source of sources) this.information.set(source.id, source);
    return JSON.stringify({ status: data.status, sources });
  }

  private recordUnavailable(name: string, isSearch: boolean) {
    if (name === "seekInformation") {
      this.informationRequested = true;
      this.informationFailed = true;
    }
    if (!isSearch) return;
    this.searched = true;
    this.failedSearches++;
    const source =
      name === "youtube_search"
        ? "youtube"
        : name === "music_search"
          ? "search"
          : "library";
    this.failed.set(source, { source, reason: "unavailable" });
  }

  private trace(
    name: string,
    callId: string,
    status: "ok" | "partial" | "error",
    started: number,
    input: unknown,
    output: unknown,
  ) {
    this.observe?.({
      kind: "tool",
      name,
      callId,
      status,
      durationMs: Date.now() - started,
      input,
      output,
    });
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
