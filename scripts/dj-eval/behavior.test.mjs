import { test } from "node:test";
import assert from "node:assert/strict";
import { applyResponse, checkResponse, classifyFailure, initialState, requestFor, safeResponse, validateResponse } from "./behavior.mjs";
import { htmlReport } from "./report.mjs";

const a = { id: "library0001", title: "Premier", channel: "Artiste" };
const b = { id: "youtube0001", title: "Deuxième", channel: "Artiste" };
const c = { id: "youtube0002", title: "Troisième", channel: "Artiste" };
test("multi-turn requests carry real cards and explicit exclusions, independent of playback", () => {
  const scenario = { scope: "all", current: { ...a, artists: [], genres: [] } };
  const state = initialState(scenario);
  const step = { message: "propose", expect: { action: "keep", minCards: 2 } };
  const request = requestFor(scenario, step, state);
  const response = { reply: "Voici", action: "keep", tracks: [], discoveries: [b, c].map((video) => ({ video, inLibrary: false })) };
  assert.deepEqual(checkResponse(step, request, response, state), []);
  applyResponse(request, response, state);
  assert.equal(state.current.id, a.id);
  assert.deepEqual(state.queue, []);
  const next = requestFor(scenario, { message: "d’autres sauf ces deux-là", rejectPrevious: true }, state);
  assert.deepEqual(next.rejectedIds, [b.id, c.id]);
  assert.deepEqual(next.excludeIds, [a.id]);
  assert.equal(next.history.length, 2);
  assert.equal(next.discoveryContext[0].title, b.title);
});
test("catches ignored count, wrong action, duplicates, rejected cards and order", () => {
  const scenario = { scope: "all", current: a, queuedIds: [b.id] };
  const state = initialState(scenario);
  const step = { message: "prépare 5", expect: { action: "append", minTracks: 5, preserveCurrent: true, exactIds: [c.id] } };
  const request = requestFor(scenario, step, state);
  request.rejectedIds = [a.id];
  const failures = checkResponse(step, request, { action: "replace", reply: "ok", tracks: [a, a] }, state);
  assert.equal(failures.length, 6);
  assert.ok(failures.some((failure) => failure.includes("ordre")));
  assert.ok(failures.some((failure) => failure.includes("exclu")));
});
test("append preserves current and prepares next request exclusions", () => {
  const scenario = { scope: "all", current: a };
  const state = initialState(scenario);
  const request = requestFor(scenario, { message: "à suivre" }, state);
  applyResponse(request, { action: "append", reply: "Ajoutés", tracks: [b, c] }, state);
  assert.equal(state.current.id, a.id);
  assert.deepEqual(requestFor(scenario, { message: "encore" }, state).excludeIds, [a.id, b.id, c.id]);
});
test("quota and source failures are blockers, not successes or musical judgments", () => {
  assert.equal(classifyFailure(429, { error: "occupé" }), "quota_or_busy");
  assert.equal(classifyFailure(200, { reply: "Une source de recherche n’a pas pu fournir de résultat exploitable" }), "source_unavailable");
  assert.equal(classifyFailure(200, { reply: "Je n’ai trouvé que 1 titre" }), null);
  assert.equal(classifyFailure(200, safeResponse({ reply: "Une source de recherche n’a pas pu fournir de résultat exploitable" })), "source_unavailable");
});
test("rejects raw contract violations before sanitation can normalize them", () => {
  for (const malformed of [null, [], { action: "keep", reply: 123, tracks: [] },
    { action: "keep", reply: "ok", tracks: [null] },
    { action: "replace", reply: "ok", tracks: [{ id: 12345678901, title: "numérique" }] }]) {
    assert.ok(validateResponse(malformed).length);
    assert.doesNotThrow(() => safeResponse(malformed));
  }
  assert.deepEqual(validateResponse({ action: "replace", reply: "ok", tracks: [a] }), []);
});
test("a matching track count cannot hide an unrelated requested artist", () => {
  const state = initialState({});
  const step = { expect: { action: "replace", minTracks: 1, artistAliases: ["Omer Adam", "עומר אדם"] } };
  const request = { scope: "all", rejectedIds: [], excludeIds: [] };
  assert.ok(checkResponse(step, request, { action: "replace", reply: "ok", tracks: [a] }, state).length);
  assert.deepEqual(checkResponse(step, request, { action: "replace", reply: "ok", tracks: [{ ...a, channel: "עומר אדם" }] }, state), []);
});
test("append to an empty session starts its first track in the response simulator", () => {
  const state = initialState({});
  applyResponse({ message: "prépare", rejectedIds: [] }, { action: "append", reply: "ok", tracks: [a, b] }, state);
  assert.equal(state.current.id, a.id);
  assert.deepEqual(state.queue, [b.id]);
});
test("reports discard raw envelopes and redact known tokens and Gemini keys", () => {
  const secret = "private-session-token";
  const safe = safeResponse({ action: "keep", reply: secret + " AIza" + "x".repeat(32), rawHeader: secret, tracks: [], internal: { key: secret } }, [secret]);
  assert.ok(!JSON.stringify(safe).includes(secret));
  assert.ok(!JSON.stringify(safe).includes("AIza"));
  assert.ok(!("internal" in safe));
});
test("HTML report treats model output as text, never executable markup", () => {
  const html = htmlReport({ createdAt: "today", requests: 1, results: [{ caseId: "x", status: "fail", message: '<img src=x onerror="alert(1)">', response: { reply: "<script>bad()</script>" } }] });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<img"));
});
