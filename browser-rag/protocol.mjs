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

  return {
    begin(operation) {
      const identity = Object.freeze({
        protocolVersion: 1,
        runtimeId,
        operationId: `op-${nextOperationId++}`,
        documentEpoch: 0,
        operation,
      });
      state = {
        runtimeId,
        documentEpoch: 0,
        active: { ...identity, lastSeq: 0, stage: null, progress: null },
        terminal: null,
      };
      return identity;
    },
    accept(event) {
      if (state.active === null) {
        return { accepted: false, reason: 'no-active-operation' };
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
  };
}
