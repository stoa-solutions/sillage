import { serve } from "@hono/node-server";
import { createDocsApp } from "./app.ts";

const port = Number(process.env.RECALL_DOCS_PORT ?? 3030);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Port local invalide.");
serve(
  {
    fetch: createDocsApp(process.env.RECALL_DOCS_API_URL).fetch,
    hostname: "127.0.0.1",
    port,
  },
  () => {
    console.log(`Documentation Sillage locale : http://127.0.0.1:${port}`);
  },
);
