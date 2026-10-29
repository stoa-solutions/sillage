import { it, expect, vi, afterEach } from "vitest";
import { journalPayload } from "../src/modules/dj/journal/journal.payload.ts";
import {
  journalUpload,
  journalEventPage,
} from "../src/modules/dj/journal/types/journal.contracts.ts";
import {
  beginJournal,
  publicJournalError,
} from "../src/modules/dj/journal/services/journal.service.ts";
import { djInput } from "../src/modules/dj/types/dj.contracts.ts";
import type { Database } from "../src/db/index.ts";

afterEach(() => vi.restoreAllMocks());
it("preserves every message, name and tool argument verbatim without anonymization", () => {
  const value = {
    email: "samuel@example.test",
    title: "Jewel Usain feat. HEDGES",
    input: 'token="user-provided-text"',
    tool: { query: "M’Dee basquany :(" },
  };
  expect(journalPayload(value)).toEqual(value);
});
it("bounds oversized payloads explicitly and tolerates unserializable values", () => {
  expect(journalPayload({ text: "x".repeat(300000) })).toMatchObject({
    truncated: true,
    sha256: expect.any(String),
  });
  expect(journalPayload(Array(205).fill("song"))).toHaveLength(205);
  const cycle: any = {};
  cycle.self = cycle;
  expect(journalPayload(cycle)).toEqual({
    omitted: true,
    reason: "unserializable",
  });
});
it("rejects malformed client events and out-of-range sequence cursors", () => {
  expect(
    journalUpload.safeParse({ events: [{ kind: "provider", scope: "all" }] })
      .success,
  ).toBe(false);
  expect(
    journalEventPage.safeParse({ after: "9999999999999999999" }).success,
  ).toBe(false);
  expect(journalEventPage.safeParse({ after: "not-a-sequence" }).success).toBe(
    false,
  );
  expect(journalEventPage.parse({ after: "9223372036854775807" }).after).toBe(
    "9223372036854775807",
  );
});
it("does not break a DJ request when journal storage is unavailable", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const db = {
    connect: vi.fn().mockRejectedValue(new Error("private database address")),
  } as unknown as Database;
  const journal = await beginJournal(
    db,
    "owner",
    "installation",
    djInput.parse({ message: "du jazz", scope: "all" }),
  );
  journal.observe({ kind: "tool", status: "ok", name: "music_search" });
  expect(
    await journal.finish("completed", { reply: "Un morceau", tracks: [] }),
  ).toBe(false);
  expect(publicJournalError(new Error("private database address"))).toEqual({
    error: "Erreur interne du DJ.",
    status: 500,
  });
  expect(console.warn).toHaveBeenCalledWith("DJ journal unavailable", {
    traceId: journal.id,
  });
});
