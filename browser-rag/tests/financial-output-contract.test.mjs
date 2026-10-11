import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageRecord } from '../pdf-source.mjs';
import { chunkSource } from '../chunking.mjs';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { projectEmbeddingInput } from '../embedding-source.mjs';
import { copyQueryPassages, copyQueryResult, queryResultReceipt } from '../query-source.mjs';
import { rankCandidates } from '../retrieval.mjs';
import { assembleProvenanceContext } from '../context-contract.mjs';
import { GenerationContractError, preflightGeneration } from '../generator-contract.mjs';

// Missing exports fail individual behavior assertions for meaningful TDD RED.
const outputModule = await import('../financial-output-contract.mjs').catch(() => ({}));
const SHA = 'a'.repeat(64);
const PARSER = { name: 'pdfjs', version: '6.4.299', policyVersion: 'text-items-v1', disableNormalization: true };
const OPTIONS = { maxChunkUtf16: 4096, overlapUtf16: 0 };
const INPUT_KEYS = ['source', 'chunkArtifact', 'embeddingArtifact', 'question', 'queryResult', 'topK', 'queryDownloadTotal', 'queryMetadata'];
const MESSAGES = {
  INVALID_FINANCIAL_OUTPUT_TEXT: 'The financial output text is invalid.',
  FINANCIAL_OUTPUT_LIMIT: 'The financial output exceeds its inspection limit.',
  INVALID_FINANCIAL_OUTPUT_TERMINATION: 'The financial output did not terminate with EOS.',
  INVALID_FINANCIAL_OUTPUT_JSON: 'The financial output is not a complete supported JSON object.',
  INVALID_FINANCIAL_OUTPUT_SCHEMA: 'The financial output does not match the required schema.',
  INVALID_FINANCIAL_OUTPUT_CITATION: 'The financial output citation identities are invalid.',
  INVALID_FINANCIAL_OUTPUT_CONTEXT: 'The financial output provenance input is invalid.',
  FINANCIAL_OUTPUT_FAILED: 'The financial output could not be inspected safely.',
};
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
  copyQueryResult(queryResult, projection, passages, topK, 100, queryMetadata);
  return structuredClone({ source, chunkArtifact, embeddingArtifact, question: '  PRIVATE_QUESTION 財報 😀?\n',
    queryResult, topK, queryDownloadTotal: 100, queryMetadata });
}
const preflight = () => structuredClone(preflightGeneration([5, 6], { maxNewTokens: 3 }));
const textOf = (answer = 'A draft answer.', citations = ['E2'], insufficient_evidence = false) =>
  JSON.stringify({ answer, citations, insufficient_evidence });
function inspect(text = textOf(), ids = [5, 6, 7, 151645], accepted = preflight(), input = fixture()) {
  assert.equal(typeof outputModule.inspectFinancialOutput, 'function', 'inspectFinancialOutput export');
  return outputModule.inspectFinancialOutput(text, ids, accepted, input);
}
const safe = code => error => error?.name === 'FinancialOutputError' && error.code === code
  && error.message === MESSAGES[code] && !Object.hasOwn(error, 'cause')
  && !/PRIVATE|財報|😀|\.pdf|https?:|E999/.test(error.message);
const generationError = code => error => error instanceof GenerationContractError
  && error.code === code && !Object.hasOwn(error, 'cause') && !/PRIVATE/.test(error.message);
function assertFrozen(value) {
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) assertFrozen(child);
  }
}
function binding(unit) {
  return Object.fromEntries(['citationId', 'rank', 'ordinal', 'chunkId', 'physicalPageNumber', 'pageLabel',
    'startUtf16', 'endUtf16', 'text', 'segments'].map(key => [key, unit[key]]));
}

test('acceptance owns only cited selected provenance and explicitly leaves financial claims unestablished', () => {
  const input = fixture(), context = assembleProvenanceContext(input), text = ' \r\n' + textOf('PRIVATE_ANSWER', ['E1', 'E2']) + '\t ';
  assert.deepEqual(context.evidenceUnits.map(unit => unit.citationId), ['E2', 'E1', 'E3']);
  const result = inspect(text, undefined, undefined, input);
  assert.deepEqual(result, { schemaVersion: 1, status: 'unverified-financial-draft', generationMode: 'not-run',
    outputInspection: 'shape-and-citation-identity-accepted', financialCorrectness: 'unestablished',
    claimSupport: 'unestablished', disposition: 'draft', text, answer: 'PRIVATE_ANSWER', citations: ['E1', 'E2'],
    insufficient_evidence: false, source: context.source, parser: context.parser, chunker: context.chunker,
    citationBindings: [binding(context.evidenceUnits[1]), binding(context.evidenceUnits[0])], termination: 'eos' });
  assertFrozen(result);
  assert.equal(result.citationBindings[0].pageLabel, null);
  assert.ok(result.citationBindings[0].segments.some(segment => segment.kind === 'presentation'));
  const serialized = JSON.stringify(result);
  for (const omitted of ['PRIVATE_QUESTION', 'PRIVATE_GAMMA', 'vector', 'score', 'dotProduct', 'receipt', 'queryMetadata', 'url', 'fiscalYear']) {
    assert.equal(serialized.includes(omitted), false, omitted);
  }
});
for (const text of [
  '{"citations":["E2"],"insufficient_evidence":false,"answer":"ok"}',
  ' \t\r\n{ \n"insufficient_evidence" : false, "answer" : "ok", "citations" : [ "E2" ] }\r\n',
  '{"\\u0061nswer":"ok","citations":["\\u00452"],"insufficient_evidence":false}',
]) test('field ordering, JSON whitespace and decoded legal field names are accepted', () => {
  const result = inspect(text); assert.equal(result.text, text); assert.equal(result.answer, 'ok'); assert.deepEqual(result.citations, ['E2']);
});
for (const answer of ['財報 😀', 'quotes " and slash \\ and /', '{}[] and ```json are data', '<|im_end|>', '\uD800x\uDC00', 'e\u0301']) {
  test(`answer string preserves its exact code units: ${JSON.stringify(answer)}`, () => {
    assert.equal(inspect(textOf(answer)).answer, answer);
  });
}
test('escaped Unicode, quote and backslash tokens decode without normalizing lone UTF16 units', () => {
  const text = '{"answer":"\\u8ca1\\ud83d\\ude00 \\" \\\\ \\/ \\ud800","citations":["E2"],"insufficient_evidence":false}';
  const result = inspect(text); assert.equal(result.text, text); assert.equal(result.answer, '財😀 " \\ / \uD800');
});
test('exact 16384 UTF16 text limit includes preserved surrounding whitespace', () => {
  const base = textOf('😀'), text = base + ' '.repeat(16384 - base.length);
  assert.equal(text.length, 16384); assert.equal(inspect(text).text, text);
  assert.throws(() => inspect(text + ' '), safe('FINANCIAL_OUTPUT_LIMIT'));
});
test('exact 16384 UTF16 text limit also permits a full answer string without truncation', () => {
  const overhead = textOf('').length, answer = 'x'.repeat(16384 - overhead), text = textOf(answer);
  assert.equal(text.length, 16384); assert.equal(inspect(text).answer, answer);
});
for (const value of [undefined, null, true, 1, 1n, {}, [], new String('PRIVATE'), Symbol('PRIVATE')]) {
  test(`text is a primitive string only: ${typeof value}`, () => {
    assert.equal(typeof outputModule.inspectFinancialOutput, 'function', 'inspectFinancialOutput export');
    assert.throws(() => outputModule.inspectFinancialOutput(value, [5, 6, 151645], preflight(), fixture()), safe('INVALID_FINANCIAL_OUTPUT_TEXT'));
  });
}
test('invalid or overlimit text is rejected before token, preflight or provenance traversal', () => {
  let reads = 0;
  const unreadable = new Proxy({}, { get() { reads++; throw new Error('PRIVATE'); }, ownKeys() { reads++; throw new Error('PRIVATE'); },
    getPrototypeOf() { reads++; throw new Error('PRIVATE'); } });
  assert.throws(() => inspect('x'.repeat(16385), unreadable, unreadable, unreadable), safe('FINANCIAL_OUTPUT_LIMIT'));
  assert.throws(() => inspect(new String('PRIVATE'), unreadable, unreadable, unreadable), safe('INVALID_FINANCIAL_OUTPUT_TEXT'));
  assert.equal(reads, 0);
});
for (const [name, ids] of [['length', [5, 6, 7, 8, 9]], ['incomplete', [5, 6, 7]], ['empty-output', [5, 6]]]) {
  test(`valid JSON never becomes a draft after ${name} termination`, () => {
    assert.throws(() => inspect(textOf(), ids), safe('INVALID_FINANCIAL_OUTPUT_TERMINATION'));
  });
}
for (const eos of [151645, 151643, 151645n, 151643n]) {
  test(`the canonical terminal EOS ${eos} is recomputed from the full sequence`, () => {
    assert.equal(inspect(textOf(), [5, 6, eos]).termination, 'eos');
  });
}
for (const [name, ids] of [['prefix', [6, 5, 151645]], ['short prefix', [5]], ['oversized suffix', [5, 6, 7, 8, 9, 151645]],
  ['interior EOS', [5, 6, 151645, 7]], ['repeated EOS', [5, 6, 151643, 151645]], ['sparse', [5, , 151645]],
  ['typed array', new Uint32Array([5, 6, 151645])], ['sequence receipt substitute', { termination: 'eos' }]]) {
  test(`canonical generation error remains private for invalid ${name}`, () => {
    assert.throws(() => inspect(textOf(), ids), generationError('INVALID_GENERATION_OUTPUT'));
  });
}
for (const [name, mutate] of [['settings', value => { value.settings.do_sample = true; }],
  ['EOS policy', value => { value.settings.eos_token_id.reverse(); }], ['input count', value => { value.inputTokens++; }],
  ['generation identity', value => { value.generation.revision = 'PRIVATE'; }],
  ['throwing settings', value => { Object.defineProperty(value.settings, 'top_p', { get() { throw new Error('PRIVATE'); } }); }]]) {
  test(`canonical generation config error remains private for forged ${name}`, () => {
    const accepted = preflight(); mutate(accepted);
    assert.throws(() => inspect(textOf(), undefined, accepted), generationError('INVALID_GENERATION_CONFIG'));
  });
}
for (const key of ['answer', 'citations', 'insufficient_evidence']) {
  for (const escaped of [false, true]) test(`duplicate root ${key} is rejected before assignment (${escaped ? 'escaped' : 'literal'})`, () => {
    const encoded = escaped ? '\\u' + key.charCodeAt(0).toString(16).padStart(4, '0') + key.slice(1) : key;
    const text = textOf().slice(0, -1) + `,"${encoded}":${JSON.stringify(key === 'answer' ? 'PRIVATE_REPLACEMENT' : key === 'citations' ? [] : true)}}`;
    assert.throws(() => inspect(text), safe('INVALID_FINANCIAL_OUTPUT_SCHEMA'));
  });
}
for (const [name, text] of [
  ['missing answer', '{"citations":["E2"],"insufficient_evidence":false}'],
  ['missing citations', '{"answer":"ok","insufficient_evidence":false}'],
  ['missing flag', '{"answer":"ok","citations":["E2"]}'],
  ['empty root', '{}'], ['extra root', textOf().slice(0, -1) + ',"extra":"PRIVATE"}'],
  ['prototype key', textOf().slice(0, -1) + ',"__proto__":null}'],
  ['answer object', '{"answer":{},"citations":["E2"],"insufficient_evidence":false}'],
  ['answer array', '{"answer":[],"citations":["E2"],"insufficient_evidence":false}'],
  ['citations object', '{"answer":"ok","citations":{},"insufficient_evidence":false}'],
  ['nested citation array', '{"answer":"ok","citations":[[]],"insufficient_evidence":false}'],
  ['nested citation object', '{"answer":"ok","citations":[{}],"insufficient_evidence":false}'],
]) test(`schema refuses ${name}`, () => {
  assert.throws(() => inspect(text), safe('INVALID_FINANCIAL_OUTPUT_SCHEMA'));
});
for (const [field, values] of [['answer', [null, true, 1, [], {}]], ['citations', [null, true, 1, 'E2', {}]],
  ['insufficient_evidence', [null, 0, 1, 'false', [], {}]]]) {
  for (const value of values) test(`wrong ${field} type ${JSON.stringify(value)} is rejected`, () => {
    const output = { answer: 'ok', citations: ['E2'], insufficient_evidence: false }; output[field] = value;
    assert.throws(() => inspect(JSON.stringify(output)), safe('INVALID_FINANCIAL_OUTPUT_SCHEMA'));
  });
}
for (const value of [null, true, false, 1, [], {}]) test(`citation entry ${JSON.stringify(value)} must be a string`, () => {
  assert.throws(() => inspect(textOf('ok', [value])), safe('INVALID_FINANCIAL_OUTPUT_SCHEMA'));
});
for (const [name, text] of [
  ['empty text', ''], ['only whitespace', ' \t\r\n'], ['root array', '[]'], ['root string', '"PRIVATE"'], ['root null', 'null'],
  ['fenced object', '```json\n' + textOf() + '\n```'], ['prose before object', 'PRIVATE ' + textOf()],
  ['prose after object', textOf() + ' PRIVATE'], ['adjacent objects', textOf() + textOf()],
  ['BOM', '\uFEFF' + textOf()], ['non-JSON whitespace', '\u00a0' + textOf()], ['vertical tab', '\u000b' + textOf()],
  ['comments', '{/*PRIVATE*/"answer":"ok","citations":["E2"],"insufficient_evidence":false}'],
  ['unquoted key', '{answer:"ok","citations":["E2"],"insufficient_evidence":false}'],
  ['trailing root comma', textOf().slice(0, -1) + ',}'], ['trailing citation comma', '{"answer":"ok","citations":["E2",],"insufficient_evidence":false}'],
  ['sparse citations', '{"answer":"ok","citations":[,"E2"],"insufficient_evidence":false}'],
  ['missing comma', '{"answer":"ok" "citations":["E2"],"insufficient_evidence":false}'],
  ['missing colon', '{"answer" "ok","citations":["E2"],"insufficient_evidence":false}'],
  ['unfinished object', textOf().slice(0, -1)], ['unfinished string', '{"answer":"PRIVATE'],
  ['literal newline', '{"answer":"a\nb","citations":["E2"],"insufficient_evidence":false}'],
  ['literal null control', textOf().replace('A draft answer.', 'a\u0000b')],
  ['bad escape', '{"answer":"\\q","citations":["E2"],"insufficient_evidence":false}'],
  ['short Unicode escape', '{"answer":"\\u123","citations":["E2"],"insufficient_evidence":false}'],
  ['nonhex Unicode escape', '{"answer":"\\u12g4","citations":["E2"],"insufficient_evidence":false}'],
  ['truncated Unicode escape', '{"answer":"\\u'],
  ['single quotes', "{'answer':'ok','citations':['E2'],'insufficient_evidence':false}"],
  ['invalid boolean', '{"answer":"ok","citations":["E2"],"insufficient_evidence":False}'],
  ['boolean trailing token', '{"answer":"ok","citations":["E2"],"insufficient_evidence":falsex}'],
]) test(`complete JSON boundary refuses ${name} without repairing or extracting content`, () => {
  assert.throws(() => inspect(text), error => Object.values(MESSAGES).includes(error.message)
    && ['INVALID_FINANCIAL_OUTPUT_JSON', 'INVALID_FINANCIAL_OUTPUT_SCHEMA'].includes(error.code) && !Object.hasOwn(error, 'cause'));
});
for (const answer of ['', ' ', '\t\n\r', '\u00a0']) test(`non-abstained blank answer ${JSON.stringify(answer)} is rejected`, () => {
  assert.throws(() => inspect(textOf(answer)), safe('INVALID_FINANCIAL_OUTPUT_SCHEMA'));
});
test('non-abstained output requires at least one citation', () => {
  assert.throws(() => inspect(textOf('ok', [])), safe('INVALID_FINANCIAL_OUTPUT_SCHEMA'));
});
for (const answer of ['', ' ', 'The supplied passages do not establish the requested number.', 'Invented explanatory claim 999999.']) {
  test(`explicit abstention allows empty or explanatory answer ${JSON.stringify(answer)} without semantic inference`, () => {
    const result = inspect(textOf(answer, [], true)); assert.equal(result.disposition, 'abstained');
    assert.equal(result.answer, answer); assert.deepEqual(result.citations, []); assert.deepEqual(result.citationBindings, []);
    assert.equal(result.claimSupport, 'unestablished'); assert.equal(result.financialCorrectness, 'unestablished');
  });
}
test('explicit abstention rejects even a valid selected citation', () => {
  assert.throws(() => inspect(textOf('insufficient', ['E2'], true)), safe('INVALID_FINANCIAL_OUTPUT_SCHEMA'));
});
for (const citations of [['E2', 'E2'], ['E999'], ['e2'], ['E02'], [' E2'], ['E2 '], ['E2\n'], ['https://PRIVATE.invalid/file'], [''], ['E0']]) {
  test(`citation identities are exact and never silently filtered: ${JSON.stringify(citations)}`, () => {
    assert.throws(() => inspect(textOf('ok', citations)), safe('INVALID_FINANCIAL_OUTPUT_CITATION'));
  });
}
test('duplicate citation identity is detected after JSON unescaping', () => {
  assert.throws(() => inspect('{"answer":"ok","citations":["E2","\\u00452"],"insufficient_evidence":false}'), safe('INVALID_FINANCIAL_OUTPUT_CITATION'));
});
test('source ordinal citations keep model citation order even when rank differs', () => {
  const result = inspect(textOf('ok', ['E3', 'E1', 'E2']));
  assert.deepEqual(result.citationBindings.map(unit => [unit.citationId, unit.rank, unit.ordinal]), [['E3', 3, 2], ['E1', 2, 0], ['E2', 1, 1]]);
  assert.deepEqual(result.citationBindings.map(unit => unit.pageLabel), ['i', null, 'i']);
});
test('top K one permits only E2, never rank-derived E1 or unselected E3', () => {
  const input = fixture(sourceOf(), OPTIONS, 1);
  assert.deepEqual(inspect(textOf(), undefined, undefined, input).citations, ['E2']);
  for (const citations of [['E1'], ['E3'], ['E2', 'E1']]) {
    assert.throws(() => inspect(textOf('ok', citations), undefined, undefined, input), safe('INVALID_FINANCIAL_OUTPUT_CITATION'));
  }
});
test('citation array cap is enforced before provenance traversal', () => {
  let reads = 0;
  const input = new Proxy({}, { getPrototypeOf() { reads++; throw new Error('PRIVATE'); } });
  assert.throws(() => inspect(textOf('ok', Array(513).fill('E2')), undefined, undefined, input), safe('FINANCIAL_OUTPUT_LIMIT'));
  assert.equal(reads, 0);
});
test('the exact 512 citation cap reaches validated selected-context count checking', () => {
  assert.throws(() => inspect(textOf('ok', Array.from({ length: 512 }, (_, index) => `E${index + 1}`))), safe('INVALID_FINANCIAL_OUTPUT_CITATION'));
});
test('overlapping source and presentation segments preserve actual verified shape and nullable labels', () => {
  const input = fixture(sourceOf([['AB😀C', 'DEF\uD800', '尾']], [null]), { maxChunkUtf16: 6, overlapUtf16: 2 }, 3);
  const context = assembleProvenanceContext(input), ids = context.evidenceUnits.map(unit => unit.citationId).reverse();
  const result = inspect(textOf('ok', ids), undefined, undefined, input);
  assert.deepEqual(result.citationBindings, ids.map(id => binding(context.evidenceUnits.find(unit => unit.citationId === id))));
  assert.ok(result.citationBindings.every(unit => unit.pageLabel === null));
  const sourceSegments = result.citationBindings.flatMap(unit => unit.segments).filter(segment => segment.kind === 'source');
  const presentation = result.citationBindings.flatMap(unit => unit.segments).filter(segment => segment.kind === 'presentation');
  assert.ok(sourceSegments.length > 0); assert.ok(presentation.length > 0);
  for (const segment of presentation) assert.deepEqual(Object.keys(segment).sort(), ['kind', 'text', 'chunkStartUtf16', 'chunkEndUtf16'].sort());
  for (const segment of sourceSegments) assert.deepEqual(Object.keys(segment).sort(), ['kind', 'sourceSpanId', 'itemIndex', 'startUtf16', 'endUtf16', 'quote', 'chunkStartUtf16', 'chunkEndUtf16'].sort());
  assert.ok(input.chunkArtifact.chunks[1].startUtf16 < input.chunkArtifact.chunks[0].endUtf16);
});
test('original exact eight-field provenance is mandatory; an assembled context is never a substitute', () => {
  const input = fixture(); assert.deepEqual(Object.keys(input).sort(), INPUT_KEYS.slice().sort());
  assert.throws(() => inspect(textOf(), undefined, undefined, assembleProvenanceContext(input)), safe('INVALID_FINANCIAL_OUTPUT_CONTEXT'));
  const wrapper = { ...input, context: assembleProvenanceContext(input) };
  assert.throws(() => inspect(textOf(), undefined, undefined, wrapper), safe('INVALID_FINANCIAL_OUTPUT_CONTEXT'));
});
for (const key of INPUT_KEYS) for (const missing of [true, false]) {
  test(`original context ${key} cannot be ${missing ? 'missing' : 'undefined'}`, () => {
    const input = fixture(); if (missing) delete input[key]; else input[key] = undefined;
    assert.throws(() => inspect(textOf(), undefined, undefined, input), safe('INVALID_FINANCIAL_OUTPUT_CONTEXT'));
  });
}
for (const [name, mutate] of [
  ['source quote', input => { input.source.pages[0].textItems[0].span.quote = 'PRIVATE_FORGED'; }],
  ['source SHA', input => { input.source.source.sha256 = 'b'.repeat(64); }],
  ['chunk text', input => { input.chunkArtifact.chunks[0].text = 'PRIVATE_FORGED'; }],
  ['segment', input => { input.chunkArtifact.chunks[0].segments[0].sourceSpanId = 'PRIVATE_FORGED'; }],
  ['embedding order', input => input.embeddingArtifact.chunkIds.reverse()],
  ['embedding norm', input => { input.embeddingArtifact.vectors[0][0] = 2; }],
  ['candidate score', input => { input.queryResult.retrieval.candidates[0].score = 0.5; }],
  ['candidate rank', input => input.queryResult.retrieval.candidates.reverse()],
  ['terminal receipt', input => { input.queryMetadata.retrieval.returnedCount--; }],
  ['download total', input => { input.queryDownloadTotal++; }],
  ['throwing getter', input => { Object.defineProperty(input, 'question', { get() { throw new Error('PRIVATE_QUESTION https://PRIVATE.invalid'); } }); }],
  ['impersonated error', input => { Object.defineProperty(input, 'source', { get() { throw new GenerationContractError('INVALID_GENERATION_CONFIG'); } }); }],
]) test(`original provenance is revalidated for changed ${name} with private errors`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => inspect(textOf(), undefined, undefined, input), safe('INVALID_FINANCIAL_OUTPUT_CONTEXT'));
});
for (const [name, mutate] of [
  ['pages', input => { input.source.pages = new Array(513); }],
  ['source text', input => { input.source.pages[0].textItems[0].text = 'x'.repeat(2000001); }],
  ['chunks', input => { input.chunkArtifact.chunks = new Array(10001); }],
  ['chunk text', input => { input.chunkArtifact.chunks[0].text = 'x'.repeat(4097); }],
  ['fragments', input => { input.chunkArtifact.chunks[0].segments = new Array(200001); }],
  ['selected units', input => { input.topK = 513; }],
  ['question', input => { input.question = 'x'.repeat(4097); }],
  ['source name', input => { input.source.source.name = 'x'.repeat(4097); }],
  ['page label', input => { input.source.pages[0].pageLabel = 'x'.repeat(4097); }],
]) test(`existing provenance limits remain enforced for ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => inspect(textOf(), undefined, undefined, input), safe('INVALID_FINANCIAL_OUTPUT_CONTEXT'));
});
test('receipt ownership never freezes caller input and mutations cannot change accepted output', () => {
  const input = fixture(), accepted = preflight(), ids = [5, 6, 7, 151645];
  const result = inspect(textOf('PRIVATE_ANSWER', ['E1', 'E2']), ids, accepted, input);
  assertFrozen(result);
  for (const value of [input, input.source, input.source.pages[0], input.chunkArtifact, input.chunkArtifact.chunks[0].segments,
    input.embeddingArtifact, input.queryResult, input.queryMetadata, accepted, accepted.settings, ids]) assert.equal(Object.isFrozen(value), false);
  input.source.source.name = 'CHANGED'; input.chunkArtifact.chunks[0].segments[0].quote = 'CHANGED';
  input.queryResult.query.vector[1] = 9; input.queryMetadata.query.receipt.elapsedMs = 99;
  accepted.settings.top_p = 0; ids[0] = 9;
  assert.equal(result.source.name, 'PRIVATE_SOURCE.pdf');
  assert.equal(result.citationBindings[0].segments[0].quote, '  PRIVATE_ALPHA\n😀  ');
  assert.equal(result.answer, 'PRIVATE_ANSWER');
  assert.throws(() => { result.citations.push('E3'); }, TypeError);
  assert.throws(() => { result.citationBindings[0].segments[0].quote = 'CHANGED'; }, TypeError);
});
test('validated getters are captured once without later copying unvalidated caller fields', () => {
  const input = fixture(), original = input.chunkArtifact.chunks[0].text; let reads = 0;
  Object.defineProperty(input.chunkArtifact.chunks[0], 'text', { enumerable: true,
    get() { reads++; return reads === 1 ? original : 'PRIVATE_AFTER_VALIDATION'; } });
  const result = inspect(textOf('ok', ['E1']), undefined, undefined, input);
  assert.equal(result.citationBindings[0].text, original); assert.equal(reads, 1);
});
test('a fabricated financial number can pass shape without proving correctness or claim support', () => {
  const result = inspect(textOf('Revenue was $999999999 billion in fiscal 2099.', ['E2']));
  assert.equal(result.financialCorrectness, 'unestablished'); assert.equal(result.claimSupport, 'unestablished');
  assert.equal(result.status, 'unverified-financial-draft'); assert.equal(result.generationMode, 'not-run');
});
test('FinancialOutputError exposes only fixed safe codes/messages and safe fallback', () => {
  assert.equal(typeof outputModule.FinancialOutputError, 'function', 'FinancialOutputError export');
  for (const code of Object.keys(MESSAGES)) assert.ok(safe(code)(new outputModule.FinancialOutputError(code)));
  for (const code of ['PRIVATE filename https://PRIVATE.invalid E999', '__proto__', 'constructor', null, undefined, 1, {},
    { toString() { throw new Error('PRIVATE'); } }]) {
    assert.ok(safe('FINANCIAL_OUTPUT_FAILED')(new outputModule.FinancialOutputError(code)));
  }
});
