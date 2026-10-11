import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { prepareVerifiedAssetCache, VerifiedCacheError } from '../verified-cache.mjs';

const bytes = new TextEncoder().encode('verified cache fixture');
const asset = (url = 'https://assets.example/model.bin', data = bytes, aliases = []) => ({
  url, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), aliases,
});
const plan = (assets = [asset()]) => ({ cacheName: 'financial-rag-generator-test', assets });
function storageFixture(initial = []) {
  const entries = new Map(initial);
  const calls = { open: [], match: [], put: [] };
  const cache = {
    async match(key) { calls.match.push(key); return entries.has(key) ? new Response(entries.get(key)) : undefined; },
    async put(key, response) {
      calls.put.push(key);
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); length += value.length;
      }
      const stored = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { stored.set(chunk, offset); offset += chunk.length; }
      entries.set(key, stored);
    },
  };
  return { entries, calls, cache, cacheStorage: { async open(name) { calls.open.push(name); return cache; } } };
}
function options(fixture, extra = {}) {
  return { cacheStorage: fixture.cacheStorage, fetch: async () => new Response(bytes), ...extra };
}
async function consume(response) { return new Uint8Array(await response.arrayBuffer()); }
const canonical = code => error => {
  assert.equal(error instanceof VerifiedCacheError, true);
  assert.equal(error.name, 'VerifiedCacheError');
  assert.equal(error.code, code);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.equal(/secret|https:|private|quota/.test(error.message), false);
  return true;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function timely(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('operation stayed pending')), 200);
    })]);
  } finally { clearTimeout(timer); }
}

test('cold preparation awaits verified cache write and SDK reads verify again', async () => {
  const fixture = storageFixture(), fetches = [], progress = [];
  const store = await prepareVerifiedAssetCache(plan(), options(fixture, {
    fetch: async (...args) => { fetches.push(args); return new Response(bytes); },
    onProgress: event => progress.push(event),
  }));
  assert.deepEqual(store.receipt, { assets: 1, verifiedBytes: bytes.length, networkBytes: bytes.length, cacheBytes: 0 });
  assert.equal(Object.isFrozen(store), true);
  assert.equal(Object.isFrozen(store.cache), true);
  assert.equal(Object.isFrozen(store.receipt), true);
  assert.deepEqual(fixture.calls.open, ['financial-rag-generator-test']);
  assert.deepEqual(fixture.calls.put, [asset().url]);
  assert.equal(fetches[0][0], asset().url);
  assert.equal(fetches[0][1].redirect, 'error');
  assert.equal(fetches[0][1].credentials, 'omit');
  assert.equal(fetches[0][1].signal instanceof AbortSignal, true);
  assert.deepEqual(await consume(await store.cache.match(asset().url)), bytes);
  assert.deepEqual(await store.finishReads(), { reads: 1, verifiedBytes: bytes.length });
  assert.equal(fetches.length, 1);
  assert.equal(fixture.calls.put.length, 1);
  assert.deepEqual(progress.at(-1), { stage: 'consume', assetIndex: 0, completed: bytes.length,
    total: bytes.length, unit: 'bytes', estimated: false, verified: true });
  assert.equal(progress.every(Object.isFrozen), true);
  store.close();
});

test('warm preparation drains real cached body without fetch or write', async () => {
  const fixture = storageFixture([[asset().url, bytes]]);
  const store = await prepareVerifiedAssetCache(plan(), options(fixture, {
    fetch: () => { throw new Error('must not fetch'); },
  }));
  assert.deepEqual(store.receipt, { assets: 1, verifiedBytes: bytes.length, networkBytes: 0, cacheBytes: bytes.length });
  assert.deepEqual(fixture.calls.put, []);
  assert.deepEqual(await store.finishReads(), { reads: 0, verifiedBytes: 0 });
  store.close();
});

for (const [label, change] of [
  ['extra top key', value => { value.secret = true; }],
  ['symbol top key', value => { value[Symbol('secret')] = true; }],
  ['nonplain top prototype', value => Object.setPrototypeOf(value, {})],
  ['name prefix', value => { value.cacheName = 'other-cache'; }],
  ['empty suffix', value => { value.cacheName = 'financial-rag-generator-'; }],
  ['long suffix', value => { value.cacheName += 'x'.repeat(120); }],
  ['uppercase suffix', value => { value.cacheName += 'A'; }],
  ['zero assets', value => { value.assets = []; }],
  ['too many assets', value => { value.assets = Array.from({ length: 65 }, (_, i) => asset(`https://assets.example/${i}`)); }],
  ['array hole', value => { value.assets.length = 2; }],
  ['array extra key', value => { value.assets.secret = 1; }],
  ['array symbol', value => { value.assets[Symbol()] = 1; }],
  ['array subclass', value => { Object.setPrototypeOf(value.assets, Object.create(Array.prototype)); }],
  ['asset extra key', value => { value.assets[0].secret = 1; }],
  ['asset missing aliases', value => { delete value.assets[0].aliases; }],
  ['asset prototype', value => { Object.setPrototypeOf(value.assets[0], {}); }],
  ['zero bytes', value => { value.assets[0].bytes = 0; }],
  ['negative bytes', value => { value.assets[0].bytes = -1; }],
  ['fractional bytes', value => { value.assets[0].bytes = 1.1; }],
  ['string bytes', value => { value.assets[0].bytes = '1'; }],
  ['over 1GiB', value => { value.assets[0].bytes = 1073741825; }],
  ['aggregate over 1GiB', value => { value.assets[0].bytes = 1073741824; value.assets.push(asset('https://assets.example/other')); }],
  ['uppercase digest', value => { value.assets[0].sha256 = value.assets[0].sha256.toUpperCase(); }],
  ['short digest', value => { value.assets[0].sha256 = 'a'.repeat(63); }],
  ['invalid digest', value => { value.assets[0].sha256 = 'z'.repeat(64); }],
  ['relative URL', value => { value.assets[0].url = '/model'; }],
  ['noncanonical URL', value => { value.assets[0].url = 'https://ASSETS.example/model'; }],
  ['query URL', value => { value.assets[0].url += '?secret'; }],
  ['fragment URL', value => { value.assets[0].url += '#secret'; }],
  ['credential URL', value => { value.assets[0].url = 'https://secret@assets.example/model'; }],
  ['file URL', value => { value.assets[0].url = 'file:///secret'; }],
  ['mixed primary origins', value => { value.assets.push(asset('https://other.example/model')); }],
  ['duplicate primary', value => { value.assets.push(asset()); }],
  ['aliases not array', value => { value.assets[0].aliases = {}; }],
  ['aliases hole', value => { value.assets[0].aliases = Array(1); }],
  ['aliases extra key', value => { value.assets[0].aliases.secret = 1; }],
  ['too many aliases', value => { value.assets[0].aliases = Array.from({ length: 4 }, (_, i) => `https://aliases.example/${i}`); }],
  ['duplicate aliases', value => { value.assets[0].aliases = ['https://aliases.example/a', 'https://aliases.example/a']; }],
  ['alias collision primary', value => { value.assets[0].aliases = ['https://assets.example/other']; value.assets.push(asset('https://assets.example/other')); }],
  ['alias collision alias', value => { value.assets[0].aliases = ['https://aliases.example/a']; value.assets.push(asset('https://assets.example/other', bytes, ['https://aliases.example/a'])); }],
  ['alias query', value => { value.assets[0].aliases = ['https://aliases.example/a?secret']; }],
]) {
  test(`configuration rejects ${label} before storage/network work`, async () => {
    const value = plan(), fixture = storageFixture();
    change(value);
    await assert.rejects(prepareVerifiedAssetCache(value, options(fixture)), canonical('INVALID_CACHE_CONFIG'));
    assert.deepEqual(fixture.calls.open, []);
  });
}

test('key allowlists precede value getters, then capture known fields once into owned projection', async () => {
  let reads = 0;
  const invalid = { ...plan(), extra: true };
  Object.defineProperty(invalid, 'assets', { get() { reads++; throw new Error('secret'); } });
  await assert.rejects(prepareVerifiedAssetCache(invalid), canonical('INVALID_CACHE_CONFIG'));
  assert.equal(reads, 0);
  const fixture = storageFixture(), value = plan(), counts = new Map();
  for (const object of [value, value.assets[0]]) {
    for (const key of Object.keys(object)) {
      const original = object[key];
      Object.defineProperty(object, key, { get() {
        counts.set(key, (counts.get(key) ?? 0) + 1); return original;
      }, configurable: true });
    }
  }
  const started = deferred(), release = deferred();
  const preparation = prepareVerifiedAssetCache(value, options(fixture, {
    fetch: async () => { started.resolve(); await release.promise; return new Response(bytes); },
  }));
  await started.promise;
  Object.defineProperty(value.assets[0], 'url', { value: 'https://secret.example/changed' });
  release.resolve();
  const store = await preparation;
  assert.deepEqual([...counts.values()], [1, 2, 1, 1, 1, 1]);
  assert.deepEqual(await consume(await store.cache.match(asset().url)), bytes);
  store.close();
});

for (const badOptions of [{ extra: true }, { signal: {} }, { signal: undefined },
  { onProgress: null }, { fetch: null }, { cacheStorage: null }]) {
  test(`invalid option projection ${Object.keys(badOptions)} refuses canonically`, async () => {
    await assert.rejects(prepareVerifiedAssetCache(plan(), badOptions), canonical('INVALID_CACHE_CONFIG'));
  });
}

test('null prototype records and an alias identical to own primary remain valid', async () => {
  const fixture = storageFixture(), a = Object.assign(Object.create(null), asset());
  a.aliases = [a.url, 'https://aliases.example/a'];
  const store = await prepareVerifiedAssetCache(Object.assign(Object.create(null), plan([a])), options(fixture));
  for (const key of [a.url, a.aliases[1], new Request(a.aliases[1])]) {
    assert.deepEqual(await consume(await store.cache.match(key)), bytes);
  }
  assert.deepEqual(await store.finishReads(), { reads: 3, verifiedBytes: 3 * bytes.length });
  assert.deepEqual(fixture.calls.match, Array(4).fill(a.url));
  store.close();
});

for (const data of [bytes.slice(1), new Uint8Array(bytes.length), new Uint8Array(bytes.length + 1)]) {
  test(`corrupt existing cache ${data.length} bytes refuses without fetch, repair, or deletion`, async () => {
    const fixture = storageFixture([[asset().url, data]]);
    await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture, {
      fetch: () => { throw new Error('network forbidden'); },
    })), canonical('ASSET_INTEGRITY_ERROR'));
    assert.deepEqual(fixture.calls.put, []);
    assert.deepEqual(fixture.entries.get(asset().url), data);
  });
}

test('cache read and fetch exceptions cannot borrow a caller ABORTED code', async () => {
  for (const stage of ['open', 'match', 'fetch']) {
    const fixture = storageFixture(), secret = Object.assign(new Error('secret URL quota'), { code: 'ABORTED' });
    const opts = options(fixture);
    if (stage === 'open') fixture.cacheStorage.open = () => { throw secret; };
    if (stage === 'match') fixture.cache.match = () => Promise.reject(secret);
    if (stage === 'fetch') opts.fetch = () => Promise.reject(secret);
    await assert.rejects(prepareVerifiedAssetCache(plan(), opts), canonical('ASSET_CACHE_ERROR'));
  }
});

test('quota refusal rejects after successful hash and delayed put prevents early acceptance', async () => {
  const fixture = storageFixture(), release = deferred(), written = deferred();
  const put = fixture.cache.put;
  fixture.cache.put = async (...args) => { await put(...args); written.resolve(); await release.promise; };
  let accepted = false;
  const preparation = prepareVerifiedAssetCache(plan(), options(fixture)).then(value => { accepted = true; return value; });
  await written.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted, false);
  release.reject(Object.assign(new Error('quota secret'), { code: 'ABORTED' }));
  await assert.rejects(preparation, canonical('ASSET_CACHE_ERROR'));
});

test('short or wrong hash cold responses never produce an accepted store', async () => {
  for (const data of [bytes.slice(1), new Uint8Array(bytes.length)]) {
    const fixture = storageFixture();
    await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture, {
      fetch: async () => new Response(data),
    })), canonical('ASSET_INTEGRITY_ERROR'));
    assert.equal(fixture.entries.size, 0);
  }
});

for (const stage of ['open', 'match', 'fetch', 'put', 'drain']) {
  test(`owned abort promptly races hung ${stage} and quiet late cleanup`, async () => {
    const fixture = storageFixture(), gate = deferred(), entered = deferred(), controller = new AbortController();
    let cancelled = 0;
    const lateResponse = () => new Response(new ReadableStream({ cancel() { cancelled++; throw new Error('secret cancel'); } }));
    const opts = options(fixture, { signal: controller.signal });
    if (stage === 'open') fixture.cacheStorage.open = () => { entered.resolve(); return gate.promise; };
    if (stage === 'match') fixture.cache.match = () => { entered.resolve(); return gate.promise; };
    if (stage === 'fetch') opts.fetch = () => { entered.resolve(); return gate.promise; };
    if (stage === 'put') fixture.cache.put = () => { entered.resolve(); return gate.promise; };
    if (stage === 'drain') fixture.cache.match = async () => new Response(new ReadableStream({
      pull() { entered.resolve(); return gate.promise; }, cancel() { cancelled++; },
    }, { highWaterMark: 0 }));
    const preparation = prepareVerifiedAssetCache(plan(), opts);
    await entered.promise;
    controller.abort(Object.assign(new Error('secret'), { code: 'INVALID_CACHE_CONFIG' }));
    await assert.rejects(timely(preparation), canonical('ABORTED'));
    gate.resolve(stage === 'open' ? fixture.cache : stage === 'put' || stage === 'drain' ? undefined : lateResponse());
    await new Promise(resolve => setImmediate(resolve));
    if (stage === 'match' || stage === 'fetch' || stage === 'drain') assert.equal(cancelled, 1);
  });
}

test('abort already set avoids opening storage and throwing progress cannot leak payload', async () => {
  const fixture = storageFixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture, { signal: controller.signal })), canonical('ABORTED'));
  assert.deepEqual(fixture.calls.open, []);
  await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture, {
    onProgress() { throw Object.assign(new Error('secret'), { code: 'ABORTED' }); },
  })), canonical('ASSET_INTEGRITY_ERROR'));
});

test('SDK denials return truthy Responses with body errors and poison finishReads', async () => {
  for (const kind of ['unknown', 'missing', 'cacheThrow', 'post', 'spoofRequest']) {
    const fixture = storageFixture(), store = await prepareVerifiedAssetCache(plan(), options(fixture));
    if (kind === 'missing') fixture.entries.clear();
    if (kind === 'cacheThrow') fixture.cache.match = () => { throw new Error('secret'); };
    let key = kind === 'unknown' ? 'https://secret.example/private' : asset().url;
    if (kind === 'post') key = new Request(asset().url, { method: 'POST' });
    if (kind === 'spoofRequest') key = Object.create(Request.prototype);
    const response = await store.cache.match(key);
    assert.equal(response instanceof Response, true);
    assert.equal(response.ok, true);
    await assert.rejects(consume(response), canonical('ASSET_CACHE_ERROR'));
    await assert.rejects(store.finishReads(), canonical('ASSET_CACHE_ERROR'));
    store.close();
  }
});

test('SDK corrupt reads and cancelled unconsumed reads cannot earn receipts', async () => {
  for (const kind of ['corrupt', 'short', 'cancel']) {
    const fixture = storageFixture(), store = await prepareVerifiedAssetCache(plan(), options(fixture));
    if (kind === 'corrupt') fixture.entries.set(asset().url, new Uint8Array(bytes.length));
    if (kind === 'short') fixture.entries.set(asset().url, bytes.slice(1));
    const response = await store.cache.match(asset().url);
    if (kind === 'cancel') await response.body.cancel('secret');
    else await assert.rejects(consume(response), canonical('ASSET_INTEGRITY_ERROR'));
    await assert.rejects(store.finishReads(), canonical(kind === 'cancel' ? 'ABORTED' : 'ASSET_INTEGRITY_ERROR'));
    store.close();
  }
});

test('SDK put is denied and close is idempotent, revokes new reads, and aborts active reads', async () => {
  const fixture = storageFixture(), store = await prepareVerifiedAssetCache(plan(), options(fixture));
  const response = await store.cache.match(asset().url);
  store.close(); store.close();
  await assert.rejects(consume(response), canonical('ABORTED'));
  await assert.rejects(consume(await store.cache.match(asset().url)), canonical('ABORTED'));
  await assert.rejects(store.cache.put('secret', new Response(bytes)), canonical('ASSET_CACHE_ERROR'));
  await assert.rejects(store.finishReads(), canonical('ABORTED'));
  assert.equal(fixture.calls.put.length, 1);
});

test('finishReads includes new reads registered while its barrier is waiting', async () => {
  const fixture = storageFixture(), store = await prepareVerifiedAssetCache(plan(), options(fixture));
  const first = await store.cache.match(asset().url);
  const barrier = store.finishReads();
  const second = await store.cache.match(asset().url);
  await consume(first); await consume(second);
  assert.deepEqual(await barrier, { reads: 2, verifiedBytes: bytes.length * 2 });
  store.close();
});

test('reentrant progress abort prevents acceptance even after hash verified event', async () => {
  const fixture = storageFixture(), controller = new AbortController();
  await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture, {
    signal: controller.signal, onProgress(event) { if (event.verified) controller.abort('secret'); },
  })), canonical('ABORTED'));
});

test('only native missing undefined permits fetch; malformed null is not a repair opportunity', async () => {
  const fixture = storageFixture();
  let fetches = 0;
  fixture.cache.match = async () => null;
  await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture, {
    fetch: async () => { fetches++; return new Response(bytes); },
  })), canonical('ASSET_INTEGRITY_ERROR'));
  assert.equal(fetches, 0);
  assert.deepEqual(fixture.calls.put, []);
});

test('unavailable CacheStorage and invalid cache methods refuse without fallback buffering', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  try {
    Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true });
    await assert.rejects(prepareVerifiedAssetCache(plan(), { fetch: () => { throw new Error('must not fetch'); } }), canonical('ASSET_CACHE_ERROR'));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor);
    else delete globalThis.caches;
  }
  for (const method of ['open', 'match', 'put']) {
    const fixture = storageFixture();
    if (method === 'open') fixture.cacheStorage.open = undefined;
    else fixture.cache[method] = undefined;
    await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture)), canonical('ASSET_CACHE_ERROR'));
  }
});

test('real HTTP fetch has a native final URL and delivers bounded verified chunks to storage', async () => {
  const large = Uint8Array.from({ length: 131091 }, (_, index) => index % 251), fixture = storageFixture();
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Length': String(large.length) });
    response.end(large);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/model.bin`, sizes = [];
  const originalPut = fixture.cache.put;
  fixture.cache.put = async (key, response) => {
    const body = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else { sizes.push(value.length); controller.enqueue(value); }
      },
    }, { highWaterMark: 0 });
    const reader = response.body.getReader();
    await originalPut(key, new Response(body));
  };
  try {
    const store = await prepareVerifiedAssetCache(plan([asset(url, large)]), options(fixture, { fetch: globalThis.fetch }));
    assert.equal(sizes.every(size => size <= 65536), true);
    assert.equal(sizes.reduce((total, size) => total + size, 0), large.length);
    assert.deepEqual(store.receipt, { assets: 1, verifiedBytes: large.length, networkBytes: large.length, cacheBytes: 0 });
    assert.deepEqual(await consume(await store.cache.match(url)), large);
    assert.deepEqual(await store.finishReads(), { reads: 1, verifiedBytes: large.length });
    store.close();
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('prepare and warm drain never call source full-buffer or clone methods', async () => {
  const fixture = storageFixture();
  const nativeResponse = () => {
    const response = new Response(bytes);
    for (const method of ['arrayBuffer', 'clone', 'text', 'json', 'blob']) {
      Object.defineProperty(response, method, { value() { throw new Error('full-buffer forbidden'); } });
    }
    return response;
  };
  const cold = await prepareVerifiedAssetCache(plan(), options(fixture, { fetch: async () => nativeResponse() }));
  cold.close();
  fixture.cache.match = async () => nativeResponse();
  const warm = await prepareVerifiedAssetCache(plan(), options(fixture));
  assert.equal(warm.receipt.cacheBytes, bytes.length);
  warm.close();
});

test('native signal and Request fields ignore misleading own getters and methods', async () => {
  const fixture = storageFixture(), controller = new AbortController();
  for (const key of ['aborted', 'addEventListener', 'removeEventListener']) {
    Object.defineProperty(controller.signal, key, { get() { throw new Error('private signal shadow'); } });
  }
  const store = await prepareVerifiedAssetCache(plan(), options(fixture, { signal: controller.signal }));
  const key = new Request(asset().url);
  for (const field of ['method', 'url']) {
    Object.defineProperty(key, field, { get() { throw new Error('private request shadow'); } });
  }
  assert.deepEqual(await consume(await store.cache.match(key)), bytes);
  controller.abort();
  await assert.rejects(consume(await store.cache.match(key)), canonical('ABORTED'));
  store.close();
});

test('raw error code getters and Response shadows are never trusted or disclosed', async () => {
  const raw = new Error('secret payload URL');
  Object.defineProperty(raw, 'code', { get() { throw new Error('private code getter'); } });
  const fixture = storageFixture();
  fixture.cacheStorage.open = () => { throw raw; };
  await assert.rejects(prepareVerifiedAssetCache(plan(), options(fixture)), canonical('ASSET_CACHE_ERROR'));
  for (const field of ['url', 'status', 'body']) {
    let reads = 0;
    const response = new Response(bytes), data = storageFixture();
    Object.defineProperty(response, field, { get() { reads++; throw raw; } });
    await assert.rejects(prepareVerifiedAssetCache(plan(), options(data, { fetch: async () => response })), canonical('ASSET_INTEGRITY_ERROR'));
    assert.equal(reads, 0);
  }
  for (const code of ['https://secret.example/key', raw, undefined, '__proto__']) {
    const error = new VerifiedCacheError(code);
    assert.equal(error.code, 'INVALID_CACHE_CONFIG');
    assert.equal(error.message, 'The asset cache configuration is invalid.');
  }
});

test('SDK pending cache lookup and fresh response pull both settle after close', async () => {
  for (const stage of ['match', 'pull']) {
    const fixture = storageFixture(), store = await prepareVerifiedAssetCache(plan(), options(fixture));
    let cancelled = 0;
    const gate = deferred(), entered = deferred();
    fixture.cache.match = stage === 'match'
      ? () => { entered.resolve(); return gate.promise; }
      : async () => new Response(new ReadableStream({
        pull() { entered.resolve(); return gate.promise; }, cancel() { cancelled++; },
      }, { highWaterMark: 0 }));
    const response = store.cache.match(asset().url);
    const consumption = response.then(consume);
    await entered.promise;
    store.close();
    await assert.rejects(timely(consumption), canonical('ABORTED'));
    await assert.rejects(timely(store.finishReads()), canonical('ABORTED'));
    if (stage === 'match') gate.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
    else gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, 1);
  }
});

test('close immediately errors an SDK reader closed promise even when no body read began', async () => {
  const fixture = storageFixture(), store = await prepareVerifiedAssetCache(plan(), options(fixture));
  const response = await store.cache.match(asset().url), reader = response.body.getReader();
  const closed = reader.closed;
  store.close();
  await assert.rejects(timely(closed), canonical('ABORTED'));
  await assert.rejects(timely(store.finishReads()), canonical('ABORTED'));
  reader.releaseLock();
});
