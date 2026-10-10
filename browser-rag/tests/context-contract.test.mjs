import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageRecord } from '../pdf-source.mjs';
import { chunkSource } from '../chunking.mjs';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { projectEmbeddingInput } from '../embedding-source.mjs';
import { copyQueryPassages, copyQueryResult, queryResultReceipt } from '../query-source.mjs';
import { rankCandidates } from '../retrieval.mjs';
import * as compute from '../compute-source.mjs';

// Missing exports produce individual behavioral RED failures, allowing the
// already-existing worker regressions to run in the same focused command.
const contextModule = await import('../context-contract.mjs').catch(() => ({}));
const SHA = 'a'.repeat(64), OPTIONS = { maxChunkUtf16: 4096, overlapUtf16: 0 };
const PARSER = { name: 'pdfjs', version: '6.4.299', policyVersion: 'text-items-v1', disableNormalization: true };
const rawQuestion = '  PRIVATE_QUESTION\n財報 😀?  ';
const vector = axis => Array.from({ length: 384 }, (_, index) => index === axis ? 1 : 0);
function sourceOf(pages = [['  PRIVATE_ALPHA\n😀  ', '', '尾\t'], ['PRIVATE_BETA'], ['PRIVATE_GAMMA']], labels = [null, 'i', 'i']) {
  return { schemaVersion: 1, status: 'extracted-not-indexed',
    source: { sha256: SHA, name: 'PRIVATE_SOURCE.pdf', size: 1002 }, parser: { ...PARSER },
    numPages: pages.length, workerMode: 'node-fake',
    pages: pages.map((strings, index) => createPageRecord({ sourceSha256: SHA,
      parserVersion: PARSER.version, physicalPageNumber: index + 1, pageLabel: labels[index] ?? null,
      page: { view: [0, 0, 612, 792], rotate: 0, userUnit: 1 },
      textContent: { items: strings.map(str => ({ str, dir: 'ltr', transform: [1, 0, 0, 1, 30, 740],
        width: 120, height: 12, fontName: 'f1', hasEOL: false })) } })) };
}
function fixture(source = sourceOf(), options = OPTIONS, topK = 3) {
  const chunkArtifact = chunkSource(source, options), projection = projectEmbeddingInput(chunkArtifact);
  const count = projection.chunks.length;
  const embeddingArtifact = { schemaVersion: 1, status: 'embedded-not-retrieved', sourceSha256: SHA,
    representationId: EMBEDDING_SPEC.version, representation: { ...EMBEDDING_SPEC }, backend: 'webgpu', dtype: 'fp32',
    chunkIds: projection.chunks.map(chunk => chunk.id), tokenIds: projection.chunks.map(() => [101, 42, 102]),
    vectors: projection.chunks.map((_, index) => vector(index % 384)),
    counts: { chunks: count, totalTokens: count * 3, dimensions: 384 },
    receipt: { verifiedBytes: 200, networkBytes: 150, cacheBytes: 50, elapsedMs: 2 } };
  const query = { schemaVersion: 1, status: 'query-embedded-not-retrieved', representationId: EMBEDDING_SPEC.version,
    representation: { ...EMBEDDING_SPEC }, backend: 'webgpu', dtype: 'fp32', tokenIds: [101, 44, 102], vector: vector(1),
    counts: { totalTokens: 3, dimensions: 384 }, receipt: { verifiedBytes: 100, networkBytes: 70, cacheBytes: 30, elapsedMs: 1 } };
  const passages = copyQueryPassages(embeddingArtifact, projection);
  const queryResult = { query, retrieval: rankCandidates(projection, passages,
    { representationId: query.representationId, representation: query.representation, vector: query.vector }, { topK }) };
  const queryMetadata = queryResultReceipt(queryResult);
  // Establish that these fixtures satisfy the same query/embedding contracts.
  copyQueryResult(queryResult, projection, passages, topK, 100, queryMetadata);
  return structuredClone({ source, chunkArtifact, embeddingArtifact, question: rawQuestion,
    queryResult, topK, queryDownloadTotal: 100, queryMetadata });
}
function assemble(input) {
  assert.equal(typeof contextModule.assembleProvenanceContext, 'function', 'assembleProvenanceContext export');
  return contextModule.assembleProvenanceContext(input);
}
function copy(source, artifact) {
  assert.equal(typeof compute.copyValidatedChunkArtifact, 'function', 'copyValidatedChunkArtifact export');
  return compute.copyValidatedChunkArtifact(source, artifact);
}
const safeContext = code => error => error?.name === 'ContextError' && error.code === code
  && !/PRIVATE|財報|😀|\.pdf/.test(error.message);
const safeCompute = error => error?.name === 'ComputeError'
  && ['INVALID_SOURCE', 'WORKER_PROTOCOL_ERROR'].includes(error.code) && !/PRIVATE|\.pdf/.test(error.message);
function assertFrozen(value) {
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) assertFrozen(child);
  }
}
function recount(artifact) {
  artifact.counts = { chunks: artifact.chunks.length,
    outputUtf16: artifact.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
    fragments: artifact.chunks.reduce((sum, chunk) => sum + chunk.segments.length, 0) };
}

test('context preserves verified full evidence in rank order with stable source-ordinal citations', () => {
  const input = fixture(), result = assemble(input);
  assert.deepEqual(Object.keys(result).sort(), ['schemaVersion', 'status', 'question', 'source', 'parser', 'numPages',
    'workerMode', 'chunker', 'counts', 'representation', 'query', 'retrieval', 'evidenceUnits', 'omissions'].sort());
  assert.equal(result.schemaVersion, 1); assert.equal(result.status, 'context-not-generated');
  assert.equal(result.question, rawQuestion); assert.deepEqual(result.omissions, []);
  for (const key of ['source', 'parser', 'numPages', 'workerMode', 'chunker', 'counts']) assert.deepEqual(result[key], input.chunkArtifact[key]);
  assert.deepEqual(result.representation, EMBEDDING_SPEC); assert.deepEqual(result.query, input.queryResult.query);
  assert.deepEqual(result.retrieval, input.queryResult.retrieval);
  assert.deepEqual(result.evidenceUnits.map(unit => unit.ordinal), [1, 0, 2]);
  assert.deepEqual(result.evidenceUnits.map(unit => unit.citationId), ['E2', 'E1', 'E3']);
  for (let index = 0; index < result.evidenceUnits.length; index++) {
    const candidate = input.queryResult.retrieval.candidates[index], chunk = input.chunkArtifact.chunks[candidate.ordinal];
    assert.deepEqual(result.evidenceUnits[index], { citationId: `E${candidate.ordinal + 1}`, rank: index + 1,
      ...candidate, physicalPageNumber: chunk.physicalPageNumber, pageLabel: chunk.pageLabel,
      startUtf16: chunk.startUtf16, endUtf16: chunk.endUtf16, text: chunk.text, segments: chunk.segments });
  }
  assert.deepEqual(result.evidenceUnits.map(unit => unit.pageLabel), ['i', null, 'i']);
  assert.ok(result.evidenceUnits[1].segments.some(segment => segment.kind === 'presentation'));
  assertFrozen(result); assert.equal(Object.isFrozen(input.source), false);
  input.chunkArtifact.chunks[0].segments[0].quote = 'changed'; input.queryResult.query.vector[0] = 9;
  input.source.source.name = 'changed'; input.queryMetadata.query.counts.totalTokens = 9;
  assert.equal(result.source.name, 'PRIVATE_SOURCE.pdf'); assert.equal(result.query.vector[0], 0);
  assert.equal(result.evidenceUnits[1].text, '  PRIVATE_ALPHA\n😀  \n尾\t');
});
test('top K selects complete units without altering the accepted mechanical artifact counts', () => {
  const input = fixture(sourceOf(), OPTIONS, 1), result = assemble(input);
  assert.equal(result.evidenceUnits.length, 1); assert.equal(result.evidenceUnits[0].citationId, 'E2');
  assert.equal(result.counts.chunks, 3); assert.deepEqual(result.omissions, []);
});
test('full copier preserves canonical surrogate-safe overlap, lone units, empty items and empty pages', () => {
  const source = sourceOf([['', 'A😀BC😀D\uD800', '', 'E'], [' \t'], ['終😀尾']], [null, 'i', 'i']);
  const artifact = chunkSource(source, { maxChunkUtf16: 4, overlapUtf16: 2 });
  const result = copy(source, artifact);
  assert.deepEqual(result, artifact); assertFrozen(result); assert.notEqual(result, artifact);
  assert.deepEqual(result.chunks.filter(chunk => chunk.physicalPageNumber === 1).map(chunk => [chunk.startUtf16, chunk.endUtf16]),
    [[0, 4], [3, 7], [5, 9], [7, 11]]);
  assert.ok(result.chunks.every(chunk => chunk.physicalPageNumber !== 2));
});
test('full copier derives declared valid settings within global caps and accepts blank mechanical windows', () => {
  const source = sourceOf([['A       B']]), artifact = chunkSource(source, { maxChunkUtf16: 3, overlapUtf16: 0 });
  const copied = copy(source, artifact); assert.deepEqual(copied, artifact);
  assert.ok(copied.chunks.some(chunk => !chunk.text.trim()));
  assert.throws(() => projectEmbeddingInput(copied));
});
for (const [name, mutate] of [
  ['first window', artifact => artifact.chunks.shift()], ['middle window', artifact => artifact.chunks.splice(1, 1)],
  ['last window', artifact => artifact.chunks.pop()],
  ['whole text page', artifact => { artifact.chunks = artifact.chunks.filter(chunk => chunk.physicalPageNumber !== 2); }],
  ['reordered windows', artifact => artifact.chunks.reverse()],
  ['extra window', artifact => artifact.chunks.push(structuredClone(artifact.chunks[0]))],
]) test(`full copier refuses ${name} with recalculated internally consistent counts`, () => {
  const source = sourceOf([['ABCDEFGHIJKLMNO'], ['second page']]), artifact = structuredClone(chunkSource(source, { maxChunkUtf16: 5, overlapUtf16: 1 }));
  mutate(artifact); recount(artifact); assert.throws(() => copy(source, artifact), safeCompute);
});
for (const [name, mutate] of [
  ['page SHA', value => { value.pages[0].sourceSha256 = 'b'.repeat(64); }],
  ['page parser', value => { value.pages[0].parserVersion = '6.4.300'; }],
  ['page policy', value => { value.pages[0].policyVersion = 'changed'; }],
  ['page ordinal', value => { value.pages[0].physicalPageNumber = 2; }],
  ['item ordinal', value => { value.pages[0].textItems[0].itemIndex = 1; }],
  ['span ID', value => { value.pages[0].textItems[0].span.id = 'PRIVATE_FORGED'; }],
  ['span start', value => { value.pages[0].textItems[0].span.startUtf16 = 1; }],
  ['span end', value => { value.pages[0].textItems[0].span.endUtf16--; }],
  ['span quote', value => { value.pages[0].textItems[0].span.quote = 'PRIVATE_FORGED'; }],
  ['actual status', value => { value.pages[0].status = 'empty'; }],
]) test(`context refuses changed source ${name}`, () => {
  const input = fixture(); mutate(input.source);
  assert.throws(() => assemble(input), safeContext('INVALID_CONTEXT_ARTIFACT'));
});
for (const [name, mutate] of [
  ['projection only', input => { input.chunkArtifact = projectEmbeddingInput(input.chunkArtifact); }],
  ['chunk header SHA', input => { input.chunkArtifact.source.sha256 = 'b'.repeat(64); }],
  ['chunk label', input => { input.chunkArtifact.chunks[0].pageLabel = 'other'; }],
  ['chunk text', input => { input.chunkArtifact.chunks[0].text = 'PRIVATE_FORGED'; }],
  ['source segment', input => { input.chunkArtifact.chunks[0].segments[0].sourceSpanId = 'PRIVATE_FORGED'; }],
  ['presentation segment', input => { input.chunkArtifact.chunks[0].segments.find(segment => segment.kind === 'presentation').text = ' '; }],
  ['embedding row order', input => input.embeddingArtifact.chunkIds.reverse()],
  ['embedding SHA', input => { input.embeddingArtifact.sourceSha256 = 'b'.repeat(64); }],
  ['embedding representation', input => { input.embeddingArtifact.representation.pooling = 'changed'; }],
  ['embedding dimensions', input => input.embeddingArtifact.vectors[0].pop()],
  ['embedding norm', input => { input.embeddingArtifact.vectors[0][0] = 2; }],
  ['embedding nonfinite', input => { input.embeddingArtifact.vectors[0][0] = Infinity; }],
  ['query norm', input => { input.queryResult.query.vector[1] = 2; }],
  ['candidate order', input => input.queryResult.retrieval.candidates.reverse()],
  ['candidate score', input => { input.queryResult.retrieval.candidates[0].score = 0.5; }],
  ['candidate dot', input => { input.queryResult.retrieval.candidates[0].dotProduct = 0.5; }],
  ['candidate norm', input => { input.queryResult.retrieval.candidates[0].chunkNorm = 0.99999; }],
  ['candidate ordinal', input => { input.queryResult.retrieval.candidates[0].ordinal = 0; }],
  ['query receipt', input => { input.queryMetadata.query.receipt.cacheBytes++; }],
  ['retrieval receipt', input => { input.queryMetadata.retrieval.returnedCount--; }],
  ['undefined query metadata', input => { input.queryMetadata.query = undefined; }],
  ['undefined retrieval metadata', input => { input.queryMetadata.retrieval = undefined; }],
  ['download total mismatch', input => { input.queryDownloadTotal++; }],
]) test(`context refuses invalid ${name} with a fixed private-safe error`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => assemble(input), safeContext('INVALID_CONTEXT_ARTIFACT'));
});
for (const field of ['source', 'chunkArtifact', 'embeddingArtifact', 'question', 'queryResult', 'topK', 'queryDownloadTotal', 'queryMetadata']) {
  for (const missing of [true, false]) test(`required ${field} cannot be ${missing ? 'missing' : 'undefined'}`, () => {
    const input = fixture(); if (missing) delete input[field]; else input[field] = undefined;
    assert.throws(() => assemble(input), safeContext('INVALID_CONTEXT_INPUT'));
  });
}
for (const [name, value] of [['zero', 0], ['large', 513], ['fraction', 1.5], ['string', '3'], ['null', null]]) {
  test(`context rejects ${name} top K without invoking shared optional defaults`, () => {
    const input = fixture(); input.topK = value;
    assert.throws(() => assemble(input), safeContext('INVALID_CONTEXT_INPUT'));
  });
}
for (const [name, value] of [['blank', ' \n\t'], ['oversized', 'x'.repeat(4097)], ['nonstring', 1]]) {
  test(`context rejects ${name} question`, () => {
    const input = fixture(); input.question = value;
    assert.throws(() => assemble(input), safeContext('INVALID_CONTEXT_INPUT'));
  });
}
test('context accepts the exact question limit without pretending to bind its text to the query vector', () => {
  const input = fixture(); input.question = '😀'.repeat(2048);
  assert.equal(assemble(input).question, input.question);
});
for (const [name, mutate] of [
  ['extra context field', input => { input.answer = 'PRIVATE'; }],
  ['metadata extra field', input => { input.queryMetadata.private = 'PRIVATE'; }],
  ['metadata missing query', input => { delete input.queryMetadata.query; }],
  ['metadata missing retrieval', input => { delete input.queryMetadata.retrieval; }],
]) test(`exact context boundary rejects ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => assemble(input), safeContext(name === 'extra context field' ? 'INVALID_CONTEXT_INPUT' : 'INVALID_CONTEXT_ARTIFACT'));
});
for (const [name, mutate] of [
  ['oversized pages', input => { input.source.pages = new Array(513); }],
  ['sparse pages', input => { delete input.source.pages[0]; }],
  ['oversized items', input => { input.source.pages[0].textItems = new Array(100001); }],
  ['sparse items', input => { delete input.source.pages[0].textItems[0]; }],
  ['oversized text', input => { input.source.pages[0].textItems[0].text = 'x'.repeat(2000001); }],
  ['oversized chunks', input => { input.chunkArtifact.chunks = new Array(10001); }],
  ['sparse chunks', input => { delete input.chunkArtifact.chunks[0]; }],
  ['sparse segments', input => { delete input.chunkArtifact.chunks[0].segments[0]; }],
  ['oversized fragments', input => { input.chunkArtifact.chunks[0].segments = new Array(200001); }],
  ['sparse embedding rows', input => { delete input.embeddingArtifact.vectors[0]; }],
]) test(`context refuses bounded-array violation ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => assemble(input), safeContext('INVALID_CONTEXT_ARTIFACT'));
});
test('unused source geometry and extractor getters are ignored, never copied or frozen', () => {
  const input = fixture(); let touched = 0;
  const ignored = { get() { touched++; throw new Error('PRIVATE unused getter'); }, configurable: true, enumerable: true };
  Object.defineProperty(input.source, 'extractorExtra', ignored);
  Object.defineProperty(input.source.pages[0], 'geometry', ignored);
  Object.defineProperty(input.source.pages[0].textItems[0], 'transform', ignored);
  const result = assemble(input); assert.equal(touched, 0); assertFrozen(result);
  assert.equal(Object.isFrozen(input.source.pages[0].textItems[0]), false);
});
test('full copier reads source array indices without invoking caller array map methods', () => {
  const source = sourceOf(), artifact = chunkSource(source, OPTIONS), saved = Array.prototype.map;
  try {
    Array.prototype.map = function () { throw new Error('PRIVATE caller map'); };
    assert.deepEqual(copy(source, artifact), artifact);
  } finally { Array.prototype.map = saved; }
});
test('full copier copies exactly the values it validated, without a later blind structured clone', () => {
  const input = fixture(); const original = input.chunkArtifact.chunks[0].text; let reads = 0;
  Object.defineProperty(input.chunkArtifact.chunks[0], 'text', { enumerable: true,
    get() { reads++; return reads === 1 ? original : 'PRIVATE_CHANGED_AFTER_CHECK'; } });
  const result = copy(input.source, input.chunkArtifact);
  assert.equal(result.chunks[0].text, original); assert.equal(reads, 1);
});
test('ContextError normalizes unknown codes into a fixed safe fallback', () => {
  assert.equal(typeof contextModule.ContextError, 'function', 'ContextError export');
  const error = new contextModule.ContextError('PRIVATE arbitrary exception');
  assert.ok(safeContext('CONTEXT_FAILED')(error));
});
