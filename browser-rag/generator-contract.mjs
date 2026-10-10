// Pinned metadata for the later runtime: this is not an installed or accepted
// model. The device budget intentionally remains below the model's context.
export const GENERATION_SPEC = Object.freeze({
  modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  revision: '22942cb7d7ba4cc81bb4673549ca4d4614469b5e',
  tokenizerModelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  tokenizerRevision: '22942cb7d7ba4cc81bb4673549ca4d4614469b5e',
  libraryVersion: '3.8.1', ortVersion: '1.22.0-dev.20250409-89f8206ba4',
  dtype: 'q4', device: 'webgpu', modelMaxPositions: 32768, vocabSize: 151936,
  maxDeviceWindowTokens: 2048, defaultMaxNewTokens: 128, hardMaxNewTokens: 512,
  version: 'qwen2.5-0.5b-q4-webgpu-v1',
});

const MESSAGES = Object.freeze({
  INVALID_GENERATION_CONFIG: 'The generation configuration is invalid.',
  GENERATION_INPUT_LIMIT: 'The generation input is invalid or exceeds its token budget.',
  INVALID_GENERATION_OUTPUT: 'The generated token sequence is invalid.',
});

export class GenerationContractError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code)
      ? code : 'INVALID_GENERATION_CONFIG';
    super(MESSAGES[safe]); this.name = 'GenerationContractError'; this.code = safe;
  }
}
const fail = code => { throw new GenerationContractError(code); };

const SPEC_KEYS = Object.keys(GENERATION_SPEC);
const OPTION_KEYS = ['contextWindowTokens', 'maxNewTokens'];
const PREFLIGHT_KEYS = ['schemaVersion', 'status', 'generationMode', 'generationId',
  'generation', 'promptTokenIds', 'inputTokens', 'contextWindowTokens', 'maxNewTokens', 'settings'];
const SETTING_KEYS = ['do_sample', 'num_beams', 'num_return_sequences', 'max_new_tokens',
  'eos_token_id', 'pad_token_id', 'return_dict_in_generate', 'use_cache'];

// Local same-realm plain records (including null-prototype records) are the
// contract boundary. Reflection/access failures are made canonical; this is
// not a universal sandbox for hostile objects or modified global intrinsics.
function snapshotRecord(value, keys, code, exact = true) {
  if (value === null || typeof value !== 'object'
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if ((exact && ownKeys.length !== keys.length)
      || ownKeys.some(key => !keys.includes(key))) fail(code);
  const captured = {};
  for (const key of keys) {
    if (exact && !Object.hasOwn(value, key)) fail(code);
    captured[key] = Object.hasOwn(value, key) ? value[key] : undefined;
  }
  return captured;
}

// Read the bounded length before enumerating keys or reading token values.
// Never delegate copying to caller map/slice/iterator implementations.
function snapshotIds(value, minLength, maxLength, code, allowBigInt = false) {
  if (!Array.isArray(value)) fail(code);
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < minLength || length > maxLength) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !Object.hasOwn(value, 'length')) fail(code);
  const copied = [];
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(value, index)) fail(code);
    let id = value[index];
    if (allowBigInt && typeof id === 'bigint') {
      if (id < 0n || id >= BigInt(GENERATION_SPEC.vocabSize)) fail(code);
      id = Number(id);
    }
    if (typeof id !== 'number' || !Number.isSafeInteger(id)
        || id < 0 || id >= GENERATION_SPEC.vocabSize) fail(code);
    copied.push(id);
  }
  return Object.freeze(copied);
}

function generationSettings(maxNewTokens) {
  return Object.freeze({
    do_sample: false, num_beams: 1, num_return_sequences: 1, max_new_tokens: maxNewTokens,
    eos_token_id: Object.freeze([151645, 151643]), pad_token_id: 151643,
    return_dict_in_generate: false, use_cache: true,
  });
}

function generationOptions(options) {
  try {
    const captured = snapshotRecord(options, OPTION_KEYS, 'INVALID_GENERATION_CONFIG', false);
    const contextWindowTokens = captured.contextWindowTokens === undefined
      ? GENERATION_SPEC.maxDeviceWindowTokens : captured.contextWindowTokens;
    const maxNewTokens = captured.maxNewTokens === undefined
      ? GENERATION_SPEC.defaultMaxNewTokens : captured.maxNewTokens;
    if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens < 1
        || contextWindowTokens > GENERATION_SPEC.maxDeviceWindowTokens
        || !Number.isSafeInteger(maxNewTokens) || maxNewTokens < 1
        || maxNewTokens > GENERATION_SPEC.hardMaxNewTokens) fail('INVALID_GENERATION_CONFIG');
    return { contextWindowTokens, maxNewTokens };
  } catch {
    throw new GenerationContractError('INVALID_GENERATION_CONFIG');
  }
}

// Invalid options are configuration errors. Prompt shape, ID values and the
// combined input/output budget are input-limit errors. No text is tokenized,
// inferred or truncated here; all prompt IDs, including specials, survive.
export function preflightGeneration(promptTokenIds, options = {}) {
  const { contextWindowTokens, maxNewTokens } = generationOptions(options);
  try {
    const prompt = snapshotIds(promptTokenIds, 1, GENERATION_SPEC.maxDeviceWindowTokens,
      'GENERATION_INPUT_LIMIT');
    const inputTokens = prompt.length;
    if (inputTokens + maxNewTokens > contextWindowTokens
        || inputTokens + maxNewTokens > GENERATION_SPEC.modelMaxPositions) fail('GENERATION_INPUT_LIMIT');
    return Object.freeze({
      schemaVersion: 1, status: 'generation-preflight', generationMode: 'not-run',
      generationId: GENERATION_SPEC.version, generation: Object.freeze({ ...GENERATION_SPEC }),
      promptTokenIds: prompt, inputTokens, contextWindowTokens, maxNewTokens,
      settings: generationSettings(maxNewTokens),
    });
  } catch {
    throw new GenerationContractError('GENERATION_INPUT_LIMIT');
  }
}

function acceptPreflight(value) {
  try {
    // Capture each caller property once, then compare only owned snapshots to
    // a newly recreated canonical preflight. Mutable records are permissible.
    const captured = snapshotRecord(value, PREFLIGHT_KEYS, 'INVALID_GENERATION_CONFIG');
    const spec = snapshotRecord(captured.generation, SPEC_KEYS, 'INVALID_GENERATION_CONFIG');
    const settings = snapshotRecord(captured.settings, SETTING_KEYS, 'INVALID_GENERATION_CONFIG');
    const eos = snapshotIds(settings.eos_token_id, 2, 2, 'INVALID_GENERATION_CONFIG');
    const prompt = snapshotIds(captured.promptTokenIds, 1, GENERATION_SPEC.maxDeviceWindowTokens,
      'INVALID_GENERATION_CONFIG');
    const canonical = preflightGeneration(prompt, {
      contextWindowTokens: captured.contextWindowTokens, maxNewTokens: captured.maxNewTokens,
    });
    for (const key of ['schemaVersion', 'status', 'generationMode', 'generationId',
      'inputTokens', 'contextWindowTokens', 'maxNewTokens']) {
      if (captured[key] !== canonical[key]) fail('INVALID_GENERATION_CONFIG');
    }
    for (const key of SPEC_KEYS) {
      if (spec[key] !== canonical.generation[key]) fail('INVALID_GENERATION_CONFIG');
    }
    for (const key of SETTING_KEYS) {
      if (key !== 'eos_token_id' && settings[key] !== canonical.settings[key]) fail('INVALID_GENERATION_CONFIG');
    }
    if (eos[0] !== canonical.settings.eos_token_id[0]
        || eos[1] !== canonical.settings.eos_token_id[1]) fail('INVALID_GENERATION_CONFIG');
    return canonical;
  } catch {
    throw new GenerationContractError('INVALID_GENERATION_CONFIG');
  }
}

// SDK adapters may later unwrap tensors into full-sequence arrays. This pure
// check establishes token shape/prefix/termination only. A 'not-run' receipt
// establishes no model invocation, decoded answer, tokenizer-byte acceptance,
// runtime acceptance or factual release.
export function inspectGeneratedSequence(sequenceIds, acceptedPreflight) {
  const preflight = acceptPreflight(acceptedPreflight);
  try {
    const sequence = snapshotIds(sequenceIds, preflight.inputTokens,
      preflight.inputTokens + preflight.maxNewTokens, 'INVALID_GENERATION_OUTPUT', true);
    for (let index = 0; index < preflight.inputTokens; index++) {
      if (sequence[index] !== preflight.promptTokenIds[index]) fail('INVALID_GENERATION_OUTPUT');
    }
    const generated = [];
    for (let index = preflight.inputTokens; index < sequence.length; index++) {
      const id = sequence[index];
      if ((id === 151645 || id === 151643) && index !== sequence.length - 1) {
        fail('INVALID_GENERATION_OUTPUT');
      }
      generated.push(id);
    }
    const generatedTokens = generated.length, last = generated[generatedTokens - 1];
    const termination = generatedTokens === 0 ? 'empty-output'
      : last === 151645 || last === 151643 ? 'eos'
      : generatedTokens === preflight.maxNewTokens ? 'length' : 'incomplete';
    return Object.freeze({
      schemaVersion: 1, status: 'generated-token-sequence', generationMode: 'not-run',
      sequenceIds: sequence, generatedTokenIds: Object.freeze(generated),
      inputTokens: preflight.inputTokens, generatedTokens,
      maxNewTokens: preflight.maxNewTokens, termination,
    });
  } catch {
    throw new GenerationContractError('INVALID_GENERATION_OUTPUT');
  }
}
