import { encodeQuery, EmbeddingRuntimeError } from './embedding-runtime.mjs';
import { rankCandidates, RetrievalError } from './retrieval.mjs';
import { QueryWorkerError, copyQueryCommand, createQueryStageGuard,
  copyQueryArtifact, copyQueryResult, queryResultReceipt } from './query-source.mjs';
import { suppressWorkerConsole } from './worker-console.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// This pure handler owns a single validated command and no browser or console
// globals. Passage vectors are accepted once; only the question is encoded.
export function createQueryCommandHandler(send, options = {}) {
  let encode;
  try {
    if (typeof send !== 'function' || !record(options) || Reflect.ownKeys(options).some(key => key !== 'encode')) {
      throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
    }
    ({ encode = encodeQuery } = options);
    if (typeof encode !== 'function') throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
  } catch { throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG'); }
  let consumed = false;
  const emit = packet => { try { send(packet); } catch { throw new QueryWorkerError('QUERY_FAILED'); } };
  return raw => {
    if (consumed) throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
    const command = copyQueryCommand(raw);
    consumed = true; // Revoke second-command permission before any awaited work.
    const { identity, question, chunkArtifact: source, embeddingArtifact: passages, topK } = command;
    const stages = createQueryStageGuard(source.counts.chunks); let seq = 0, active = true;
    function progress(stage, payload) {
      if (!active || seq >= Number.MAX_SAFE_INTEGER - 1) throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
      const accepted = stages.accept(stage, payload);
      emit({ event: Object.freeze({ ...identity, kind: 'progress', stage, seq: ++seq, payload: accepted }) });
    }
    function terminal(kind, payload, artifact) {
      if (!active || seq >= Number.MAX_SAFE_INTEGER) throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
      active = false;
      const event = Object.freeze({ ...identity, kind, stage: stages.stage, seq: ++seq, payload });
      emit(artifact === undefined ? { event } : { event, artifact });
    }
    return (async () => {
      try {
        const encoded = await encode(question, { onProgress: progress });
        stages.assertEncoded();
        const query = copyQueryArtifact(encoded, stages.downloadTotal);
        stages.assertEncoded(query.counts.totalTokens);
        progress('rank', { completed: 0, total: source.counts.chunks, unit: 'chunks', estimated: false });
        const retrieval = rankCandidates(source, passages, {
          representationId: query.representationId, representation: query.representation, vector: query.vector }, { topK });
        progress('rank', { completed: source.counts.chunks, total: source.counts.chunks, unit: 'chunks', estimated: false });
        stages.assertComplete(query.counts.totalTokens);
        const artifact = copyQueryResult({ query, retrieval }, source, passages, topK, stages.downloadTotal);
        terminal('result', Object.freeze({ data: queryResultReceipt(artifact) }), artifact);
      } catch (error) {
        if (!active) throw new QueryWorkerError('QUERY_FAILED');
        let code = 'QUERY_FAILED';
        try {
          if (error instanceof EmbeddingRuntimeError || error instanceof RetrievalError || error instanceof QueryWorkerError) code = error.code;
        } catch { /* Diagnostics and hostile getters cannot cross this channel. */ }
        const safe = new QueryWorkerError(code);
        terminal('error', Object.freeze({ code: safe.code, message: safe.message }));
      }
      return true;
    })();
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope
    && typeof globalThis.postMessage === 'function') {
  const handle = createQueryCommandHandler(packet => globalThis.postMessage(packet), {
    encode(question, options) {
      try { suppressWorkerConsole(); } catch { throw new QueryWorkerError('QUERY_FAILED'); }
      return encodeQuery(question, options);
    },
  });
  const safeChannelFailure = () => { throw new QueryWorkerError('WORKER_PROTOCOL_ERROR'); };
  globalThis.addEventListener('message', message => {
    try { handle(message.data).catch(() => globalThis.setTimeout(safeChannelFailure, 0)); }
    catch { safeChannelFailure(); }
  });
  globalThis.postMessage({ kind: 'query-ready', protocolVersion: 1, workerVersion: 'query-v1' });
}
