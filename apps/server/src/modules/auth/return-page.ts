/** A real browser landing page survives the handoff to the native app. No session token is
 * exposed: the short-lived grant still requires the app's PKCE verifier at /auth/exchange. */
export function googleReturnPage(callback: string, nonce: string): string {
  const href = callback.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Retour dans Sillage</title>
<style nonce="${nonce}">body{margin:0;background:#20201e;color:#f5f3ee;font:17px system-ui;display:grid;place-items:center;min-height:100vh}main{max-width:480px;padding:40px}h1{font-size:32px}p{line-height:1.6;color:#c4c2ba}a{display:inline-block;background:#f5f3ee;color:#20201e;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>Retour dans Sillage</h1><p>Google a confirmé ton identité. Termine la connexion dans l’application.</p>
<a id="return" href="${href}">Ouvrir Sillage</a>
<p id="status">Si rien ne s’ouvre, clique sur le bouton et autorise ton navigateur à ouvrir Sillage. Tu pourras ensuite fermer cet onglet.</p>
</main><script nonce="${nonce}">
const button = document.getElementById('return');
window.location.assign(button.href);
setTimeout(() => { button.removeAttribute('href'); button.textContent = 'Retourne dans Sillage pour réessayer'; document.getElementById('status').textContent = 'Ce lien a expiré. Relance la connexion depuis les réglages de Sillage.'; }, 90000);
</script></body></html>`;
}
