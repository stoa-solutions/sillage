const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

export function htmlReport(report) {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Recall · Évaluation du DJ</title><style>
:root{color-scheme:dark}body{font:16px/1.55 system-ui;margin:40px auto;padding:0 24px;max-width:1080px;background:#141615;color:#eee}h1{font-size:34px}small,.muted{color:#adb5b0}article{padding:24px;margin:18px 0;border-radius:16px;background:#222723}header{display:flex;justify-content:space-between;gap:20px}h2{margin:0;font-size:20px}.pass{color:#9be0b6}.fail{color:#ffad99}.blocked,.not_run{color:#f4d78c}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}li{margin:6px 0}summary{cursor:pointer}code{overflow-wrap:anywhere}a{color:#9be0b6}
</style><h1>Recall · Évaluation du DJ</h1>
<p>${escape(report.createdAt)} · serveur <code>${escape(report.releaseBefore)}</code> · modèle ${escape(report.model)}</p>
<p>${report.results.filter((item) => item.status === "pass").length} réussis · ${report.results.filter((item) => item.status === "fail").length} écarts · ${report.results.filter((item) => item.status === "blocked").length} bloqués · ${report.requests} requêtes</p>
<p class="muted">Vrais appels au chat HTTP. Aucun son lancé, aucune playlist modifiée. Les effets de file sont simulés à partir des réponses ; le lecteur Swift n’est pas exécuté. Les outils internes ne sont pas observables par cette API : leur routage est couvert séparément par les tests MCP. Une réponse structurellement correcte ne prouve pas la qualité musicale.</p>
${report.results.map((item) => `<article><header><h2>${escape(item.caseId)} · tour ${item.step}</h2><b class="${escape(item.status)}">${escape(item.status)}</b></header>
<small>${escape(item.scope)} · ${item.elapsedMs ?? 0} ms</small><p>${escape(item.message)}</p>
<blockquote>${escape(item.response?.reply || item.reason || item.response?.error)}</blockquote>
${item.failures?.length ? `<ul>${item.failures.map((failure) => `<li>${escape(failure)}</li>`).join("")}</ul>` : ""}
<details><summary>Réponse et vérifications</summary><pre>${escape(JSON.stringify(item, null, 2))}</pre></details></article>`).join("")}
<p class="muted">Version après test : ${escape(report.releaseAfter)}. ${report.releaseChanged ? "ATTENTION : le serveur a changé pendant le test." : ""}</p></html>`;
}
