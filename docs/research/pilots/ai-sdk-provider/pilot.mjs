import assert from 'node:assert/strict';
import { generateText, isStepCount, tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

// Synthetic Google wire responses. No key, real model or user data is used.
const response = parts => Response.json({
  candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
});
const report = [];
const record = (name, details) => report.push({ name, passed: true, ...details });
const tools = {
  music_search: tool({
    description: 'Search the selected musical catalog.',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => ({ tracks: [{ id: 'TRwTWnarBtE', title: 'basqany :(', query }] }),
  }),
};
function fixture(handler) {
  return createGoogleGenerativeAI({ apiKey: 'synthetic-key', fetch: handler })('gemini-3.8-flash');
}

const requests = [];
const model = fixture(async (_url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body);
  return requests.length === 1
    ? response([{ functionCall: { id: 'search-1', name: 'music_search', args: { query: 'basquany' } }, thoughtSignature: 'opaque-synthetic-signature' }])
    : response([{ text: 'Le morceau trouvé est basqany :(.' }]);
});
const result = await generateText({ model, tools, prompt: 'Cherche basquany.', toolChoice: 'auto', stopWhen: isStepCount(5), maxRetries: 0 });
assert.equal(result.steps.length, 2);
assert.equal(requests[0].toolConfig.functionCallingConfig.mode, 'AUTO');
const declaration = requests[0].tools[0].functionDeclarations[0];
assert.equal((declaration.parametersJsonSchema ?? declaration.parameters).properties.query.type, 'string');
assert.ok(requests[1].contents.some(c => c.parts.some(p => p.functionCall?.id === 'search-1' && p.thoughtSignature === 'opaque-synthetic-signature')));
assert.ok(requests[1].contents.some(c => c.parts.some(p => p.functionResponse?.id === 'search-1' && JSON.stringify(p.functionResponse.response).includes('TRwTWnarBtE'))));
record('tool_round_trip', { steps: result.steps.length, signaturePreserved: true, functionIdPreserved: true });

let acknowledgements = 0;
const ack = await generateText({
  model: fixture(async () => { acknowledgements++; return response([{ text: 'Oui, c’est bien ce morceau.' }]); }),
  tools, prompt: 'Voilà, c’est ça.', toolChoice: 'auto', stopWhen: isStepCount(5), maxRetries: 0,
});
assert.equal(acknowledgements, 1);
assert.equal(ack.toolCalls.length, 0);
record('natural_reply_without_tools', { requests: acknowledgements });

let failures = 0;
await assert.rejects(() => generateText({
  model: fixture(async () => { failures++; return Response.json({ error: { code: 429, message: 'Fixture limit' } }, { status: 429 }); }),
  prompt: 'Test', maxRetries: 0,
}));
assert.equal(failures, 1);
record('no_hidden_retry_on_429', { requests: failures });

const controller = new AbortController();
let abortedRequests = 0;
const cancelled = generateText({
  model: fixture(async (_url, init) => {
    abortedRequests++;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      controller.abort(new DOMException('Cancelled', 'AbortError'));
    });
  }),
  prompt: 'Test', abortSignal: controller.signal, maxRetries: 0,
});
await assert.rejects(() => cancelled);
assert.equal(abortedRequests, 1);
record('cancellation', { requests: abortedRequests });
console.log(JSON.stringify({ sdk: 'ai@7.0.153', google: '@ai-sdk/google@4.0.105', transportOnly: true, cases: report }, null, 2));
