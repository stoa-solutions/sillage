import { env, pipeline } from '@huggingface/transformers';
import {
  MODEL_DIMENSIONS,
  MODEL_DTYPE,
  MODEL_ID,
  MODEL_REVISION,
  prepareModelInputs,
  type EmbeddingKind,
  validateEmbeddingMatrix,
} from './model';
import type { EmbeddingStatus } from './embeddings';

interface EmbedRequest {
  type: 'embed';
  id: number;
  texts: string[];
  kind: EmbeddingKind;
}

type WorkerResponse =
  | { type: 'status'; status: EmbeddingStatus }
  | { type: 'result'; id: number; vectors: number[][] }
  | { type: 'error'; id: number; message: string };

interface TensorOutput {
  tolist(): unknown;
}

interface Extractor {
  (texts: string[], options: { pooling: 'mean'; normalize: true }): Promise<TensorOutput>;
}

const workerScope = globalThis as unknown as {
  location: Location;
  postMessage(message: WorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<EmbedRequest>) => void): void;
};

const postStatus = (phase: EmbeddingStatus['phase'], message: string): void => {
  workerScope.postMessage({ type: 'status', status: { phase, message } });
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

let extractorPromise: Promise<Extractor> | undefined;

function loadExtractor(): Promise<Extractor> {
  if (extractorPromise) return extractorPromise;

  postStatus('loading', 'Chargement du modèle sémantique local…');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = new URL('/models/', workerScope.location.href).href;
  env.useBrowserCache = false;
  const wasm = env.backends.onnx.wasm;
  if (!wasm) throw new Error('ONNX Runtime WASM is unavailable.');
  wasm.wasmPaths = new URL('/ort/', workerScope.location.href).href;
  wasm.numThreads = 1;

  extractorPromise = pipeline('feature-extraction', MODEL_ID, {
    revision: MODEL_REVISION,
    dtype: MODEL_DTYPE,
    device: 'wasm',
  }).then((extractor) => {
    postStatus('ready', 'Modèle sémantique local prêt.');
    return extractor as unknown as Extractor;
  }).catch((error: unknown) => {
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
}

async function handleRequest(request: EmbedRequest): Promise<void> {
  try {
    const inputs = prepareModelInputs(request.texts, request.kind);
    const extractor = await loadExtractor();
    const output = await extractor(inputs, { pooling: 'mean', normalize: true });
    const vectors = validateEmbeddingMatrix(output.tolist(), inputs.length, MODEL_DIMENSIONS);
    workerScope.postMessage({ type: 'result', id: request.id, vectors });
  } catch (error) {
    workerScope.postMessage({ type: 'error', id: request.id, message: errorMessage(error) });
  }
}

let inferenceQueue = Promise.resolve();

workerScope.addEventListener('message', (event) => {
  if (event.data?.type !== 'embed') return;
  const request = event.data;
  inferenceQueue = inferenceQueue.then(
    () => handleRequest(request),
    () => handleRequest(request),
  );
});
