import { expect, it } from "vitest";
import { djIntent, playbackAction } from "./dj-intent.ts";
it.each([
  ["un morceau avec Edge en feat", "browse"],
  ["une musique avec Edge qui fait un feat", "browse"],
  ["la pochette est bleue avec un visage", "browse"],
  ["un morceau avec soleil dans le titre", "browse"],
  ["joue un morceau avec Edge en feat", "replace"],
  ["ajoute à la suite le morceau avec une pochette bleue", "append"],
  ["mets Billie Jean sur YouTube", "replace"],
  ["du michael jackson stp pas rock with u", "replace"],
  ["cherche Self Care et joue-le", "replace"],
  ["joue Billie Jean après ce morceau", "append"],
  ["ajoute du jazz à la suite sans couper", "append"],
  ["Continue dans la même ambiance", "append"],
  ["Préparer la suite", "append"],
  ["cherche Mac Miller dans mes playlists", "browse"],
  ["Montre du jazz sur YouTube", "browse"],
])("routes %s as %s independently of search source", (message, intent) => {
  expect(djIntent(message)).toBe(intent);
});
it("does not convert a clarification/no-result into a playback command", () => {
  expect(playbackAction("replace", "keep")).toBe("keep");
  expect(playbackAction("replace", "append")).toBe("replace");
  expect(playbackAction("append", "replace")).toBe("append");
});
