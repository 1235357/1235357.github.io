import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getModelFile } from '../node_modules/@huggingface/transformers/src/utils/hub.js';
import { env } from '../node_modules/@huggingface/transformers/src/env.js';
import { prepareVerifiedAssetCache, VerifiedCacheError } from '../verified-cache.mjs';

const MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
const REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e';
const LOCAL_ROOT = 'https://models.example/sealed/';
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json',
  'generation_config.json', 'onnx/model_q4.onnx'];
// Tiny synthetic bodies exercise the real SDK file loader. They are never
// passed to a tokenizer, ONNX session, GPU, model loader or generation call.
const bodies = FILES.map((file, index) => new TextEncoder().encode(`synthetic ${index}: ${file}`));
const assets = FILES.map((file, index) => ({
  url: `https://assets.example/verified/${file}`,
  bytes: bodies[index].length,
  sha256: createHash('sha256').update(bodies[index]).digest('hex'),
  aliases: [`${LOCAL_ROOT}${MODEL}/${file}`, `https://huggingface.co/${MODEL}/resolve/${REVISION}/${file}`],
}));
const cachePlan = { cacheName: 'financial-rag-generator-sdk-test', assets };
const canonical = code => error => {
  assert.equal(error instanceof VerifiedCacheError, true);
  assert.equal(error.name, 'VerifiedCacheError');
  assert.equal(error.code, code);
  assert.equal(/https:|secret|quota/.test(error.message), false);
  return true;
};
function fixture() {
  const entries = new Map(), calls = { network: 0, writes: 0, matches: [] };
  const cache = {
    async match(key) {
      calls.matches.push(key);
      return entries.has(key) ? new Response(entries.get(key)) : undefined;
    },
    async put(key, response) {
      calls.writes++;
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); length += value.length;
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      entries.set(key, body);
    },
  };
  return { entries, cache, calls, options: {
    cacheStorage: { async open(name) { assert.equal(name, cachePlan.cacheName); return cache; } },
    async fetch(key) {
      calls.network++;
      const index = assets.findIndex(asset => asset.url === key);
      assert.notEqual(index, -1);
      return new Response(bodies[index]);
    },
  } };
}
const sdkTest = (name, body) => test(name, { concurrency: false }, body);
async function withSDK(cache, callback) {
  const fields = ['allowLocalModels', 'allowRemoteModels', 'useCustomCache', 'customCache',
    'useBrowserCache', 'useFSCache', 'localModelPath'];
  const before = Object.fromEntries(fields.map(field => [field, env[field]]));
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let fetches = 0, puts = 0;
  try {
    Object.assign(env, { allowLocalModels: true, allowRemoteModels: false, useCustomCache: true,
      useBrowserCache: false, useFSCache: false, localModelPath: LOCAL_ROOT,
      customCache: { match: (...args) => cache.match(...args), put: (...args) => { puts++; return cache.put(...args); } } });
    globalThis.fetch = async () => { fetches++; throw new Error('SDK network attempt'); };
    // The installed SDK warns before reading an errored denial response with
    // no length header. Keep that expected diagnostic local to the test.
    console.warn = () => {};
    await callback(() => ({ fetches, puts }));
  } finally {
    Object.assign(env, before);
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

sdkTest('the integration uses installed Transformers.js 3.8.1 source file loader', () => {
  const installed = JSON.parse(readFileSync(new URL('../node_modules/@huggingface/transformers/package.json', import.meta.url), 'utf8'));
  assert.equal(installed.version, '3.8.1');
  assert.equal(typeof getModelFile, 'function');
});

for (const [index, file] of FILES.entries()) {
  for (const progress of [false, true]) {
    sdkTest(`real SDK reads approved ${file} with progress=${progress}, no fallback or SDK put`, async () => {
      const data = fixture(), store = await prepareVerifiedAssetCache(cachePlan, data.options), events = [];
      try {
        await withSDK(store.cache, async counts => {
          const options = { revision: REVISION };
          if (progress) options.progress_callback = event => events.push(event);
          const result = await getModelFile(MODEL, file, true, options);
          assert.deepEqual(result, bodies[index]);
          assert.deepEqual(await store.finishReads(), { reads: 1, verifiedBytes: bodies[index].length });
          assert.deepEqual(counts(), { fetches: 0, puts: 0 });
          assert.equal(data.calls.writes, FILES.length);
          assert.equal(data.calls.network, FILES.length);
          assert.equal(data.calls.matches.at(-1), assets[index].url);
          if (progress) assert.equal(events.at(-1).status, 'done');
        });
      } finally { store.close(); }
    });
  }
}

for (const progress of [false, true]) {
  sdkTest(`real SDK repeatedly reads one store with progress=${progress}, fresh responses and cumulative receipts`, async () => {
    const index = FILES.length - 1, file = FILES[index], data = fixture();
    const store = await prepareVerifiedAssetCache(cachePlan, data.options), responses = [];
    const match = data.cache.match;
    data.cache.match = async key => {
      const response = await match(key);
      responses.push(response);
      return response;
    };
    try {
      await withSDK(store.cache, async counts => {
        const options = { revision: REVISION };
        if (progress) options.progress_callback = () => {};
        for (let reads = 1; reads <= 3; reads++) {
          assert.deepEqual(await getModelFile(MODEL, file, true, options), bodies[index]);
          assert.deepEqual(await store.finishReads(), { reads, verifiedBytes: reads * bodies[index].length });
          assert.equal(responses.length, reads);
          assert.equal(responses.at(-1) instanceof Response, true);
          assert.equal(responses.at(-1).bodyUsed, true);
          assert.equal(new Set(responses).size, reads);
          assert.deepEqual(counts(), { fetches: 0, puts: 0 });
          assert.equal(data.calls.network, FILES.length);
          assert.equal(data.calls.writes, FILES.length);
        }
        assert.deepEqual(data.calls.matches.slice(FILES.length), Array(3).fill(assets[index].url));
      });
    } finally { store.close(); }
  });
}

for (const progress of [false, true]) {
  for (const fatal of [false, true]) {
    for (const kind of ['corrupt', 'short', 'missing', 'cacheThrow', 'unknown']) {
      sdkTest(`SDK ${kind} rejects with progress=${progress} fatal=${fatal} and cannot escape sealed cache`, async () => {
        const data = fixture(), store = await prepareVerifiedAssetCache(cachePlan, data.options);
        if (kind === 'corrupt') data.entries.set(assets[0].url, new Uint8Array(bodies[0].length));
        if (kind === 'short') data.entries.set(assets[0].url, bodies[0].slice(1));
        if (kind === 'missing') data.entries.delete(assets[0].url);
        if (kind === 'cacheThrow') data.cache.match = () => { throw Object.assign(new Error('secret'), { code: 'ABORTED' }); };
        const code = ['corrupt', 'short'].includes(kind) ? 'ASSET_INTEGRITY_ERROR' : 'ASSET_CACHE_ERROR';
        try {
          await withSDK(store.cache, async counts => {
            const options = { revision: REVISION };
            if (progress) options.progress_callback = () => {};
            await assert.rejects(getModelFile(MODEL, kind === 'unknown' ? 'unknown.json' : FILES[0], fatal, options), canonical(code));
            await assert.rejects(store.finishReads(), canonical(code));
            assert.deepEqual(counts(), { fetches: 0, puts: 0 });
            assert.equal(data.calls.writes, FILES.length);
            assert.equal(data.calls.network, FILES.length);
          });
        } finally { store.close(); }
      });
    }
  }
}

for (const progress of [false, true]) {
  sdkTest(`SDK abort errors a pending native response with progress=${progress}, no fallback`, async () => {
    const data = fixture(), controller = new AbortController();
    const store = await prepareVerifiedAssetCache(cachePlan, { ...data.options, signal: controller.signal });
    let started;
    const reading = new Promise(resolve => { started = resolve; });
    data.cache.match = async () => new Response(new ReadableStream({
      pull() { started(); return new Promise(() => {}); },
    }, { highWaterMark: 0 }));
    try {
      await withSDK(store.cache, async counts => {
        const options = { revision: REVISION };
        if (progress) options.progress_callback = () => {};
        const load = getModelFile(MODEL, FILES[0], true, options);
        await reading;
        controller.abort(Object.assign(new Error('secret'), { code: 'ASSET_CACHE_ERROR' }));
        await assert.rejects(load, canonical('ABORTED'));
        await assert.rejects(store.finishReads(), canonical('ABORTED'));
        assert.deepEqual(counts(), { fetches: 0, puts: 0 });
      });
    } finally { store.close(); }
  });
}

sdkTest('registered Hugging Face aliases resolve fresh native responses from primary entries', async () => {
  const data = fixture(), store = await prepareVerifiedAssetCache(cachePlan, data.options);
  try {
    for (const [index, asset] of assets.entries()) {
      const first = await store.cache.match(asset.aliases[1]);
      const second = await store.cache.match(new Request(asset.aliases[1]));
      assert.notEqual(first, second);
      assert.equal(first instanceof Response, true);
      assert.deepEqual(new Uint8Array(await first.arrayBuffer()), bodies[index]);
      assert.deepEqual(new Uint8Array(await second.arrayBuffer()), bodies[index]);
    }
    assert.deepEqual(await store.finishReads(), { reads: FILES.length * 2,
      verifiedBytes: bodies.reduce((total, body) => total + body.length * 2, 0) });
    assert.equal(data.calls.writes, FILES.length);
    assert.equal(data.calls.network, FILES.length);
  } finally { store.close(); }
});

sdkTest('negative control proves SDK swallows legacy cache match rejection and attempts a fetch', async () => {
  const originalWarn = console.warn;
  const legacy = { async match() { throw new Error('legacy cache refusal'); }, async put() { throw new Error('unexpected write'); } };
  try {
    console.warn = () => {};
    await withSDK(legacy, async counts => {
      await assert.rejects(getModelFile(MODEL, FILES[0], true, { revision: REVISION }));
      assert.deepEqual(counts(), { fetches: 1, puts: 0 });
    });
  } finally { console.warn = originalWarn; }
});
