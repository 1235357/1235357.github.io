import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { verifyAssetResponse, VerifiedStreamError } from '../verified-stream.mjs';

const URL = 'https://example.test/models/weights.bin';
const bytesOf = text => new TextEncoder().encode(text);
const digestOf = data => createHash('sha256').update(data).digest('hex');
const expectedFor = data => ({ url: URL, bytes: data.length, sha256: digestOf(data) });
const tick = () => new Promise(resolve => setImmediate(resolve));

function sourceResponse(chunks, { headers, status = 200,
  failure, pending = false, cancelFailure = false } = {}) {
  const state = { pulls: 0, cancellations: [], controller: null };
  let index = 0;
  const body = new ReadableStream({
    start(controller) { state.controller = controller; },
    pull(controller) {
      state.pulls += 1;
      if (pending) return new Promise(() => {});
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else if (failure) controller.error(failure);
      else controller.close();
    },
    cancel(reason) {
      state.cancellations.push(reason);
      if (cancelFailure) return Promise.reject(new Error('private cancel payload'));
    },
  }, { highWaterMark: 0 });
  const response = new Response(body, { status, headers });
  return { response, body, state };
}

async function nativeFetchServer(t, { encoding, data = bytesOf('abc') } = {}) {
  const wire = (encoding?.split(',') ?? []).reduce((bytes, value) => value.trim() === 'gzip'
    ? gzipSync(bytes) : value.trim() === 'br' ? brotliCompressSync(bytes) : deflateSync(bytes), data);
  const server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/asset' });
      response.end();
    } else {
      response.writeHead(200, { 'Content-Length': String(wire.length),
        ...(encoding ? { 'Content-Encoding': encoding } : {}) });
      response.end(wire);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const canonical = code => error => {
  assert.ok(error instanceof VerifiedStreamError);
  assert.equal(error.name, 'VerifiedStreamError');
  assert.equal(error.code, code);
  assert.equal(error.message, {
    INVALID_ASSET_CONFIG: 'The asset configuration is invalid.',
    ASSET_INTEGRITY_ERROR: 'The asset failed integrity verification.',
    ABORTED: 'The asset verification was aborted.',
  }[code]);
  assert.equal(error.cause, undefined);
  return true;
};

test('streams abc bytes and resolves a frozen verified receipt using the known SHA-256 oracle', async () => {
  const data = bytesOf('abc');
  assert.equal(digestOf(data), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const source = sourceResponse([data]);
  const progress = [];
  const result = verifyAssetResponse(source.response, expectedFor(data), {
    onProgress: item => progress.push(item),
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(result.response instanceof Response);
  assert.equal(result.response.headers.get('Content-Length'), '3');
  assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), data);
  assert.deepEqual(await result.completion, { bytes: 3, sha256: digestOf(data) });
  assert.ok(Object.isFrozen(await result.completion));
  assert.deepEqual(progress, [
    { completed: 0, total: 3, unit: 'bytes', estimated: false, verified: false },
    { completed: 3, total: 3, unit: 'bytes', estimated: false, verified: false },
    { completed: 3, total: 3, unit: 'bytes', estimated: false, verified: true },
  ]);
  assert.ok(progress.every(Object.isFrozen));
  assert.equal(source.body.locked, false);
  assert.deepEqual(source.state.cancellations, []);
});

for (const size of [1, 55, 56, 63, 64, 65, 127, 128, 129, 65536, 65537, 262155]) {
  for (const consumption of ['reader', 'arrayBuffer']) {
    test(`matches the independent digest for ${size} bytes with ${consumption} consumption`, async () => {
      const data = Uint8Array.from({ length: size }, (_, index) => (index * 37 + 11) % 256);
      const source = sourceResponse([data.subarray(0, 7), data.subarray(7)]);
      const result = verifyAssetResponse(source.response, expectedFor(data));
      if (consumption === 'reader') {
        const reader = result.response.body.getReader();
        let copied = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          assert.ok(value instanceof Uint8Array);
          assert.ok(value.byteLength <= 65536);
          assert.deepEqual(value, data.subarray(copied, copied + value.length));
          copied += value.length;
        }
        assert.equal(copied, size);
        reader.releaseLock();
      } else assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), data);
      assert.deepEqual(await result.completion, { bytes: size, sha256: digestOf(data) });
      assert.equal(source.body.locked, false);
    });
  }
}

test('remains pull driven and owns each outgoing copy while retaining only one upstream chunk', async () => {
  const data = Uint8Array.from({ length: 131075 }, (_, index) => index % 251);
  const preserved = data.slice();
  const source = sourceResponse([data]);
  const result = verifyAssetResponse(source.response, expectedFor(data));
  await tick();
  assert.equal(source.state.pulls, 0);
  const reader = result.response.body.getReader();
  const first = (await reader.read()).value;
  assert.equal(first.length, 65536);
  assert.notEqual(first.buffer, data.buffer);
  first.fill(0); // The consumer cannot change bytes already fed to the hasher.
  await tick();
  assert.equal(source.state.pulls, 1);
  const second = (await reader.read()).value;
  assert.equal(second.length, 65536);
  assert.notEqual(second.buffer, first.buffer);
  assert.deepEqual(second, preserved.subarray(65536, 131072));
  await tick();
  assert.equal(source.state.pulls, 1);
  assert.deepEqual((await reader.read()).value, preserved.subarray(131072));
  assert.equal(source.state.pulls, 1);
  assert.equal((await reader.read()).done, true);
  assert.equal(source.state.pulls, 2);
  assert.deepEqual(await result.completion, { bytes: data.length, sha256: digestOf(preserved) });
});

test('accepts exact content length or an absent header and supplies a trusted length', async () => {
  const data = bytesOf('abc');
  for (const headers of [undefined, { 'Content-Length': '3' }]) {
    const source = sourceResponse([data], { headers });
    const result = verifyAssetResponse(source.response, expectedFor(data));
    assert.equal(result.response.headers.get('Content-Length'), '3');
    await result.response.arrayBuffer();
    await result.completion;
  }
});

for (const encoding of ['gzip', 'br', 'deflate', 'gzip, br']) {
  test(`verifies decoded bytes for ${encoding} without treating wire length as the asset length`, async () => {
    const data = bytesOf('abc');
    for (const wireLength of ['1', '30', null]) {
      // Fetch supplies the decoded body while preserving the encoded HTTP headers.
      const source = sourceResponse([data], { headers: { 'Content-Encoding': encoding,
        ...(wireLength === null ? {} : { 'Content-Length': wireLength }) } });
      const result = verifyAssetResponse(source.response, expectedFor(data));
      assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), data);
      assert.deepEqual(await result.completion, { bytes: data.length, sha256: digestOf(data) });
      assert.equal(result.response.headers.get('Content-Length'), String(data.length));
      assert.equal(result.response.headers.get('Content-Encoding'), null);
      assert.equal(source.body.locked, false);
    }
  });
}

for (const encoding of ['gzip', 'br', 'deflate', 'gzip, br']) {
  for (const data of [bytesOf('abc'), bytesOf('a'.repeat(4096))]) {
    test(`accepts native Fetch decoding ${encoding} with ${data.length} decoded bytes`, async t => {
      const base = await nativeFetchServer(t, { encoding, data });
      const url = `${base}/asset`, response = await fetch(url);
      const wireLength = Number(response.headers.get('Content-Length'));
      assert.equal(response.headers.get('Content-Encoding'), encoding);
      assert.ok(data.length === 3 ? wireLength > data.length : wireLength < data.length);
      const result = verifyAssetResponse(response, { ...expectedFor(data), url });
      assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), data);
      assert.deepEqual(await result.completion, { bytes: data.length, sha256: digestOf(data) });
    });
  }
}

for (const headers of [
  { 'Content-Encoding': 'identity', 'Content-Length': '2' },
  { 'Content-Encoding': 'identity', 'Content-Length': '+3' },
  { 'Content-Encoding': 'gzip', 'Content-Length': '+2' },
  { 'Content-Encoding': 'br', 'Content-Length': '02' },
  { 'Content-Encoding': 'gzip', 'Content-Length': '2, 2' },
  { 'Content-Encoding': 'br', 'Content-Length': '9007199254740992' },
  { 'Content-Encoding': 'unknown', 'Content-Length': '3' },
  { 'Content-Encoding': 'gzip, unknown', 'Content-Length': '3' },
  { 'Content-Encoding': 'gzip,', 'Content-Length': '3' },
  { 'Content-Encoding': '', 'Content-Length': '3' },
]) {
  test(`refuses ambiguous encoded metadata ${JSON.stringify(headers)} before reading`, () => {
    const source = sourceResponse([bytesOf('abc')], { headers });
    assert.throws(() => verifyAssetResponse(source.response, validConfig()), canonical('ASSET_INTEGRITY_ERROR'));
    assert.equal(source.state.pulls, 0);
    assert.equal(source.body.locked, false);
  });
}

for (const [name, chunks] of [
  ['short decoded body', [bytesOf('ab')]],
  ['corrupt decoded body', [bytesOf('abd')]],
  ['decoded overflow', [bytesOf('abcd')]],
]) {
  test(`compressed transport still refuses ${name}`, async () => {
    const source = sourceResponse(chunks, { headers: { 'Content-Encoding': 'br', 'Content-Length': '1' } });
    const result = verifyAssetResponse(source.response, validConfig());
    await assert.rejects(result.response.arrayBuffer(), canonical('ASSET_INTEGRITY_ERROR'));
    await assert.rejects(result.completion, canonical('ASSET_INTEGRITY_ERROR'));
    await tick();
    assert.equal(source.body.locked, false);
    if (name === 'decoded overflow') assert.equal(source.state.cancellations.length, 1);
  });
}

test('abort of a pending decoded compressed stream still cancels and releases its reader', async () => {
  const source = sourceResponse([], { pending: true,
    headers: { 'Content-Encoding': 'gzip', 'Content-Length': '1' } });
  const controller = new AbortController();
  const result = verifyAssetResponse(source.response, validConfig(), { signal: controller.signal });
  const reading = result.response.arrayBuffer();
  await tick(); controller.abort();
  await assert.rejects(reading, canonical('ABORTED'));
  await assert.rejects(result.completion, canonical('ABORTED'));
  await tick();
  assert.equal(source.state.cancellations.length, 1);
  assert.equal(source.body.locked, false);
});

test('accepts null prototype configurations and captures supported fields exactly once', async () => {
  const data = bytesOf('abc');
  const counts = {};
  const config = Object.create(null);
  for (const [key, value] of Object.entries(expectedFor(data))) {
    Object.defineProperty(config, key, { get() { counts[key] = (counts[key] ?? 0) + 1; return value; } });
  }
  const options = Object.create(null);
  Object.defineProperty(options, 'onProgress', { get() {
    counts.onProgress = (counts.onProgress ?? 0) + 1;
    return () => {};
  } });
  const source = sourceResponse([data]);
  const result = verifyAssetResponse(source.response, config, options);
  await result.response.arrayBuffer();
  await result.completion;
  assert.deepEqual(counts, { url: 1, bytes: 1, sha256: 1, onProgress: 1 });
});

const validConfig = () => expectedFor(bytesOf('abc'));
const invalidConfigurations = [
  null, undefined, [], 'private payload', new Date(),
  Object.assign(Object.create({}), validConfig()),
  runInNewContext('({url:"https://example.test/models/weights.bin",bytes:3,sha256:"a".repeat(64)})'),
  { ...validConfig(), secret: 'private' },
  { ...validConfig(), [Symbol('unknown')]: 1 },
  { ...validConfig(), bytes: 0 }, { ...validConfig(), bytes: -1 },
  { ...validConfig(), bytes: 1.5 }, { ...validConfig(), bytes: NaN },
  { ...validConfig(), bytes: 1073741825 }, { ...validConfig(), bytes: '3' },
  { ...validConfig(), sha256: 'A'.repeat(64) }, { ...validConfig(), sha256: 'a'.repeat(63) },
  { ...validConfig(), url: 'http://user:secret@example.test/file' },
  { ...validConfig(), url: `${URL}?token=secret` },
  { ...validConfig(), url: `${URL}#private` },
  { ...validConfig(), url: `${URL}?` }, { ...validConfig(), url: `${URL}#` },
  { ...validConfig(), url: '/models/weights.bin' },
  { ...validConfig(), url: 'file:///private' },
  { ...validConfig(), url: 'https://EXAMPLE.test/models/weights.bin' },
  { ...validConfig(), url: ' https://example.test/models/weights.bin' },
];
for (const [index, config] of invalidConfigurations.entries()) {
  test(`canonicalizes invalid asset metadata case ${index}`, () => {
    assert.throws(() => verifyAssetResponse(sourceResponse([bytesOf('abc')]).response, config),
      canonical('INVALID_ASSET_CONFIG'));
  });
}

test('rejects missing metadata keys and unknown keys before invoking any value getter', () => {
  let reads = 0;
  const config = { get url() { reads += 1; throw new Error('private url'); },
    get bytes() { reads += 1; return 3; }, get sha256() { reads += 1; return 'a'.repeat(64); },
    get unknown() { reads += 1; return 'secret'; } };
  assert.throws(() => verifyAssetResponse(null, config), canonical('INVALID_ASSET_CONFIG'));
  assert.equal(reads, 0);
  const missing = { get url() { reads += 1; return URL; }, bytes: 3 };
  assert.throws(() => verifyAssetResponse(null, missing), canonical('INVALID_ASSET_CONFIG'));
  assert.equal(reads, 0);
});

test('canonicalizes throwing supported metadata getters without retaining the private error', () => {
  const config = { ...validConfig(), get bytes() { throw new Error('private payload url'); } };
  assert.throws(() => verifyAssetResponse(null, config), canonical('INVALID_ASSET_CONFIG'));
});

for (const [index, options] of [null, [], 'secret', new Date(), { extra: true },
  { onProgress: 5 }, { onProgress: null }, { signal: null }, { signal: {} },
  { [Symbol('unknown')]: true }].entries()) {
  test(`canonicalizes invalid options case ${index}`, () => {
    assert.throws(() => verifyAssetResponse(sourceResponse([bytesOf('abc')]).response,
      validConfig(), options), canonical('INVALID_ASSET_CONFIG'));
  });
}

test('rejects unknown options before supported value getters', () => {
  let reads = 0;
  const options = { get signal() { reads += 1; throw new Error('secret'); }, extra: true };
  assert.throws(() => verifyAssetResponse(null, validConfig(), options), canonical('INVALID_ASSET_CONFIG'));
  assert.equal(reads, 0);
});

for (const [name, parameters] of [
  ['non-200 status', { status: 201 }],
  ['content length too short', { headers: { 'Content-Length': '2' } }],
  ['content length too long', { headers: { 'Content-Length': '4' } }],
  ['non-decimal content length', { headers: { 'Content-Length': '+3' } }],
  ['leading zero content length', { headers: { 'Content-Length': '03' } }],
  ['combined content length', { headers: { 'Content-Length': '3, 3' } }],
]) {
  test(`rejects ${name} with a canonical integrity error`, () => {
    assert.throws(() => verifyAssetResponse(sourceResponse([bytesOf('abc')], parameters).response,
      validConfig()), canonical('ASSET_INTEGRITY_ERROR'));
  });
}

test('accepts a real native fetch response whose final URL matches the pinned URL', async t => {
  const base = await nativeFetchServer(t);
  const url = `${base}/asset`;
  const response = await fetch(url);
  assert.equal(response.url, url);
  assert.equal(response.redirected, false);
  const result = verifyAssetResponse(response, { ...validConfig(), url });
  assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), bytesOf('abc'));
  assert.deepEqual(await result.completion, { bytes: 3, sha256: digestOf(bytesOf('abc')) });
});

test('rejects a real native fetch response whose final URL differs from the pinned URL', async t => {
  const base = await nativeFetchServer(t);
  const response = await fetch(`${base}/asset`);
  assert.equal(response.url, `${base}/asset`);
  assert.throws(() => verifyAssetResponse(response, { ...validConfig(), url: `${base}/other` }),
    canonical('ASSET_INTEGRITY_ERROR'));
  await response.body.cancel();
});

test('rejects a real followed redirect even when the final native URL matches the pin', async t => {
  const base = await nativeFetchServer(t);
  const response = await fetch(`${base}/redirect`);
  assert.equal(response.url, `${base}/asset`);
  assert.equal(response.redirected, true);
  assert.throws(() => verifyAssetResponse(response, { ...validConfig(), url: `${base}/asset` }),
    canonical('ASSET_INTEGRITY_ERROR'));
  await response.body.cancel();
});

test('rejects a missing, locked, consumed, or non-native response body', async () => {
  assert.throws(() => verifyAssetResponse(new Response(null), validConfig()), canonical('ASSET_INTEGRITY_ERROR'));
  assert.throws(() => verifyAssetResponse({}, validConfig()), canonical('ASSET_INTEGRITY_ERROR'));
  const locked = sourceResponse([bytesOf('abc')]);
  const reader = locked.body.getReader();
  assert.throws(() => verifyAssetResponse(locked.response, validConfig()), canonical('ASSET_INTEGRITY_ERROR'));
  reader.releaseLock();
  const consumed = sourceResponse([bytesOf('abc')]);
  await consumed.response.arrayBuffer();
  assert.throws(() => verifyAssetResponse(consumed.response, validConfig()), canonical('ASSET_INTEGRITY_ERROR'));
});

test('rejects a Response-prototype spoof before reading its overriding response properties', () => {
  let reads = 0;
  let result;
  const spoof = Object.create(Response.prototype);
  for (const [key, value] of Object.entries({ status: 200, redirected: false, url: URL,
    bodyUsed: false, headers: new Headers(), body: new ReadableStream() })) {
    Object.defineProperty(spoof, key, { get() { reads += 1; return value; } });
  }
  assert.ok(spoof instanceof Response);
  const nativeStatus = Object.getOwnPropertyDescriptor(Response.prototype, 'status').get;
  assert.throws(() => nativeStatus.call(spoof), TypeError);
  try {
    assert.throws(() => { result = verifyAssetResponse(spoof, validConfig()); },
      canonical('ASSET_INTEGRITY_ERROR'));
    assert.equal(reads, 0);
  } finally {
    if (result) result.response.body.cancel().catch(() => {});
  }
});

for (const status of [404, 204]) {
  test(`rejects a native ${status} response with forged own status and body`, () => {
    const response = new Response(status === 204 ? null : bytesOf('abc'), { status });
    const body = new ReadableStream({ start(controller) { controller.enqueue(bytesOf('abc')); controller.close(); } });
    Object.defineProperties(response, { status: { value: 200 }, body: { value: body } });
    let result;
    try {
      assert.throws(() => { result = verifyAssetResponse(response, validConfig()); },
        canonical('ASSET_INTEGRITY_ERROR'));
    } finally {
      if (result) result.response.body.cancel().catch(() => {});
    }
  });
}

for (const field of ['status', 'redirected', 'url', 'bodyUsed', 'body', 'headers']) {
  test(`rejects an own ${field} shadow without invoking its private getter`, () => {
    const response = new Response(bytesOf('abc'));
    let reads = 0;
    Object.defineProperty(response, field, { get() {
      reads += 1;
      throw new Error('private response field payload');
    } });
    assert.throws(() => verifyAssetResponse(response, validConfig()), canonical('ASSET_INTEGRITY_ERROR'));
    assert.equal(reads, 0);
  });
}

for (const [name, chunks, config] of [
  ['short body', [bytesOf('ab')], validConfig()],
  ['excess first chunk', [bytesOf('abcd')], validConfig()],
  ['excess later chunk', [bytesOf('ab'), bytesOf('cd')], validConfig()],
  ['wrong digest', [bytesOf('abc')], { ...validConfig(), sha256: 'a'.repeat(64) }],
  ['non-byte chunk', ['private payload'], validConfig()],
]) {
  test(`errors the output body and completion for ${name}`, async () => {
    const source = sourceResponse(chunks);
    const result = verifyAssetResponse(source.response, config);
    await assert.rejects(result.response.arrayBuffer(), canonical('ASSET_INTEGRITY_ERROR'));
    await assert.rejects(result.completion, canonical('ASSET_INTEGRITY_ERROR'));
    await tick();
    assert.equal(source.body.locked, false);
    if (name.startsWith('excess') || name === 'non-byte chunk') {
      assert.equal(source.state.cancellations.length, 1);
      canonical('ASSET_INTEGRITY_ERROR')(source.state.cancellations[0]);
    }
  });
}

test('rejects an overlong upstream chunk before exposing any portion of that chunk', async () => {
  const source = sourceResponse([bytesOf('ab'), bytesOf('cd')]);
  const result = verifyAssetResponse(source.response, validConfig());
  const reader = result.response.body.getReader();
  assert.deepEqual((await reader.read()).value, bytesOf('ab'));
  await assert.rejects(reader.read(), canonical('ASSET_INTEGRITY_ERROR'));
  await assert.rejects(result.completion, canonical('ASSET_INTEGRITY_ERROR'));
});

test('canonicalizes a private upstream read failure and releases the lock', async () => {
  const source = sourceResponse([bytesOf('a')], { failure: new Error('private signed url payload') });
  const result = verifyAssetResponse(source.response, validConfig());
  await assert.rejects(result.response.arrayBuffer(), canonical('ASSET_INTEGRITY_ERROR'));
  await assert.rejects(result.completion, canonical('ASSET_INTEGRITY_ERROR'));
  await tick();
  assert.equal(source.body.locked, false);
});

test('a pre-aborted signal promptly rejects completion and body and cancels upstream', async () => {
  const abort = new AbortController();
  abort.abort(new Error('private abort reason'));
  const source = sourceResponse([bytesOf('abc')]);
  const result = verifyAssetResponse(source.response, validConfig(), { signal: abort.signal });
  await assert.rejects(result.completion, canonical('ABORTED'));
  await assert.rejects(result.response.arrayBuffer(), canonical('ABORTED'));
  await tick();
  assert.equal(source.state.pulls, 0);
  assert.equal(source.state.cancellations.length, 1);
  assert.equal(source.body.locked, false);
});

test('abort settles a pending upstream read without waiting for its pull promise', async () => {
  const abort = new AbortController();
  const source = sourceResponse([], { pending: true });
  const result = verifyAssetResponse(source.response, validConfig(), { signal: abort.signal });
  const reader = result.response.body.getReader();
  const reading = reader.read();
  await tick();
  assert.equal(source.state.pulls, 1);
  abort.abort('private abort reason');
  await assert.rejects(result.completion, canonical('ABORTED'));
  await assert.rejects(reading, canonical('ABORTED'));
  await tick();
  assert.equal(source.state.cancellations.length, 1);
  assert.equal(source.body.locked, false);
});

test('abort between consumer reads discards the held upstream chunk', async () => {
  const data = new Uint8Array(70000).fill(29);
  const abort = new AbortController();
  const source = sourceResponse([data]);
  const result = verifyAssetResponse(source.response, expectedFor(data), { signal: abort.signal });
  const reader = result.response.body.getReader();
  assert.equal((await reader.read()).value.length, 65536);
  abort.abort();
  await assert.rejects(result.completion, canonical('ABORTED'));
  await assert.rejects(reader.read(), canonical('ABORTED'));
  await tick();
  assert.equal(source.body.locked, false);
  assert.equal(source.state.pulls, 1);
});

test('consumer cancellation rejects completion and uses a canonical upstream reason', async () => {
  const source = sourceResponse([bytesOf('abc')], { cancelFailure: true });
  const result = verifyAssetResponse(source.response, validConfig());
  await result.response.body.cancel(new Error('private consumer reason'));
  await assert.rejects(result.completion, canonical('ABORTED'));
  await tick();
  assert.equal(source.state.cancellations.length, 1);
  canonical('ABORTED')(source.state.cancellations[0]);
  assert.equal(source.body.locked, false);
});

for (const failingCall of [1, 2, 3]) {
  test(`throwing progress callback at call ${failingCall} errors the body and completion`, async () => {
    const source = sourceResponse([bytesOf('abc')]);
    let calls = 0;
    const result = verifyAssetResponse(source.response, validConfig(), { onProgress() {
      if (++calls === failingCall) throw new Error('private progress callback payload');
    } });
    await assert.rejects(result.response.arrayBuffer(), canonical('ASSET_INTEGRITY_ERROR'));
    await assert.rejects(result.completion, canonical('ASSET_INTEGRITY_ERROR'));
    await tick();
    assert.equal(source.body.locked, false);
  });
}

test('internally suppresses an abandoned completion rejection while explicit awaiting still rejects', async () => {
  const source = sourceResponse([bytesOf('abc')]);
  const abort = new AbortController();
  const result = verifyAssetResponse(source.response, validConfig(), { signal: abort.signal });
  abort.abort();
  await tick();
  await tick();
  await assert.rejects(result.completion, canonical('ABORTED'));
});

test('canonicalizes failure while validating a signal rather than leaking its private getter error', () => {
  const signal = new Proxy(new AbortController().signal, {
    get() { throw new Error('private signal getter payload'); },
  });
  assert.throws(() => verifyAssetResponse(sourceResponse([bytesOf('abc')]).response,
    validConfig(), { signal }), canonical('INVALID_ASSET_CONFIG'));
});

test('uses native signal operations even when own methods or getters contain private failures', async () => {
  const abort = new AbortController();
  Object.defineProperties(abort.signal, {
    addEventListener: { value() { throw new Error('private add listener error'); } },
    removeEventListener: { value() { throw new Error('private remove listener error'); } },
    aborted: { get() { throw new Error('private aborted getter'); } },
  });
  const source = sourceResponse([bytesOf('abc')]);
  const result = verifyAssetResponse(source.response, validConfig(), { signal: abort.signal });
  await result.response.arrayBuffer();
  assert.deepEqual(await result.completion, { bytes: 3, sha256: digestOf(bytesOf('abc')) });
  assert.equal(source.body.locked, false);
});

for (const abortingCall of [1, 2, 3]) {
  test(`a progress callback can abort synchronously at call ${abortingCall}`, async () => {
    const abort = new AbortController();
    const source = sourceResponse([bytesOf('abc')]);
    let calls = 0;
    const result = verifyAssetResponse(source.response, validConfig(), { signal: abort.signal,
      onProgress() { if (++calls === abortingCall) abort.abort('private callback abort'); } });
    await assert.rejects(result.response.arrayBuffer(), canonical('ABORTED'));
    await assert.rejects(result.completion, canonical('ABORTED'));
    await tick();
    assert.equal(source.body.locked, false);
  });
}

test('does not resolve verification until the consumer pulls and observes EOF', async () => {
  const source = sourceResponse([bytesOf('abc')]);
  const progress = [];
  const result = verifyAssetResponse(source.response, validConfig(), {
    onProgress: item => progress.push(item),
  });
  let settled = false;
  result.completion.then(() => { settled = true; });
  const reader = result.response.body.getReader();
  assert.deepEqual((await reader.read()).value, bytesOf('abc'));
  await tick();
  assert.equal(settled, false);
  assert.equal(progress.at(-1).verified, false);
  assert.equal((await reader.read()).done, true);
  await result.completion;
  assert.equal(progress.at(-1).verified, true);
});

test('copies a byte-offset view so later upstream mutation cannot change handed-off bytes', async () => {
  const backing = bytesOf('xabcx');
  const data = backing.subarray(1, 4);
  const source = sourceResponse([data]);
  const result = verifyAssetResponse(source.response, expectedFor(data));
  const reader = result.response.body.getReader();
  const outgoing = (await reader.read()).value;
  backing.fill(0);
  assert.deepEqual(outgoing, bytesOf('abc'));
  assert.equal((await reader.read()).done, true);
  assert.deepEqual(await result.completion, { bytes: 3, sha256: digestOf(bytesOf('abc')) });
});

test('unknown error codes cannot disclose private details', () => {
  canonical('INVALID_ASSET_CONFIG')(new VerifiedStreamError('private signed url payload'));
});
