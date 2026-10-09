function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const IDENTITY_KEYS = ['protocolVersion', 'runtimeId', 'operationId', 'documentEpoch', 'operation'];
const EVENT_KEYS = [...IDENTITY_KEYS, 'kind', 'stage', 'seq', 'payload'];
const STAGES = new Map([
  ['model-load', ['download', 'initialize']], ['ingest', ['parse', 'index']],
  ['embed', ['download', 'initialize', 'encode']],
  ['query', ['encode', 'rank', 'context', 'generate', 'release']], ['clear', ['clear']],
]);
const UNITS = new Set(['bytes', 'pages', 'chunks', 'tokens']);
const MAX_JSON_BYTES = 256 * 1024;
const utf8 = new TextEncoder();

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

// Bounded metadata only, never PDF bytes, model tensors or an answer schema.
// Charge the eventual JSON representation incrementally, before a large whole
// serialization can be allocated. Repeated references are legal; cycles are not.
function copyResultData(data) {
  let visited = 0;
  let bytes = 0;
  const ancestors = new WeakSet();
  function invalid() { throw new TypeError('Invalid result metadata'); }
  function charge(fragment) {
    bytes += utf8.encode(fragment).byteLength;
    if (bytes > MAX_JSON_BYTES) invalid();
  }
  function stringFragment(value) {
    if (value.length > MAX_JSON_BYTES) invalid();
    return JSON.stringify(value);
  }
  function copy(value, depth) {
    if (++visited > 4096 || depth > 32) invalid();
    if (value === null || typeof value === 'boolean') {
      charge(JSON.stringify(value)); return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      charge(JSON.stringify(value)); return value;
    }
    if (typeof value === 'string') { charge(stringFragment(value)); return value; }
    if (typeof value !== 'object' || ancestors.has(value)) invalid();
    const array = Array.isArray(value);
    if (!array && !isRecord(value)) invalid();
    const keys = Reflect.ownKeys(value);
    if (array && (value.length > 4096 - visited || keys.length !== value.length + 1)) invalid();
    if (!array && (keys.length > 4096 - visited || keys.some(key => typeof key !== 'string'))) invalid();
    ancestors.add(value);
    try {
      if (array) {
        charge('[');
        const result = [];
        for (let index = 0; index < value.length; index++) {
          if (!Object.hasOwn(value, index)) invalid();
          if (index > 0) charge(',');
          result.push(copy(value[index], depth + 1));
        }
        charge(']'); return result;
      }
      charge('{');
      const entries = keys.map((key, index) => {
        if (index > 0) charge(',');
        charge(stringFragment(key)); charge(':');
        return [key, copy(value[key], depth + 1)];
      });
      charge('}'); return Object.fromEntries(entries);
    } finally { ancestors.delete(value); }
  }
  return copy(data, 0);
}

function copyPayload(event) {
  const payload = event.payload;
  if (event.kind === 'progress') {
    if (!exactKeys(payload, ['completed', 'total', 'unit', 'estimated'])
        || typeof payload.completed !== 'number' || !Number.isFinite(payload.completed)
        || payload.completed < 0 || !UNITS.has(payload.unit)
        || typeof payload.estimated !== 'boolean'
        || (payload.total !== null && (typeof payload.total !== 'number'
          || !Number.isFinite(payload.total) || payload.total < payload.completed))) {
      throw new TypeError('Invalid progress');
    }
    return { completed: payload.completed, total: payload.total,
      unit: payload.unit, estimated: payload.estimated };
  }
  if (event.kind === 'result' && exactKeys(payload, ['data'])) {
    return { data: copyResultData(payload.data) };
  }
  if (event.kind === 'error' && exactKeys(payload, ['code', 'message'])
      && nonemptyString(payload.code) && nonemptyString(payload.message)) {
    return { code: payload.code, message: payload.message };
  }
  if (event.kind === 'cancelled' && exactKeys(payload, ['reason'])
      && payload.reason === 'worker-cancelled') return { reason: payload.reason };
  throw new TypeError('Invalid terminal payload');
}

export function createController(runtimeId) {
  if (!nonemptyString(runtimeId)) throw new TypeError('Runtime incarnation ID must be nonempty');
  let state = { runtimeId, documentEpoch: 0, active: null, terminal: null };
  let nextOperationId = 1;
  const seenRuntimeIds = new Set([runtimeId]);

  function cancelActive(reason) {
    if (state.active === null) return;
    const { lastSeq, stage, progress, ...identity } = state.active;
    state = {
      ...state, active: null,
      terminal: { ...identity, kind: 'cancelled', stage, seq: null,
        payload: { reason } },
    };
  }

  return {
    begin(operation) {
      if (state.active !== null) throw new Error('An operation is already active');
      if (!STAGES.has(operation)) throw new TypeError('Unknown operation');
      const identity = Object.freeze({
        protocolVersion: 1,
        runtimeId,
        operationId: `op-${nextOperationId++}`,
        documentEpoch: state.documentEpoch,
        operation,
      });
      state = {
        runtimeId,
        documentEpoch: state.documentEpoch,
        active: { ...identity, lastSeq: 0, stage: null, progress: null },
        terminal: null,
      };
      return identity;
    },
    accept(event) {
      if (state.active === null) {
        return { accepted: false, reason: 'no-active-operation' };
      }
      if (!exactKeys(event, EVENT_KEYS)) return { accepted: false, reason: 'invalid-event-schema' };
      for (const key of IDENTITY_KEYS) {
        if (event[key] !== state.active[key]) {
          return { accepted: false, reason: 'identity-mismatch' };
        }
      }

      if (!Number.isSafeInteger(event.seq) || event.seq <= 0 || event.seq <= state.active.lastSeq) {
        return { accepted: false, reason: 'invalid-sequence' };
      }
      if (!STAGES.get(state.active.operation).includes(event.stage)) {
        return { accepted: false, reason: 'invalid-stage' };
      }
      let payload;
      try { payload = copyPayload(event); }
      catch { return { accepted: false, reason: 'invalid-payload' }; }

      if (event.kind === 'progress') {
        state = {
          ...state,
          active: {
            ...state.active,
            lastSeq: event.seq,
            stage: event.stage,
            progress: payload,
          },
        };
        return { accepted: true };
      }

      if (['result', 'error', 'cancelled'].includes(event.kind)) {
        const { lastSeq, stage, progress, ...identity } = state.active;
        state = {
          ...state,
          active: null,
          terminal: {
            ...identity,
            kind: event.kind,
            stage: event.stage,
            seq: event.seq,
            payload,
          },
        };
        return { accepted: true };
      }

      return { accepted: false, reason: 'unsupported-event-kind' };
    },
    snapshot() {
      return deepFreeze(structuredClone(state));
    },
    cancel() { cancelActive('user'); },
    replaceDocument() {
      cancelActive('document-replaced');
      state = { ...state, documentEpoch: state.documentEpoch + 1 };
    },
    replaceRuntime(newRuntimeId) {
      if (!nonemptyString(newRuntimeId) || seenRuntimeIds.has(newRuntimeId)) {
        throw new TypeError('Runtime incarnation ID must be nonempty and never reused');
      }
      cancelActive('runtime-replaced');
      seenRuntimeIds.add(newRuntimeId);
      runtimeId = newRuntimeId;
      nextOperationId = 1;
      state = { ...state, runtimeId };
    },
  };
}
