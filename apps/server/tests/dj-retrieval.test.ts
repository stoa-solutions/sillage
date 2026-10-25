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
