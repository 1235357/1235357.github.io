import { EMBEDDING_SPEC, acceptEmbeddingVectors } from './embedding-contract.mjs';
import { projectEmbeddingInput, copyEmbeddingArtifact } from './embedding-source.mjs';

export class RetrievalError extends Error {
  constructor() {
    super('The retrieval input is invalid.');
    this.name = 'RetrievalError'; this.code = 'INVALID_RETRIEVAL_INPUT';
  }
}
const fail = () => { throw new RetrievalError(); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const QUERY_KEYS = ['representationId', 'representation', 'vector'];
const REPRESENTATION_KEYS = Object.keys(EMBEDDING_SPEC);

function snapshot(value, keys) {
  if (!record(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) fail();
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
function denseVector(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length !== EMBEDDING_SPEC.dimensions
      || Reflect.ownKeys(value).length !== value.length + 1) fail();
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, index);
    if (entry?.enumerable !== true || !Object.hasOwn(entry, 'value')) fail();
  }
  return acceptEmbeddingVectors([value], 1)[0];
}
function norm(vector) {
  let squared = 0;
  for (const component of vector) squared += component * component;
  return Math.sqrt(squared);
}

// This exact scan returns source-linked candidates only. Neither the caller's
// inputs nor accepted vectors are normalized, repaired or retained in results.
export function rankCandidates(chunkArtifact, embeddingArtifact, query, options = {}) {
  try {
    if (!record(options) || Reflect.ownKeys(options).some(key => key !== 'topK')) fail();
    const configuredTopK = options.topK, topK = configuredTopK === undefined ? 5 : configuredTopK;
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > EMBEDDING_SPEC.maxChunks) fail();

    const source = projectEmbeddingInput(chunkArtifact);
    const passages = copyEmbeddingArtifact(embeddingArtifact, source, embeddingArtifact.receipt.verifiedBytes);
    const querySnapshot = snapshot(query, QUERY_KEYS);
    const representation = snapshot(querySnapshot.representation, REPRESENTATION_KEYS);
    if (querySnapshot.representationId !== EMBEDDING_SPEC.version
        || REPRESENTATION_KEYS.some(key => representation[key] !== EMBEDDING_SPEC[key])) fail();
    const queryVector = denseVector(querySnapshot.vector), queryNorm = norm(queryVector);

    const candidates = passages.vectors.map((vector, ordinal) => {
      let dotProduct = 0;
      for (let index = 0; index < EMBEDDING_SPEC.dimensions; index++) dotProduct += queryVector[index] * vector[index];
      const chunkNorm = norm(vector);
      return Object.freeze({ chunkId: passages.chunkIds[ordinal], ordinal,
        score: dotProduct / (queryNorm * chunkNorm), dotProduct, chunkNorm });
    });
    candidates.sort((left, right) => right.score - left.score || left.ordinal - right.ordinal);
    const selected = Object.freeze(candidates.slice(0, topK));
    return Object.freeze({ schemaVersion: 1, status: 'candidates-only', sourceSha256: passages.sourceSha256,
      representationId: passages.representationId, requestedTopK: topK, returnedCount: selected.length,
      queryNorm, candidates: selected });
  } catch { fail(); }
}
