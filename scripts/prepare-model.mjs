import { createHash } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MODEL_FILE, MODEL_ID, MODEL_REVISION } from '../src/model.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const modelRoot = path.join(projectRoot, 'public', 'models', ...MODEL_ID.split('/'));
const ortSource = path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist');
const ortTarget = path.join(projectRoot, 'public', 'ort');
const downloadCache = path.join(projectRoot, '.cache', 'model-downloads', ...MODEL_ID.split('/'));
const hubRoot = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/`;
setDefaultResultOrder('ipv4first');

const modelFiles = [
  { name: MODEL_FILE, size: 118_308_185, sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' },
  { name: 'config.json', size: 658 },
  { name: 'tokenizer.json', size: 17_082_730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
  { name: 'tokenizer_config.json', size: 443 },
  { name: 'special_tokens_map.json', size: 167 },
  { name: 'sentencepiece.bpe.model', size: 5_069_051, sha256: 'cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865' },
];

async function fileSize(filename) {
  try {
    return (await stat(filename)).size;
  } catch (error) {
    if (error?.code === 'ENOENT') return -1;
    throw error;
  }
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function isComplete(filename, spec) {
  if (await fileSize(filename) !== spec.size) return false;
  return !spec.sha256 || await sha256(filename) === spec.sha256;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function downloadSingle(spec, target) {
  const partial = `${target}.part`;
  let offset = await fileSize(partial);
  if (offset < 0) offset = 0;
  if (offset > spec.size) {
    await unlink(partial);
    offset = 0;
  }
  if (offset === spec.size && await isComplete(partial, spec)) {
    await rename(partial, target);
    console.log(`Recovered ${spec.name} from completed partial download`);
    return;
  }

  console.log(`${offset ? 'Resuming' : 'Downloading'} ${spec.name}`);
  const response = await fetch(`${hubRoot}${spec.name}?download=true&t=${Date.now()}`, {
    headers: offset ? { Range: `bytes=${offset}-` } : {},
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${spec.name}: HTTP ${response.status}`);
  }

  const append = offset > 0 && response.status === 206;
  await streamPipeline(
    Readable.fromWeb(response.body),
    createWriteStream(partial, { flags: append ? 'a' : 'w' }),
  );
  if (!await isComplete(partial, spec)) {
    throw new Error(`Downloaded ${spec.name} failed its size or SHA-256 check.`);
  }
  await rename(partial, target);
}

async function downloadChunk(spec, index, count) {
  const start = Math.floor(index * spec.size / count);
  const end = index === count - 1 ? spec.size - 1 : Math.floor((index + 1) * spec.size / count) - 1;
  const expectedSize = end - start + 1;
  const directory = path.join(downloadCache, `${spec.name}.parts`);
  const filename = path.join(directory, `part.${index}`);
  await mkdir(directory, { recursive: true });

  let attempts = 0;
  while (await fileSize(filename) !== expectedSize) {
    let currentSize = await fileSize(filename);
    if (currentSize < 0) currentSize = 0;
    if (currentSize > expectedSize) {
      await unlink(filename);
      currentSize = 0;
    }
    if (attempts++ >= 100) throw new Error(`Failed to download ${spec.name} part ${index + 1}/${count}.`);

    try {
      const rangeStart = start + currentSize;
      const requestEnd = Math.min(rangeStart + 256 * 1024 - 1, end);
      const response = await fetch(`${hubRoot}${spec.name}?download=true&t=${Date.now()}-${index}-${attempts}`, {
        headers: { Range: `bytes=${rangeStart}-${requestEnd}` },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 206 || !response.body) {
        throw new Error(`HTTP ${response.status}; byte ranges are required.`);
      }
      const contentRange = response.headers.get('content-range');
      if (!contentRange?.startsWith(`bytes ${rangeStart}-${requestEnd}/`)) {
        throw new Error(`Unexpected Content-Range: ${contentRange}`);
      }
      await streamPipeline(
        Readable.fromWeb(response.body),
        createWriteStream(filename, { flags: currentSize ? 'a' : 'w' }),
      );
    } catch (error) {
      console.warn(`Retrying ${spec.name} part ${index + 1}/${count}: ${error.message}`);
      await delay(Math.min(attempts * 500, 3_000));
    }
  }
}

async function runConcurrent(count, concurrency, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (next < count) {
      const index = next++;
      await task(index);
    }
  }));
}

async function downloadInParts(spec, target) {
  const count = spec.size > 100_000_000 ? 32 : 16;
  console.log(`Downloading ${spec.name} in ${count} resumable parts`);
  await runConcurrent(count, 8, (index) => downloadChunk(spec, index, count));

  const partial = `${target}.part`;
  const output = await open(partial, 'w');
  try {
    for (let index = 0; index < count; index += 1) {
      const filename = path.join(downloadCache, `${spec.name}.parts`, `part.${index}`);
      for await (const chunk of createReadStream(filename)) await output.write(chunk);
    }
  } finally {
    await output.close();
  }
  if (!await isComplete(partial, spec)) {
    throw new Error(`Assembled ${spec.name} failed its size or SHA-256 check.`);
  }
  await rename(partial, target);
}

async function download(spec) {
  const target = path.join(modelRoot, ...spec.name.split('/'));
  if (await isComplete(target, spec)) {
    console.log(`Reusing ${spec.name}`);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  if (spec.size > 1_000_000) await downloadInParts(spec, target);
  else await downloadSingle(spec, target);
}

async function copyOrtAssets() {
  const names = (await readdir(ortSource)).filter((name) => /^ort-wasm.*\.(?:mjs|wasm)$/.test(name));
  if (!names.length) throw new Error(`No ONNX Runtime web assets found in ${ortSource}`);
  await mkdir(ortTarget, { recursive: true });
  for (const name of names) {
    const source = path.join(ortSource, name);
    const target = path.join(ortTarget, name);
    if (await fileSize(target) === await fileSize(source)) {
      console.log(`Reusing ort/${name}`);
      continue;
    }
    const partial = `${target}.part`;
    await copyFile(source, partial);
    await rename(partial, target);
    console.log(`Copied ort/${name}`);
  }
}

for (const spec of modelFiles) await download(spec);
await copyOrtAssets();
console.log(`Prepared ${MODEL_ID}@${MODEL_REVISION} and local ONNX Runtime assets.`);
