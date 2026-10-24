import { Hono } from "hono";
import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
export function macosReleases() {
  const app = new Hono();
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
    if (
      !/^Playlist-Recall-[0-9]+\.[0-9]+\.[0-9]+-(arm64|x86_64|universal)\.zip$/.test(
        name,
      )
    )
      return c.notFound();
    try {
      const path = join(process.env.MAC_RELEASES_DIR ?? "/releases", name);
      const file = await stat(path);
      if (!file.isFile()) return c.notFound();
      c.header("Content-Length", String(file.size));
      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${name}"`);
      c.header("Cache-Control", "public, max-age=3600");
      return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
    } catch {
      return c.notFound();
    }
  });
  return app;
}
