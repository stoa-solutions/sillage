import { expect, it } from "vitest";
import { planTurn } from "../src/features/dj/plan.ts";
import { initialMessages } from "../src/features/dj/messages.ts";
import type { DjInput } from "../src/features/dj/contracts.ts";

function request(message: string): DjInput {
  return {
    message, scope: "library", excludeIds: [], discoveryContext: [], rejectedIds: [],
    history: [{ role: "user", content: "Je veux quitter le jazz pour de la pop" }],
    playbackContext: {
      current: { id: "abcdefghijk", title: "Blue in Green", channel: "Miles Davis", artists: ["Miles Davis"], genres: ["jazz"] },
      direction: "Du jazz",
    },
  };
}
it("keeps an explicitly named artist separate from the currently playing style", () => {
  const input = request("Prépare trois titres dans le même style que Michael Jackson");
  const plan = planTurn(input);
  expect(plan).toMatchObject({ intent: "append", relative: false, grounded: false, targetCount: 3 });
  const messages = initialMessages(input, plan);
  expect(messages).toContainEqual(input.history[0]);
  expect(messages[0].content).not.toContain("RÉFÉRENCE DE CETTE DEMANDE : le morceau current");
});
it("anchors a relative follow-up to actual playback without old announcements", () => {
  const input = request("Prépare huit morceaux comme celui-ci");
  const plan = planTurn(input);
  expect(plan.relative).toBe(true);
  expect(plan.targetCount).toBe(8);
  const messages = initialMessages(input, plan);
  expect(messages).not.toContainEqual(input.history[0]);
  expect(messages[0].content).toContain("RÉFÉRENCE DE CETTE DEMANDE : le morceau current");
});
it("keeps the bounded default only when no size was specified", () => {
  expect(planTurn(request("Prépare la suite")).targetCount).toBe(5);
  expect(planTurn(request("Joue huit titres maintenant")).targetCount).toBeUndefined();
});
it.each(["library", "youtube", "all"] as const)("keeps the visible %s scope authoritative", (scope) => {
  const input = { ...request("Cherche sur YouTube"), scope };
  expect(planTurn(input)).toMatchObject({ scope, externalSearch: scope !== "library" });
});
it("retains YouTube hints only for clients without a source selector", () => {
  const input = request("Cherche sur YouTube");
  delete input.scope;
  expect(planTurn(input)).toMatchObject({ scope: "youtube", externalSearch: true });
});
it.each(["Prépare la suite dans cette ambiance", "Prépare la suite dans la même veine"])("uses current playback for %s", (message) => {
  const plan = planTurn(request(message));
  expect(plan.relative).toBe(true);
  expect(plan.grounded).toBe(true);
});

it("retains recent proposal and explicit rejections even for a relative follow-up", () => {
  const input = request("D’autres dans cette ambiance");
  input.discoveryContext = [{ id: "abcdefghijk", title: "Verified title", channel: "Artist" }];
  input.rejectedIds = ["abcdefghijk"];
  const messages = initialMessages(input, planTurn(input));
  const evidence = messages.find((message) => message.content?.startsWith("Proposition récente"));
  expect(evidence?.content).toContain('"rejectedIds":["abcdefghijk"]');
  expect(evidence?.content).toContain('"title":"Verified title"');
});

it.each(["Propose un morceau de Jewel Usain sans le lancer", "Cherche trois titres sans les jouer", "Montre-moi une chanson sans la mettre en lecture"])("never treats a pronominal prohibition as playback: %s", (message) => {
  expect(planTurn(request(message)).intent).toBe("browse");
});

it("treats carte blanche as a new direction rather than recycling old failed musical constraints",()=>{
  const input=request("met ce que tu veux dans ma playlist");
  const plan=planTurn(input);
  expect(plan).toMatchObject({openChoice:true,intent:"replace"});
  const messages=initialMessages(input,plan);
  expect(messages).not.toContainEqual(input.history[0]);
  expect(JSON.stringify(messages)).not.toContain('"direction":"Du jazz"');
  expect(messages[0].content).toContain("CARTE BLANCHE");
});


it("keeps explicit genre exclusions inside carte blanche rather than restoring the old direction",()=>{
 expect(planTurn(request("Mets ce que tu veux mais pas de rap")).openChoice).toBe(true);
 expect(planTurn(request("Je ne te donne pas carte blanche, reste dans le jazz")).openChoice).toBe(false);
});
