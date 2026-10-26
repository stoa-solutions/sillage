export type EmbeddingKind = 'query' | 'passage';

export const MODEL_ID = 'Xenova/multilingual-e5-small';
export const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const MODEL_DTYPE = 'q8' as const;
export const MODEL_DIMENSIONS = 384;
export const MODEL_FILE = 'onnx/model_quantized.onnx';
export const MODEL_KEY = `${MODEL_ID}@${MODEL_REVISION}:${MODEL_DTYPE}:mean:l2:e5-prefix-v1`;

export function prepareModelInputs(texts: readonly string[], kind: EmbeddingKind): string[] {
  if (kind !== 'query' && kind !== 'passage') throw new Error(`Unsupported embedding kind: ${String(kind)}`);
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
    throw new Error('Embedding inputs must be an array of strings.');
  }
  return texts.map((text) => `${kind}: ${text}`);
}

export function validateEmbeddingMatrix(
  value: unknown,
  expectedRows: number,
  expectedDimensions?: number,
): number[][] {
  if (!Array.isArray(value) || value.length !== expectedRows) {
    throw new Error(`Invalid embedding output: expected ${expectedRows} vectors.`);
  }
  if (expectedRows === 0) return [];

  let dimensions = expectedDimensions;
  const vectors = value.map((row, index) => {
    if (!Array.isArray(row) || row.length === 0) {
      throw new Error(`Invalid embedding output: vector ${index + 1} is empty.`);
    }
    dimensions ??= row.length;
    if (row.length !== dimensions) {
      throw new Error(`Invalid embedding output: vector ${index + 1} has ${row.length} dimensions; expected ${dimensions}.`);
    }
    if (row.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
      throw new Error(`Invalid embedding output: vector ${index + 1} contains a non-finite value.`);
    }
    const vector = row as number[];
    const norm = Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0));
    if (Math.abs(norm - 1) > 1e-3) {
      throw new Error(`Invalid embedding output: vector ${index + 1} is not normalized.`);
    }
    return [...vector];
  });

  return vectors;
}
