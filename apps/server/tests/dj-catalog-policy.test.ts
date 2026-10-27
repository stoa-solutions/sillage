import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requested: vi.fn(), tracks: vi.fn() }));
vi.mock("../src/music-mcp.ts", () => ({
  requestedTracks: mocks.requested,
  musicTracks: mocks.tracks,
}));
import { catalogSelection } from "../src/features/dj/catalog.ts";
import { planTurn } from "../src/features/dj/plan.ts";
import { djInput } from "../src/features/dj/contracts.ts";
import type { Database } from "../src/db/index.ts";

const db = {} as Database;
const track = { id: "navajo00001", title: "Masego - Navajo", channel: "Masego" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requested.mockResolvedValue({ tracks: [track], missing: [], append: true });
  mocks.tracks.mockResolvedValue([track]);
});

it("an immediate correction also wins on the catalog fast path", async () => {
  const input = djInput.parse({ message: "Non, ne le mets pas en file : joue-le maintenant" });
  const result = await catalogSelection(db, input, "account-a", planTurn(input));
  expect(result?.action).toBe("replace");
  expect(mocks.tracks).toHaveBeenCalledWith(db, [track.id], "account-a");
});
it("a catalog match keeps the requested deferred timing", async () => {
  mocks.requested.mockResolvedValue({ tracks: [track], missing: [], append: false });
  const input = djInput.parse({ message: "Ajoute Masego Navajo à la suite" });
  expect((await catalogSelection(db, input, "account-a", planTurn(input)))?.action).toBe("append");
});
it("a candidate request cannot take the immediate catalog path", async () => {
  const input = djInput.parse({ message: "Ne joue rien maintenant, propose Navajo" });
  expect(await catalogSelection(db, input, "account-a", planTurn(input))).toBeNull();
  expect(mocks.requested).not.toHaveBeenCalled();
});
it("an unavailable or unowned title cannot produce a playback announcement", async () => {
  mocks.tracks.mockResolvedValue([]);
  const input = djInput.parse({ message: "Joue Navajo" });
  const result = await catalogSelection(db, input, "account-b", planTurn(input));
  expect(result?.action).toBe("keep");
  expect(result?.tracks).toEqual([]);
  expect(mocks.tracks).toHaveBeenCalledWith(db, [track.id], "account-b");
});
it("explicitly rejected cards bypass catalog playback and allow alternative search", async () => {
  const input = djInput.parse({ message: "Joue autre chose sauf ces deux là", rejectedIds: [track.id] });
  expect(await catalogSelection(db, input, "account-a", planTurn(input))).toBeNull();
  expect(mocks.tracks).not.toHaveBeenCalled();
});
