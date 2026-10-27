import { expect, it } from "vitest";
import { summarizeMemory, type JournalTurn } from "../src/features/dj/memory.ts";
import { initialMessages } from "../src/features/dj/messages.ts";
import { planTurn } from "../src/features/dj/plan.ts";
import { djInput } from "../src/features/dj/contracts.ts";
import { required } from "./support/required.ts";

const completed = (message: string, titles: string[]): JournalTurn => ({
  trigger: "user",
  status: "completed",
  input: { message },
  response: { reply: `C’est parti : ${titles.join(", ")}.`, tracks: titles.map((title) => ({ title })) },
});

it("remembers the latest exchanges in order and compresses older ones", () => {
  const turns = Array.from({ length: 23 }, (_, index) =>
    completed(`demande ${index}`, [`Titre ${index}`]),
  ).reverse();
  const memory = summarizeMemory(turns, 20);
  expect(memory.exchanges).toHaveLength(20);
  expect(required(memory.exchanges[0]).request).toBe("demande 3");
  expect(memory.exchanges.at(-1)?.tracks).toEqual(["Titre 22"]);
  expect(memory.earlier).toEqual({ exchanges: 3, tracks: 3 });
});

it("forgets refused and failed turns", () => {
  const memory = summarizeMemory([
    { trigger: "user", status: "busy", input: { message: "perdu" }, response: { error: "occupé" } },
    { trigger: "user", status: "error", input: { message: "raté" }, response: { error: "illisible" } },
    completed("du jazz", ["Blue in Green"]),
  ]);
  expect(memory.exchanges.map((exchange) => exchange.request)).toEqual(["du jazz"]);
});

it("carries what an interrupted turn had already explored", () => {
  const memory = summarizeMemory([
    {
      trigger: "user",
      status: "superseded",
      input: { message: "un mood russe" },
      response: null,
      tools: [
        {
          input: { query: "russian doomer" },
          output: { results: [{ video: { id: "abcdefghijk", title: "Кино — Группа крови" } }] },
        },
      ],
    },
  ]);
  expect(memory.interrupted).toEqual({
    request: "un mood russe",
    searches: ["russian doomer"],
    candidates: ["Кино — Группа крови"],
  });
});

it("gives a relative request only the titles to avoid, not the old wishes", () => {
  const memory = summarizeMemory([completed("du Elvis", ["Can't Help Falling In Love"])]);
  const input = djInput.parse({
    message: "Prépare la suite dans cette ambiance",
    history: [{ role: "user", content: "client history" }],
    playbackContext: {
      current: { id: "abcdefghijk", title: "In The Ghetto", channel: "Elvis", artists: [], genres: [] },
      direction: "",
    },
  });
  const messages = initialMessages(input, planTurn(input), [], memory);
  const text = JSON.stringify(messages);
  expect(text).toContain("Titres déjà proposés");
  expect(text).toContain("Can't Help Falling In Love");
  expect(text).not.toContain("du Elvis");
  expect(text).not.toContain("client history");
});

it("prefers the server memory over the client's text history", () => {
  const memory = summarizeMemory([completed("du Elvis", ["My Way"])]);
  const input = djInput.parse({
    message: "et maintenant du rock",
    history: [{ role: "assistant", content: "On continue avec My Way." }],
  });
  const text = JSON.stringify(initialMessages(input, planTurn(input), [], memory));
  expect(text).toContain("Mémoire de cette conversation");
  expect(text).not.toContain("On continue avec My Way.");
});
