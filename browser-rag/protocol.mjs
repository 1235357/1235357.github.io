function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function createController(runtimeId) {
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
      for (const key of ['protocolVersion', 'runtimeId', 'operationId', 'documentEpoch', 'operation']) {
        if (event[key] !== state.active[key]) {
          return { accepted: false, reason: 'identity-mismatch' };
        }
      }

      if (event.kind === 'progress') {
        state = {
          ...state,
          active: {
            ...state.active,
            lastSeq: event.seq,
            stage: event.stage,
            progress: structuredClone(event.payload),
          },
        };
        return { accepted: true };
      }

      if (event.kind === 'result') {
        const { lastSeq, stage, progress, ...identity } = state.active;
        state = {
          ...state,
          active: null,
          terminal: {
            ...identity,
            kind: event.kind,
            stage: event.stage,
            seq: event.seq,
            payload: structuredClone(event.payload),
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
      if (typeof newRuntimeId !== 'string' || newRuntimeId.trim().length === 0
          || seenRuntimeIds.has(newRuntimeId)) {
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
