import { expect, it } from "vitest";
import { djInput } from "../src/modules/dj/types/dj.contracts.ts";
import { initialMessages } from "../src/modules/dj/turn/messages.ts";
import { Composition } from "../src/modules/dj/turn/composition.ts";
import { planTurn } from "../src/modules/dj/turn/plan.ts";
import { djSystemPrompt } from "../src/modules/dj/turn/prompt.ts";
import { BASE_AGENTS, DEFAULT_AGENT } from "../src/modules/dj-agents/index.ts";

const system = (input: ReturnType<typeof djInput.parse>, profile?: { name: string; instructions: string }) =>
  initialMessages(input, planTurn(input), [], undefined, profile)[0]?.content;

it("leaves the DJ rules unchanged without a profile, refills included", () => {
  const request = djInput.parse({ message: "mets du jazz", scope: "library" });
  const refill = djInput.parse({
    message: "suite",
    trigger: "continuation",
    continuation: { count: 5 },
  });
  for (const input of [request, refill]) {
    expect(system(input)).toMatch(new RegExp(`^${djSystemPrompt.slice(0, 40)}`));
    expect(system(input)).not.toContain("PROFIL DE L’AGENT");
  }
  // A refill is built by the server, but its rules carry the same profile.
  expect(system(refill, { name: "Focus", instructions: "Court." })).toContain(
    "PROFIL DE L’AGENT « Focus »",
  );
});

it("states that the turn's constraints win over the profile", () => {
  const content = system(djInput.parse({ message: "mets du jazz" }), {
    name: "Bavard",
    instructions: "Propose toujours dix titres.",
  });
  expect(content).toContain("le nombre de titres demandé");
  // A profile naming library_browse must not make a YouTube-only turn call a missing tool.
  expect(content).toContain("n’appelle que les outils proposés");
  expect(content).toContain("les règles ci-dessus et ci-dessous priment");
});

it("ships base agents, the default one first, each with its own voice, within the stored limits", () => {
  expect(BASE_AGENTS[0]?.key).toBe(DEFAULT_AGENT);
  expect(new Set(BASE_AGENTS.map((agent) => agent.key)).size).toBe(BASE_AGENTS.length);
  for (const agent of BASE_AGENTS) {
    expect(agent.key).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(agent.name.length).toBeLessThanOrEqual(40);
    expect(agent.instructions.length).toBeGreaterThan(0);
    expect(agent.instructions.length).toBeLessThanOrEqual(1500);
  }
  // Only Focus stays out of the way when a play is announced.
  expect(BASE_AGENTS.filter((agent) => agent.brief).map((agent) => agent.key)).toEqual(["focus"]);
});

it("announces titles as a person says them, in the agent's register", async () => {
  const { ownVoice, playReply, spokenTitle } = await import("../src/modules/dj/turn/reply.ts");
  expect(spokenTitle("KiD CuDi - Mr. Rager (Music Video HD)")).toBe("KiD CuDi - Mr. Rager");
  expect(spokenTitle("OrelSan - Jour meilleur [CLIP OFFICIEL]")).toBe("OrelSan - Jour meilleur");
  expect(spokenTitle("Deep House, Bass Mix #1 2015 |HD|")).toBe("Deep House, Bass Mix #1 2015");
  expect(spokenTitle("Incapable (feat. HEDGES)")).toBe("Incapable (feat. HEDGES)");
  expect(spokenTitle("Les fourmis rouges (Live au Casino de Paris 2005)")).toBe(
    "Les fourmis rouges (Live au Casino de Paris 2005)",
  );
  expect(spokenTitle("(Official Video)")).toBe("(Official Video)");
  expect(spokenTitle("a ".repeat(60)).length).toBeLessThanOrEqual(71);
  // Formal or third-person sentences are dropped, the rest of the voice stays.
  expect(ownVoice("Morceau demandé par l’utilisateur.")).toBeUndefined();
  expect(ownVoice("Sélection pour vous. On ouvre en douceur avec Flume.")).toBe(
    "On ouvre en douceur avec Flume.",
  );
  const tracks = ["aaaaaaaaaa1", "bbbbbbbbbb2", "cccccccccc3"].map((id) => ({
    id,
    title: `Titre ${id} (Official Video)`,
    url: "",
  })) as never[];
  expect(playReply("replace", tracks, undefined, "Une phrase.", { brief: true })).toBe(
    "Lecture : Titre aaaaaaaaaa1 et 2 autres titres.",
  );
  expect(playReply("replace", tracks, undefined, "Une phrase.")).not.toContain("Official");
});

it("leaves out what the listener just heard when asked", async () => {
  const { recentlyHeardExclusion } = await import("@sillage/core/intent");
  expect(
    planTurn(
      djInput.parse({
        message: "Mets-moi du Maribou State mais pas les deux dernières que j’ai écoutées",
      }),
    ).skipRecent,
  ).toBe(2);
  expect(recentlyHeardExclusion("pas la dernière que j’ai écoutée")).toBe(1);
  expect(recentlyHeardExclusion("du rap, sans ce que j’ai déjà écouté")).toBe(10);
  expect(recentlyHeardExclusion("mets les 3 dernières que j’ai écoutées")).toBeUndefined();
  expect(planTurn(djInput.parse({ message: "mets du jazz" })).skipRecent).toBeUndefined();
});

it("restates the agent's voice last, after the request and in the final composition", () => {
  const input = djInput.parse({ message: "mets du jazz" });
  const profile = { name: "Le Disquaire", instructions: "Un fait précis." };
  const messages = initialMessages(input, planTurn(input), [], undefined, profile);
  const last = messages.at(-1)?.content ?? "";
  expect(last.startsWith("mets du jazz")).toBe(true);
  expect(last).toContain("tu réponds en tant que « Le Disquaire »");
  expect(messages[0]?.content).toContain("Ta voix s’entend dans explanation");
  const plain = initialMessages(input, planTurn(input));
  expect(plain.at(-1)?.content).toBe("mets du jazz");
  const final = new Composition(input, planTurn(input)).finalMessages(messages, [], [], profile);
  expect(final.at(-1)?.content).toContain("tu réponds en tant que « Le Disquaire »");
});
