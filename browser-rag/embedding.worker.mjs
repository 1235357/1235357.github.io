import { encodeChunks, EmbeddingRuntimeError } from './embedding-runtime.mjs';
import { EmbeddingWorkerError, isEmbeddingCommand, isEmbeddingIdentity, projectEmbeddingInput,
  createEmbeddingStageGuard, copyEmbeddingArtifact, embeddingReceipt } from './embedding-source.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// The pure handler owns one command. It never reads console, navigator or a
// browser channel. Invalid commands cannot author a fictitious lifecycle ID.
export function createEmbeddingCommandHandler(send, options = {}) {
  let encode;
  try {
    if (typeof send !== 'function' || !record(options) || Reflect.ownKeys(options).some(key => key !== 'encode')) {
      throw new EmbeddingWorkerError('INVALID_EMBEDDING_WORKER_CONFIG');
    }
    ({ encode = encodeChunks } = options);
    if (typeof encode !== 'function') throw new EmbeddingWorkerError('INVALID_EMBEDDING_WORKER_CONFIG');
  } catch { throw new EmbeddingWorkerError('INVALID_EMBEDDING_WORKER_CONFIG'); }
  let consumed = false;
  function emit(packet) {
    try { send(packet); } catch { throw new EmbeddingWorkerError('EMBEDDING_FAILED'); }
  }
  return command => {
    let source, identity;
    try {
      if (consumed || !isEmbeddingCommand(command)) throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
      source = projectEmbeddingInput(command.chunkArtifact);
      identity = Object.freeze(Object.fromEntries(['protocolVersion', 'runtimeId', 'operationId', 'documentEpoch', 'operation']
        .map(key => [key, command.identity[key]])));
      if (!isEmbeddingIdentity(identity)) throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
    } catch { throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR'); }
    consumed = true;
    const stages = createEmbeddingStageGuard(source.counts.chunks); let seq = 0;
    function progress(stage, payload) {
      // Reserve the largest safe sequence for a terminal event. Never emit a
      // progress packet that leaves no possible strictly-increasing terminal.
      if (seq >= Number.MAX_SAFE_INTEGER - 1) throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
      const accepted = stages.accept(stage, payload);
      emit({ event: Object.freeze({ ...identity, kind: 'progress', stage, seq: ++seq, payload: accepted }) });
    }
    function terminal(kind, payload, artifact) {
      if (seq >= Number.MAX_SAFE_INTEGER) throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
      const event = Object.freeze({ ...identity, kind, stage: stages.stage, seq: ++seq, payload });
      emit(artifact === undefined ? { event } : { event, artifact });
    }
    return (async () => {
      try {
        const encoded = await encode(source, { onProgress: progress });
        stages.assertComplete();
        const artifact = copyEmbeddingArtifact(encoded, source, stages.downloadTotal);
        terminal('result', Object.freeze({ data: embeddingReceipt(artifact) }), artifact);
      } catch (error) {
        let code = 'EMBEDDING_FAILED';
        try {
          if (error instanceof EmbeddingRuntimeError || error instanceof EmbeddingWorkerError) code = error.code;
        } catch { /* hostile diagnostics cannot escape error normalization */ }
        const safe = new EmbeddingWorkerError(code);
        terminal('error', Object.freeze({ code: safe.code, message: safe.message }));
      }
      return true;
    })();
  };
}

// Pinned Transformers.js logs raw inference exceptions and tensors. Muting is
// deliberately confined to the owned native worker, after a validated command
// and before dynamic SDK import. It stays muted throughout SDK cleanup.
function suppressWorkerConsole() {
  try {
    const target = globalThis.console;
    if (!target || typeof target !== 'object') throw new Error();
    const keys = new Set(['log', 'error', 'warn', 'info', 'debug', 'trace', 'table', 'dir', 'dirxml', 'assert',
      'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'timeLog', 'count', 'countReset', 'clear',
      'profile', 'profileEnd', 'timeStamp']);
    let prototype = target, depth = 0;
    while (prototype && prototype !== Object.prototype) {
      if (++depth > 8) throw new Error();
      for (const key of Reflect.ownKeys(prototype)) {
        if (key !== 'constructor' && typeof target[key] === 'function') keys.add(key);
        if (keys.size > 256) throw new Error();
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    const quiet = () => {};
    for (const key of keys) {
      if (!Reflect.set(target, key, quiet) || target[key] !== quiet) throw new Error();
    }
  } catch { throw new EmbeddingWorkerError('EMBEDDING_FAILED'); }
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope
    && typeof globalThis.postMessage === 'function') {
  const handle = createEmbeddingCommandHandler(packet => globalThis.postMessage(packet), {
    encode(source, options) { suppressWorkerConsole(); return encodeChunks(source, options); },
  });
  const safeChannelFailure = () => { throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR'); };
  globalThis.addEventListener('message', message => {
    try {
      const pending = handle(message.data);
      // Browser event listeners do not await promises. Turn a channel/send
      // failure into a native worker error using only the fixed safe message.
      pending.catch(() => globalThis.setTimeout(safeChannelFailure, 0));
    } catch { safeChannelFailure(); }
  });
  globalThis.postMessage({ kind: 'embedding-ready', protocolVersion: 1, workerVersion: 'embedding-v1' });
}
