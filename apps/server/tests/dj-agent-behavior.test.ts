import { DiscoveryError } from "../src/modules/discovery/index.ts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  current,
  library,
  external,
  collaboration,
} from "./fixtures/dj-agent/catalog.ts";

// The agent loop, MCP SDK, tool schemas and evidence validation are real.
// Only search backends, SQL and the provider's HTTP responses are controlled.
const boundaries = vi.hoisted(() => ({ search: vi.fn(), youtube: vi.fn(), information: vi.fn() }));
vi.mock("../src/integrations/searxng/information.ts", () => ({ informationSearch: () => ({ search: boundaries.information }) }));
vi.mock("../src/search.ts", () => ({ search: boundaries.search }));
vi.mock("../src/modules/discovery/index.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/modules/discovery/index.ts")>(),
  discoveryFor: () => ({ search: boundaries.youtube }),
}));
import { djInput, djTurn } from "../src/dj.ts";
import type { Database } from "../src/db/index.ts";
import { required } from "./support/required.ts";

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
    if (sql.includes("FROM playlists p"))
      return { rows: [{ id: "PLsoul", title: "Soul du dimanche", tracks: 3 }], rowCount: 1 };
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

it("acknowledges the identified track and owned credits without searching or changing playback", async () => {
  const track = {
    id: "TRwTWnarBtE", title: "basqany :(", channel: "Ayau", duration_seconds: 220,
    music_metadata: { status: "matched", artists: [{ name: "Ayau" }, { name: "M’Dee" }] },
  };
  owned.push(track as typeof collaboration);
  const reply = "Oui, c’est bien basqany :(, avec M’Dee dans les crédits MusicBrainz.";
  responses.push({ content: JSON.stringify({ kind: "conversation", action: "keep", trackIds: [], reply }) });
  const result = await run({
    message: "voila ça y'a m'dee et c basqany",
    scope: "library",
    discoveryContext: [{ id: track.id, title: track.title, channel: track.channel }],
    excludeIds: [track.id],
  });
  expect(result).toMatchObject({ action: "keep", tracks: [], reply });
  expect(requests).toHaveLength(1);
  expect(requests[0].tool_choice).toBe("auto");
  expect(JSON.stringify(requests[0].messages)).toContain("M’Dee");
  expect(boundaries.search).not.toHaveBeenCalled();
  expect(boundaries.youtube).not.toHaveBeenCalled();
  expect(boundaries.information).not.toHaveBeenCalled();
});

it("never hydrates another account's metadata into a confirmation", async () => {
  responses.push({ content: JSON.stringify({ kind: "conversation", action: "keep", trackIds: [], reply: "Merci pour la précision." }) });
  await run({
    message: "voilà c'est ça",
    discoveryContext: [{ id: collaboration.id, title: "A supplied title", channel: "A supplied artist" }],
  }, "bob");
  expect(JSON.stringify(requests[0].messages)).not.toContain("Béesau");
  expect(JSON.stringify(requests[0].messages)).not.toContain("Titres récents revérifiés");
});

it("still requires a verified selection when a confirmation includes a new playback request", async () => {
  responses.push(searchCall("cumbia"), selection([required(external[0]).id], "replace"));
  const result = await run({ message: "Oui c'est ça, joue ce morceau maintenant", scope: "all" });
  expect(result).toMatchObject({ action: "replace", tracks: [{ id: required(external[0]).id }] });
  expect(boundaries.youtube).toHaveBeenCalledOnce();
});

it("cannot use a conversation label to execute unverified tracks", async () => {
  responses.push({ content: JSON.stringify({ kind: "conversation", action: "replace", trackIds: [required(external[0]).id], reply: "Je lance !" }) });
  responses.push({ content: JSON.stringify({ kind: "conversation", action: "replace", trackIds: [required(external[0]).id], reply: "Je lance !" }) });
  await expect(run({ message: "oui", scope: "all" })).rejects.toThrow("Je n’ai pas pu rechercher ces indices");
  expect(requests).toHaveLength(2);
});

it.each(["library", "youtube", "all"] as const)(
  "routes the real agent tools through %s only",
  async (scope) => {
    const id = scope === "library" ? required(library[0]).id : required(external[0]).id;
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
    selection([required(library[0]).id, ...ids, required(ids[0])], "replace"),
  );
  const result = await run({
    message:
      "Prépare 5 nouveaux morceaux à suivre dans le même style, sans répétition et sans interrompre la lecture.",
    scope: "all",
    excludeIds: [current.id, required(library[0]).id],
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
    new DiscoveryError("private provider quota", 429, "rate_or_quota"),
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
  const rejectedIds = [required(library[0]).id, required(external[0]).id];
  responses.push(
    searchCall("autre cumbia", { includeQueued: true }),
    cards([required(external[1]).id]),
  );
  const result = await run({
    message: "Propose d'autres morceaux, sauf ces deux-là",
    scope: "all",
    rejectedIds,
    discoveryContext: [
      { id: required(library[0]).id, title: required(library[0]).title },
      { id: required(external[0]).id, title: required(external[0]).title },
    ],
  });
  expect(result).toMatchObject({
    action: "keep",
    discoveries: [{ video: { id: required(external[1]).id } }],
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
    selection([required(external[0]).id], "append"),
  );
  const result = await run({
    message: "Non, mets Omer Adam directement maintenant",
    scope: "youtube",
    history: [{ role: "user", content: "Ajoute Michael Jackson à la suite" }],
  });
  expect(result.action).toBe("replace");
  expect(result.tracks.map((track) => track.id)).toEqual([required(external[0]).id]);
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
  responses.push(searchCall(), cards([required(library[0]).id]));
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

it("recovers a broad afro request with a short library query when YouTube's daily quota is exhausted", async () => {
  boundaries.youtube.mockRejectedValue(
    new DiscoveryError("private provider details", 429, "daily_quota"),
  );
  boundaries.search
    .mockResolvedValueOnce({ results: [], degraded: null })
    .mockResolvedValue({
      results: library.slice(0, 2).map((video) => ({ video })),
      degraded: null,
    });
  responses.push(
    searchCall("afrobeats afro pop"),
    searchCall("afro"),
    selection(
      library.slice(0, 2).map((track) => track.id),
      "replace",
    ),
  );
  const result = await run({
    message: "Fais-moi une playlist de musique afro s'il te plaît",
    scope: "all",
  });
  expect(result.action).toBe("replace");
  expect(result.tracks).toHaveLength(2);
  expect(result.reply).toContain("quota quotidien");
  expect(result.reply).not.toContain("dans un instant");
  expect(toolEvidence()[0].sources).toContainEqual(
    expect.objectContaining({ source: "youtube", reason: "daily_quota" }),
  );
  expect(JSON.stringify(requests[1].messages)).toContain(
    "Repars du mot musical",
  );
  expect(boundaries.search).toHaveBeenLastCalledWith(
    db,
    expect.objectContaining({ query: "afro" }),
    "alice",
  );
  expect(JSON.stringify(requests)).not.toContain("private provider details");
});

it("explains daily YouTube exhaustion truthfully when no authorized source has candidates", async () => {
  boundaries.youtube.mockRejectedValue(
    new DiscoveryError("private", 429, "daily_quota"),
  );
  boundaries.search.mockResolvedValue({ results: [], degraded: null });
  responses.push(searchCall("afro"), selection([], "keep"));
  const result = await run({
    message: "Propose de la musique afro",
    scope: "youtube",
  });
  expect(result).toMatchObject({ action: "keep", tracks: [] });
  expect(result.reply).toContain("quota quotidien");
  expect(result.reply).not.toContain("dans un instant");
  expect(boundaries.search).not.toHaveBeenCalled();
});

it("reconsiders quota-driven browse without silently converting an ambiguous proposal into playback", async () => {
  boundaries.youtube.mockRejectedValue(new DiscoveryError("private", 429, "daily_quota"));
  responses.push(searchCall("afro"), cards([required(library[0]).id]), selection([required(library[0]).id], "replace"));
  const result = await run({ message: "Fais-moi une playlist afro", scope: "all" });
  expect(result.action).toBe("replace");
  expect(required(result.tracks[0]).id).toBe(required(library[0]).id);
  expect(requests).toHaveLength(3);
  expect(JSON.stringify(requests[2].messages)).toContain("quota d’une source ne transforme pas");
});

it("keeps a genuinely ambiguous proposal after one reconsideration even with a source quota", async () => {
  boundaries.youtube.mockRejectedValue(new DiscoveryError("private", 429, "daily_quota"));
  responses.push(searchCall("feat"), cards([required(library[0]).id]), cards([required(library[0]).id]));
  const result = await run({ message: "Joue le morceau avec le featuring", scope: "all" });
  expect(result.action).toBe("keep");
  expect(result.tracks).toEqual([]);
  expect(result).toMatchObject({ discoveries: [{ video: { id: required(library[0]).id } }] });
  expect(requests).toHaveLength(3);
});

it("does not let a later empty filtered search erase earlier candidates during a quota outage", async () => {
  boundaries.youtube.mockRejectedValue(new DiscoveryError("private", 429, "daily_quota"));
  responses.push(searchCall("afro"), searchCall("afro", { playlist: "_library_all" }), selection([], "keep"), selection([required(library[0]).id], "replace"));
  const result = await run({ message: "Fais-moi une playlist de musique afro", scope: "all" });
  expect(result).toMatchObject({ action: "replace", tracks: [{ id: required(library[0]).id }] });
  expect(boundaries.search).toHaveBeenCalledOnce();
  expect(toolEvidence()).toContainEqual(expect.objectContaining({ note: expect.stringContaining("No playlist matches") }));
  expect(requests).toHaveLength(4);
});


it("clears a transient source warning after that source recovers in the same turn", async () => {
  boundaries.youtube.mockRejectedValueOnce(new DiscoveryError("private", 502));
  responses.push(searchCall("cumbia"), searchCall("cumbia chill"), cards([required(external[0]).id]));
  const result = await run({ message: "Propose un morceau de cumbia", scope: "all" });
  expect(result).toMatchObject({ discoveries: [{ video: { id: required(external[0]).id } }] });
  expect(result.reply).not.toMatch(/indisponible|quota|refuse/);
});

it("answers an information question with sourced text and keeps the playing queue", async () => {
  boundaries.information.mockResolvedValue({
    status: "ok",
    sources: [
      {
        id: 1,
        title: "Artist interview",
        url: "https://artist.test/interview",
        snippet: "The artist explains the recording.",
      },
    ],
  });
  responses.push(
    {
      tool_calls: [
        {
          id: "info",
          type: "function",
          function: {
            name: "seekInformation",
            arguments: JSON.stringify({
              query: "Acid Coco recording interview",
            }),
          },
        },
      ],
    },
    {
      content: JSON.stringify({
        reply: "L’artiste explique cet enregistrement dans une interview [1].",
        action: "keep",
        trackIds: [],
        citationIds: [1],
      }),
    },
  );
  const result = await run({
    message: "Raconte-moi une anecdote sourcée sur Acid Coco",
    scope: "library",
  });
  expect(result.action).toBe("keep");
  expect(result.tracks).toEqual([]);
  expect(result.reply).toContain("interview [1]");
  expect(result).toHaveProperty(
    "sources.0.url",
    "https://artist.test/interview",
  );
  expect(boundaries.search).not.toHaveBeenCalled();
  expect(boundaries.youtube).not.toHaveBeenCalled();
});
it("does not fabricate an anecdote after an information search outage", async () => {
  boundaries.information.mockResolvedValue({
    status: "unavailable",
    sources: [],
  });
  responses.push(
    {
      tool_calls: [
        {
          id: "info",
          type: "function",
          function: {
            name: "seekInformation",
            arguments: JSON.stringify({ query: "Acid Coco anecdote" }),
          },
        },
      ],
    },
    {
      content: JSON.stringify({
        reply: "Invented anecdote",
        action: "keep",
        trackIds: [],
        citationIds: [1],
      }),
    },
  );
  const result = await run({
    message: "Une anecdote sur Acid Coco ?",
    scope: "all",
  });
  expect(result.action).toBe("keep");
  expect(result.reply).toContain("Web est momentanément indisponible");
  expect(result.reply).not.toContain("Invented");
});


it("observes actual catalog, provider and MCP rounds without changing selection or source", async () => {
  const events: import("../src/modules/dj/journal/contracts.ts").TraceEvent[] = [];
  responses.push(searchCall("cumbia"), selection([required(external[0]).id], "append"));
  const result = await djTurn(db as unknown as Database, djInput.parse({message:"Ajoute 1 morceau de cumbia à la suite",scope:"all"}), undefined, config, "alice", event=>events.push(event));
  expect(result.action).toBe("append");
  expect(events.map(event=>event.kind)).toEqual(["catalog","provider","tool","provider","policy"]);
  // The journal records why the answer became this outcome.
  expect(events.at(-1)).toMatchObject({name:"decision",output:{kind:"play",reason:"selection"}});
  expect(events.find(event=>event.kind==="tool")).toMatchObject({name:"music_search",callId:"search",input:{query:"cumbia"},status:"ok"});
  expect(boundaries.search).toHaveBeenCalledOnce();
  expect(boundaries.youtube).toHaveBeenCalledOnce();
});

it("concludes from accumulated candidates when the exploratory budget runs out", async () => {
  responses.push(searchCall("énergie"), searchCall("dynamique"), searchCall("workout"), searchCall("rock"), selection([required(library[0]).id], "replace"));
  boundaries.search.mockResolvedValueOnce({results:library.map(video=>({video})),degraded:null}).mockResolvedValue({results:[],degraded:null});
  const result=await run({message:"De l’énergie pour avancer",scope:"library"});
  expect(result).toMatchObject({action:"replace",tracks:[{id:required(library[0]).id}]});
  const final=requests.at(-1);
  expect(final.messages.some((m:any)=>m.role==="tool")).toBe(false);
  expect(JSON.stringify(final.messages)).toContain(required(library[0]).id);
});
it("offers known choices rather than claiming nothing exists if the final provider still requests a tool", async () => {
  responses.push(searchCall("énergie"),searchCall("dynamique"),searchCall("workout"),searchCall("rock"),searchCall("dance"));
  const result=await run({message:"De l’énergie pour avancer",scope:"library"});
  expect(result.action).toBe("keep");
  expect("discoveries" in result && result.discoveries?.length).toBeGreaterThan(0);
  expect(result.reply).not.toMatch(/pas trouvé|aucun morceau/);
});
it("preserves a separate musical explanation while announcing the validated queue", async () => {
  responses.push(searchCall(),{content:JSON.stringify({reply:"Je lance immédiatement !",explanation:"Une couleur électronique et atmosphérique pour prolonger le morceau actuel.",trackIds:[required(library[0]).id],action:"append"})});
  const result=await run({message:"Ajoute un morceau dans cette ambiance",scope:"library",playbackContext:{current,direction:"cumbia électronique"}});
  expect(result.action).toBe("append");
  expect(result.reply).toContain("J’ajoute à la suite");
  expect(result.reply).toContain("électronique et atmosphérique");
  expect(result.reply).not.toContain("Je lance");
});


it("chooses freely for carte blanche without stale failed artist requests or invented playlist filters",async()=>{
 responses.push(searchCall("funk"),selection(library.slice(0,3).map(track=>track.id),"replace"));
 const result=await run({message:"met ce que tu veux dans ma playlist",scope:"library",history:[{role:"user",content:"Ancienne envie : sean rap français"}],playbackContext:{current,direction:"Ancienne envie : sean rap français"}});
 expect(result.action).toBe("replace");expect(result.tracks).toHaveLength(3);
 expect(JSON.stringify(requests[0].messages)).not.toContain("Ancienne envie");
 expect(boundaries.search).toHaveBeenCalledWith(db,expect.objectContaining({query:"funk",playlistId:undefined}),"alice");
});


it("keeps the musical explanation on exploratory cards without executing the provider's announcement", async()=>{
 responses.push(searchCall(),{content:JSON.stringify({reply:"Je lance tout",explanation:"Ces morceaux prolongent la couleur tropicale recherchée.",trackIds:[],discoveryIds:[required(library[0]).id],action:"keep"})});
 const result=await run({message:"Propose un morceau sans le lancer",scope:"library"});
 expect(result.action).toBe("keep");expect(result.tracks).toEqual([]);
 expect(result.reply).toContain("couleur tropicale");expect(result.reply).not.toContain("Je lance");
});

// Real journal, 26 October: both answers were correct and were refused as « pas lisible ».
it("answers a question planned as playback when the provider writes null for unused fields", async () => {
  boundaries.information.mockResolvedValue({
    status: "ok",
    sources: [{ id: 1, title: "Erykah Badu", url: "https://fr.wikipedia.org/wiki/Erykah_Badu", snippet: "Chanteuse américaine." }],
  });
  const reply = "Erykah Badu est une figure de la néo-soul [1].";
  responses.push(
    { tool_calls: [{ id: "info", type: "function", function: { name: "seekInformation", arguments: JSON.stringify({ query: "Erykah Badu" }) } }] },
    { content: JSON.stringify({ kind: "information", reply, explanation: null, trackIds: [], citationIds: [1], discoveryIds: null, action: "keep" }) },
  );
  const result = await run({ message: "donne des infos sur elle", scope: "all" });
  expect(result).toMatchObject({ action: "keep", tracks: [], reply, source: "web" });
  expect(result).toHaveProperty("sources.0.id", 1);
});

it("answers a conversational question without searching even when its wording looks like a command", async () => {
  const reply = "Oui, je vois les morceaux de notre session, pas ton historique d’écoute global.";
  responses.push({ content: JSON.stringify({ kind: "conversation", reply, explanation: null, trackIds: [], citationIds: [], action: "keep" }) });
  const result = await run({ message: "Est-ce que t'as accès à mon historique là par hasard", scope: "all" });
  expect(result).toMatchObject({ action: "keep", tracks: [], reply });
  expect(boundaries.search).not.toHaveBeenCalled();
});

it("keeps a sourced identification in the DJ's words and names every proposed card", async () => {
  boundaries.information.mockResolvedValue({
    status: "ok",
    sources: [{ id: 1, title: "Paroles", url: "https://lyrics.test/cest-ecrit", snippet: "Dans les vapeurs des ports" }],
  });
  const reply = "C’est **C’est écrit**, sur l’album *Sarbacane* [1].";
  responses.push(
    { tool_calls: [{ id: "info", type: "function", function: { name: "seekInformation", arguments: JSON.stringify({ query: "Cabrel vapeurs des ports" }) } }] },
    searchCall("C'est écrit", { artist: "Francis Cabrel" }),
    { content: JSON.stringify({ kind: "music", reply, trackIds: [], discoveryIds: [required(library[0]).id, required(library[1]).id], citationIds: [1], action: "keep" }) },
  );
  const result = await run({ message: "C'est laquelle de Francis Cabrel où il parle des vapeurs du port", scope: "library" });
  expect(result.reply).toBe(reply);
  expect(result.discoveries).toHaveLength(2);
  expect(result).toHaveProperty("sources.0.url", "https://lyrics.test/cest-ecrit");
});

it("names each card when it proposes several, so the count matches what is shown", async () => {
  responses.push(searchCall("jazz"), cards([required(library[0]).id, required(library[1]).id]));
  const result = await run({ message: "Propose deux morceaux de jazz sans les lancer", scope: "library" });
  expect(result.reply).toContain(`« ${required(library[0]).title} »`);
  expect(result.reply).toContain(`« ${required(library[1]).title} »`);
  expect(result.reply).not.toContain("immédiatement");
});

it("plans a structured refill from its count, whatever the accompanying text says", async () => {
  responses.push(searchCall("cumbia"), selection(library.slice(0, 3).map((track) => track.id), "replace"));
  const result = await run({ message: "Mets du rock maintenant", continuation: { count: 3 }, scope: "library" });
  expect(result.action).toBe("append");
  expect(result.tracks).toHaveLength(3);
  const prompt = requests[0].messages.at(-1).content;
  expect(prompt).toContain("Continue cette session avec 3 nouveaux vrais morceaux");
});
