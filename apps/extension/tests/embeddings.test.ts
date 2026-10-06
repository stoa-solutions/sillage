import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingClient } from '../src/embeddings';
import { prepareModelInputs, validateEmbeddingMatrix } from '../src/model';

interface WorkerRequest {
  type: 'embed';
  id: number;
  texts: string[];
  kind: 'query' | 'passage';
}

class FakeWorker {
  static latest: FakeWorker | undefined;

  readonly messages: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(message: WorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  emitFatal(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const unitVector = (): number[] => Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0);

beforeEach(() => {
  FakeWorker.latest = undefined;
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('E5 model input preparation', () => {
  it('uses the query prefix for every multilingual search text', () => {
    expect(prepareModelInputs(['dîner en amoureux', 'romantic dinner'], 'query')).toEqual([
      'query: dîner en amoureux',
      'query: romantic dinner',
    ]);
  });

  it('uses the passage prefix without inventing content for an empty source document', () => {
    expect(prepareModelInputs(['Venetian Night Jazz', ''], 'passage')).toEqual([
      'passage: Venetian Night Jazz',
      'passage: ',
    ]);
  });
});

describe('embedding output validation', () => {
  it('accepts a finite, consistently-sized, normalized matrix', () => {
    expect(validateEmbeddingMatrix([[1, 0], [0.6, 0.8]], 2)).toEqual([
      [1, 0],
      [0.6, 0.8],
    ]);
  });

  it.each([
    { name: 'wrong row count', value: [[1, 0]], count: 2 },
    { name: 'empty vectors', value: [[]], count: 1 },
    { name: 'inconsistent dimensions', value: [[1, 0], [1]], count: 2 },
    { name: 'non-finite values', value: [[Number.NaN, 0]], count: 1 },
    { name: 'unnormalized vectors', value: [[2, 0]], count: 1 },
  ])('rejects $name from the inference boundary', ({ value, count }) => {
    expect(() => validateEmbeddingMatrix(value, count)).toThrow(/embedding/i);
  });
});

describe('EmbeddingClient', () => {
  it('forwards worker statuses and resolves validated vectors by request id', async () => {
    const statuses: Array<{ phase: 'loading' | 'ready' | 'error'; message: string }> = [];
    const client = new EmbeddingClient((status) => statuses.push(status));
    const worker = FakeWorker.latest!;

    worker.emit({ type: 'status', status: { phase: 'loading', message: 'Loading local model' } });
    worker.emit({ type: 'status', status: { phase: 'ready', message: 'Local model ready' } });
    const result = client.embed(['bonjour'], 'query');

    expect(worker.messages).toEqual([
      { type: 'embed', id: 1, texts: ['bonjour'], kind: 'query' },
    ]);

    const vector = unitVector();
    worker.emit({ type: 'result', id: 1, vectors: [vector] });

    await expect(result).resolves.toEqual([vector]);
    expect(statuses).toEqual([
      { phase: 'loading', message: 'Loading local model' },
      { phase: 'ready', message: 'Local model ready' },
    ]);
  });

  it('rejects malformed worker output instead of returning corrupt search vectors', async () => {
    const client = new EmbeddingClient();
    const worker = FakeWorker.latest!;
    const result = client.embed(['one', 'two'], 'passage');

    worker.emit({ type: 'result', id: 1, vectors: [[1, 0]] });

    await expect(result).rejects.toThrow(/embedding/i);
  });

  it('rejects a failed inference and reports the worker error status', async () => {
    const onStatus = vi.fn();
    const client = new EmbeddingClient(onStatus);
    const worker = FakeWorker.latest!;
    const result = client.embed(['bonjour'], 'query');

    worker.emit({ type: 'error', id: 1, message: 'Local inference failed' });

    await expect(result).rejects.toThrow('Local inference failed');
    expect(onStatus).toHaveBeenLastCalledWith({ phase: 'error', message: 'Local inference failed' });
  });

  it('terminates the worker and rejects pending and future requests after disposal', async () => {
    const client = new EmbeddingClient();
    const worker = FakeWorker.latest!;
    const pending = client.embed(['bonjour'], 'query');

    client.dispose();

    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toThrow(/disposed/i);
    await expect(client.embed(['encore'], 'query')).rejects.toThrow(/disposed/i);
  });

  it('rejects future requests immediately after the worker fatally crashes', async () => {
    const client = new EmbeddingClient();
    const worker = FakeWorker.latest!;
    const pending = client.embed(['bonjour'], 'query');
    const pendingExpectation = expect(pending).rejects.toThrow('Embedding worker crashed');

    worker.emitFatal('Embedding worker crashed');
    const future = client.embed(['encore'], 'query');
    const futureExpectation = expect(future).rejects.toThrow('Embedding worker crashed');

    expect(worker.messages).toHaveLength(1);
    await pendingExpectation;
    client.dispose();
    await futureExpectation;
  });
});
