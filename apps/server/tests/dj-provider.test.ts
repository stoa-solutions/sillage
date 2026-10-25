import { afterEach, expect, it, vi } from "vitest";
import {
  completeTurn,
  MAX_ROUNDS,
  type ChatMessage,
} from "../src/features/dj/provider.ts";
import { DjUnavailable } from "../src/dj.ts";

const config = {
  configured: true,
  baseUrl: "https://provider.test",
  model: "gemini-3.8-flash",
  key: "test-key",
};
const messages: ChatMessage[] = [{ role: "user", content: "Du jazz" }];
const tools = [
  {
    type: "function" as const,
    function: { name: "library_search", parameters: {} },
  },
];
afterEach(() => vi.unstubAllGlobals());

it("keeps forced search, JSON mode and final-round tools compatible with Gemini", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    }),
  );
  for (const round of [0, 1, MAX_ROUNDS - 1]) {
    await completeTurn(
      config,
      messages,
      tools,
      round,
      new AbortController().signal,
    );
  }
  expect(bodies[0]).toMatchObject({
    tool_choice: "required",
    reasoning_effort: "low",
  });
  expect(bodies[0].response_format).toBeUndefined();
  expect(bodies[1]).toMatchObject({
    tool_choice: "auto",
    response_format: { type: "json_object" },
  });
  expect(bodies[2].tools).toBeUndefined();
  expect(bodies[2].tool_choice).toBeUndefined();
});

it("preserves opaque provider signatures across a tool-call round trip", async () => {
  const call = {
    id: "search-1",
    type: "function",
    function: { name: "library_search", arguments: "{}" },
    extra_content: { google: { thought_signature: "opaque-test-signature" } },
  };
  const message = {
    content: null,
    tool_calls: [call],
    extra_content: { provider: "opaque" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ choices: [{ message }] })),
  );
  expect(
    await completeTurn(
      config,
      messages,
      tools,
      0,
      new AbortController().signal,
    ),
  ).toEqual(message);
});

it.each([
  {},
  { choices: [] },
  { choices: [{ message: { tool_calls: [{ function: {} }] } }] },
])(
  "rejects malformed provider envelopes with a safe error",
  async (payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload)),
    );
    await expect(
      completeTurn(config, messages, tools, 0, new AbortController().signal),
    ).rejects.toMatchObject({
      status: 502,
      message: "La réponse du DJ est incomplète. Réessaie.",
    });
  },
);

it("never forwards provider error bodies or credentials to the client", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response("secret-provider-debug-key", { status: 429 }),
    ),
  );
  const result = completeTurn(
    config,
    messages,
    tools,
    0,
    new AbortController().signal,
  );
  await expect(result).rejects.toBeInstanceOf(DjUnavailable);
  await expect(result).rejects.toMatchObject({ status: 429 });
  await expect(result).rejects.not.toThrow(/secret-provider|test-key/);
});

it("passes cancellation to the transport without starting a second request", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.signal).toBe(controller.signal);
    init.signal?.throwIfAborted();
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    completeTurn(config, messages, tools, 0, controller.signal),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("identifies provider throttling or quota separately from the Recall budget", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response("provider-private-details", { status: 429 }),
    ),
  );
  await expect(
    completeTurn(config, messages, tools, 0, new AbortController().signal),
  ).rejects.toMatchObject({
    status: 429,
    message: expect.stringContaining(
      "limite de débit ou quota de ta clé Gemini",
    ),
  });
});
