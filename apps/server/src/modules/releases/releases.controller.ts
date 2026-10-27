import { createRoute, z } from "@hono/zod-openapi";
import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import {
  commonErrors,
  featureRouter,
  operation,
  textResponse,
} from "../../shared/openapi.ts";

const TAG = "Lecteur et distribution";
const feedRoute = createRoute({
  method: "get",
  path: "/appcast.xml",
  ...operation({
    operationId: "getMacUpdateFeed",
    tag: TAG,
    summary: "Flux de mises à jour Mac",
    description:
      "Flux Sparkle public. Un flux vide est normal tant qu’aucune archive signée n’a été volontairement publiée. Une installation locale n’active pas automatiquement une mise à jour publique.",
    public: true,
  }),
  responses: {
    ...commonErrors(true),
    200: textResponse("application/rss+xml", "Flux Sparkle"),
    503: textResponse("text/plain", "Flux temporairement indisponible"),
  },
});
const archiveRoute = createRoute({
  method: "get",
  path: "/{archive}",
  ...operation({
    operationId: "downloadMacArchive",
    tag: TAG,
    summary: "Télécharger une archive publiée",
    description:
      "Uniquement les archives ZIP nommées Playlist-Recall-version-architecture.zip présentes dans le répertoire de publication. Le nom technique historique reste stable malgré la marque Sillage.",
    public: true,
  }),
  request: {
    params: z.object({
      archive: z
        .string()
        .regex(
          /^Playlist-Recall-[0-9]+\.[0-9]+\.[0-9]+-(arm64|x86_64|universal)\.zip$/,
        )
        .openapi({
          param: { name: "archive", in: "path" },
          description: "Nom exact de l’archive publiée",
        }),
    }),
  },
  responses: {
    ...commonErrors(true),
    200: {
      description: "Archive ZIP",
      content: {
        "application/zip": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    404: textResponse("text/plain", "Archive absente ou nom refusé"),
  },
});

/**
 * Sparkle feed and signed archives of the Mac app, served from MAC_RELEASES_DIR. Files are
 * streamed as they are, so the routes are documented here and served by plain handlers.
 */
export function releaseRoutes() {
  const app = featureRouter();
  app.openAPIRegistry.registerPath(feedRoute);
  app.openAPIRegistry.registerPath(archiveRoute);
  app.get("/appcast.xml", async (c) => {
    c.header("Cache-Control", "no-cache");
    c.header("Content-Type", "application/rss+xml; charset=utf-8");
    try {
      return c.body(
        await readFile(
          join(process.env["MAC_RELEASES_DIR"] ?? "/releases", "appcast.xml"),
          "utf8",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
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
      const path = join(process.env["MAC_RELEASES_DIR"] ?? "/releases", name);
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
