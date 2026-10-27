import { DiscoveryError } from "../src/features/discovery/index.ts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), youtube: vi.fn() }));
vi.mock("../src/search.ts", () => ({ search: mocks.search }));
vi.mock("../src/features/discovery/index.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/features/discovery/index.ts")>(),
  discoveryFor: () => ({ search: mocks.youtube }),
}));
import { connectMusicMcp } from "../src/music-mcp.ts";
import type { Database } from "../src/db/index.ts";
import { required } from "./support/required.ts";

const libraryTrack = {
  id: "library0001",
  title: "Album track",
  channel: "Library artist",
  thumbnail_url: "https://example.test/library.jpg",
  duration_seconds: 180,
};
const externalTrack = {
  id: "youtube0001",
  title: "Other artist, same mood",
  channel: "External artist",
  thumbnailUrl: "https://example.test/external.jpg",
  durationSeconds: 210,
  url: "https://youtube.com/watch?v=youtube0001",
};
const db = {
  query: vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: [libraryTrack],
  })),
};
const clients: Awaited<ReturnType<typeof connectMusicMcp>>[] = [];
beforeEach(() => {
  db.query.mockClear();
  mocks.search
    .mockReset()
    .mockResolvedValue({
      results: [{ video: libraryTrack, reason: "catalog" }],
      degraded: null,
    });
  mocks.youtube
    .mockReset()
    .mockResolvedValue({
      results: [{ video: externalTrack, inLibrary: false }],
    });
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
async function scoped(
  scope: "library" | "youtube" | "all",
  rejectedIds: string[] = [],
) {
  const mcp = await connectMusicMcp(
    db as unknown as Database,
    [],
    "alice",
    scope !== "library",
    scope,
    rejectedIds,
  );
  clients.push(mcp);
  return mcp.client;
}
async function query(
  scope: "library" | "youtube" | "all",
  args: Record<string, unknown> = { query: "dream pop" },
  rejectedIds: string[] = [],
) {
  const client = await scoped(scope, rejectedIds);
  const response = await client.callTool({
    name: "music_search",
    arguments: args,
  });
  expect(response.isError).not.toBe(true);
  return JSON.parse(required((response.content as { text: string }[])[0]).text);
}
it.each(["library", "youtube", "all"] as const)(
  "exposes one music search routed to %s",
  async (scope) => {
    const client = await scoped(scope);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      scope === "youtube"
        ? ["seekInformation", "music_search"]
        : ["seekInformation", "library_browse", "music_search"],
    );
    const result = await query(scope);
    expect(mocks.search).toHaveBeenCalledTimes(scope === "youtube" ? 0 : 1);
    expect(mocks.youtube).toHaveBeenCalledTimes(scope === "library" ? 0 : 1);
    expect(
      result.results
        .map((item: { video: { id: string } }) => item.video.id)
        .sort(),
    ).toEqual(
      scope === "library"
        ? [libraryTrack.id]
        : scope === "youtube"
          ? [externalTrack.id]
          : [libraryTrack.id, externalTrack.id].sort(),
    );
    expect(
      result.sources.every(
        (source: { status: string }) => source.status === "ok",
      ),
    ).toBe(true);
  },
);
it("searches freely across both sources and preserves the account boundary", async () => {
  await query("all", { query: "cumbia psychédélique", fuzzy: true });
  expect(mocks.search).toHaveBeenCalledWith(
    db,
    expect.objectContaining({ query: "cumbia psychédélique", fuzzy: true }),
    "alice",
  );
  expect(mocks.youtube).toHaveBeenCalledWith("alice", "cumbia psychédélique");
  expect(required(db.query.mock.calls[0])[1]).toEqual([[libraryTrack.id], "alice"]);
});
it.each(["library", "youtube"])(
  "keeps the other source when %s fails",
  async (source) => {
    (source === "library" ? mocks.search : mocks.youtube).mockRejectedValueOnce(
      new Error("secret provider transport"),
    );
    const result = await query("all");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].video.id).toBe(
      source === "library" ? externalTrack.id : libraryTrack.id,
    );
    expect(result.sources).toContainEqual(
      expect.objectContaining({ source, status: "error" }),
    );
    expect(JSON.stringify(result)).not.toContain("secret provider");
  },
);
it("deduplicates shared videos, preferring enriched library evidence", async () => {
  mocks.youtube.mockResolvedValueOnce({
    results: [
      { video: { ...externalTrack, id: libraryTrack.id }, inLibrary: true },
    ],
  });
  const result = await query("all");
  expect(result.results).toHaveLength(1);
  expect(result.results[0]).toMatchObject({
    inLibrary: true,
    video: { title: libraryTrack.title },
  });
});
it.each(["library", "youtube", "all"] as const)(
  "explicit rejections survive includeQueued in %s",
  async (scope) => {
    const result = await query(
      scope,
      { query: "dream pop", includeQueued: true },
      [libraryTrack.id, externalTrack.id],
    );
    expect(result.results).toEqual([]);
  },
);
it("does not pretend YouTube can search a cover color", async () => {
  const result = await query("youtube", {
    query: "yellow cover",
    mode: "image",
  });
  expect(result.results).toEqual([]);
  expect(result.sources).toContainEqual(
    expect.objectContaining({ source: "youtube", status: "unsupported" }),
  );
  expect(mocks.youtube).not.toHaveBeenCalled();
  expect(mocks.search).not.toHaveBeenCalled();
});
it("uses local thumbnail evidence for an image request in Partout", async () => {
  const result = await query("all", { query: "yellow cover", mode: "image" });
  expect(result.results).toHaveLength(1);
  expect(mocks.search).toHaveBeenCalledWith(
    db,
    expect.objectContaining({ mode: "image" }),
    "alice",
  );
  expect(mocks.youtube).not.toHaveBeenCalled();
});
it("applies an explicitly requested duration to YouTube candidates too", async () => {
  const result = await query("youtube", {
    query: "dream pop",
    maxDurationSeconds: 180,
  });
  expect(result.results).toEqual([]);
  expect(mocks.youtube).toHaveBeenCalledOnce();
});
it("classifies YouTube throttling without leaking its private response", async () => {
  mocks.youtube.mockRejectedValueOnce(
    new DiscoveryError("private quota details", 429, "rate_or_quota"),
  );
  const result = await query("all");
  expect(result.results).toHaveLength(1);
  expect(result.sources).toContainEqual({
    source: "youtube",
    status: "error",
    reason: "rate_or_quota",
  });
  expect(JSON.stringify(result)).not.toContain("private quota details");
});

it("rejects invented playlist filters without searching or treating them as an empty catalog", async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: "owned-playlist", title: "My playlist", tracks: 3 }] } as never);
  const result = await query("all", { query: "afro", playlist: "_library_all" });
  expect(result.sources).toContainEqual({ source: "library", status: "invalid_request", reason: "invalid_playlist" });
  expect(result.note).toContain("omit playlist");
  expect(mocks.search).not.toHaveBeenCalled();
  expect(mocks.youtube).not.toHaveBeenCalled();
});
it("resolves a playlist the listener names, without a prior listing call", async () => {
  const mcp = await connectMusicMcp(db as unknown as Database, [], "alice", true, "all");
  try {
    db.query.mockResolvedValueOnce({ rows: [{ id: "owned-playlist", title: "Soirée d’été", tracks: 12 }] } as never);
    await mcp.client.callTool({ name: "music_search", arguments: { query: "afro", playlist: "soiree d'ete" } });
    expect(mocks.search).toHaveBeenCalledWith(db, expect.objectContaining({ playlistId: "owned-playlist" }), "alice");
    expect(mocks.youtube).not.toHaveBeenCalled();
  } finally { await mcp.close(); }
});

it("uses an explicit artist identity without AND-ing descriptive style words into the lookup", async()=>{
  await query("all",{query:"sean rap français",artist:"sean"});
  expect(mocks.search).toHaveBeenCalledWith(db,expect.objectContaining({query:"sean"}),"alice");
  expect(mocks.youtube).toHaveBeenCalledWith("alice","sean");
});
it("explores independent clues in both sources with the same account and exclusions", async()=>{
  const result=await query("all",{query:"cumbia",alternatives:["champeta","cumbia"]});
  expect(mocks.search.mock.calls.map(call=>call[1].query)).toEqual(["cumbia","champeta"]);
  expect(mocks.youtube.mock.calls.map(call=>call[1])).toEqual(["cumbia","champeta"]);
  expect(result.results).toHaveLength(2);
  expect(result.queries).toEqual(["cumbia","champeta"]);
});

it("keeps successful alternative searches while exposing the failed YouTube clue", async()=>{
  mocks.youtube.mockRejectedValueOnce(new DiscoveryError("private error",429,"daily_quota"));
  const result=await query("all",{query:"cumbia",alternatives:["champeta"]});
  expect(result.results.map((item:any)=>item.video.id).sort()).toEqual([libraryTrack.id,externalTrack.id].sort());
  expect(result.sources).toContainEqual({source:"youtube",status:"error",reason:"daily_quota"});
  expect(JSON.stringify(result)).not.toContain("private error");
});
it("removes obvious tutorials from mood results without excluding unknown recordings", async()=>{
  const tutorial={...libraryTrack,id:"tutorial001",title:"Learn Three.js by Building 5 Projects",channel:"freeCodeCamp.org"};
  db.query.mockResolvedValueOnce({rows:[tutorial,libraryTrack]});
  mocks.search.mockResolvedValueOnce({results:[{video:tutorial},{video:libraryTrack}],degraded:null});
  const result=await query("library",{query:"énergie"});
  expect(result.results.map((item:any)=>item.video.id)).toEqual([libraryTrack.id]);
});

it("does not let a prolific primary artist hide the alternative artists in the final 20 candidates",async()=>{
 const primary=Array.from({length:24},(_,index)=>({...libraryTrack,id:`primary${String(index).padStart(4,"0")}`,title:`Sean song ${index}`,channel:"Sean"}));
 const alternative={...libraryTrack,id:"other000001",title:"Neighboring artist",channel:"Other"};
 mocks.search.mockImplementation(async (_db,input)=>({results:(input.query==="sean"?primary:[alternative]).map(video=>({video})),degraded:null}));
 db.query.mockResolvedValueOnce({rows:[...primary,alternative]});
 const result=await query("library",{query:"sean rap français",artist:"sean",alternatives:["melodic rap"]});
 expect(result.results).toHaveLength(20);
 expect(result.results.some((item:any)=>item.video.id===alternative.id)).toBe(true);
});
