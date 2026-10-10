import { copyValidatedChunkArtifact } from './compute-source.mjs';
import { projectEmbeddingInput } from './embedding-source.mjs';
import { copyQueryPassages, copyQueryResult } from './query-source.mjs';

const MESSAGES = Object.freeze({
  INVALID_CONTEXT_INPUT: 'The provenance context input is invalid.',
  INVALID_CONTEXT_ARTIFACT: 'The provenance context artifacts are inconsistent.',
  CONTEXT_FAILED: 'The provenance context could not be assembled safely.',
});
const INPUT_KEYS = ['source', 'chunkArtifact', 'embeddingArtifact', 'question', 'queryResult', 'topK', 'queryDownloadTotal', 'queryMetadata'];
const MAX_QUERY_BYTES = 128 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every(key => keys.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = code => { throw new ContextError(code); };

export class ContextError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'CONTEXT_FAILED';
    super(MESSAGES[safe]); this.name = 'ContextError'; this.code = safe;
  }
}
function fields(value, keys) {
  const owned = {};
  for (const key of keys) owned[key] = value[key];
  return owned;
}
function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Pure provenance consistency only. The owned session must separately bind the
// raw question to its query attempt; this does not authenticate source rights,
// prove semantic question/vector identity, render a prompt or generate an answer.
export function assembleProvenanceContext(input) {
  try {
    if (!exact(input, INPUT_KEYS)) fail('INVALID_CONTEXT_INPUT');
    input = fields(input, INPUT_KEYS);
    if (INPUT_KEYS.some(key => input[key] === undefined)
        || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 4096
        || !positive(input.topK) || input.topK > 512
        || !positive(input.queryDownloadTotal) || input.queryDownloadTotal > MAX_QUERY_BYTES) fail('INVALID_CONTEXT_INPUT');
  } catch { fail('INVALID_CONTEXT_INPUT'); }
  try {
    // Explicit exact terminal metadata prevents the shared query copier's
    // optional metadata defaults from weakening this boundary.
    if (!exact(input.queryMetadata, ['query', 'retrieval'])) fail('INVALID_CONTEXT_ARTIFACT');
    const metadata = fields(input.queryMetadata, ['query', 'retrieval']);
    if (metadata.query === undefined || metadata.retrieval === undefined) fail('INVALID_CONTEXT_ARTIFACT');
    const chunks = copyValidatedChunkArtifact(input.source, input.chunkArtifact);
    const projection = projectEmbeddingInput(chunks);
    const passages = copyQueryPassages(input.embeddingArtifact, projection);
    // Shared copier independently recomputes the exact ranker and checks each
    // candidate field, position and receipt; no duplicate cosine implementation
    // is introduced here.
    const result = copyQueryResult(input.queryResult, projection, passages, input.topK,
      input.queryDownloadTotal, metadata);
    const evidenceUnits = [];
    for (let index = 0; index < result.retrieval.candidates.length; index++) {
      const candidate = result.retrieval.candidates[index], chunk = chunks.chunks[candidate.ordinal];
      evidenceUnits.push({ citationId: `E${candidate.ordinal + 1}`, rank: index + 1,
        ...candidate, physicalPageNumber: chunk.physicalPageNumber, pageLabel: chunk.pageLabel,
        startUtf16: chunk.startUtf16, endUtf16: chunk.endUtf16, text: chunk.text, segments: chunk.segments });
    }
    return freeze({ schemaVersion: 1, status: 'context-not-generated', question: input.question,
      source: chunks.source, parser: chunks.parser, numPages: chunks.numPages, workerMode: chunks.workerMode,
      chunker: chunks.chunker, counts: chunks.counts, representation: result.query.representation,
      query: result.query, retrieval: result.retrieval, evidenceUnits, omissions: [] });
  } catch { fail('INVALID_CONTEXT_ARTIFACT'); }
}
