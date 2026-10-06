import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "apps/extension/.output/chrome-mv3");
const target = path.join(root, "extension");
const temporary = path.join(root, ".output/local-package");
const required = [
  "manifest.json",
  "library.html",
  "sidepanel.html",
  "data/library.json",
  "data/vectors.json",
  "models/Xenova/multilingual-e5-small/tokenizer.json",
  "models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx",
];
for (const file of required) {
  const info = await stat(path.join(source, file));
  if (!info.isFile() || !info.size)
    throw new Error(`Missing packaged resource: ${file}`);
}
const seed = JSON.parse(
  await readFile(path.join(source, "data/vectors.json"), "utf8"),
);
if (!seed.modelKey || !seed.vectors?.length)
  throw new Error("The personal semantic index is empty.");
const runtime = await readdir(path.join(source, "ort"));
if (
  !runtime.some((file) => file.endsWith(".wasm")) ||
  !runtime.some((file) => file.endsWith(".mjs"))
)
  throw new Error("Local ONNX runtime assets are missing.");
await mkdir(path.dirname(temporary), { recursive: true });
await rm(temporary, { recursive: true, force: true });
await cp(source, temporary, {
  recursive: true,
  filter: (file) => !file.endsWith(".part"),
});
await rm(target, { recursive: true, force: true });
await rename(temporary, target);
console.log(`Ready to load in Chrome: ${target}`);
