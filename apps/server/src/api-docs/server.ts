import { serve } from "@hono/node-server";
import { createDocsApp } from "./app.ts";
import {
  activeDeveloperConnection,
  developerFile,
} from "./developer-access.ts";
import { rm } from "node:fs/promises";

const port = Number(process.env.RECALL_DOCS_PORT ?? 3030);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Port local invalide.");
serve(
  {
    fetch: createDocsApp(process.env.RECALL_DOCS_API_URL, fetch, {
      read: () =>
        activeDeveloperConnection(
          new URL(
            process.env.RECALL_DOCS_API_URL ?? "https://recall.stoa.solutions",
          ).origin,
        ),
      clear: () => rm(developerFile(), { force: true }),
    }).fetch,
    hostname: "127.0.0.1",
    port,
  },
  () => {
    console.log(`Documentation Sillage locale : http://127.0.0.1:${port}`);
  },
);
