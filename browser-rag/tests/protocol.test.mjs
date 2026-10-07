import assert from 'node:assert/strict';
import test from 'node:test';
import { createController } from '../protocol.mjs';

test('an ingest accepts progress and completes exactly once', () => {
  const controller = createController('runtime-1');
  const identity = controller.begin('ingest');

  assert.deepEqual(identity, {
    protocolVersion: 1,
    runtimeId: 'runtime-1',
    operationId: 'op-1',
    documentEpoch: 0,
    operation: 'ingest',
  });
  assert.deepEqual(controller.snapshot(), {
    runtimeId: 'runtime-1',
    documentEpoch: 0,
    active: {
      protocolVersion: 1,
      runtimeId: 'runtime-1',
      operationId: 'op-1',
      documentEpoch: 0,
      operation: 'ingest',
      lastSeq: 0,
      stage: null,
      progress: null,
    },
    terminal: null,
  });

  assert.deepEqual(controller.accept({
    ...identity,
    kind: 'progress',
    stage: 'parse',
    seq: 1,
    payload: { completed: 1, total: 2, unit: 'pages', estimated: false },
  }), { accepted: true });
  assert.deepEqual(controller.snapshot().active, {
    protocolVersion: 1,
    runtimeId: 'runtime-1',
    operationId: 'op-1',
    documentEpoch: 0,
    operation: 'ingest',
    lastSeq: 1,
    stage: 'parse',
    progress: { completed: 1, total: 2, unit: 'pages', estimated: false },
  });

  const result = {
    ...identity,
    kind: 'result',
    stage: 'index',
    seq: 2,
    payload: { data: { indexedPages: 2 } },
  };
  assert.deepEqual(controller.accept(result), { accepted: true });
  const completed = controller.snapshot();
  assert.deepEqual(completed, {
    runtimeId: 'runtime-1',
    documentEpoch: 0,
    active: null,
    terminal: {
      protocolVersion: 1,
      runtimeId: 'runtime-1',
      operationId: 'op-1',
      documentEpoch: 0,
      operation: 'ingest',
      kind: 'result',
      stage: 'index',
      seq: 2,
      payload: { data: { indexedPages: 2 } },
    },
  });

  const rejected = controller.accept(result);
  assert.equal(rejected.accepted, false);
  assert.equal(typeof rejected.reason, 'string');
  assert.deepEqual(controller.snapshot(), completed);
});

test('begin clears the prior terminal and assigns a new operation ID', () => {
  const controller = createController('runtime-1');
  const first = controller.begin('ingest');
  controller.accept({
    ...first,
    kind: 'result',
    stage: 'index',
    seq: 1,
    payload: { data: { indexedPages: 2 } },
  });

  assert.deepEqual(controller.begin('ingest'), {
    protocolVersion: 1,
    runtimeId: 'runtime-1',
    operationId: 'op-2',
    documentEpoch: 0,
    operation: 'ingest',
  });
  assert.deepEqual(controller.snapshot(), {
    runtimeId: 'runtime-1',
    documentEpoch: 0,
    active: {
      protocolVersion: 1,
      runtimeId: 'runtime-1',
      operationId: 'op-2',
      documentEpoch: 0,
      operation: 'ingest',
      lastSeq: 0,
      stage: null,
      progress: null,
    },
    terminal: null,
  });
  const second = controller.snapshot().active;
  controller.accept({
    protocolVersion: second.protocolVersion, runtimeId: second.runtimeId,
    operationId: second.operationId, documentEpoch: second.documentEpoch,
    operation: second.operation, kind: 'result', stage: 'index', seq: 1,
    payload: { data: { indexedPages: 3 } },
  });
  assert.equal(controller.begin('ingest').operationId, 'op-3');
});

test('the begin identity cannot be changed by its caller', () => {
  const controller = createController('runtime-1');
  const identity = controller.begin('ingest');

  assert.throws(() => { identity.operationId = 'changed'; }, TypeError);
  assert.equal(controller.snapshot().active.operationId, 'op-1');
});

test('snapshots are detached immutable views of controller state', () => {
  const controller = createController('runtime-1');
  assert.deepEqual(controller.snapshot(), {
    runtimeId: 'runtime-1', documentEpoch: 0, active: null, terminal: null,
  });
  controller.begin('ingest');
  const first = controller.snapshot();
  const second = controller.snapshot();

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.active, second.active);
  assert.throws(() => { first.runtimeId = 'changed'; }, TypeError);
  assert.throws(() => { first.active.lastSeq = 99; }, TypeError);
  assert.equal(controller.snapshot().active.lastSeq, 0);
});

test('accepted progress is detached from its input payload and frozen in snapshots', () => {
  const controller = createController('runtime-1');
  const identity = controller.begin('ingest');
  const payload = { completed: 1, total: 2, unit: 'pages', estimated: false };
  controller.accept({ ...identity, kind: 'progress', stage: 'parse', seq: 1, payload });

  payload.completed = 99;
  const snapshot = controller.snapshot();
  assert.deepEqual(snapshot.active.progress, {
    completed: 1, total: 2, unit: 'pages', estimated: false,
  });
  assert.throws(() => { snapshot.active.progress.total = 99; }, TypeError);
  assert.equal(controller.snapshot().active.progress.total, 2);
});

test('accepted result data is detached from its input payload and deeply frozen', () => {
  const controller = createController('runtime-1');
  const identity = controller.begin('ingest');
  const payload = { data: { indexedPages: 2 } };
  controller.accept({ ...identity, kind: 'result', stage: 'index', seq: 1, payload });

  payload.data.indexedPages = 99;
  const snapshot = controller.snapshot();
  assert.deepEqual(snapshot.terminal.payload, { data: { indexedPages: 2 } });
  assert.throws(() => { snapshot.terminal.seq = 99; }, TypeError);
  assert.throws(() => { snapshot.terminal.payload.data.indexedPages = 99; }, TypeError);
  assert.deepEqual(controller.snapshot().terminal.payload, { data: { indexedPages: 2 } });
});

// Breaks caught below: allowing overlap, stale identity commits, reused worker
// incarnations, and document replacement that fails to advance the epoch.
function message(identity, kind = 'progress', seq = 1) {
  return {
    ...identity, kind, stage: kind === 'progress' ? 'parse' : 'index', seq,
    payload: kind === 'progress'
      ? { completed: 1, total: 2, unit: 'pages', estimated: false }
      : kind === 'error' ? { code: 'parse-failed', message: 'Cannot parse page' }
        : { data: { indexedPages: 2 } },
  };
}

test('begin rejects overlapping work without changing any state', () => {
  const controller = createController('runtime-a');
  controller.begin('ingest');
  const before = controller.snapshot();
  assert.throws(() => controller.begin('query'), /active/i);
  assert.deepEqual(controller.snapshot(), before);
  controller.cancel();
  assert.equal(controller.begin('ingest').operationId, 'op-2');
});

test('cancel records one synchronous terminal before late work arrives', () => {
  const controller = createController('runtime-a');
  const a = controller.begin('ingest');
  controller.accept(message(a));
  controller.accept({ ...message(a, 'progress', 2), stage: 'index' });
  controller.cancel();
  assert.deepEqual(controller.snapshot(), {
    runtimeId: 'runtime-a', documentEpoch: 0, active: null,
    terminal: { ...a, kind: 'cancelled', stage: 'index', seq: null,
      payload: { reason: 'user' } },
  });
  const after = controller.snapshot();
  controller.cancel();
  assert.deepEqual(controller.snapshot(), after);
  for (const kind of ['progress', 'result', 'error']) {
    assert.equal(controller.accept(message(a, kind, 2)).accepted, false);
    assert.deepEqual(controller.snapshot(), after);
  }
});

test('cancelling idle work is a no-op and cancellation before progress has a null stage', () => {
  const controller = createController('runtime-a');
  const idle = controller.snapshot();
  controller.cancel();
  assert.deepEqual(controller.snapshot(), idle);
  controller.begin('ingest');
  controller.cancel();
  assert.notEqual(controller.snapshot().terminal, null);
  assert.equal(controller.snapshot().terminal.stage, null);
});

test('late progress, result and error from A cannot mutate active B', () => {
  const controller = createController('runtime-a');
  const a = controller.begin('ingest');
  controller.cancel();
  const b = controller.begin('ingest');
  assert.equal(b.operationId, 'op-2');
  const before = controller.snapshot();
  for (const kind of ['progress', 'result', 'error']) {
    assert.equal(controller.accept(message(a, kind, 2)).accepted, false);
    assert.deepEqual(controller.snapshot(), before);
  }
});

test('document replacement advances epoch before B starts and rejects the old epoch', () => {
  const controller = createController('runtime-a');
  const a = controller.begin('ingest');
  controller.replaceDocument();
  assert.equal(controller.snapshot().documentEpoch, 1);
  assert.equal(controller.snapshot().terminal.payload.reason, 'document-replaced');
  const b = controller.begin('ingest');
  assert.equal(b.documentEpoch, 1);
  const before = controller.snapshot();
  assert.equal(controller.accept(message({ ...b, documentEpoch: a.documentEpoch }, 'result')).accepted, false);
  assert.deepEqual(controller.snapshot(), before);
  assert.equal(controller.accept(message(b, 'result')).accepted, true);
});

test('begin clear does not advance the document epoch a second time', () => {
  const controller = createController('runtime-a');
  controller.replaceDocument();
  controller.replaceDocument();
  assert.equal(controller.begin('clear').documentEpoch, 2);
  assert.equal(controller.snapshot().documentEpoch, 2);
});

test('worker replacement rejects old incarnation while preserving document epoch', () => {
  const controller = createController('runtime-a');
  controller.replaceDocument();
  const a = controller.begin('ingest');
  controller.replaceRuntime('runtime-b');
  assert.notEqual(controller.snapshot().terminal, null);
  assert.equal(controller.snapshot().terminal.payload.reason, 'runtime-replaced');
  const b = controller.begin('ingest');
  assert.equal(b.runtimeId, 'runtime-b');
  assert.equal(b.operationId, 'op-1');
  assert.equal(b.documentEpoch, 1);
  const before = controller.snapshot();
  assert.equal(controller.accept(message({ ...b, runtimeId: a.runtimeId }, 'result')).accepted, false);
  assert.deepEqual(controller.snapshot(), before);
});

test('invalid or reused worker IDs are rejected before cancelling current work', () => {
  const controller = createController('runtime-a');
  controller.replaceRuntime('runtime-b');
  controller.begin('ingest');
  const before = controller.snapshot();
  for (const id of ['runtime-a', 'runtime-b', '', ' ', null, 2]) {
    assert.throws(() => controller.replaceRuntime(id));
    assert.deepEqual(controller.snapshot(), before);
  }
});

test('messages with mismatched operation or protocol identity preserve state', () => {
  const controller = createController('runtime-a');
  const a = controller.begin('ingest');
  const before = controller.snapshot();
  for (const changed of [{ operation: 'query' }, { protocolVersion: 2 }]) {
    assert.equal(controller.accept(message({ ...a, ...changed })).accepted, false);
    assert.deepEqual(controller.snapshot(), before);
  }
});
