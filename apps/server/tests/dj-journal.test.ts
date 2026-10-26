import { it, expect, vi, afterEach } from "vitest";
import { journalPayload } from "../src/features/dj/journal/payload.ts";
import {
  journalUpload,
  journalEventPage,
} from "../src/features/dj/journal/contracts.ts";
import {
  beginJournal,
  publicJournalError,
} from "../src/features/dj/journal/store.ts";
import { completeTurn } from "../src/features/dj/provider.ts";
import { djInput } from "../src/features/dj/contracts.ts";
import type { TraceEvent } from "../src/features/dj/journal/contracts.ts";
import type { Database } from "../src/db.ts";

afterEach(() => vi.restoreAllMocks());
it("preserves every message, name and tool argument verbatim without anonymization", () => {
  const value = {
    email: "demo@example.test",
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
it("captures visible provider calls and usage without storing thought signatures or API keys", async () => {
  const events: TraceEvent[] = [];
  const call = {
    id: "search-1",
    type: "function",
    function: { name: "music_search", arguments: '{"query":"Acid Coco"}' },
    extra_content: { google: { thought_signature: "opaque-private" } },
  };
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [call],
              extra_content: { hidden: "opaque-private" },
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    );
  const result = await completeTurn(
    {
      configured: true,
      baseUrl: "https://provider.test",
      model: "test-model",
      key: "private-key",
    },
    [{ role: "user", content: "du jazz" }],
    [],
    0,
    new AbortController().signal,
    (event) => events.push(event),
  );
  expect(result.tool_calls?.[0]).toMatchObject({id:call.id,function:call.function});
  expect(JSON.stringify(result.providerContent)).toContain("opaque-private");
  expect(journalPayload(events)).toMatchObject([
    {
      kind: "provider",
      status: "ok",
      output: { usage: { total_tokens: 30 }, tool_calls: [{ id: "search-1" }] },
    },
  ]);
  expect(JSON.stringify(journalPayload(events))).not.toMatch(
    /opaque-private|private-key|extra_content/,
  );
  fetcher.mockResolvedValueOnce(
    Response.json({ choices: [{ message: { content: "{}" } }] }),
  );
  await expect(
    completeTurn(
      {
        configured: true,
        baseUrl: "https://provider.test",
        model: "test",
        key: undefined,
      },
      [{role:"user",content:"ok"}],
      [],
      0,
      new AbortController().signal,
      (event) => events.push(event),
    ),
  ).resolves.toMatchObject({ content: "{}" });
});
