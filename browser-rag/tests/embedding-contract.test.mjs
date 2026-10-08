import test from 'node:test';
import assert from 'node:assert/strict';
import { EMBEDDING_SPEC, EmbeddingError, validateTokenIds, acceptEmbeddingVectors } from '../embedding-contract.mjs';

const MESSAGES = {
  INVALID_EMBEDDING: 'The embedding vectors are invalid.',
  ENCODER_INPUT_LIMIT: 'The encoder input is invalid or exceeds its token budget.',
  INVALID_EMBEDDING_CONFIG: 'The embedding configuration is invalid.',
};
const fixedError = code => error => error instanceof EmbeddingError
  && error.name === 'EmbeddingError' && error.code === code && error.message === MESSAGES[code];
function vector(first = 1) {
  const row = Array(384).fill(0); row[0] = first; return row;
}

test('the frozen spec binds the model, tokenizer and complete numerical budget', () => {
  assert.deepEqual(EMBEDDING_SPEC, {
    modelId: 'Xenova/all-MiniLM-L6-v2',
    revision: '751bff37182d3f1213fa05d7196b954e230abad9',
    tokenizerModelId: 'Xenova/all-MiniLM-L6-v2',
    tokenizerRevision: '751bff37182d3f1213fa05d7196b954e230abad9',
    pooling: 'attention-mask-mean', normalization: 'l2', dtype: 'fp32', device: 'webgpu',
    dimensions: 384, maxTokens: 256, maxChunks: 512, batchSize: 1, maxTotalTokens: 131072,
    version: 'miniLM-fp32-mean-l2-webgpu-v1',
  });
  assert.equal(Object.isFrozen(EMBEDDING_SPEC), true);
  assert.throws(() => { EMBEDDING_SPEC.maxTokens = 999; }, TypeError);
});

test('EmbeddingError exposes only its fixed code and message vocabulary', () => {
  for (const code of Object.keys(MESSAGES)) {
    const error = new EmbeddingError(code);
    assert.equal(fixedError(code)(error), true);
    assert.equal(error instanceof Error, true);
  }
  for (const code of ['private filename.pdf', '__proto__', 'constructor', null, undefined,
    1, {}, Object.create(null), { toString() { throw new Error('private diagnostic'); } }]) {
    assert.equal(fixedError('INVALID_EMBEDDING_CONFIG')(new EmbeddingError(code)), true);
  }
});

test('token IDs at both length boundaries are detached and frozen', () => {
  for (const length of [3, 256]) {
    const ids = Array(length).fill(1); ids[0] = 0; ids[length - 1] = Number.MAX_SAFE_INTEGER;
    const accepted = validateTokenIds(ids);
    assert.deepEqual(accepted, ids);
    assert.notEqual(accepted, ids);
    assert.equal(Object.isFrozen(accepted), true);
    ids[1] = 7;
    assert.equal(accepted[1], 1);
    assert.throws(() => { accepted[1] = 8; }, TypeError);
  }
});

test('token IDs reject wrong containers and lengths, including special-token slots', () => {
  for (const ids of [null, undefined, '101 2 102', {}, Object.create(null),
    { 0: 101, 1: 2, 2: 102, length: 3 }, new Uint32Array([101, 2, 102]),
    [], [101], [101, 102], Array(257).fill(1)]) {
    assert.throws(() => validateTokenIds(ids), fixedError('ENCODER_INPUT_LIMIT'));
  }
});

test('token IDs reject sparse arrays even when a prototype supplies the hole', () => {
  const sparse = [101, , 102];
  const inherited = [101, , 102]; Object.setPrototypeOf(inherited, { 1: 7 });
  for (const ids of [sparse, inherited]) {
    assert.throws(() => validateTokenIds(ids), fixedError('ENCODER_INPUT_LIMIT'));
  }
});

test('token IDs must all be nonnegative safe integers', () => {
  for (const id of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    '7', null, undefined, true, 1n, {}, Object.create(null)]) {
    assert.throws(() => validateTokenIds([101, id, 102]), fixedError('ENCODER_INPUT_LIMIT'));
  }
});

test('token length is refused before reading an oversized array', () => {
  let reads = 0;
  const ids = Array(257);
  Object.defineProperty(ids, 0, { get() { reads++; throw new Error('private document text'); } });
  assert.throws(() => validateTokenIds(ids), fixedError('ENCODER_INPUT_LIMIT'));
  assert.equal(reads, 0);
});

test('unreadable token values yield a fixed error without private diagnostics', () => {
  const ids = [101, 1, 102];
  Object.defineProperty(ids, 1, { get() { throw new Error('private document text'); } });
  assert.throws(() => validateTokenIds(ids), fixedError('ENCODER_INPUT_LIMIT'));
});

test('accepted unit vectors are deeply frozen copies without normalization', () => {
  const shared = vector(-1); const rows = [shared, shared];
  const accepted = acceptEmbeddingVectors(rows, 2);
  assert.deepEqual(accepted, rows);
  assert.notEqual(accepted, rows);
  assert.notEqual(accepted[0], shared);
  assert.notEqual(accepted[0], accepted[1]);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(accepted.every(Object.isFrozen), true);
  shared[0] = 0; rows.length = 0;
  assert.equal(accepted[0][0], -1);
  assert.throws(() => { accepted[0][0] = 0; }, TypeError);
  assert.throws(() => { accepted.push(vector()); }, TypeError);
});

test('the maximum chunk count is accepted', () => {
  const denseUnit = Array(384).fill(1 / Math.sqrt(384));
  const accepted = acceptEmbeddingVectors(Array(512).fill(denseUnit), 512);
  assert.equal(Array.isArray(accepted), true);
  assert.equal(accepted.length, 512);
  assert.equal(accepted.every(row => row.length === 384 && Object.isFrozen(row)), true);
  assert.deepEqual(accepted[0], denseUnit);
});

test('invalid expected counts are refused before any row access', () => {
  let reads = 0;
  const rows = [];
  Object.defineProperty(rows, 0, { get() { reads++; throw new Error('private diagnostic'); } });
  for (const count of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    513, '1', null, undefined, true, {}, Object.create(null)]) {
    assert.throws(() => acceptEmbeddingVectors(rows, count), fixedError('INVALID_EMBEDDING_CONFIG'));
  }
  assert.equal(reads, 0);
});

test('vector rows require dense arrays and the exact expected outer count', () => {
  const inherited = Array(1); Object.setPrototypeOf(inherited, { 0: vector() });
  for (const rows of [null, undefined, {}, Object.create(null), new Float32Array(384),
    { 0: vector(), length: 1 }, [], [vector(), vector()], Array(1), inherited]) {
    assert.throws(() => acceptEmbeddingVectors(rows, 1), fixedError('INVALID_EMBEDDING'));
  }
});

test('each vector has exactly 384 own numeric slots', () => {
  const sparse = vector(); delete sparse[383];
  const inherited = vector(); delete inherited[1]; Object.setPrototypeOf(inherited, { 1: 0 });
  for (const row of [null, undefined, {}, Object.create(null), new Float32Array(384),
    vector().slice(0, 383), [...vector(), 0], sparse, inherited]) {
    assert.throws(() => acceptEmbeddingVectors([row], 1), fixedError('INVALID_EMBEDDING'));
  }
});

test('zero, nonfinite, overflowing and nonnumeric vectors are refused', () => {
  assert.throws(() => acceptEmbeddingVectors([vector(0)], 1), fixedError('INVALID_EMBEDDING'));
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE, '0', null, undefined,
    true, 0n, {}, Object.create(null)]) {
    const row = vector(); row[1] = value;
    assert.throws(() => acceptEmbeddingVectors([row], 1), fixedError('INVALID_EMBEDDING'));
  }
});

test('unit-norm tolerance is inclusive on both sides and does not silently normalize', () => {
  for (const first of [1 - 1e-4, 1 + 1e-4]) {
    const accepted = acceptEmbeddingVectors([vector(first)], 1);
    assert.equal(Array.isArray(accepted), true);
    assert.equal(accepted[0][0], first);
  }
  for (const first of [1 - 1.01e-4, 1 + 1.01e-4]) {
    assert.throws(() => acceptEmbeddingVectors([vector(first)], 1), fixedError('INVALID_EMBEDDING'));
  }
});

test('oversized outer and inner arrays are refused before reading their values', () => {
  let reads = 0;
  const rows = Array(513); const row = Array(385);
  for (const array of [rows, row]) {
    Object.defineProperty(array, 0, { get() { reads++; throw new Error('private document text'); } });
  }
  assert.throws(() => acceptEmbeddingVectors(rows, 1), fixedError('INVALID_EMBEDDING'));
  assert.throws(() => acceptEmbeddingVectors([row], 1), fixedError('INVALID_EMBEDDING'));
  assert.equal(reads, 0);
});

test('unreadable vector rows and coordinates yield only fixed errors', () => {
  const rows = [vector()]; const row = vector();
  Object.defineProperty(rows, 0, { get() { throw new Error('private filename.pdf'); } });
  Object.defineProperty(row, 1, { get() { throw new Error('private tensor diagnostic'); } });
  for (const input of [rows, [row]]) {
    assert.throws(() => acceptEmbeddingVectors(input, 1), fixedError('INVALID_EMBEDDING'));
  }
});
