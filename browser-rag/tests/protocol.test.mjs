import assert from 'node:assert/strict';
import test from 'node:test';
import { createController } from '../protocol.mjs';

test('embedding vocabulary accepts only its three stages without changing other operations', () => {
  const controller = createController('embedding-runtime');
  let identity;
  assert.doesNotThrow(() => { identity = controller.begin('embed'); });
  for (const [index, stage] of ['download', 'initialize', 'encode'].entries()) {
    assert.deepEqual(controller.accept({ ...identity, kind: 'progress', stage, seq: index + 1,
      payload: { completed: 0, total: null, unit: 'chunks', estimated: false } }), { accepted: true });
  }
  assert.deepEqual(controller.accept({ ...identity, kind: 'result', stage: 'index', seq: 4,
    payload: { data: {} } }), { accepted: false, reason: 'invalid-stage' });
  assert.equal(controller.accept({ ...identity, kind: 'result', stage: 'encode', seq: 5,
    payload: { data: { status: 'embedded-not-retrieved' } } }).accepted, true);
});

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

function assertRejectedWithoutCommit(controller, event) {
  const before = controller.snapshot();
  const verdict = controller.accept(event);
  assert.equal(verdict.accepted, false);
  assert.equal(typeof verdict.reason, 'string');
  assert.deepEqual(controller.snapshot(), before);
}

test('invalid initial runtime IDs and unknown operations have no state effects', () => {
  for (const id of ['', '  ', null, undefined, 3, {}]) {
    assert.throws(() => createController(id), TypeError);
  }
  const controller = createController('runtime-a');
  const before = controller.snapshot();
  for (const operation of ['', 'other', 'toString', '__proto__', null, 3]) {
    assert.throws(() => controller.begin(operation), TypeError);
    assert.deepEqual(controller.snapshot(), before);
  }
  assert.equal(controller.begin('ingest').operationId, 'op-1');
});

test('non-record messages and additional or missing envelope keys are rejected', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  for (const event of [null, undefined, false, 1, 'event', [], new Date()]) {
    assertRejectedWithoutCommit(controller, event);
  }
  for (const key of Object.keys(message(identity))) {
    const event = message(identity);
    delete event[key];
    assertRejectedWithoutCommit(controller, event);
  }
  assertRejectedWithoutCommit(controller, { ...message(identity), extra: true });
  assertRejectedWithoutCommit(controller, { ...message(identity), [Symbol('extra')]: true });
  assertRejectedWithoutCommit(controller, { ...message(identity), kind: 'finished' });
});

test('unsafe, nonpositive and nonnumeric sequences do not consume a sequence', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  for (const seq of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    assertRejectedWithoutCommit(controller, message(identity, 'progress', seq));
  }
  assert.deepEqual(controller.accept(message(identity)), { accepted: true });
  assert.deepEqual(controller.accept(message(identity, 'progress', 3)), { accepted: true });
  for (const seq of [1, 2, 3]) {
    for (const kind of ['progress', 'result', 'error']) {
      assertRejectedWithoutCommit(controller, message(identity, kind, seq));
    }
  }
});

test('each operation accepts only its declared stage vocabulary', () => {
  const stages = {
    'model-load': ['download', 'initialize'], ingest: ['parse', 'index'],
    query: ['encode', 'rank', 'context', 'generate', 'release'], clear: ['clear'],
  };
  for (const [operation, allowed] of Object.entries(stages)) {
    const controller = createController(`runtime-${operation}`);
    const identity = controller.begin(operation);
    let seq = 1;
    for (const stage of allowed) {
      assert.deepEqual(controller.accept({ ...message(identity, 'progress', seq++), stage }), { accepted: true });
    }
    for (const stage of ['other', null, ...Object.values(stages).flat().filter(item => !allowed.includes(item))]) {
      assertRejectedWithoutCommit(controller, { ...message(identity, 'progress', seq), stage });
      assertRejectedWithoutCommit(controller, { ...message(identity, 'result', seq), stage });
    }
    // Vocabulary is validated, but ordering belongs to adapters, not this controller.
    assert.equal(controller.accept({ ...message(identity, 'progress', seq), stage: allowed[0] }).accepted, true);
  }
});

test('malformed progress is rejected without consuming a higher sequence', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  const valid = message(identity).payload;
  const invalid = [null, [], {}, { ...valid, extra: true }, { ...valid, percent: 50 }];
  for (const completed of [-1, NaN, Infinity, '1', null]) invalid.push({ ...valid, completed });
  for (const total of [-1, 0, NaN, Infinity, '2', undefined]) invalid.push({ ...valid, total });
  for (const unit of ['percent', '', null, 1]) invalid.push({ ...valid, unit });
  for (const estimated of ['false', 0, null]) invalid.push({ ...valid, estimated });
  for (const key of Object.keys(valid)) {
    const payload = { ...valid }; delete payload[key]; invalid.push(payload);
  }
  for (const payload of invalid) {
    assertRejectedWithoutCommit(controller, { ...message(identity, 'progress', 7), payload });
  }
  assert.deepEqual(controller.accept(message(identity, 'progress', 7)), { accepted: true });
  assert.equal(controller.snapshot().active.lastSeq, 7);
});

test('unknown-total and zero-total progress are accepted without fabricated percentage', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  let seq = 1;
  for (const unit of ['bytes', 'pages', 'chunks', 'tokens']) {
    const payload = { completed: 3, total: null, unit, estimated: true };
    assert.equal(controller.accept({ ...message(identity, 'progress', seq++), payload }).accepted, true);
    assert.deepEqual(controller.snapshot().active.progress, payload);
    assert.equal('percent' in controller.snapshot().active.progress, false);
  }
  const payload = { completed: 0, total: 0, unit: 'pages', estimated: false };
  assert.equal(controller.accept({ ...message(identity, 'progress', seq), payload }).accepted, true);
});

test('error and worker cancellation close an operation once with detached payloads', () => {
  for (const [kind, payload] of [
    ['error', { code: 'parse-failed', message: 'Cannot parse page' }],
    ['cancelled', { reason: 'worker-cancelled' }],
  ]) {
    const controller = createController(`runtime-${kind}`);
    const identity = controller.begin('ingest');
    const event = { ...message(identity, kind, 2), payload };
    assert.deepEqual(controller.accept(event), { accepted: true });
    const receipt = controller.snapshot();
    assert.equal(receipt.active, null);
    assert.deepEqual(receipt.terminal, { ...identity, kind, stage: 'index', seq: 2, payload });
    payload.extra = 'changed later';
    assert.deepEqual(controller.snapshot(), receipt);
    for (const lateKind of ['progress', 'result', 'error', 'cancelled']) {
      assertRejectedWithoutCommit(controller, message(identity, lateKind, 3));
    }
  }
});

test('malformed terminal payloads keep the operation active and its sequence unchanged', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  const cases = [
    ['result', null], ['result', {}], ['result', { data: 1, extra: true }],
    ['error', {}], ['error', { code: '', message: 'x' }], ['error', { code: ' ', message: 'x' }],
    ['error', { code: 'x', message: '' }], ['error', { code: 'x', message: 1 }],
    ['error', { code: 'x', message: 'x', extra: true }],
    ['cancelled', {}], ['cancelled', { reason: 'user' }],
    ['cancelled', { reason: 'worker-cancelled', extra: true }],
  ];
  for (const [kind, payload] of cases) {
    assertRejectedWithoutCommit(controller, { ...message(identity, kind, 5), payload });
  }
  assert.equal(controller.accept(message(identity, 'result', 5)).accepted, true);
});

test('non-JSON result data, cycles, sparse arrays and symbolic keys are rejected', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  const cycle = {}; cycle.self = cycle;
  const sparse = []; sparse.length = 2;
  const cases = [undefined, NaN, Infinity, () => {}, Symbol('x'), 1n, cycle,
    new Date(), new Map(), new Set(), new Uint8Array([1]), sparse,
    { nested: undefined }, { nested: NaN }, { [Symbol('x')]: true }];
  for (const data of cases) {
    assertRejectedWithoutCommit(controller, { ...message(identity, 'result', 5), payload: { data } });
  }
  assert.equal(controller.accept(message(identity, 'result', 5)).accepted, true);
});

test('result metadata obeys depth, visited-value and UTF-8 size limits', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  let tooDeep = null;
  for (let i = 0; i < 33; i++) tooDeep = { next: tooDeep };
  for (const data of [tooDeep, Array(4096).fill(null), 'x'.repeat(262145),
    '界'.repeat(90000), { ['x'.repeat(262145)]: 1 }]) {
    assertRejectedWithoutCommit(controller, { ...message(identity, 'result', 8), payload: { data } });
  }
  // Array root + 4095 values equals the allowed 4096 visited values.
  const data = Array(4095).fill(null);
  assert.equal(controller.accept({ ...message(identity, 'result', 8), payload: { data } }).accepted, true);
});

test('JSON values and repeated noncyclic references copy safely, including prototype-named keys', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  const shared = { count: 1 };
  const data = JSON.parse('{"__proto__":{"safe":true},"constructor":"metadata"}');
  data.items = [null, true, false, 'quote', 0, -1, shared, shared];
  const expected = structuredClone(data);
  assert.equal(controller.accept({ ...message(identity, 'result'), payload: { data } }).accepted, true);
  shared.count = 99; data.items[1] = 'changed';
  assert.deepEqual(controller.snapshot().terminal.payload.data, expected);
  assert.equal(Object.hasOwn(controller.snapshot().terminal.payload.data, '__proto__'), true);
  assert.equal({}.safe, undefined);
});

test('an immutable worker event can be accepted without mutating its input', () => {
  const controller = createController('runtime-a');
  const identity = controller.begin('ingest');
  const event = Object.freeze({ ...message(identity), payload: Object.freeze(message(identity).payload) });
  const before = structuredClone(event);
  assert.equal(controller.accept(event).accepted, true);
  assert.deepEqual(event, before);
});
