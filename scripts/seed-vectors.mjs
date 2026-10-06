import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { buildDocument, parseImport } from '../packages/core/src/import.ts';
import {
  MODEL_DIMENSIONS,
  MODEL_DTYPE,
  MODEL_ID,
  MODEL_KEY,
  MODEL_REVISION,
  prepareModelInputs,
  validateEmbeddingMatrix,
} from '../packages/core/src/model.ts';

const BATCH_SIZE = 16;
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const libraryPath = path.join(projectRoot, 'apps', 'extension', 'public', 'data', 'library.json');
const vectorsPath = path.join(projectRoot, 'apps', 'extension', 'public', 'data', 'vectors.json');
const temporaryPath = `${vectorsPath}.part`;

const source = JSON.parse(await readFile(libraryPath, 'utf8'));
const library = parseImport(source);
const documents = library.videos
  .map((video) => ({ id: video.id, text: buildDocument(video) }))
  .filter(({ text }) => text.length > 0);

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${path.join(projectRoot, 'apps', 'extension', 'public', 'models')}${path.sep}`;

console.log(`Loading local ${MODEL_ID} q8 model for ${documents.length} videos…`);
const extractor = await pipeline('feature-extraction', MODEL_ID, {
  revision: MODEL_REVISION,
  dtype: MODEL_DTYPE,
  device: 'cpu',
});

const vectors = [];
try {
  for (let start = 0; start < documents.length; start += BATCH_SIZE) {
    const batch = documents.slice(start, start + BATCH_SIZE);
    const inputs = prepareModelInputs(batch.map(({ text }) => text), 'passage');
    const output = await extractor(inputs, { pooling: 'mean', normalize: true });
    const matrix = validateEmbeddingMatrix(output.tolist(), batch.length, MODEL_DIMENSIONS);
    for (let index = 0; index < batch.length; index += 1) {
      vectors.push({ id: batch[index].id, modelKey: MODEL_KEY, text: batch[index].text, vector: matrix[index] });
    }
    console.log(`Embedded ${Math.min(start + BATCH_SIZE, documents.length)}/${documents.length}`);
  }
} finally {
  await extractor.dispose();
}

if (vectors.length !== documents.length) {
  throw new Error(`Vector seed is incomplete: expected ${documents.length}, wrote ${vectors.length}.`);
}

await writeFile(temporaryPath, JSON.stringify({ modelKey: MODEL_KEY, vectors }));
await rename(temporaryPath, vectorsPath);
console.log(`Wrote ${vectors.length} vectors to ${vectorsPath}`);
