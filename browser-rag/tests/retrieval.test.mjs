import assert from 'node:assert/strict';
import test from 'node:test';
import { rankCandidates, RetrievalError } from '../retrieval.mjs';

const HASH = 'a'.repeat(64);
const REPRESENTATION = Object.freeze({
  modelId: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  tokenizerModelId: 'Xenova/all-MiniLM-L6-v2',
  tokenizerRevision: '751bff37182d3f1213fa05d7196b954e230abad9',
  pooling: 'attention-mask-mean', normalization: 'l2', dtype: 'fp32', device: 'webgpu',
  dimensions: 384, maxTokens: 256, maxChunks: 512, batchSize: 1, maxTotalTokens: 131072,
  version: 'miniLM-fp32-mean-l2-webgpu-v1',
});
function vector(first = 1, second = 0) {
  const row = Array(384).fill(0); row[0] = first; row[1] = second; return row;
}
function fixture(rows = [vector(), vector(0, 1), vector(-1)]) {
  const chunkIds = rows.map((_, ordinal) => `chunk-${ordinal}`);
  return {
    chunks: { schemaVersion: 1, status: 'chunked-not-embedded',
      source: { sha256: HASH, name: 'PRIVATE_FILENAME.pdf' }, counts: { chunks: rows.length },
      chunks: chunkIds.map(id => ({ id, text: 'PRIVATE_PASSAGE_TEXT', geometry: 'PRIVATE_GEOMETRY' })) },
    embeddings: { schemaVersion: 1, status: 'embedded-not-retrieved', sourceSha256: HASH,
      representationId: REPRESENTATION.version, representation: { ...REPRESENTATION }, backend: 'webgpu', dtype: 'fp32',
      chunkIds, tokenIds: rows.map(() => [101, 42, 102]), vectors: rows,
      counts: { chunks: rows.length, totalTokens: rows.length * 3, dimensions: 384 },
      receipt: { verifiedBytes: 100, networkBytes: 70, cacheBytes: 30, elapsedMs: 1.25 } },
    query: { representationId: REPRESENTATION.version, representation: { ...REPRESENTATION }, vector: vector() },
  };
}
const rank = (value, options) => rankCandidates(value.chunks, value.embeddings, value.query, options);
const candidate = (ordinal, score, dotProduct = score, chunkNorm = 1) => ({ chunkId: `chunk-${ordinal}`, ordinal, score, dotProduct, chunkNorm });
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} must be close to ${expected}`); }
function invalid(error) {
  assert.ok(error instanceof RetrievalError);
  assert.equal(error.name, 'RetrievalError');
  assert.equal(error.code, 'INVALID_RETRIEVAL_INPUT');
  assert.equal(error.message, 'The retrieval input is invalid.');
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.equal(JSON.stringify(error).includes('PRIVATE'), false);
  return true;
}
function parentAt(value, path) {
  const fields = path.split('.'), field = fields.pop();
  return [fields.reduce((part, key) => part[key], value), field];
}

// Break caught: ranking ascending, retaining source order, or dropping negative/zero candidates.
test('literal 384-dimensional basis vectors rank cosine 1, 0 and -1 descending', () => {
  const value = fixture([vector(-1), vector(0, 1), vector()]);
  assert.deepEqual(rank(value), {
    schemaVersion: 1, status: 'candidates-only', sourceSha256: HASH,
    representationId: 'miniLM-fp32-mean-l2-webgpu-v1', requestedTopK: 5, returnedCount: 3, queryNorm: 1,
    candidates: [candidate(2, 1), candidate(1, 0), candidate(0, -1)],
  });
});

// Break caught: using dot product as cosine for accepted, slightly non-unit vectors.
test('true cosine divides by both independently measured vector norms', () => {
  const value = fixture([vector(1.00004), vector(0, 1.00003)]);
  value.query.vector = vector(0.60003, 0.80004);
  const result = rank(value);
  close(result.queryNorm, 1.00005);
  assert.deepEqual(result.candidates.map(row => row.ordinal), [1, 0]);
  close(result.candidates[0].score, 0.8); close(result.candidates[1].score, 0.6);
  close(result.candidates[0].dotProduct, 0.8000640012);
  close(result.candidates[1].dotProduct, 0.6000540012);
  close(result.candidates[0].chunkNorm, 1.00003); close(result.candidates[1].chunkNorm, 1.00004);
  assert.notEqual(result.candidates[0].score, result.candidates[0].dotProduct);
});
test('exact cosine ties use source ordinal even when raw dot products differ', () => {
  const value = fixture([vector(0.99991), vector(1.00009), vector()]);
  const result = rank(value, { topK: 2 });
  assert.deepEqual(result.candidates.map(row => row.ordinal), [0, 1]);
  assert.deepEqual(result.candidates.map(row => row.score), [1, 1]);
  assert.deepEqual(result.candidates.map(row => row.dotProduct), [0.99991, 1.00009]);
});
test('identical tied rows retain their source order at the topK boundary', () => {
  assert.deepEqual(rank(fixture(Array.from({ length: 7 }, () => vector())), { topK: 3 }).candidates,
    [candidate(0, 1), candidate(1, 1), candidate(2, 1)]);
});
for (const [name, options, requested, ordinals] of [
  ['omitted options', undefined, 5, [0, 1, 2, 3, 4]],
  ['empty options', {}, 5, [0, 1, 2, 3, 4]],
  ['explicit undefined topK', { topK: undefined }, 5, [0, 1, 2, 3, 4]],
  ['minimum topK', { topK: 1 }, 1, [0]],
  ['maximum topK caps to source rows', { topK: 512 }, 512, [0, 1, 2, 3, 4, 5]],
  ['null-prototype options', Object.assign(Object.create(null), { topK: 2 }), 2, [0, 1]],
]) test(`topK accepts ${name}`, () => {
  const result = rank(fixture(Array.from({ length: 6 }, () => vector())), options);
  assert.equal(result.requestedTopK, requested); assert.equal(result.returnedCount, ordinals.length);
  assert.deepEqual(result.candidates.map(row => row.ordinal), ordinals);
});
test('all 512 source rows may be returned without an implicit retrieval threshold', () => {
  const result = rank(fixture(Array.from({ length: 512 }, () => vector(-1))), { topK: 512 });
  assert.equal(result.returnedCount, 512); assert.deepEqual(result.candidates[511], candidate(511, -1));
});
test('results are deeply frozen and remain detached after every input is mutated', () => {
  const value = fixture(), before = structuredClone(value), result = rank(value);
  assert.deepEqual(value, before);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  for (const target of [result, result.candidates, ...result.candidates]) assert.equal(Object.isFrozen(target), true);
  assert.throws(() => { result.candidates[0].score = 99; }, TypeError);
  assert.throws(() => { result.candidates.push(candidate(9, 1)); }, TypeError);
  value.chunks.source.sha256 = 'b'.repeat(64); value.chunks.chunks[0].id = 'PRIVATE_CHANGED';
  value.embeddings.chunkIds.reverse(); value.embeddings.vectors[0][0] = 0;
  value.embeddings.representation.modelId = 'PRIVATE_MODEL'; value.query.vector[0] = -1;
  assert.equal(result.sourceSha256, HASH); assert.deepEqual(result.candidates[0], candidate(0, 1));
});

// Break caught: accepting a different source, row lineage, receipt, or embedding contract.
for (const [name, mutate] of [
  ['source hash mismatch', value => { value.embeddings.sourceSha256 = 'b'.repeat(64); }],
  ['invalid source hash', value => { value.chunks.source.sha256 = 'PRIVATE_HASH'; }],
  ['reordered row IDs', value => { value.embeddings.chunkIds.reverse(); }],
  ['duplicate embedding row ID', value => { value.embeddings.chunkIds[1] = value.embeddings.chunkIds[0]; }],
  ['duplicate source chunk ID', value => { value.chunks.chunks[1].id = value.chunks.chunks[0].id; }],
  ['missing source row', value => { value.chunks.chunks.pop(); }],
  ['missing embedding ID', value => { value.embeddings.chunkIds.pop(); }],
  ['missing embedding vector', value => { value.embeddings.vectors.pop(); }],
  ['embedding row count mismatch', value => { value.embeddings.counts.chunks = 2; }],
  ['source row count mismatch', value => { value.chunks.counts.chunks = 2; }],
  ['no source rows', value => { value.chunks.chunks = []; value.chunks.counts.chunks = 0; }],
  ['too many source rows', value => { value.chunks.chunks = Array.from({ length: 513 }, (_, ordinal) => ({ id: String(ordinal), text: 'text' })); value.chunks.counts.chunks = 513; }],
  ['wrong source status', value => { value.chunks.status = 'embedded-not-retrieved'; }],
  ['wrong embedding status', value => { value.embeddings.status = 'candidates-only'; }],
  ['wrong embedding schema', value => { value.embeddings.schemaVersion = 2; }],
  ['wrong embedding representation ID', value => { value.embeddings.representationId = 'PRIVATE_VERSION'; }],
  ['wrong embedding backend', value => { value.embeddings.backend = 'wasm'; }],
  ['wrong embedding dtype', value => { value.embeddings.dtype = 'q8'; }],
  ['wrong dimension count', value => { value.embeddings.counts.dimensions = 383; }],
  ['wrong token count', value => { value.embeddings.counts.totalTokens++; }],
  ['invalid token boundary', value => { value.embeddings.tokenIds[0][0] = 100; }],
  ['invalid token vocabulary', value => { value.embeddings.tokenIds[0][1] = 30522; }],
  ['zero verified bytes', value => { value.embeddings.receipt.verifiedBytes = 0; value.embeddings.receipt.networkBytes = value.embeddings.receipt.cacheBytes = 0; }],
  ['receipt sum mismatch', value => { value.embeddings.receipt.networkBytes++; }],
  ['nonfinite receipt duration', value => { value.embeddings.receipt.elapsedMs = Infinity; }],
  ['unexpected artifact metadata', value => { value.embeddings.private = 'PRIVATE'; }],
]) test(`refuses ${name}`, () => { const value = fixture(); mutate(value); assert.throws(() => rank(value), invalid); });
for (const side of ['embeddings', 'query']) for (const key of Object.keys(REPRESENTATION)) {
  test(`refuses ${side} representation mismatch in ${key}`, () => {
    const value = fixture(); value[side].representation[key] = typeof REPRESENTATION[key] === 'number' ? REPRESENTATION[key] + 1 : 'PRIVATE_MISMATCH';
    assert.throws(() => rank(value), invalid);
  });
}
for (const side of ['embeddings', 'query']) for (const kind of ['missing', 'extra', 'symbol']) {
  test(`refuses ${side} representation ${kind} field`, () => {
    const value = fixture();
    if (kind === 'missing') delete value[side].representation.modelId;
    else value[side].representation[kind === 'symbol' ? Symbol('PRIVATE') : 'private'] = 'PRIVATE';
    assert.throws(() => rank(value), invalid);
  });
}
for (const [name, mutate] of [
  ['wrong version', value => { value.query.representationId = 'PRIVATE_VERSION'; }],
  ['extra query text', value => { value.query.text = 'PRIVATE_QUESTION'; }],
  ['symbol field', value => { value.query[Symbol('PRIVATE')] = true; }],
  ['missing vector', value => { delete value.query.vector; }],
  ['array query', value => { value.query = []; }],
  ['null query', value => { value.query = null; }],
  ['class query', value => { value.query = new (class Query {})(); }],
]) test(`query refuses ${name}`, () => { const value = fixture(); mutate(value); assert.throws(() => rank(value), invalid); });

// Break caught: malformed vectors reaching the ranking calculation or being silently repaired.
for (const side of ['embeddings', 'query']) for (const [name, change] of [
  ['zero norm', () => vector(0)], ['outside unit tolerance', () => vector(1.00011)],
  ['NaN', () => vector(NaN)], ['positive infinity', () => vector(Infinity)], ['negative infinity', () => vector(-Infinity)],
  ['non-number', () => vector('PRIVATE_NUMBER')], ['383 dimensions', () => Array(383).fill(0)],
  ['385 dimensions', () => Array(385).fill(0)], ['typed array', () => new Float32Array(vector())],
  ['sparse component', () => { const row = vector(); delete row[3]; return row; }],
  ['accessor component', () => { const row = vector(); Object.defineProperty(row, '0', { get() { throw new Error('PRIVATE_COMPONENT'); } }); return row; }],
  ['hidden component', () => { const row = vector(); Object.defineProperty(row, '0', { enumerable: false }); return row; }],
  ['named array property', () => { const row = vector(); row.private = 'PRIVATE'; return row; }],
  ['symbol array property', () => { const row = vector(); row[Symbol('PRIVATE')] = true; return row; }],
  ['inherited array', () => { const row = vector(); Object.setPrototypeOf(row, Object.create(Array.prototype)); return row; }],
]) test(`${side} vector refuses ${name}`, () => {
  const value = fixture(); if (side === 'query') value.query.vector = change(); else value.embeddings.vectors[0] = change();
  assert.throws(() => rank(value), invalid);
});
for (const topK of [0, -1, 1.5, 513, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, null, true, '5', 5n]) {
  test(`topK refuses ${String(topK)}`, () => { assert.throws(() => rank(fixture(), { topK }), invalid); });
}
for (const [name, options] of [
  ['null', null], ['array', []], ['number', 5], ['string', '5'], ['date', new Date(0)],
  ['unknown key', { topK: 2, threshold: 0.78 }], ['symbol key', { [Symbol('PRIVATE')]: true }],
  ['custom prototype', Object.create({ topK: 2 })],
]) test(`options refuse ${name}`, () => { assert.throws(() => rank(fixture(), options), invalid); });

// Break caught: private getter/proxy exceptions escaping the public error boundary.
for (const path of ['chunks.source.sha256', 'chunks.chunks.0.id', 'chunks.chunks.0.text',
  'embeddings.backend', 'embeddings.receipt.verifiedBytes', 'embeddings.representation.modelId',
  'query.representationId', 'query.representation.modelId', 'query.vector']) {
  test(`throwing ${path} accessor exposes only the canonical retrieval error`, () => {
    const value = fixture(), [parent, field] = parentAt(value, path);
    Object.defineProperty(parent, field, { enumerable: true, get() { throw new Error('PRIVATE_GETTER_DIAGNOSTIC'); } });
    assert.throws(() => rank(value), invalid);
  });
}
test('throwing topK accessor exposes only the canonical retrieval error', () => {
  assert.throws(() => rank(fixture(), { get topK() { throw new Error('PRIVATE_OPTIONS'); } }), invalid);
});
for (const target of ['chunks', 'embeddings', 'query']) test(`hostile ${target} prototype inspection is sanitized`, () => {
  const value = fixture(); value[target] = new Proxy(value[target], { getPrototypeOf() { throw new Error('PRIVATE_PROXY'); } });
  assert.throws(() => rank(value), invalid);
});
for (const path of ['query.representationId', 'query.representation.modelId', 'query.vector']) {
  test(`ranking uses the one validated owned read of ${path}`, () => {
    const value = fixture(), [parent, field] = parentAt(value, path), original = parent[field]; let reads = 0;
    Object.defineProperty(parent, field, { enumerable: true, get() { return ++reads === 1 ? original : 'PRIVATE_CHANGED'; } });
    assert.deepEqual(rank(value).candidates, [candidate(0, 1), candidate(1, 0), candidate(2, -1)]);
    assert.equal(reads, 1);
  });
}
test('topK is snapshotted once before validation and ranking', () => {
  let reads = 0; const result = rank(fixture(), { get topK() { return ++reads === 1 ? 1 : 512; } });
  assert.equal(result.requestedTopK, 1); assert.equal(result.returnedCount, 1); assert.equal(reads, 1);
});
test('the error class never inspects or echoes a supplied private diagnostic', () => {
  for (const supplied of ['PRIVATE_ERROR', undefined, null, { toString() { throw new Error('PRIVATE_STRING'); } }]) invalid(new RetrievalError(supplied));
});
