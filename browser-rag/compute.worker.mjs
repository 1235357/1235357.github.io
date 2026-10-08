import { chunkSource, ChunkingError } from './chunking.mjs';
import { ComputeError, isComputeIdentity } from './compute-source.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every(key => keys.includes(key));

// The same handler is unit-tested in Node and installed separately in a native
// module worker. Node imports never announce browser readiness or own a channel.
export function createComputeCommandHandler(send) {
  if (typeof send !== 'function') throw new ComputeError('INVALID_COMPUTE_CONFIG');
  let consumed = false;
  function emit(packet) {
    try { send(packet); } catch { throw new ComputeError('COMPUTE_FAILED'); }
  }
  return command => {
    if (consumed || !exact(command, ['kind', 'identity', 'source', 'options'])
        || command.kind !== 'chunk-source' || !isComputeIdentity(command.identity)) {
      // No valid identity means no truthful lifecycle error can be authored.
      throw new ComputeError('WORKER_PROTOCOL_ERROR');
    }
    consumed = true;
    const identity = Object.fromEntries(['protocolVersion', 'runtimeId', 'operationId', 'documentEpoch', 'operation']
      .map(key => [key, command.identity[key]]));
    emit({ event: { ...identity, kind: 'progress', stage: 'index', seq: 1,
      payload: { completed: 0, total: null, unit: 'chunks', estimated: false } } });
    let artifact;
    try { artifact = chunkSource(command.source, command.options); }
    catch (error) {
      const safe = new ComputeError(error instanceof ChunkingError ? error.code : 'COMPUTE_FAILED');
      emit({ event: { ...identity, kind: 'error', stage: 'index', seq: 2,
        payload: { code: safe.code, message: safe.message } } });
      return true;
    }
    emit({ event: { ...identity, kind: 'result', stage: 'index', seq: 2,
      payload: { data: { sourceSha256: artifact.source.sha256, parserVersion: artifact.parser.version,
        pageCount: artifact.numPages, status: artifact.status, chunkerVersion: artifact.chunker.version,
        counts: { ...artifact.counts } } } }, artifact });
    return true;
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope
    && typeof globalThis.postMessage === 'function') {
  const handle = createComputeCommandHandler(packet => globalThis.postMessage(packet));
  globalThis.addEventListener('message', message => {
    try { handle(message.data); }
    catch (error) {
      // Invalid commands fail the channel. Never invent an identity or expose
      // raw exception messages, filenames or PDF text in the worker error.
      throw new ComputeError(error instanceof ComputeError ? error.code : 'COMPUTE_FAILED');
    }
  });
  globalThis.postMessage({ kind: 'compute-ready', protocolVersion: 1, workerVersion: 'chunks-v1' });
}
