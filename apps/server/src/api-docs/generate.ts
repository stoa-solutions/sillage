import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { artifacts } from "./artifacts.ts";
import { stringify } from "yaml";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const check = process.argv.includes("--check");
let stale = false;
for (const [path, value] of Object.entries(artifacts())) {
  const filename = resolve(root, path);
  const content = path.endsWith(".yaml")
    ? stringify(value, { lineWidth: 120 })
    : `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if ((await readFile(filename, "utf8").catch(() => "")) !== content) {
      console.error(`À régénérer : ${path}`);
      stale = true;
    }
  } else {
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, content);
    console.log(path);
  }
}
if (stale) process.exitCode = 1;
if (!check) {
  const manifest = resolve(root, ".postman/resources.yaml");
  try {
    await writeFile(manifest, await readFile(resolve(root, ".postman/resources.example.yaml")), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
