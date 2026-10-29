import { readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

// Production runs plain JavaScript: no TypeScript compiler in memory at start-up.
// Dependencies stay in node_modules, except the workspace's own TypeScript package.
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const external = Object.keys(manifest.dependencies).filter(
  (name) => !name.startsWith("@sillage/"),
);

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: [
    "src/boot.ts",
    "src/main.ts",
    "src/worker.ts",
    "src/inference.ts",
    "src/model-process.ts",
    "src/migrate.ts",
    "src/modules/auth/token.cli.ts",
    "src/modules/jobs/jobs.cli.ts",
  ],
  outdir: "dist",
  outbase: "src",
  entryNames: "[dir]/[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external,
  sourcemap: "linked",
  logLevel: "warning",
});
