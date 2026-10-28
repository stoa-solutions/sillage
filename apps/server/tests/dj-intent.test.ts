import { expect, it } from "vitest";
import { asksForMusic, djIntent, playbackAction, parseDJIntent, followsCurrent } from "@sillage/core/intent";
it.each([
  ["Non je t'ai dit ajoute du Omer Adam et mets-la directement et fais passe les musiques", "replace"],
  ["ajoute Omer Adam et joue-le maintenant", "replace"],
  ["Mets le trois en file d'attente", "append"],
  ["ne le joue pas maintenant, ajoute à la suite", "append"],
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
it.each([
  ["prepare moi des à suivre comme ça stp", "append"],
  ["prépare-moi quelques titres à suivre", "append"],
  ["j'ai envie que tu me mettre une next musique dans ce meme style stp", "replace"],
  ["mets ce titre à suivre", "append"],
])("honors continuation intent in %s", (message, expected) => {
  expect(djIntent(message)).toBe(expected);
});

it.each([
  ["Ajoute du jazz et joue-le maintenant, sans live", "replace"],
  ["Non, ne le mets pas en file : joue-le maintenant", "replace"],
  ["Ne joue pas maintenant, prépare la suite", "append"],
  ["Ne rajoute rien", "browse"],
  ["Ne joue pas Navajo", "browse"],
  ["Joue Ne me quitte pas", "replace"],
  ["Tu peux ne pas changer de musique", "browse"],
  ["Peux-tu ne pas lancer de musique", "browse"],
  ["Tu peux ne pas changer de musique, mais prépare la suite", "append"],
  ["Tu peux jouer Ne me quitte pas", "replace"],
  ["D’autres stp", "browse"],
  ["Autre chose", "browse"],
  ["Mets tout ce que tu trouves sauf ces deux-là", "replace"],
  ["Cherche du jazz sans jouer les morceaux", "browse"],
  ["Joue Mac Miller, pas Self Care", "replace"],
  ["Joue Mac Miller pas Self Care", "replace"],
  ["Prépare-moi une file de rap US", "append"],
  ["Prépare la file, sans changer la musique", "append"],
])("scopes operation and negation in %s", (message, expected) => {
  expect(djIntent(message)).toBe(expected);
});

it("does not turn a corrected immediate request back into append", () => {
  expect(playbackAction(djIntent("Ajoute du jazz et joue-le maintenant, sans live"), "replace"))
    .toBe("replace");
});

it.each([
  ["Prépare trois nouveaux morceaux à suivre", 3],
  ["Prépare huit nouvelles chansons à suivre", 8],
  ["Prépare quinze titres à suivre", 15],
  ["Ajoute 20 morceaux", 20],
  ["Ajoute 2 titres", 2],
  ["Ajoute un morceau", 1],
])("extracts the explicit bounded count in %s", (message, count) => {
  expect(parseDJIntent(message)).toMatchObject({ intent: "append", timing: "later", count });
});
it.each([
  ["dans le même style que Michael Jackson", "named", false],
  ["dans la même ambiance que Tyga", "named", false],
  ["dans ce même style", "current", true],
  ["dans cette ambiance", "current", true],
  ["dans la même veine", "current", true],
  ["dans la même veine que Michael Jackson", "named", false],
  ["comme celui-ci", "current", true],
  ["comme celle-ci", "current", true],
  ["comme ça", "current", true],
  ["du jazz", "none", false],
])("distinguishes an explicit reference in %s", (message, reference, relative) => {
  expect(parseDJIntent(message).reference).toBe(reference);
  expect(followsCurrent(message)).toBe(relative);
});

it("ignores a count above the selection limit instead of misreading it", () => {
  expect(parseDJIntent("Ajoute 25 titres").count).toBeUndefined();
});

it.each([
  ["Mets-moi quelque chose que j'aime", true],
  ["Du rap s'il te plaît", true],
  ["un peu de jazz", true],
  ["Une playlist pour bosser", true],
  ["Carte blanche, surprends-moi", true],
  ["merci", false],
  ["des infos sur Damso ?", false],
  ["ne mets rien", false],
])("tells whether %s asks for music", (message, expected) => {
  expect(asksForMusic(message)).toBe(expected);
});
