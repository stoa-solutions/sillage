import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { applyResponse, checkResponse, classifyFailure, initialState, requestFor, safeResponse, validateResponse } from "./behavior.mjs";
import { htmlReport } from "./report.mjs";

const { values } = parseArgs({ options: {
  live: { type: "boolean", default: false },
  suite: { type: "string", default: "smoke" },
  case: { type: "string" },
  scenarios: { type: "string" },
  "connection-file": { type: "string" },
  "max-requests": { type: "string", default: "3" },
  out: { type: "string" },
  help: { type: "boolean" },
} });

async function main() {
  if (values.help) {
    console.log(`Évaluation du vrai DJ via HTTP (aucun pilotage de l’app).
Sans --live : affiche uniquement les cas, sans lire les identifiants ni appeler le réseau.
--suite smoke|external|journal-regressions|agents|all  --case ID  --max-requests 3
--scenarios fichier.json  --out dossier
--live --connection-file fichier-privé.json
Alternative : SILLAGE_API_URL et SILLAGE_API_TOKEN dans l’environnement.
La connexion peut être un export {url,token} ou le fichier Session/session.json de Sillage.
Les requêtes réelles consomment des quotas ; aucune requête vocale ni modification de bibliothèque.`);
    return;
  }
  const path = values.scenarios ? resolve(values.scenarios) : fileURLToPath(new URL("./scenarios.json", import.meta.url));
  const scenarios = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(scenarios)) throw new Error("Le fichier de scénarios doit contenir une liste.");
  const cases = scenarios.filter((item) => values.case
    ? item.id === values.case : values.suite === "all" || item.suite === values.suite);
  if (!cases.length) throw new Error("Aucun scénario sélectionné.");
  for (const item of cases) {
    if (!item.id || !["library", "youtube", "all"].includes(item.scope) || !item.steps?.length
      || item.steps.some((step) => typeof step.message !== "string" || !["keep", "append", "replace"].includes(step.expect?.action))) {
      throw new Error("Scénario invalide : id, scope, steps et expect.action requis.");
    }
  }
  const planned = cases.reduce((sum, item) => sum + item.steps.length, 0);
  const max = Number(values["max-requests"]);
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error("max-requests doit être compris entre 1 et 20.");
  console.log(JSON.stringify({ mode: values.live ? "live" : "plan", cases: cases.map((item) => item.id), plannedRequests: planned }, null, 2));
  if (!values.live) return;
  if (planned > max) throw new Error(`${planned} requêtes prévues, plafond ${max}. Sélectionne moins de cas ou fixe --max-requests explicitement.`);

  let connection;
  if (values["connection-file"]) {
    const path = resolve(values["connection-file"]);
    if ((await stat(path)).size > 65536) throw new Error("Fichier de connexion trop volumineux.");
    const stored = JSON.parse(await readFile(path, "utf8"));
    connection = typeof stored.server === "string"
      ? JSON.parse(Buffer.from(stored.server, "base64").toString("utf8")) : stored;
  } else connection = { url: process.env.SILLAGE_API_URL, token: process.env.SILLAGE_API_TOKEN };
  if (typeof connection?.token !== "string" || connection.token.length < 16) throw new Error("Connexion privée absente ou invalide.");
  const base = new URL(connection.url);
  if (base.username || base.password || base.search || base.hash
    || (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new Error("Le serveur doit utiliser HTTPS (HTTP permis uniquement en local).");
  }
  const endpoint = (path) => new URL(path, base.origin);
  async function get(path, authenticated = false) {
    const response = await fetch(endpoint(path), {
      redirect: "error", signal: AbortSignal.timeout(15000),
      headers: authenticated ? { Authorization: `Bearer ${connection.token}` } : {},
    });
    if (!response.ok) throw new Error(`Préparation impossible (HTTP ${response.status}).`);
    return response.json();
  }
  const health = await get("/health");
  const config = await get("/v1/dj/status", true);
  const report = {
    createdAt: new Date().toISOString(), mode: "live-http", releaseBefore: health.release,
    model: config.model ?? "non retourné", requests: 0, results: [],
    scopeOfProof: "HTTP response and simulated queue effects; native player and internal live tool trace not observed",
  };
  const directory = resolve(values.out ?? `output/dj-eval/${report.createdAt.replace(/[:.]/g, "-")}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  async function save() {
    await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    await writeFile(resolve(directory, "report.html"), htmlReport(report), { mode: 0o600 });
  }
  let stopReason;
  for (const scenario of cases) {
    const state = initialState(scenario);
    let chainFailed = false;
    for (const [index, step] of scenario.steps.entries()) {
      const item = { caseId: scenario.id, scope: scenario.scope, step: index + 1, message: step.message, expected: step.expect };
      if (stopReason || chainFailed) {
        report.results.push({ ...item, status: "not_run", reason: stopReason ?? "Le tour précédent n’a pas fourni l’état requis." });
        continue;
      }
      const request = requestFor(scenario, step, state);
      const started = performance.now();
      report.requests++;
      try {
        const response = await fetch(endpoint("/v1/dj/chat"), {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(105000),
          headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const raw = await response.json();
        const safe = safeResponse(raw, [connection.token]);
        const dependency = classifyFailure(response.status, safe);
        const contractFailures = response.ok ? validateResponse(raw) : [];
        const failures = response.ok
          ? contractFailures.length ? contractFailures : checkResponse(step, request, safe, state)
          : [`HTTP ${response.status}`];
        const status = dependency ? "blocked" : failures.length ? "fail" : "pass";
        report.results.push({ ...item, status, httpStatus: response.status, elapsedMs: Math.round(performance.now() - started),
          dependency, failures, response: safe, tools: "not_observable_over_http", currentBefore: state.current?.id ?? null });
        if (status === "pass") applyResponse(request, safe, state);
        else chainFailed = true;
        if ([401, 403, 429].includes(response.status)) stopReason = "Authentification, débit ou quota : arrêt sans réessais automatiques.";
        console.log(`${status.toUpperCase()} ${scenario.id}/${index + 1} (${Math.round(performance.now() - started)} ms)`);
      } catch {
        report.results.push({ ...item, status: "blocked", reason: "Transport, délai ou format de réponse invalide.", elapsedMs: Math.round(performance.now() - started) });
        chainFailed = true;
        // An aborted server turn may still hold the per-account slot. Do not pile up requests.
        stopReason = "Transport interrompu : arrêt sans nouvelle requête.";
      }
      await save();
    }
  }
  try { report.releaseAfter = (await get("/health")).release; } catch { report.releaseAfter = "inconnu"; }
  report.releaseChanged = report.releaseBefore !== report.releaseAfter;
  await save();
  console.log(`Rapport : ${resolve(directory, "report.html")}`);
  process.exitCode = report.results.some((item) => item.status === "fail") ? 1
    : report.releaseChanged || report.results.some((item) => item.status !== "pass") ? 2 : 0;
}

main().catch(() => {
  // Errors may contain file paths, tokens or URLs from fetch/JSON; never dump them.
  console.error("Évaluation non lancée ou interrompue. Vérifie les arguments, le plafond et la connexion privée (--help).");
  process.exitCode = 2;
});
