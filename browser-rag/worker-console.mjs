import { EmbeddingWorkerError } from './embedding-source.mjs';

// Pinned Transformers.js logs raw inference exceptions and tensors. Muting is
// deliberately confined to the owned native worker, after a validated command
// and before dynamic SDK import. It stays muted throughout SDK cleanup.
export function suppressWorkerConsole() {
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
