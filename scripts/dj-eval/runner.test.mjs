import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./run.mjs", import.meta.url));
const secret = "test-private-token-not-for-reports";
async function runFixture(t, replies, options = []) {
  const directory = await mkdtemp(join(tmpdir(), "recall-eval-test-"));
  let chats = 0;
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    if (req.url !== "/health") assert.equal(req.headers.authorization, `Bearer ${secret}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/health") return res.end(JSON.stringify({ release: "fixture-sha" }));
    if (req.url === "/v1/dj/status") return res.end(JSON.stringify({ model: "fixture-model" }));
    assert.equal(req.url, "/v1/dj/chat");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).scope, "library");
    const reply = replies[chats++];
    res.statusCode = reply.status;
    res.end(JSON.stringify(reply.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const scenarioFile = join(directory, "scenarios.json");
  await writeFile(scenarioFile, JSON.stringify(replies.map((_, index) => ({
    id: `fixture-${index}`, suite: "smoke", scope: "library",
    steps: [{ message: "propose", expect: { action: "keep", minCards: 1 } }],
  }))));
  let result;
  try {
    result = { code: 0, ...await exec(process.execPath, [cli, "--scenarios", scenarioFile, "--out", join(directory, "report"), ...options], {
      timeout: 10000,
      env: { ...process.env, RECALL_API_TOKEN: secret, RECALL_API_URL: `http://127.0.0.1:${server.address().port}` },
    }) };
  } catch (error) { result = error; }
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  let report;
  try { report = JSON.parse(await readFile(join(directory, "report/report.json"), "utf8")); } catch {}
  assert.ok(!JSON.stringify(report)?.includes(secret));
  return { code: result.code, chats, requests, report };
}

const ok = { status: 200, body: { action: "keep", reply: "Voici", tracks: [], discoveries: [
  { video: { id: "library0001", title: "Titre", channel: "Artiste" }, inLibrary: true },
] } };
test("plan mode never calls the network; live mode exercises the HTTP contract", async (t) => {
  const dry = await runFixture(t, [ok]);
  assert.equal(dry.code, 0);
  assert.equal(dry.requests, 0);
  const live = await runFixture(t, [ok], ["--live"]);
  assert.equal(live.code, 0);
  assert.equal(live.chats, 1);
  assert.equal(live.report.results[0].status, "pass");
  assert.equal(live.report.releaseChanged, false);
});
test("live quota stops further calls and cannot count as a successful scenario", async (t) => {
  const result = await runFixture(t, [{ status: 429, body: { error: "quota" } }, ok], ["--live"]);
  assert.equal(result.code, 2);
  assert.equal(result.chats, 1);
  assert.deepEqual(result.report.results.map((item) => item.status), ["blocked", "not_run"]);
});
test("HTTP 200 invalid contracts fail rather than becoming transport blockers", async (t) => {
  const result = await runFixture(t, [{ status: 200, body: { action: "keep", reply: 123, tracks: [null] } }], ["--live"]);
  assert.equal(result.code, 1);
  assert.equal(result.report.results[0].status, "fail");
  assert.ok(result.report.results[0].failures.includes("tracks invalide"));
});
test("request cap is enforced before authentication or network traffic", async (t) => {
  const result = await runFixture(t, [ok, ok], ["--live", "--max-requests", "1"]);
  assert.equal(result.code, 2);
  assert.equal(result.requests, 0);
});
