import { expect, it } from "vitest";
import { djInput } from "../src/modules/dj/dj.contracts.ts";
import { initialMessages } from "../src/modules/dj/messages.ts";
import { Composition } from "../src/modules/dj/composition.ts";
import { planTurn } from "../src/modules/dj/plan.ts";
import { djSystemPrompt } from "../src/modules/dj/prompt.ts";
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

it("ships a default agent without a profile and base agents within the stored limits", () => {
  expect(BASE_AGENTS[0]).toMatchObject({ key: DEFAULT_AGENT, instructions: "" });
  expect(new Set(BASE_AGENTS.map((agent) => agent.key)).size).toBe(BASE_AGENTS.length);
  for (const agent of BASE_AGENTS) {
    expect(agent.key).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(agent.name.length).toBeLessThanOrEqual(40);
    expect(agent.instructions.length).toBeLessThanOrEqual(1500);
  }
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
