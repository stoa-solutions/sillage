import { MODEL_DIMENSIONS, type EmbeddingKind, validateEmbeddingMatrix } from './model';

export interface EmbeddingStatus {
  phase: 'loading' | 'ready' | 'error';
  message: string;
}

interface PendingRequest {
  expectedRows: number;
  resolve: (vectors: number[][]) => void;
  reject: (error: Error) => void;
}

interface WorkerResult {
  type: 'result';
  id: number;
  vectors: unknown;
}

interface WorkerFailure {
  type: 'error';
  id?: number;
  message: string;
}

interface WorkerStatus {
  type: 'status';
  status: EmbeddingStatus;
}

type WorkerResponse = WorkerResult | WorkerFailure | WorkerStatus;

const errorFrom = (value: unknown): Error => value instanceof Error ? value : new Error(String(value));

export class EmbeddingClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private disposed = false;
  private terminalError: Error | undefined;

  constructor(private readonly onStatus?: (status: EmbeddingStatus) => void) {
    this.worker = new Worker(new URL('./embedding-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => this.failAll(event.message || 'Embedding worker failed.');
  }

  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.disposed) return Promise.reject(new Error('Embedding client has been disposed.'));
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
      return Promise.reject(new Error('Embedding inputs must be an array of strings.'));
    }
    if (kind !== 'query' && kind !== 'passage') {
      return Promise.reject(new Error(`Unsupported embedding kind: ${String(kind)}`));
    }
    if (texts.length === 0) return Promise.resolve([]);

    const id = this.nextId++;
    return new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { expectedRows: texts.length, resolve, reject });
      this.worker.postMessage({ type: 'embed', id, texts: [...texts], kind });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.rejectPending(new Error('Embedding client has been disposed.'));
  }

  private handleMessage(response: WorkerResponse): void {
    if (!response || typeof response !== 'object' || !('type' in response)) {
      this.failAll('Embedding worker returned an invalid response.');
      return;
    }
    if (response.type === 'status') {
      this.onStatus?.(response.status);
      return;
    }
    if (response.type === 'error') {
      const error = new Error(response.message || 'Local embedding inference failed.');
      if (response.id !== undefined) {
        const request = this.pending.get(response.id);
        if (request) {
          this.pending.delete(response.id);
          request.reject(error);
        }
      } else {
        this.failAll(error.message);
        return;
      }
      this.onStatus?.({ phase: 'error', message: error.message });
      return;
    }

    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    try {
      request.resolve(validateEmbeddingMatrix(response.vectors, request.expectedRows, MODEL_DIMENSIONS));
    } catch (error) {
      request.reject(errorFrom(error));
    }
  }

  private failAll(message: string): void {
    if (this.terminalError) return;
    const error = new Error(message);
    this.terminalError = error;
    this.worker.terminate();
    this.rejectPending(error);
    this.onStatus?.({ phase: 'error', message });
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
