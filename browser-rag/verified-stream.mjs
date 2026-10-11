import { sha256 } from './vendor/noble-hashes/sha2.js';

const MESSAGES = Object.freeze({
  INVALID_ASSET_CONFIG: 'The asset configuration is invalid.',
  ASSET_INTEGRITY_ERROR: 'The asset failed integrity verification.',
  ABORTED: 'The asset verification was aborted.',
});
const MAX_ASSET_BYTES = 1073741824;
const COPY_BYTES = 65536;
const RESPONSE_FIELDS = Object.freeze(['status', 'redirected', 'url', 'bodyUsed', 'body', 'headers']);
const responseGetters = Object.freeze(Object.fromEntries(RESPONSE_FIELDS.map(field => [
  field, Object.getOwnPropertyDescriptor(Response.prototype, field).get,
])));
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const addSignalListener = EventTarget.prototype.addEventListener;
const removeSignalListener = EventTarget.prototype.removeEventListener;

export class VerifiedStreamError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code)
      ? code : 'INVALID_ASSET_CONFIG';
    super(MESSAGES[safe]);
    this.name = 'VerifiedStreamError';
    this.code = safe;
  }
}

function ownKeys(value, required, optional = []) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => !required.includes(key) && !optional.includes(key))
      || required.some(key => !keys.includes(key))) throw new Error();
  return keys;
}

function captureConfig(expected, options) {
  try {
    ownKeys(expected, ['url', 'bytes', 'sha256']);
    const optionKeys = ownKeys(options, [], ['signal', 'onProgress']);
    // Inspect the complete key allowlists before any user-defined value getter.
    const url = expected.url;
    const bytes = expected.bytes;
    const digest = expected.sha256;
    const signal = optionKeys.includes('signal') ? options.signal : undefined;
    const onProgress = optionKeys.includes('onProgress') ? options.onProgress : undefined;
    if (typeof url !== 'string' || !Number.isSafeInteger(bytes)
        || bytes <= 0 || bytes > MAX_ASSET_BYTES
        || typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new Error();
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.href !== url
        || parsed.username || parsed.password || url.includes('?') || url.includes('#')) {
      throw new Error();
    }
    if (optionKeys.includes('signal')) {
      if (!(signal instanceof AbortSignal)) throw new Error();
      signalAborted.call(signal); // Validate the native brand without an own getter.
    }
    if (optionKeys.includes('onProgress') && typeof onProgress !== 'function') throw new Error();
    return { url, bytes, digest, signal, onProgress };
  } catch {
    throw new VerifiedStreamError('INVALID_ASSET_CONFIG');
  }
}

function acquireReader(response, config) {
  try {
    if (!(response instanceof Response)) throw new Error();
    // Refuse ambiguous own shadows without evaluating their values. Native
    // getter calls then verify internal slots and capture each field once.
    if (RESPONSE_FIELDS.some(field => Object.hasOwn(response, field))) throw new Error();
    const status = responseGetters.status.call(response);
    const redirected = responseGetters.redirected.call(response);
    const url = responseGetters.url.call(response);
    const bodyUsed = responseGetters.bodyUsed.call(response);
    const body = responseGetters.body.call(response);
    const headers = responseGetters.headers.call(response);
    if (status !== 200 || redirected || (url && url !== config.url)
        || bodyUsed || !body || body.locked) throw new Error();
    const encoding = headers.get('Content-Encoding');
    const encoded = encoding !== null && encoding.trim().toLowerCase() !== 'identity';
    if (encoded && encoding.toLowerCase().split(',').some(value =>
      !['gzip', 'br', 'deflate'].includes(value.trim()))) throw new Error();
    // Fetch exposes decoded bytes; an encoded Content-Length counts wire bytes.
    // EOF verification still requires the exact decoded length and pinned SHA.
    const length = headers.get('Content-Length');
    if (length !== null && (encoded
      ? !/^(0|[1-9]\d*)$/.test(length) || !Number.isSafeInteger(Number(length))
      : length !== String(config.bytes))) throw new Error();
    return body.getReader();
  } catch {
    throw new VerifiedStreamError('ASSET_INTEGRITY_ERROR');
  }
}

/**
 * The caller owns consuming or cancelling the returned response. Verification
 * completes only after EOF, and mismatched data errors the body before close.
 * The verifier retains one upstream chunk, one owned copy of at most 64 KiB,
 * and fixed hash state. Native upstream chunk sizes and consumer memory are
 * outside that retention bound.
 */
export function verifyAssetResponse(response, expected, options = {}) {
  const config = captureConfig(expected, options);
  const reader = acquireReader(response, config);
  const hasher = sha256.create();
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // A caller may cancel and abandon the receipt. Explicit awaiting still sees
  // rejection; only the internal unhandled-rejection warning is suppressed.
  completion.catch(() => {});

  let controller;
  let terminal = false;
  let upstreamDone = false;
  let upstreamChunk = null;
  let offset = 0;
  let received = 0;
  let completed = 0;
  const abort = () => fail('ABORTED');

  function cleanup(error) {
    upstreamChunk = null;
    if (config.signal) {
      try { removeSignalListener.call(config.signal, 'abort', abort); } catch {}
    }
    hasher.destroy();
    if (error && !upstreamDone) {
      try { Promise.resolve(reader.cancel(error)).catch(() => {}); } catch {}
    }
    // Cancellation closes pending reads immediately, independently of an
    // unfinished upstream pull or a rejecting cancellation callback.
    try { reader.releaseLock(); } catch {}
  }

  function fail(code, outputWasCancelled = false) {
    if (terminal) return;
    terminal = true;
    const error = new VerifiedStreamError(code);
    rejectCompletion(error);
    if (!outputWasCancelled) {
      try { controller.error(error); } catch {}
    }
    cleanup(error);
  }

  function progress(verified) {
    if (!config.onProgress) return;
    config.onProgress(Object.freeze({
      completed, total: config.bytes, unit: 'bytes', estimated: false, verified,
    }));
  }

  function finish() {
    if (completed !== config.bytes) return fail('ASSET_INTEGRITY_ERROR');
    const digest = hasher.digest();
    let actual = '';
    for (const byte of digest) actual += byte.toString(16).padStart(2, '0');
    if (actual !== config.digest) return fail('ASSET_INTEGRITY_ERROR');
    progress(true);
    if (terminal) return; // A progress callback can synchronously abort.
    terminal = true;
    cleanup();
    controller.close();
    resolveCompletion(Object.freeze({ bytes: completed, sha256: actual }));
  }

  const body = new ReadableStream({
    start(value) { controller = value; },
    async pull() {
      if (terminal) return;
      try {
        while (upstreamChunk === null) {
          const { done, value } = await reader.read();
          if (terminal) return;
          if (done) {
            upstreamDone = true;
            finish();
            return;
          }
          if (!(value instanceof Uint8Array)
              || received + value.byteLength > config.bytes) {
            fail('ASSET_INTEGRITY_ERROR');
            return;
          }
          received += value.byteLength;
          if (value.byteLength === 0) continue;
          upstreamChunk = value;
          offset = 0;
        }
        const length = Math.min(COPY_BYTES, upstreamChunk.byteLength - offset);
        const outgoing = new Uint8Array(length);
        outgoing.set(upstreamChunk.subarray(offset, offset + length));
        hasher.update(outgoing);
        offset += length;
        completed += length;
        if (offset === upstreamChunk.byteLength) upstreamChunk = null;
        progress(false);
        if (!terminal) controller.enqueue(outgoing);
      } catch {
        fail('ASSET_INTEGRITY_ERROR');
      }
    },
    cancel() { fail('ABORTED', true); },
  }, { highWaterMark: 0 });
  const verifiedResponse = new Response(body, {
    status: 200, headers: { 'Content-Length': String(config.bytes) },
  });
  try {
    if (config.signal) addSignalListener.call(config.signal, 'abort', abort, { once: true });
    progress(false);
    if (config.signal && signalAborted.call(config.signal)) fail('ABORTED');
  } catch {
    fail('ASSET_INTEGRITY_ERROR');
  }
  return Object.freeze({ response: verifiedResponse, completion });
}
