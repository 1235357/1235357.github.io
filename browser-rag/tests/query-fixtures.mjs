import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { rankCandidates } from '../retrieval.mjs';
export const HASH = 'a'.repeat(64);
export const READY = { kind: 'query-ready', protocolVersion: 1, workerVersion: 'query-v1' };
export const identity = () => ({ protocolVersion: 1, runtimeId: 'query-test', operationId: 'op-1', documentEpoch: 2, operation: 'query' });
export const input = () => ({ schemaVersion: 1, status: 'chunked-not-embedded', source: { sha256: HASH }, counts: { chunks: 2 },
  chunks: [{ id: 'PRIVATE_ALPHA', text: 'PRIVATE_TEXT_ALPHA' }, { id: 'PRIVATE_BETA', text: 'PRIVATE_TEXT_BETA' }] });
export const vector = (axis = 0) => Array.from({ length: 384 }, (_, index) => index === axis ? 1 : 0);
export const passages = () => ({ schemaVersion: 1, status: 'embedded-not-retrieved', sourceSha256: HASH,
  representationId: EMBEDDING_SPEC.version, representation: { ...EMBEDDING_SPEC }, backend: 'webgpu', dtype: 'fp32',
  chunkIds: input().chunks.map(chunk => chunk.id), tokenIds: [[101, 42, 102], [101, 43, 102]], vectors: [vector(), vector(1)],
  counts: { chunks: 2, totalTokens: 6, dimensions: 384 }, receipt: { verifiedBytes: 200, networkBytes: 150, cacheBytes: 50, elapsedMs: 2 } });
export const query = () => ({ schemaVersion: 1, status: 'query-embedded-not-retrieved', representationId: EMBEDDING_SPEC.version,
  representation: { ...EMBEDDING_SPEC }, backend: 'webgpu', dtype: 'fp32', tokenIds: [101, 44, 102], vector: vector(1),
  counts: { totalTokens: 3, dimensions: 384 }, receipt: { verifiedBytes: 100, networkBytes: 70, cacheBytes: 30, elapsedMs: 1 } });
export const queryMetadata = value => Object.fromEntries(['representationId', 'status', 'backend', 'dtype', 'counts', 'receipt'].map(key => [key, structuredClone(value[key])]));
export const retrievalMetadata = value => Object.fromEntries(['sourceSha256', 'representationId', 'status', 'requestedTopK', 'returnedCount', 'queryNorm'].map(key => [key, value[key]]));
export function resultArtifact(topK = 5) {
  const value = query(); return { query: value, retrieval: structuredClone(rankCandidates(input(), passages(), {
    representationId: value.representationId, representation: value.representation, vector: value.vector }, { topK })) };
}
export const resultMetadata = value => ({ query: queryMetadata(value.query), retrieval: retrievalMetadata(value.retrieval) });
export const event = (kind, stage, seq, payload, id = identity()) => ({ ...id, kind, stage, seq, payload });
export const progress = (stage, seq, completed, total, unit = stage === 'download' ? 'bytes' : stage === 'rank' ? 'chunks' : 'tokens') =>
  ({ event: event('progress', stage, seq, { completed, total, unit, estimated: false }) });
export const stagePackets = () => [progress('download', 1, 0, 100), progress('download', 2, 100, 100),
  progress('initialize', 3, 0, null), progress('encode', 4, 0, 3), progress('encode', 5, 3, 3), progress('rank', 6, 0, 2), progress('rank', 7, 2, 2)];
export const encodeStages = onProgress => { for (const packet of stagePackets().slice(0, 5)) onProgress(packet.event.stage, packet.event.payload); };
export const result = (value = resultArtifact(), seq = 8) => ({ event: event('result', 'rank', seq, { data: resultMetadata(value) }), artifact: value });
export const command = () => ({ kind: 'query-candidates', identity: identity(), question: 'PRIVATE_QUESTION', chunkArtifact: input(), embeddingArtifact: passages(), topK: 5 });
export const code = expected => error => error?.name === 'QueryWorkerError' && error.code === expected && !error.message.includes('PRIVATE');
export class ControlledWorker {
  listeners = new Map(); sent = []; terminated = 0; captured; onTerminate;
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); if (type === 'message') this.captured = listener; }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(command) { this.sent.push(command); }
  terminate() { this.terminated++; this.onTerminate?.(); }
  emit(type, data) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(type === 'message' ? { data } : data); }
  ready() { this.emit('message', READY); }
  stages() { stagePackets().forEach(packet => this.emit('message', packet)); }
}
export function clean(worker) { if (worker.terminated !== 1 || [...worker.listeners.values()].some(set => set.size)) throw new Error('worker was not cleaned once'); }
