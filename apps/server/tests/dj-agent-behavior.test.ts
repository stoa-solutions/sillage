import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  current,
  library,
  external,
  collaboration,
} from "./fixtures/dj-agent/catalog.ts";

// The agent loop, MCP SDK, tool schemas and evidence validation are real.
// Only search backends, SQL and the provider's HTTP responses are controlled.
const boundaries = vi.hoisted(() => ({ search: vi.fn(), youtube: vi.fn() }));
vi.mock("../src/search.ts", () => ({ search: boundaries.search }));
vi.mock("../src/discovery.ts", () => ({
  discoveryFor: () => ({ search: boundaries.youtube }),
}));
import { djInput, djTurn } from "../src/dj.ts";
import type { Database } from "../src/db.ts";

const config = {
  configured: true,
  baseUrl: "https://agent.fixture.test",
  key: "fixture-only",
  model: "fixture",
  local: false,
};
let owned = [...library, collaboration];
const db = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO account_dj_usage"))
      return { rows: [], rowCount: 1 };
    if (sql.includes("ANY($1::text[])")) {
      const ids = params?.[0] as string[];
      return {
        rows:
          params?.[1] === "alice"
            ? owned.filter((track) => ids.includes(track.id))
            : [],
        rowCount: 1,
      };
    }
    // Exact catalog resolution is a separate fast path. These cases exercise tools.
    if (sql.includes("LIMIT 10001")) return { rows: [], rowCount: 0 };
    throw new Error("Unexpected SQL in agent fixture");
  }),
};
let requests: any[];
let responses: (Record<string, unknown> | Response)[];
const searchCall = (query = "cumbia", extra: Record<string, unknown> = {}) => ({
  tool_calls: [
    {
      id: "search",
      type: "function",
      function: {
        name: "music_search",
        arguments: JSON.stringify({ query, ...extra }),
      },
    },
  ],
});
const selection = (
  ids: string[],
  action: "keep" | "append" | "replace" = "append",
) => ({
  content: JSON.stringify({
    reply: "Provider's untrusted announcement",
    action,
    trackIds: ids,
  }),
});
const cards = (ids: string[]) => ({
  content: JSON.stringify({
    reply: "Je lance immédiatement !",
    action: "keep",
    trackIds: [],
    discoveryIds: ids,
  }),
});
function run(input: Record<string, unknown>, user = "alice") {
  return djTurn(
    db as unknown as Database,
    djInput.parse(input),
    undefined,
    config,
    user,
  );
}
function toolEvidence() {
  return requests.flatMap((request) =>
    request.messages
      .filter((message: any) => message.role === "tool")
      .map((message: any) => JSON.parse(message.content)),
  );
}
beforeEach(() => {
  owned = [...library, collaboration];
  requests = [];
  responses = [];
  db.query.mockClear();
  boundaries.search
    .mockReset()
    .mockResolvedValue({
      results: library.map((video) => ({ video, reason: "catalog" })),
      degraded: null,
    });
  boundaries.youtube
    .mockReset()
    .mockResolvedValue({
      results: external.map((video) => ({ video, inLibrary: false })),
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://agent.fixture.test/chat/completions");
      requests.push(JSON.parse(String(init.body)));
      const response = responses.shift();
      if (!response)
        throw new Error("Agent exceeded its scripted provider responses");
      return response instanceof Response
        ? response
        : Response.json({ choices: [{ message: response }] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it.each(["library", "youtube", "all"] as const)(
  "routes the real agent tools through %s only",
  async (scope) => {
    const id = scope === "library" ? library[0].id : external[0].id;
    responses.push(searchCall(), cards([id]));
    const result = await run({
      message: "Propose un morceau de cumbia sans le jouer",
      scope,
    });
    expect(result).toMatchObject({
      action: "keep",
      tracks: [],
      discoveries: [{ video: { id } }],
    });
    expect(boundaries.search).toHaveBeenCalledTimes(
      scope === "youtube" ? 0 : 1,
    );
    expect(boundaries.youtube).toHaveBeenCalledTimes(
      scope === "library" ? 0 : 1,
    );
    const names = requests[0].tools.map((tool: any) => tool.function.name);
    expect(names).toContain("music_search");
    expect(names).not.toContain("youtube_search");
    expect(names).not.toContain("library_search");
    expect(requests).toHaveLength(2);
    if (scope === "all") {
      expect(toolEvidence()[0].sources).toEqual(
        expect.arrayContaining([
          { source: "library", status: "ok" },
          { source: "youtube", status: "ok" },
        ]),
      );
    }
  },
);

it("prepares five fresh Acid Coco successors without replacing the current track", async () => {
  const ids = library
    .slice(1, 4)
    .map((track) => track.id)
    .concat(external.slice(0, 2).map((track) => track.id));
  responses.push(
    searchCall("cumbia tropical", { includeQueued: true }),
    selection([library[0].id, ...ids, ids[0]], "replace"),
  );
  const result = await run({
    message:
      "Prépare 5 nouveaux morceaux à suivre dans le même style, sans répétition et sans interrompre la lecture.",
    scope: "all",
    excludeIds: [current.id, library[0].id],
    playbackContext: { current, direction: "Cumbia tropicale" },
    history: [{ role: "assistant", content: "Je lance du Michael Jackson" }],
  });
  expect(result.action).toBe("append");
  expect(result.tracks.map((track) => track.id)).toEqual(ids);
  expect(new Set(result.tracks.map((track) => track.id)).size).toBe(5);
  expect(JSON.stringify(requests[0].messages)).toContain(current.title);
  expect(JSON.stringify(requests[0].messages)).not.toContain(
    "Je lance du Michael Jackson",
  );
  expect(result.reply).not.toContain("Provider's");
});

it("keeps verified library selections when YouTube is quota-limited and expansion fails", async () => {
  boundaries.youtube.mockRejectedValue(
    Object.assign(new Error("private provider quota"), { status: 429 }),
  );
  boundaries.search.mockResolvedValue({
    results: library.slice(0, 2).map((video) => ({ video })),
    degraded: null,
  });
  responses.push(
    searchCall(),
    selection(library.slice(0, 2).map((track) => track.id)),
    new Response("private Gemini body", { status: 429 }),
  );
  const result = await run({
    message: "Prépare 5 morceaux à suivre dans le même style",
    scope: "all",
    playbackContext: { current, direction: "Cumbia" },
  });
  expect(result.action).toBe("append");
  expect(result.tracks.map((track) => track.id)).toEqual(
    library.slice(0, 2).map((track) => track.id),
  );
  expect(toolEvidence()[0].sources).toContainEqual({
    source: "youtube",
    status: "error",
    reason: "rate_or_quota",
  });
  expect(JSON.stringify(requests)).not.toContain("private provider");
  expect(JSON.stringify(result)).not.toContain("private Gemini");
  expect(requests).toHaveLength(3);
  expect(boundaries.youtube).toHaveBeenCalledOnce();
});

it("shows the verified Jewel/Hedges card without executing a provider's launch announcement", async () => {
  boundaries.search.mockResolvedValue({
    results: [{ video: collaboration }],
    degraded: null,
  });
  responses.push(
    searchCall("Jewel Hedges", { fuzzy: true }),
    cards([collaboration.id]),
  );
  const result = await run({
    message:
      "Ne joue rien maintenant. Propose-moi le morceau de Jewel Usain avec Hedges, je ne me souviens plus du titre.",
    scope: "library",
  });
  expect(result).toMatchObject({
    action: "keep",
    tracks: [],
    discoveries: [{ video: { id: collaboration.id } }],
  });
  expect(result.reply).not.toContain("Je lance");
  expect(
    toolEvidence()[0].results[0].video.musicMetadata.artists,
  ).toContainEqual({ name: "Hedges", role: "featured" });
  expect(boundaries.search).toHaveBeenCalledWith(
    db,
    expect.objectContaining({ query: "Jewel Hedges", fuzzy: true }),
    "alice",
  );
});

it("keeps explicit card refusals excluded even when the model requests includeQueued", async () => {
  const rejectedIds = [library[0].id, external[0].id];
  responses.push(
    searchCall("autre cumbia", { includeQueued: true }),
    cards([external[1].id]),
  );
  const result = await run({
    message: "Propose d'autres morceaux, sauf ces deux-là",
    scope: "all",
    rejectedIds,
    discoveryContext: [
      { id: library[0].id, title: library[0].title },
      { id: external[0].id, title: external[0].title },
    ],
  });
  expect(result).toMatchObject({
    action: "keep",
    discoveries: [{ video: { id: external[1].id } }],
  });
  const evidenceIds = toolEvidence()[0].results.map(
    (item: any) => item.video.id,
  );
  for (const id of rejectedIds) expect(evidenceIds).not.toContain(id);
  expect(boundaries.search).toHaveBeenCalledWith(
    db,
    expect.objectContaining({ excludeIds: rejectedIds }),
    "alice",
  );
});

it("an explicit immediate correction executes an external result instead of appending", async () => {
  responses.push(
    searchCall("Omer Adam"),
    selection([external[0].id], "append"),
  );
  const result = await run({
    message: "Non, mets Omer Adam directement maintenant",
    scope: "youtube",
    history: [{ role: "user", content: "Ajoute Michael Jackson à la suite" }],
  });
  expect(result.action).toBe("replace");
  expect(result.tracks.map((track) => track.id)).toEqual([external[0].id]);
  expect(boundaries.search).not.toHaveBeenCalled();
});

it("does not authorize an ID that was not returned by the real MCP tool", async () => {
  responses.push(searchCall(), selection(["unknown0001"], "replace"));
  await expect(
    run({ message: "Joue de la cumbia", scope: "all" }),
  ).rejects.toThrow("non vérifié");
  expect(requests).toHaveLength(2);
});

it("cannot expose another account's library even if its search backend returns the ID", async () => {
  responses.push(searchCall(), cards([library[0].id]));
  await expect(
    run({ message: "Propose de la cumbia", scope: "library" }, "bob"),
  ).rejects.toThrow("non vérifié");
  expect(boundaries.search).toHaveBeenCalledWith(db, expect.anything(), "bob");
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("ANY($1::text[])"),
    [library.map((track) => track.id), "bob"],
  );
});

it("bounds an agent that keeps searching after both sources fail", async () => {
  boundaries.search.mockRejectedValue(new Error("private library diagnostic"));
  boundaries.youtube.mockRejectedValue(new Error("private YouTube diagnostic"));
  responses.push(...Array.from({ length: 5 }, () => searchCall()));
  const result = await run({
    message: "Prépare la suite",
    scope: "all",
    playbackContext: { current, direction: "Cumbia" },
  });
  expect(result).toMatchObject({ action: "keep", tracks: [] });
  expect(requests).toHaveLength(5);
  expect(boundaries.youtube).toHaveBeenCalledTimes(4);
  expect(boundaries.search).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(requests)).not.toContain("private library diagnostic");
  expect(requests.at(-1)).not.toHaveProperty("tools");
});
