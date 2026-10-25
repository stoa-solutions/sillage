import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), close: vi.fn() }));
vi.mock("../src/music-mcp.ts", () => ({
  requestedTracks: async () => null,
  musicTracks: async () => [],
  connectMusicMcp: async () => ({
    close: mocks.close,
    client: {
      listTools: async () => ({ tools: [{ name: "library_search", inputSchema: {} }] }),
      callTool: mocks.call,
    },
  }),
}));
import { djInput, djTurn } from "../src/dj.ts";
import type { Database } from "../src/db.ts";
const db = { query: async () => ({ rowCount: 1 }) } as unknown as Database;
const config = { configured: true, baseUrl: "https://gemini.test", model: "test", key: "test", local: false };
const track = { id: "edge0000001", title: "Artiste - Collaboration (feat. Edge)", channel: "Artiste", url: "https://www.youtube.com/watch?v=edge0000001" };
const tool = { tool_calls: [{ id: "s", type: "function", function: {
  name: "library_search", arguments: JSON.stringify({ query: "Edge", mode: "text" }),
} }] };
const answer = (ids = [track.id]) => ({ content: JSON.stringify({ reply: "Quelques possibilités", action: "keep", trackIds: [], discoveryIds: ids }) });
beforeEach(() => {
  mocks.call.mockReset().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ tracks: [track] }) }] });
  mocks.close.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
function provider(sequence: unknown[]) {
  const bodies: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Response.json({ choices: [{ message: sequence.shift() }] });
  }));
  return bodies;
}
it("recovers when a provider asks for an exact title before searching, then returns verified cards", async () => {
  const bodies = provider([answer([]), tool, answer()]);
  const result = await djTurn(db, djInput.parse({ message: "un morceau avec Edge en feat" }), undefined, config, "alice");
  expect(bodies[0].tool_choice).toBe("required");
    expect(bodies[0].response_format).toBeUndefined();
  expect(mocks.call).toHaveBeenCalledWith({ name: "library_search", arguments: { query: "Edge", mode: "text" } }, undefined, expect.anything());
  expect(result).toMatchObject({ action: "keep", tracks: [], discoveries: [{ video: track, inLibrary: true }] });
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("preserves candidate cards for an ambiguous play request without replacing playback", async () => {
  provider([tool, answer()]);
  const result = await djTurn(db, djInput.parse({ message: "joue un morceau avec Edge en feat" }), undefined, config, "alice");
  expect(result).toMatchObject({ action: "keep", tracks: [], discoveries: [{ video: track }] });
});
it("rejects a proposal whose ID was never returned by search", async () => {
  provider([tool, answer(["unknown0001"])]);
  await expect(djTurn(db, djInput.parse({ message: "pochette bleue" }), undefined, config, "alice")).rejects.toThrow("non vérifié");
});
it("bounds a provider that never searches and does not claim the music is absent", async () => {
  const bodies = provider(Array.from({ length: 5 }, () => answer([])));
  await expect(djTurn(db, djInput.parse({ message: "pochette bleue" }), undefined, config, "alice")).rejects.toThrow("pas pu rechercher");
  expect(bodies).toHaveLength(5);
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("immediate correction overrides append while keeping the verified external track", async () => {
  provider([tool, { content: JSON.stringify({ reply: "Je lance", action: "append", trackIds: [track.id] }) }]);
  const result = await djTurn(db, djInput.parse({ scope: "all", message: "Non je t'ai dit ajoute du Omer Adam et mets-la directement et fais passe les musiques" }), undefined, config, "alice");
  expect(result).toMatchObject({ action: "replace", tracks: [track] });
});
it("does not announce playback with an empty executable selection", async () => {
  provider([tool, { content: JSON.stringify({ reply: "C'est parti, je lance Omer Adam", action: "replace", trackIds: [] }) }]);
  await expect(djTurn(db, djInput.parse({ scope: "all", message: "lance Omer Adam" }), undefined, config, "alice")).rejects.toThrow("pas obtenu de morceau");
});
it("grounds a relative queue request in current artist, ignoring stale assistant claims", async () => {
  const reply = { content: JSON.stringify({ reply: "Je lance Acid Coco tout de suite", action: "replace", trackIds: [track.id] }) };
  const bodies = provider([tool, reply, tool, reply]);
  const result = await djTurn(db, djInput.parse({ scope: "all", message: "prepare moi des à suivre comme ça stp",
    playbackContext: { current: { id: "nMQw29nfzpg", title: "Tel Aviv", channel: "Omer Adam feat. Arisa", artists: [], genres: [] }, direction: "Du Omer Adam" },
    history: [{ role: "assistant", content: "Je lance Acid Coco" }],
  }), undefined, config, "alice");
  expect(result.action).toBe("append");
  expect(result.reply).toContain(track.title);
  expect(result.reply).not.toMatch(/Acid Coco|tout de suite|Je lance/);
  expect(bodies[0].messages.some((m: any) => m.content === "Je lance Acid Coco")).toBe(false);
  expect(JSON.stringify(bodies[0].messages)).toContain("Omer Adam feat. Arisa");
});
it("supports older clients that do not send a playback snapshot", async () => {
  provider([tool, answer()]);
  const result = await djTurn(db, djInput.parse({ message: "cherche Edge" }), undefined, config, "alice");
  expect(result.action).toBe("keep");
});

it("retries one short queue selection and rejects IDs already played even if the tool returns them", async () => {
  const fresh = { ...track, id: "fresh000001", title: "Fresh song" };
  mocks.call.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ tracks: [track, fresh] }) }] });
  const reply = { content: JSON.stringify({ reply: "Je rejoue", action: "append", trackIds: [track.id, fresh.id, fresh.id] }) };
  const bodies = provider([tool, reply, tool, reply]);
  const result = await djTurn(db, djInput.parse({ scope: "all", message: "Prépare 5 nouveaux morceaux à suivre", excludeIds: [track.id] }), undefined, config, "alice");
  expect(result).toMatchObject({ action: "append", tracks: [fresh] });
  expect(result.reply).toContain("sur les 5 demandés");
  expect(bodies).toHaveLength(4);
});
it("accepts an empty native playback snapshot before the first track", () => {
  expect(djInput.parse({ message: "du jazz", playbackContext: { direction: "" } }).playbackContext?.current).toBeUndefined();
});
