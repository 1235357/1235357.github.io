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
