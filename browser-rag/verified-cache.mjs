import { verifyAssetResponse } from './verified-stream.mjs';
import {createWorkerFailureTracker} from './runtime-failure-contract.mjs';

const MESSAGES = Object.freeze({
  INVALID_CACHE_CONFIG: 'The asset cache configuration is invalid.',
  ASSET_CACHE_ERROR: 'The asset cache operation failed.',
  ASSET_INTEGRITY_ERROR: 'The asset failed integrity verification.',
  ABORTED: 'The asset cache operation was aborted.',
});
const MAX_BYTES = 1073741824;
const internalCodes = new WeakMap();
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, 'body').get;
const requestURL = Object.getOwnPropertyDescriptor(Request.prototype, 'url').get;
const requestMethod = Object.getOwnPropertyDescriptor(Request.prototype, 'method').get;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
const abortController = AbortController.prototype.abort;
const streamCancel = ReadableStream.prototype.cancel;
const streamReader = ReadableStream.prototype.getReader;
const readChunk = ReadableStreamDefaultReader.prototype.read;
const cancelReader = ReadableStreamDefaultReader.prototype.cancel;
const releaseReader = ReadableStreamDefaultReader.prototype.releaseLock;

export class VerifiedCacheError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code)
      ? code : 'INVALID_CACHE_CONFIG';
    super(MESSAGES[safe]);
    this.name = 'VerifiedCacheError';
    this.code = safe;
  }
}

function failure(code) {
  const error = new VerifiedCacheError(code);
  internalCodes.set(error, code);
  return error;
}

function keys(value, required, optional = []) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => !required.includes(key) && !optional.includes(key))
      || required.some(key => !actual.includes(key))) throw new Error();
  return actual;
}

function array(value, minimum, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
  const length = value.length, expected = ['length'];
  if (length < minimum || length > maximum) throw new Error();
  for (let index = 0; index < length; index++) expected.push(String(index));
  const actual = Reflect.ownKeys(value);
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) throw new Error();
  return Array.from({ length }, (_, index) => value[index]);
}

function canonicalURL(value) {
  if (typeof value !== 'string') throw new Error();
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.href !== value
      || url.username || url.password || value.includes('?') || value.includes('#')) throw new Error();
  return url.origin;
}

function capture(plan, options) {
  try {
    keys(plan, ['cacheName', 'assets']);
    const optionKeys = keys(options, [], ['fetch', 'cacheStorage', 'signal', 'onProgress', 'onDiagnostic']);
    const cacheName = plan.cacheName, source = array(plan.assets, 1, 64);
    // Refuse every record's unknown keys before reading any record value.
    for (const item of source) keys(item, ['url', 'bytes', 'sha256', 'aliases']);
    if (typeof cacheName !== 'string' || !/^financial-rag-generator-[a-z0-9-]{1,120}$/.test(cacheName)) throw new Error();
    let total = 0, origin;
    const keyMap = new Map();
    const assets = source.map((item, index) => {
      const url = item.url, bytes = item.bytes, sha256 = item.sha256, aliases = array(item.aliases, 0, 3);
      const currentOrigin = canonicalURL(url);
      if (origin !== undefined && currentOrigin !== origin) throw new Error();
      origin = currentOrigin;
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES
          || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error();
      total += bytes;
      if (total > MAX_BYTES || new Set(aliases).size !== aliases.length) throw new Error();
      for (const key of [url, ...aliases]) {
        canonicalURL(key);
        if (keyMap.has(key) && keyMap.get(key) !== index) throw new Error();
        keyMap.set(key, index);
      }
      return Object.freeze({ url, bytes, sha256, aliases: Object.freeze(aliases) });
    });
    const fetch = optionKeys.includes('fetch') ? options.fetch : globalThis.fetch;
    const cacheStorage = optionKeys.includes('cacheStorage') ? options.cacheStorage : globalThis.caches;
    const signal = optionKeys.includes('signal') ? options.signal : undefined;
    const onProgress = optionKeys.includes('onProgress') ? options.onProgress : undefined;
    const onDiagnostic=optionKeys.includes('onDiagnostic')?options.onDiagnostic:undefined;
    if (optionKeys.includes('fetch') && typeof fetch !== 'function') throw new Error();
    if (optionKeys.includes('cacheStorage') && (!cacheStorage || typeof cacheStorage !== 'object')) throw new Error();
    if (optionKeys.includes('signal')) {
      if (!(signal instanceof AbortSignal)) throw new Error();
      signalAborted.call(signal);
    }
    if (optionKeys.includes('onProgress') && typeof onProgress !== 'function') throw new Error();
    if(optionKeys.includes('onDiagnostic')&&typeof onDiagnostic!=='function')throw new Error();
    return Object.freeze({ cacheName, assets: Object.freeze(assets), keyMap, fetch, cacheStorage, signal, onProgress, onDiagnostic });
  } catch { throw failure('INVALID_CACHE_CONFIG'); }
}

function cancelResponse(value) {
  try {
    if (value instanceof Response) {
      const body = responseBody.call(value);
      if (body) Promise.resolve(streamCancel.call(body)).catch(() => {});
    }
  } catch {}
}

function errorResponse(code) {
  return new Response(new ReadableStream({ start(controller) { controller.error(failure(code)); } }));
}

/** Prepare one named cache, then seal SDK reads to the verified asset allowlist.
 * Cache.put owns its native storage buffering; this module never collects,
 * clones or tees an asset body. Receipts describe completed body verification.
 */
export async function prepareVerifiedAssetCache(plan, options = {}) {
  const config = capture(plan, options), owned = new AbortController();
  const diagnostic=config.onDiagnostic?createWorkerFailureTracker('preparation-loader',config.onDiagnostic):null;
  const records = [];
  let stopped = null, storage;
  let rejectStop;
  const stopPromise = new Promise((_, reject) => { rejectStop = reject; });
  stopPromise.catch(() => {});
  const externalAbort = () => stop('ABORTED');

  function detach() {
    if (config.signal) { try { removeListener.call(config.signal, 'abort', externalAbort); } catch {} }
  }
  function stop(code) {
    if (stopped) return;
    stopped = code;
    detach();
    abortController.call(owned);
    rejectStop(failure(code));
  }
  function normalize(error, code) { return failure(stopped ?? internalCodes.get(error) ?? code); }
  async function race(operation, code, cleanup) {
    if (stopped) throw failure(stopped);
    let pending;
    try { pending = Promise.resolve(operation()); }
    catch (error) { throw normalize(error, code); }
    const checked = pending.then(value => {
      if (stopped) { if (cleanup) cleanup(value); throw failure(stopped); }
      return value;
    });
    try { return await Promise.race([checked, stopPromise]); }
    catch (error) { throw normalize(error, code); }
  }
  function invoke(target, name, ...args) {
    const method = target[name];
    if (typeof method !== 'function') throw new Error();
    return Reflect.apply(method, target, args);
  }
  function wrap(response, assetIndex, stage) {
    const asset = config.assets[assetIndex];
    try {
      return verifyAssetResponse(response, { url: asset.url, bytes: asset.bytes, sha256: asset.sha256 }, {
        signal: owned.signal,
        onProgress: event => {
          if (config.onProgress) config.onProgress(Object.freeze({ stage, assetIndex, ...event }));
        },
      });
    } catch (error) {
      cancelResponse(response);
      throw normalize(error, 'ASSET_INTEGRITY_ERROR');
    }
  }
  async function drain(response) {
    const reader = streamReader.call(responseBody.call(response));
    try {
      while (!(await race(() => readChunk.call(reader), 'ASSET_INTEGRITY_ERROR')).done) {}
    } finally { try { releaseReader.call(reader); } catch {} }
  }
  function record() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    promise.catch(() => {});
    const entry = { promise, finished: false, code: null, resolve, reject };
    records.push(entry);
    return entry;
  }
  function settle(entry, code, bytes = 0) {
    if (entry.finished) return;
    entry.finished = true;
    entry.code = code;
    if (code) entry.reject(failure(code));
    else entry.resolve(bytes);
  }
  function deny(entry, code) { settle(entry, code); return errorResponse(code); }

  const cache = Object.freeze({
    async match(request) {
      const entry = record();
      let assetIndex;
      try {
        if (stopped) return deny(entry, stopped);
        let key;
        if (typeof request === 'string') key = request;
        else if (request instanceof Request && requestMethod.call(request) === 'GET') key = requestURL.call(request);
        if (!config.keyMap.has(key)) return deny(entry, 'ASSET_CACHE_ERROR');
        assetIndex = config.keyMap.get(key);
        const response = await race(() => invoke(storage, 'match', config.assets[assetIndex].url),
          'ASSET_CACHE_ERROR', cancelResponse);
        if (!response) return deny(entry, 'ASSET_CACHE_ERROR');
        const verified = wrap(response, assetIndex, 'consume');
        const reader = streamReader.call(responseBody.call(verified.response));
        const completion = race(() => verified.completion, 'ASSET_INTEGRITY_ERROR');
        let output;
        completion.then(value => settle(entry, null, value.bytes),
          error => {
            const code = stopped ?? entry.code ?? internalCodes.get(error) ?? 'ASSET_INTEGRITY_ERROR';
            settle(entry, code);
            // Revoke even a response whose consumer never initiated pull.
            // Otherwise its closed promise and our private lock can linger.
            try { output.error(failure(code)); } catch {}
            try { releaseReader.call(reader); } catch {}
          });
        return new Response(new ReadableStream({
          start(controller) { output = controller; },
          async pull(controller) {
            try {
              const chunk = await race(() => readChunk.call(reader), 'ASSET_INTEGRITY_ERROR');
              if (chunk.done) { await completion; controller.close(); releaseReader.call(reader); }
              else controller.enqueue(chunk.value);
            } catch (error) {
              const code = stopped ?? entry.code ?? internalCodes.get(error) ?? 'ASSET_INTEGRITY_ERROR';
              settle(entry, code);
              controller.error(failure(code));
              try { releaseReader.call(reader); } catch {}
            }
          },
          cancel() {
            settle(entry, 'ABORTED');
            try { Promise.resolve(cancelReader.call(reader)).catch(() => {}); } catch {}
            try { releaseReader.call(reader); } catch {}
          },
        }, { highWaterMark: 0 }), { headers: { 'Content-Length': String(config.assets[assetIndex].bytes) } });
      } catch (error) {
        return deny(entry, stopped ?? internalCodes.get(error) ?? 'ASSET_CACHE_ERROR');
      }
    },
    async put() { const entry = record(); settle(entry, 'ASSET_CACHE_ERROR'); throw failure('ASSET_CACHE_ERROR'); },
  });

  try {
    if (config.signal) {
      addListener.call(config.signal, 'abort', externalAbort, { once: true });
      if (signalAborted.call(config.signal)) stop('ABORTED');
    }
    diagnostic?.enter('cache-open');storage = await race(() => invoke(config.cacheStorage, 'open', config.cacheName), 'ASSET_CACHE_ERROR');
    let verifiedBytes = 0, networkBytes = 0, cacheBytes = 0;
    for (let index = 0; index < config.assets.length; index++) {
      const asset = config.assets[index];
      diagnostic?.enter('cache-match',index);
      let response = await race(() => invoke(storage, 'match', asset.url), 'ASSET_CACHE_ERROR', cancelResponse);
      const cold = response === undefined;
      if (cold) {diagnostic?.enter('asset-fetch',index);response = await race(() => Reflect.apply(config.fetch, globalThis, [asset.url,
        { redirect: 'error', credentials: 'omit', signal: owned.signal }]), 'ASSET_CACHE_ERROR', cancelResponse);}
      diagnostic?.enter('asset-verify-and-store',index);
      const verified = wrap(response, index, 'prepare');
      // Await both independent obligations. A stored entry is never a receipt
      // until the entire body digest and the native put operation both succeed.
      await Promise.all([
        race(() => verified.completion, 'ASSET_INTEGRITY_ERROR'),
        cold ? race(() => invoke(storage, 'put', asset.url, verified.response), 'ASSET_CACHE_ERROR')
          : drain(verified.response),
      ]);
      if (stopped) throw failure(stopped);
      verifiedBytes += asset.bytes;
      if (cold) networkBytes += asset.bytes; else cacheBytes += asset.bytes;
    }
    const receipt = Object.freeze({ assets: config.assets.length, verifiedBytes, networkBytes, cacheBytes });
    async function finishReads() {
      let count, results;
      do {
        count = records.length;
        results = await Promise.allSettled(records.slice(0, count).map(entry => entry.promise));
      } while (count !== records.length);
      const refused = results.find(result => result.status === 'rejected');
      if (refused) throw normalize(refused.reason, 'ASSET_CACHE_ERROR');
      if (stopped) throw failure(stopped);
      return Object.freeze({ reads: count, verifiedBytes: results.reduce((total, result) => total + result.value, 0) });
    }
    return Object.freeze({ cache, receipt, finishReads, close() { stop('ABORTED'); } });
  } catch (error) {
    const code = stopped ?? internalCodes.get(error) ?? 'ASSET_CACHE_ERROR';
    diagnostic?.failure(code);
    stop(code);
    throw failure(code);
  }
}
