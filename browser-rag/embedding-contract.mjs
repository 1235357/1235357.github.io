export const EMBEDDING_SPEC = Object.freeze({
  modelId: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  tokenizerModelId: 'Xenova/all-MiniLM-L6-v2',
  tokenizerRevision: '751bff37182d3f1213fa05d7196b954e230abad9',
  pooling: 'attention-mask-mean', normalization: 'l2', dtype: 'fp32', device: 'webgpu',
  dimensions: 384, maxTokens: 256, maxChunks: 512, batchSize: 1, maxTotalTokens: 131072,
  version: 'miniLM-fp32-mean-l2-webgpu-v1',
});

const MESSAGES = Object.freeze({
  INVALID_EMBEDDING: 'The embedding vectors are invalid.',
  ENCODER_INPUT_LIMIT: 'The encoder input is invalid or exceeds its token budget.',
  INVALID_EMBEDDING_CONFIG: 'The embedding configuration is invalid.',
});

export class EmbeddingError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code)
      ? code : 'INVALID_EMBEDDING_CONFIG';
    super(MESSAGES[safe]); this.name = 'EmbeddingError'; this.code = safe;
  }
}
const fail = code => { throw new EmbeddingError(code); };

// Total IDs include the tokenizer's special tokens. The validator does not
// infer token semantics, truncate text, load a model or perform inference.
export function validateTokenIds(ids) {
  try {
    if (!Array.isArray(ids)) fail('ENCODER_INPUT_LIMIT');
    const length = ids.length;
    if (!Number.isSafeInteger(length) || length < 3 || length > EMBEDDING_SPEC.maxTokens) {
      fail('ENCODER_INPUT_LIMIT');
    }
    const copied = [];
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(ids, index)) fail('ENCODER_INPUT_LIMIT');
      const id = ids[index];
      if (!Number.isSafeInteger(id) || id < 0) fail('ENCODER_INPUT_LIMIT');
      copied.push(id);
    }
    return Object.freeze(copied);
  } catch {
    throw new EmbeddingError('ENCODER_INPUT_LIMIT');
  }
}

// Validate bounded, already-normalized numerical output; never repair it.
// Returned arrays belong to the caller without retaining encoder buffers.
export function acceptEmbeddingVectors(rows, expectedCount) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1
      || expectedCount > EMBEDDING_SPEC.maxChunks) fail('INVALID_EMBEDDING_CONFIG');
  try {
    if (!Array.isArray(rows) || rows.length !== expectedCount) fail('INVALID_EMBEDDING');
    const copied = [];
    for (let rowIndex = 0; rowIndex < expectedCount; rowIndex++) {
      if (!Object.hasOwn(rows, rowIndex)) fail('INVALID_EMBEDDING');
      const row = rows[rowIndex];
      if (!Array.isArray(row) || row.length !== EMBEDDING_SPEC.dimensions) fail('INVALID_EMBEDDING');
      const vector = [];
      let squaredNorm = 0;
      for (let index = 0; index < EMBEDDING_SPEC.dimensions; index++) {
        if (!Object.hasOwn(row, index)) fail('INVALID_EMBEDDING');
        const value = row[index];
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_EMBEDDING');
        squaredNorm += value * value;
        vector.push(value);
      }
      if (Math.abs(Math.sqrt(squaredNorm) - 1) > 1e-4) fail('INVALID_EMBEDDING');
      copied.push(Object.freeze(vector));
    }
    return Object.freeze(copied);
  } catch {
    throw new EmbeddingError('INVALID_EMBEDDING');
  }
}
