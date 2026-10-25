import { Hono } from "hono";
import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
const archiveName = /^Playlist-Recall-[0-9]+\.[0-9]+\.[0-9]+-(arm64|x86_64|universal)\.(zip|dmg)$/;
async function currentDownload() {
  try {
    const directory = process.env.MAC_RELEASES_DIR ?? "/releases";
    const release = JSON.parse(await readFile(join(directory, "download.json"), "utf8"));
    if (typeof release.installer !== "string" || !archiveName.test(release.installer)) return null;
    const file = await stat(join(directory, release.installer));
    if (!file.isFile()) return null;
    return { installer: release.installer, notarized: release.notarized === true };
  } catch { return null; }
}
export function macosReleases() {
  const app = new Hono();
  app.get("/", async (c) => {
    const release = await currentDownload();
    c.header("Cache-Control", "no-cache");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    return c.html(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recall — ton DJ sur Mac</title><style>
      *{box-sizing:border-box}body{margin:0;background:#101d19;color:#f4f2e8;font:17px/1.65 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:64px 24px}small{letter-spacing:.16em;color:#9fc3b3}h1{font:clamp(42px,8vw,72px)/1.08 Georgia,serif;margin:24px 0}p{color:#c8d3cd}.download{display:inline-block;background:#c4e4b3;color:#14231c;text-decoration:none;font-weight:700;padding:16px 26px;border-radius:16px;margin:16px 0}ol{padding-left:24px}li{padding:12px 0}aside{margin-top:30px;padding:20px;border:1px solid #496154;border-radius:18px;font-size:14px}a{color:#c4e4b3}footer{font-size:13px;margin-top:40px;color:#a3b7ac}strong{color:#f4f2e8}
      </style></head><body><main><small>RECALL · POUR MAC</small><h1>Un mood.<br>La bonne musique.</h1><p>Tes playlists YouTube, un DJ avec qui discuter et une voix pour accompagner la suite.</p>
      ${release ? '<a class="download" href="/macos/download">Télécharger Recall pour Mac ↓</a>' : '<p>Le téléchargement est en préparation.</p>'}
      <p>macOS 14 ou plus récent · Apple Silicon et Intel</p><ol><li><strong>Installe Recall.</strong><br>Ouvre le fichier téléchargé, glisse Recall dans Applications, puis ouvre l’app.</li><li><strong>Connecte ton compte Google.</strong><br>Ta bibliothèque reste privée sur le serveur. Aucun jeton à recopier.</li><li><strong>Active ton DJ.</strong><br>Crée ta clé dans <a href="https://aistudio.google.com/api-keys" rel="noreferrer">Google AI Studio</a>, colle-la une fois dans Recall, puis ajoute le lien de ta playlist YouTube publique ou non répertoriée.</li></ol>
      ${release && !release.notarized ? '<aside><strong>Version de test pour Mac.</strong><br>Cette version n’est pas encore notarisée par Apple : macOS peut afficher un avertissement ou bloquer son ouverture. La version sans cet avertissement nécessite la signature Apple Developer. Les mises à jour automatiques ne sont pas encore publiées.</aside>' : ''}
      <footer>Chaque compte utilise sa propre clé Gemini, chiffrée sur le serveur. Google traite les demandes au DJ et les titres proposés avec le quota de cette clé ; une facturation peut être nécessaire selon le modèle. Aucun accès à tes playlists YouTube privées n’est demandé.</footer></main></body></html>`);
  });
  app.get("/download", async (c) => {
    c.header("Cache-Control", "no-store");
    const release = await currentDownload();
    if (!release) return c.text("Le téléchargement est en préparation. Réessaie plus tard.", 503);
    return c.redirect(`/macos/${release.installer}`, 302);
  });
  app.get("/appcast.xml", async (c) => {
    c.header("Cache-Control", "no-cache");
    c.header("Content-Type", "application/rss+xml; charset=utf-8");
    try {
      return c.body(
        await readFile(
          join(process.env.MAC_RELEASES_DIR ?? "/releases", "appcast.xml"),
          "utf8",
        ),
      );
    } catch (error: any) {
      if (error.code !== "ENOENT")
        return c.text("Update feed unavailable", 503);
      // Empty feed until a signed release has been deliberately published.
      return c.body(
        '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Playlist Recall pour Mac</title></channel></rss>',
      );
    }
  });
  app.get("/:archive", async (c) => {
    const name = c.req.param("archive");
    if (!archiveName.test(name))
      return c.notFound();
    try {
      const path = join(process.env.MAC_RELEASES_DIR ?? "/releases", name);
      const file = await stat(path);
      if (!file.isFile()) return c.notFound();
      c.header("Content-Length", String(file.size));
      c.header("Content-Type", name.endsWith(".dmg") ? "application/x-apple-diskimage" : "application/zip");
      c.header("Content-Disposition", `attachment; filename="${name}"`);
      c.header("Cache-Control", "public, max-age=3600");
      return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
    } catch {
      return c.notFound();
    }
  });
  return app;
}
