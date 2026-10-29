import { it, expect } from "vitest";
import { Composition } from "../src/modules/dj/turn/composition.ts";
import {
  musicQueries,
  isMusicCandidate,
} from "../src/modules/mcp/mcp.retrieval.ts";
import { planTurn } from "../src/modules/dj/turn/plan.ts";
import { djInput, selection } from "../src/modules/dj/types/dj.contracts.ts";
import { required } from "./support/required.ts";
const items = Array.from({ length: 6 }, (_, i) => ({
  inLibrary: true,
  video: {
    id: `track00000${i}`,
    title: `Titre ${i}`,
    channel: "Artiste",
    durationSeconds: 180,
    url: "https://youtube.com/watch?v=track000000",
    thumbnailUrl: "",
  },
}));
it("retains a verified immediate selection across later empty searches without changing it to append", () => {
  const input = djInput.parse({
    message: "Mets deux morceaux",
    scope: "library",
  });
  const composition = new Composition(input, planTurn(input));
  composition.add(items);
  composition.select(
    selection.parse({
      reply: "ok",
      action: "replace",
      trackIds: items.slice(0, 2).map((i) => i.video.id),
    }),
  );
  composition.add([]);
  expect(composition.recover()).toMatchObject({
    action: "replace",
    ids: items.slice(0, 2).map((i) => i.video.id),
  });
});
it("does not autoplay retrieved candidates before the model has chosen them", () => {
  const input = djInput.parse({ message: "De l’énergie pour avancer" });
  const composition = new Composition(input, planTurn(input));
  composition.add(items);
  expect(composition.recover()).toMatchObject({
    action: "keep",
    ids: [],
    cards: items,
  });
});
it("preserves order, requested size and exclusions at the composition interface", () => {
  const input = djInput.parse({
    message: "Ajoute trois morceaux",
    excludeIds: [required(items[0]).video.id],
    rejectedIds: [required(items[1]).video.id],
  });
  const composition = new Composition(input, planTurn(input));
  composition.add(items);
  const chosen = composition.select(
    selection.parse({
      reply: "ok",
      action: "replace",
      trackIds: items.map((i) => i.video.id),
    }),
  );
  expect(chosen).toMatchObject({
    action: "append",
    ids: items.slice(2, 5).map((i) => i.video.id),
  });
  expect(() =>
    composition.select(
      selection.parse({
        reply: "ok",
        action: "append",
        trackIds: ["unseen00001"],
      }),
    ),
  ).toThrow("non vérifié");
});
it("never joins an artist identity and genre constraints into a strict lookup", () => {
  expect(
    musicQueries({
      query: "sean rap français",
      artist: "sean",
      alternatives: ["rap mélodique", "sean"],
    }),
  ).toEqual(["sean", "rap mélodique"]);
  expect(
    musicQueries({
      query: "yellow cover",
      artist: "sean",
      alternatives: ["pop"],
      mode: "image",
    }),
  ).toEqual(["yellow cover"]);
});
it("keeps unknown and verified music eligible while separating obvious non-musical formats", () => {
  expect(
    isMusicCandidate("énergie", {
      title: "ByteBot - L’IA qui contrôle votre PC (Tuto 2025)",
    }),
  ).toBe(false);
  expect(isMusicCandidate("énergie", { title: "Incapable" })).toBe(true);
  expect(
    isMusicCandidate("énergie", {
      title: "Lesson",
      musicMetadata: { status: "matched" },
    }),
  ).toBe(true);
  expect(
    isMusicCandidate("guitar lesson", {
      title: "Between the Bars Guitar Lesson",
    }),
  ).toBe(true);
});
