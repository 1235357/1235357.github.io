import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  GENERATION_SPEC, GenerationContractError, preflightGeneration, inspectGeneratedSequence,
} from '../generator-contract.mjs';

const SPEC = {
  modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  revision: '22942cb7d7ba4cc81bb4673549ca4d4614469b5e',
  tokenizerModelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  tokenizerRevision: '22942cb7d7ba4cc81bb4673549ca4d4614469b5e',
  libraryVersion: '3.8.1', ortVersion: '1.22.0-dev.20250409-89f8206ba4',
  dtype: 'q4', device: 'webgpu', modelMaxPositions: 32768, vocabSize: 151936,
  maxDeviceWindowTokens: 2048, defaultMaxNewTokens: 128, hardMaxNewTokens: 512,
  version: 'qwen2.5-0.5b-q4-webgpu-v2',
};
const MESSAGES = {
  INVALID_GENERATION_CONFIG: 'The generation configuration is invalid.',
  GENERATION_INPUT_LIMIT: 'The generation input is invalid or exceeds its token budget.',
  INVALID_GENERATION_OUTPUT: 'The generated token sequence is invalid.',
};
const fixedError = code => error => error instanceof GenerationContractError
  && error.name === 'GenerationContractError' && error.code === code
  && error.message === MESSAGES[code] && !Object.hasOwn(error, 'cause');
const accepted = (ids = [5, 6], options = { maxNewTokens: 3 }) => preflightGeneration(ids, options);
const mutable = (ids, options) => structuredClone(accepted(ids, options));
// Independently specify the entire effective policy, including fields that
// would otherwise survive the SDK's downloaded-model configuration merge.
const settings = (input, max) => ({
  max_length: input + max, max_new_tokens: max, min_length: 0, min_new_tokens: null,
  early_stopping: false, max_time: null, do_sample: false, num_beams: 1,
  num_beam_groups: 1, penalty_alpha: null, use_cache: true, temperature: 1,
  top_k: 0, top_p: 1, typical_p: 1, epsilon_cutoff: 0, eta_cutoff: 0,
  diversity_penalty: 0, repetition_penalty: 1, encoder_repetition_penalty: 1,
  length_penalty: 1, no_repeat_ngram_size: 0, bad_words_ids: null,
  force_words_ids: null, renormalize_logits: false, constraints: null,
  forced_bos_token_id: null, forced_eos_token_id: null, remove_invalid_values: false,
  exponential_decay_length_penalty: null, suppress_tokens: null, streamer: null,
  begin_suppress_tokens: null, forced_decoder_ids: null, guidance_scale: null,
  num_return_sequences: 1, output_attentions: false, output_hidden_states: false,
  output_scores: false, return_dict_in_generate: false, pad_token_id: 151643,
  bos_token_id: 151643, eos_token_id: [151645, 151643],
  encoder_no_repeat_ngram_size: 0, decoder_start_token_id: null, generation_kwargs: {},
});
function recursivelyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) recursivelyFrozen(value[key]);
}

test('the immutable generation identity pins the whole revision and conservative budgets', () => {
  assert.deepEqual(GENERATION_SPEC, SPEC);
  recursivelyFrozen(GENERATION_SPEC);
  assert.throws(() => { GENERATION_SPEC.maxDeviceWindowTokens = 32768; }, TypeError);
});

test('contract errors expose only canonical codes and generic messages', () => {
  for (const code of Object.keys(MESSAGES)) {
    const error = new GenerationContractError(code);
    assert.equal(fixedError(code)(error), true);
    assert.equal(error instanceof Error, true);
  }
  for (const code of ['PRIVATE_QUESTION', '__proto__', 'constructor', null, undefined,
    true, 1, {}, Object.create(null), { toString() { throw new Error('PRIVATE'); } }]) {
    assert.equal(fixedError('INVALID_GENERATION_CONFIG')(new GenerationContractError(code)), true);
  }
});

test('preflight preserves every token and returns an explicit not-run receipt', () => {
  const ids = [0, 151935, 151645, 151643];
  const result = preflightGeneration(ids);
  assert.deepEqual(result, {
    schemaVersion: 1, status: 'generation-preflight', generationMode: 'not-run',
    generationId: SPEC.version, generation: SPEC, promptTokenIds: ids,
    inputTokens: 4, contextWindowTokens: 2048, maxNewTokens: 128, settings: settings(4, 128),
  });
  assert.notEqual(result.promptTokenIds, ids);
  assert.notEqual(result.generation, GENERATION_SPEC);
  assert.equal(Object.isFrozen(ids), false);
  recursivelyFrozen(result);
});

test('preflight detaches its arrays, identity and settings without freezing caller records', () => {
  const ids = [5, 6], options = { contextWindowTokens: 7, maxNewTokens: 5 };
  const first = preflightGeneration(ids, options), second = preflightGeneration(ids, options);
  ids[0] = 9; options.maxNewTokens = 1;
  assert.deepEqual(first.promptTokenIds, [5, 6]);
  assert.equal(first.maxNewTokens, 5);
  assert.equal(Object.isFrozen(ids), false);
  assert.equal(Object.isFrozen(options), false);
  assert.notEqual(first.promptTokenIds, second.promptTokenIds);
  assert.notEqual(first.generation, second.generation);
  assert.notEqual(first.settings, second.settings);
  assert.notEqual(first.settings.eos_token_id, second.settings.eos_token_id);
  assert.notEqual(first.settings.generation_kwargs, second.settings.generation_kwargs);
  assert.equal(Reflect.ownKeys(first.settings).length, 46);
  recursivelyFrozen(first.settings);
  assert.throws(() => { first.settings.eos_token_id[0] = 0; }, TypeError);
  assert.throws(() => { first.settings.generation_kwargs.private = 'PRIVATE'; }, TypeError);
});

test('minimum valid token budget is accepted exactly', () => {
  const result = preflightGeneration([0], { contextWindowTokens: 2, maxNewTokens: 1 });
  assert.equal(result.inputTokens, 1);
  assert.equal(result.contextWindowTokens, 2);
  assert.equal(result.maxNewTokens, 1);
  assert.deepEqual(result.settings, settings(1, 1));
});

for (const [inputTokens, maxNewTokens] of [[1920, 128], [2047, 1], [1536, 512]]) {
  test(`the exact device budget accepts ${inputTokens} input and ${maxNewTokens} output tokens`, () => {
    const ids = Array(inputTokens).fill(151935);
    const result = preflightGeneration(ids, { maxNewTokens });
    assert.deepEqual(result.promptTokenIds, ids);
    assert.equal(result.inputTokens + result.maxNewTokens, 2048);
    assert.deepEqual(result.settings, settings(inputTokens, maxNewTokens));
  });
  test(`one token above the device budget refuses ${inputTokens + 1} input tokens`, () => {
    assert.throws(() => preflightGeneration(Array(inputTokens + 1).fill(5), { maxNewTokens }),
      fixedError('GENERATION_INPUT_LIMIT'));
  });
}

test('the declared smaller context budget is enforced without truncating input', () => {
  const ids = [5, 6, 7];
  assert.throws(() => preflightGeneration(ids, { contextWindowTokens: 4, maxNewTokens: 2 }),
    fixedError('GENERATION_INPUT_LIMIT'));
  assert.deepEqual(ids, [5, 6, 7]);
  assert.throws(() => preflightGeneration([5], { contextWindowTokens: 1, maxNewTokens: 1 }),
    fixedError('GENERATION_INPUT_LIMIT'));
});

test('only undefined option values select defaults', () => {
  for (const options of [{}, undefined, { contextWindowTokens: undefined },
    { maxNewTokens: undefined }, { contextWindowTokens: undefined, maxNewTokens: undefined },
    Object.create(null)]) {
    const result = preflightGeneration([5], options);
    assert.equal(result.contextWindowTokens, 2048);
    assert.equal(result.maxNewTokens, 128);
  }
});

for (const key of ['contextWindowTokens', 'maxNewTokens']) {
  test(`${key} rejects null, boxed, noninteger and nonnumeric values`, () => {
    for (const value of [null, true, false, 0, -1, 0.5, NaN, Infinity, -Infinity,
      Number.MAX_SAFE_INTEGER + 1, '128', 128n, {}, new Number(128)]) {
      assert.throws(() => preflightGeneration([5], { [key]: value }),
        fixedError('INVALID_GENERATION_CONFIG'));
    }
  });
}

test('options refuse one-over upper bounds and the model context size', () => {
  for (const options of [{ contextWindowTokens: 2049 }, { contextWindowTokens: 32768 },
    { maxNewTokens: 513 }]) {
    assert.throws(() => preflightGeneration([5], options), fixedError('INVALID_GENERATION_CONFIG'));
  }
});

test('options require local plain records with only the two supported own keys', () => {
  class Other { maxNewTokens = 1; }
  for (const options of [null, true, 3, 'options', [], new Uint8Array(2), new Number(1),
    new Other(), { unknown: 1 }, { [Symbol('private')]: 1 }, { constructor: 1 }]) {
    assert.throws(() => preflightGeneration([5], options), fixedError('INVALID_GENERATION_CONFIG'));
  }
  const nullRecord = Object.create(null); nullRecord.maxNewTokens = 1;
  assert.equal(preflightGeneration([5], nullRecord).maxNewTokens, 1);
});

test('option getters are captured once and throwing getters remain private', () => {
  const reads = { contextWindowTokens: 0, maxNewTokens: 0 };
  const options = {
    get contextWindowTokens() { return ++reads.contextWindowTokens === 1 ? 5 : 1; },
    get maxNewTokens() { return ++reads.maxNewTokens === 1 ? 3 : 512; },
  };
  const result = preflightGeneration([5, 6], options);
  assert.deepEqual(reads, { contextWindowTokens: 1, maxNewTokens: 1 });
  assert.equal(result.maxNewTokens, 3);
  for (const key of Object.keys(reads)) {
    assert.throws(() => preflightGeneration([5], { get [key]() { throw new Error('PRIVATE_QUESTION'); } }),
      fixedError('INVALID_GENERATION_CONFIG'));
  }
});

test('unknown options are refused without reading their private getter values', () => {
  let reads = 0;
  assert.throws(() => preflightGeneration([5], { get private() { reads++; throw new Error('PRIVATE'); } }),
    fixedError('INVALID_GENERATION_CONFIG'));
  assert.equal(reads, 0);
});

test('prompt IDs require dense arrays rather than typed, boxed or array-like containers', () => {
  for (const ids of [null, undefined, true, 5, '5', {}, Object.create(null),
    { 0: 5, length: 1 }, new Number(5), new Uint32Array([5]), new BigInt64Array([5n]),
    [], Array(2049).fill(5)]) {
    assert.throws(() => preflightGeneration(ids), fixedError('GENERATION_INPUT_LIMIT'));
  }
});

test('prompt arrays reject sparse, inherited-slot, extra-key and symbol-key shapes', () => {
  const inherited = [5, , 7]; Object.setPrototypeOf(inherited, { 1: 6 });
  const extra = [5]; extra.private = 'PRIVATE';
  const symbol = [5]; symbol[Symbol('private')] = 1;
  const nonenumerable = [5]; Object.defineProperty(nonenumerable, 'private', { value: 1 });
  for (const ids of [[5, , 7], inherited, extra, symbol, nonenumerable]) {
    assert.throws(() => preflightGeneration(ids), fixedError('GENERATION_INPUT_LIMIT'));
  }
});

test('prompt IDs accept only primitive in-vocabulary nonnegative integers', () => {
  for (const value of [-1, 151936, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER,
    '5', 5n, null, undefined, true, {}, new Number(5)]) {
    assert.throws(() => preflightGeneration([value]), fixedError('GENERATION_INPUT_LIMIT'));
  }
});

test('oversized prompt length is refused before keys and values are inspected', () => {
  let keys = 0, values = 0, lengths = 0;
  const ids = new Proxy(Array(2049), {
    ownKeys() { keys++; throw new Error('PRIVATE'); },
    get(target, key) {
      if (key === 'length') { lengths++; return target.length; }
      values++; throw new Error('PRIVATE');
    },
  });
  assert.throws(() => preflightGeneration(ids), fixedError('GENERATION_INPUT_LIMIT'));
  assert.equal(lengths, 1); assert.equal(keys, 0); assert.equal(values, 0);
});

test('prompt getters are captured once and neither inherited map nor slice is called', () => {
  let reads = 0, methods = 0;
  const ids = [5, 6];
  Object.defineProperty(ids, 0, { get() { reads++; return reads === 1 ? 5 : 7; } });
  Object.setPrototypeOf(ids, {
    map() { methods++; return [151936]; },
    slice() { methods++; return []; },
  });
  const result = preflightGeneration(ids);
  assert.deepEqual(result.promptTokenIds, [5, 6]);
  assert.equal(reads, 1); assert.equal(methods, 0);
  assert.equal(Object.isFrozen(ids), false);
});

test('throwing prompt property access yields only the fixed input error', () => {
  const ids = [5]; Object.defineProperty(ids, 0, { get() { throw new Error('PRIVATE_QUESTION'); } });
  assert.throws(() => preflightGeneration(ids), fixedError('GENERATION_INPUT_LIMIT'));
  const unreadableKeys = new Proxy([5], { ownKeys() { throw new Error('PRIVATE'); } });
  assert.throws(() => preflightGeneration(unreadableKeys), fixedError('GENERATION_INPUT_LIMIT'));
});

test('sequence inspection copies the SDK full sequence and generated suffix', () => {
  const preflight = accepted(), ids = [5, 6, 0, 151935, 151645];
  const result = inspectGeneratedSequence(ids, preflight);
  assert.deepEqual(result, {
    schemaVersion: 1, status: 'generated-token-sequence', generationMode: 'not-run',
    sequenceIds: [5, 6, 0, 151935, 151645], generatedTokenIds: [0, 151935, 151645],
    inputTokens: 2, generatedTokens: 3, maxNewTokens: 3, termination: 'eos',
  });
  recursivelyFrozen(result);
  assert.notEqual(result.sequenceIds, ids);
  assert.notEqual(result.generatedTokenIds, result.sequenceIds);
  assert.equal(Object.isFrozen(ids), false);
  ids[0] = 9;
  assert.equal(result.sequenceIds[0], 5);
});

test('BigInt SDK IDs normalize safely to detached primitive number arrays', () => {
  const ids = [5n, 6n, 151935n, 151643n];
  const result = inspectGeneratedSequence(ids, accepted());
  assert.deepEqual(result.sequenceIds, [5, 6, 151935, 151643]);
  assert.deepEqual(result.generatedTokenIds, [151935, 151643]);
  assert.equal(result.termination, 'eos');
  assert.deepEqual(ids, [5n, 6n, 151935n, 151643n]);
  assert.deepEqual(inspectGeneratedSequence([5, 6n, 7], accepted()).generatedTokenIds, [7]);
});

for (const eos of [151645, 151643]) {
  test(`the terminal EOS ${eos} is accepted even below the output cap`, () => {
    const result = inspectGeneratedSequence([5, 6, eos], accepted());
    assert.equal(result.termination, 'eos');
    assert.equal(result.generatedTokens, 1);
    assert.deepEqual(result.generatedTokenIds, [eos]);
  });
}

test('non-EOS output at the cap reports length while shorter output reports incomplete', () => {
  const preflight = accepted();
  assert.equal(inspectGeneratedSequence([5, 6, 7, 8, 9], preflight).termination, 'length');
  assert.equal(inspectGeneratedSequence([5, 6, 7], preflight).termination, 'incomplete');
  assert.equal(inspectGeneratedSequence([5, 6], preflight).termination, 'empty-output');
  assert.deepEqual(inspectGeneratedSequence([5, 6], preflight).generatedTokenIds, []);
});

test('maximum full sequence length preserves its entire prompt prefix', () => {
  const prompt = Array(2047).fill(5), preflight = accepted(prompt, { maxNewTokens: 1 });
  const result = inspectGeneratedSequence([...prompt, 151935], preflight);
  assert.equal(result.sequenceIds.length, 2048);
  assert.equal(result.inputTokens, 2047);
  assert.equal(result.generatedTokens, 1);
  assert.equal(result.termination, 'length');
});

test('EOS tokens in the prompt have no output termination meaning', () => {
  const result = inspectGeneratedSequence([151645, 151643, 7], accepted([151645, 151643]));
  assert.equal(result.termination, 'incomplete');
  assert.deepEqual(result.generatedTokenIds, [7]);
});

for (const suffix of [[151645, 7], [151643, 7], [151645, 151645], [151643, 151643],
  [151645, 151643], [151643, 151645], [7, 151645, 8]]) {
  test(`interior or repeated EOS rejects the generated suffix ${suffix.join('-')}`, () => {
    assert.throws(() => inspectGeneratedSequence([5, 6, ...suffix], accepted()),
      fixedError('INVALID_GENERATION_OUTPUT'));
  });
}

test('generated sequences must contain the exact full prompt prefix', () => {
  for (const ids of [[], [5], [6, 5], [5, 7, 8], [0, 5, 6], [5, 6, 7, 8, 9, 10]]) {
    assert.throws(() => inspectGeneratedSequence(ids, accepted()), fixedError('INVALID_GENERATION_OUTPUT'));
  }
});

test('generated IDs reject invalid numbers and BigInts without precision loss', () => {
  for (const value of [-1, 151936, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER,
    -1n, 151936n, 9007199254740993n, '7', null, undefined, true, new Number(7), {}]) {
    assert.throws(() => inspectGeneratedSequence([5, 6, value], accepted()),
      fixedError('INVALID_GENERATION_OUTPUT'));
  }
});

test('the pure sequence boundary requires dense arrays rather than tensors or typed arrays', () => {
  const extra = [5, 6]; extra.private = 1;
  const symbol = [5, 6]; symbol[Symbol('private')] = 1;
  const inherited = [5, , 7]; Object.setPrototypeOf(inherited, { 1: 6 });
  for (const ids of [null, true, '5 6', { tolist() { return [5, 6]; } },
    { 0: 5, 1: 6, length: 2 }, new Uint32Array([5, 6]), new BigInt64Array([5n, 6n]),
    [5, , 7], inherited, extra, symbol]) {
    assert.throws(() => inspectGeneratedSequence(ids, accepted()), fixedError('INVALID_GENERATION_OUTPUT'));
  }
});

test('oversized generated length is refused before keys or values are read', () => {
  let keys = 0, values = 0, lengths = 0;
  const ids = new Proxy(Array(6), {
    ownKeys() { keys++; throw new Error('PRIVATE'); },
    get(target, key) {
      if (key === 'length') { lengths++; return target.length; }
      values++; throw new Error('PRIVATE');
    },
  });
  assert.throws(() => inspectGeneratedSequence(ids, accepted()), fixedError('INVALID_GENERATION_OUTPUT'));
  assert.equal(lengths, 1); assert.equal(keys, 0); assert.equal(values, 0);
});

test('generated values are captured once without using caller array methods', () => {
  let reads = 0, methods = 0;
  const ids = [5, 6, 7];
  Object.defineProperty(ids, 0, { get() { reads++; return reads === 1 ? 5n : 9n; } });
  Object.setPrototypeOf(ids, { map() { methods++; return []; }, slice() { methods++; return []; } });
  const result = inspectGeneratedSequence(ids, accepted());
  assert.deepEqual(result.sequenceIds, [5, 6, 7]);
  assert.deepEqual(result.generatedTokenIds, [7]);
  assert.equal(reads, 1); assert.equal(methods, 0);
});

test('throwing generated getters and reflection produce generic output errors', () => {
  const ids = [5, 6]; Object.defineProperty(ids, 1, { get() { throw new Error('PRIVATE_QUESTION'); } });
  const keys = new Proxy([5, 6], { ownKeys() { throw new Error('PRIVATE_FILENAME'); } });
  for (const input of [ids, keys]) {
    assert.throws(() => inspectGeneratedSequence(input, accepted()), fixedError('INVALID_GENERATION_OUTPUT'));
  }
});

for (const key of Object.keys(SPEC)) {
  test(`accepted preflight identity refuses an altered ${key}`, () => {
    const preflight = mutable(); preflight.generation[key] = typeof SPEC[key] === 'number' ? 1 : 'OTHER';
    assert.throws(() => inspectGeneratedSequence([5, 6, 7], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
  });
}

for (const key of Object.keys(settings(2, 3))) {
  test(`accepted preflight refuses altered generation setting ${key}`, () => {
    const preflight = mutable();
    preflight.settings[key] = Array.isArray(preflight.settings[key]) ? [151643, 151645]
      : typeof preflight.settings[key] === 'boolean' ? !preflight.settings[key] : 2;
    assert.throws(() => inspectGeneratedSequence([5, 6, 7], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
  });
  test(`accepted preflight refuses missing generation setting ${key}`, () => {
    const preflight = mutable(); delete preflight.settings[key];
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
  });
  test(`throwing generation setting ${key} receives only the private configuration error`, () => {
    const preflight = mutable();
    Object.defineProperty(preflight.settings, key, { get() { throw new Error('PRIVATE_QUESTION'); } });
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
  });
  test(`changing generation setting ${key} is captured exactly once`, () => {
    const preflight = mutable(), expected = preflight.settings[key];
    let reads = 0;
    Object.defineProperty(preflight.settings, key, { get() {
      return ++reads === 1 ? expected : 'PRIVATE_CHANGED_VALUE';
    } });
    assert.equal(inspectGeneratedSequence([5, 6], preflight).termination, 'empty-output');
    assert.equal(reads, 1);
  });
}

test('extra generation setting getters are refused without reading private values', () => {
  for (const key of ['private', Symbol('private')]) {
    const preflight = mutable(); let reads = 0;
    Object.defineProperty(preflight.settings, key, { get() { reads++; throw new Error('PRIVATE'); } });
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
    assert.equal(reads, 0);
  }
});

test('generation kwargs must be an empty local plain record', () => {
  class Other {}
  for (const value of [null, undefined, true, 1, 'kwargs', [], new Map(), new Other(),
    Object.create({}), runInNewContext('({})'), { private: 1 },
    { [Symbol('private')]: 1 }]) {
    const preflight = mutable(); preflight.settings.generation_kwargs = value;
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
  }
});

test('nonempty generation kwargs reject private getter values without reading them', () => {
  for (const key of ['private', Symbol('private')]) {
    const preflight = mutable(), kwargs = {}; let reads = 0;
    Object.defineProperty(kwargs, key, { get() { reads++; throw new Error('PRIVATE'); } });
    preflight.settings.generation_kwargs = kwargs;
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
    assert.equal(reads, 0);
    assert.equal(Object.isFrozen(kwargs), false);
  }
});

test('malformed generation kwargs containers are refused before reading private getters', () => {
  class Other {}
  for (const kwargs of [[], new Other(), Object.create({})]) {
    const preflight = mutable(); let reads = 0;
    Object.defineProperty(kwargs, 'private', { get() { reads++; throw new Error('PRIVATE'); } });
    preflight.settings.generation_kwargs = kwargs;
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
    assert.equal(reads, 0);
  }
});

test('generation kwargs reflection errors stay canonical without reading values', () => {
  for (const trap of ['getPrototypeOf', 'ownKeys']) {
    const preflight = mutable(); let reads = 0;
    preflight.settings.generation_kwargs = new Proxy({}, {
      [trap]() { throw new Error('PRIVATE_REFLECTION'); },
      get() { reads++; throw new Error('PRIVATE_VALUE'); },
    });
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
    assert.equal(reads, 0);
  }
});

test('empty null-prototype generation kwargs are accepted without identity comparison or mutation', () => {
  const preflight = mutable(), kwargs = Object.create(null);
  preflight.settings.generation_kwargs = kwargs;
  assert.equal(inspectGeneratedSequence([5, 6], preflight).termination, 'empty-output');
  assert.equal(preflight.settings.generation_kwargs, kwargs);
  assert.deepEqual(Reflect.ownKeys(kwargs), []);
  assert.equal(Object.getPrototypeOf(kwargs), null);
  assert.equal(Object.isFrozen(kwargs), false);
});

test('EOS policy is bounded to two numeric snapshot values', () => {
  const extra = [151645, 151643]; extra.private = 1;
  const symbol = [151645, 151643]; symbol[Symbol('private')] = 1;
  for (const eos of [[151645, 151643, 0], [151645, 151643n], [151645, '151643'],
    [151645, ,], extra, symbol]) {
    const preflight = mutable(); preflight.settings.eos_token_id = eos;
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
  }
  const preflight = mutable(); let values = 0, keys = 0;
  preflight.settings.eos_token_id = new Proxy(Array(3), {
    ownKeys() { keys++; throw new Error('PRIVATE_KEYS'); },
    get(target, key) {
      if (key === 'length') return target.length;
      values++; throw new Error('PRIVATE_VALUE');
    },
  });
  assert.throws(() => inspectGeneratedSequence([5, 6], preflight),
    fixedError('INVALID_GENERATION_CONFIG'));
  assert.equal(keys, 0); assert.equal(values, 0);
});

test('changing EOS policy token getters are captured once', () => {
  const preflight = mutable(), reads = [0, 0], ids = [151645, 151643];
  for (let index = 0; index < 2; index++) {
    Object.defineProperty(preflight.settings.eos_token_id, index, { get() {
      return ++reads[index] === 1 ? ids[index] : 0;
    } });
  }
  assert.equal(inspectGeneratedSequence([5, 6], preflight).termination, 'empty-output');
  assert.deepEqual(reads, [1, 1]);
});

for (const [key, value] of [['schemaVersion', 2], ['status', 'generated'],
  ['generationMode', 'run'], ['generationId', 'other'], ['inputTokens', 1],
  ['contextWindowTokens', 1], ['maxNewTokens', 513], ['maxNewTokens', 2],
  ['promptTokenIds', [5, 151936]], ['promptTokenIds', [5n, 6n]]]) {
  test(`accepted preflight refuses inconsistent metadata ${key}=${String(value)}`, () => {
    const preflight = mutable(); preflight[key] = value;
    assert.throws(() => inspectGeneratedSequence([5, 6, 7], preflight),
      fixedError('INVALID_GENERATION_CONFIG'));
  });
}

test('accepted preflight does not rely on caller status or claimed input counts alone', () => {
  const preflight = mutable(); preflight.inputTokens = 3;
  assert.throws(() => inspectGeneratedSequence([5, 6, 7], preflight), fixedError('INVALID_GENERATION_CONFIG'));
  const overBudget = mutable();
  overBudget.promptTokenIds = Array(2047).fill(5); overBudget.inputTokens = 2047;
  assert.throws(() => inspectGeneratedSequence(Array(2047).fill(5), overBudget),
    fixedError('INVALID_GENERATION_CONFIG'));
});

test('accepted preflight requires exact own fields at every metadata level', () => {
  for (const level of ['', 'generation', 'settings']) {
    for (const change of ['extra', 'symbol', 'missing']) {
      const preflight = mutable(), target = level ? preflight[level] : preflight;
      if (change === 'extra') target.private = 'PRIVATE';
      if (change === 'symbol') target[Symbol('private')] = 1;
      if (change === 'missing') delete target[Object.keys(target)[0]];
      assert.throws(() => inspectGeneratedSequence([5, 6], preflight), fixedError('INVALID_GENERATION_CONFIG'));
    }
  }
  for (const preflight of [null, undefined, true, [], {}, new Number(1)]) {
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight), fixedError('INVALID_GENERATION_CONFIG'));
  }
});

test('malformed preflight nested records and EOS lists receive canonical private errors', () => {
  for (const level of ['generation', 'settings']) {
    const preflight = mutable(); preflight[level] = new Map();
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight), fixedError('INVALID_GENERATION_CONFIG'));
  }
  for (const eos of [[151645], [151645, , 151643], [151645n, 151643n], new Uint32Array([151645, 151643])]) {
    const preflight = mutable(); preflight.settings.eos_token_id = eos;
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight), fixedError('INVALID_GENERATION_CONFIG'));
  }
});

test('preflight revalidation captures all top, identity, setting and token getters once', () => {
  const original = mutable(), reads = new Map();
  function getters(value, label) {
    const result = {};
    for (const key of Object.keys(value)) {
      const captured = value[key];
      Object.defineProperty(result, key, { enumerable: true, get() {
        const path = `${label}.${key}`, count = (reads.get(path) || 0) + 1;
        reads.set(path, count);
        if (count > 1) throw new Error('PRIVATE_SECOND_READ');
        return captured;
      } });
    }
    return result;
  }
  original.generation = getters(original.generation, 'generation');
  original.settings = getters(original.settings, 'settings');
  let tokenReads = 0;
  Object.defineProperty(original.promptTokenIds, 0, { get() { tokenReads++; return tokenReads === 1 ? 5 : 9; } });
  const preflight = getters(original, 'preflight');
  const result = inspectGeneratedSequence([5, 6, 7], preflight);
  assert.equal(result.termination, 'incomplete');
  assert.equal([...reads.values()].every(count => count === 1), true);
  assert.equal(tokenReads, 1);
  assert.equal(Object.isFrozen(original), false);
});

test('throwing preflight getters at each level never expose caller diagnostics', () => {
  for (const [level, key] of [['', 'generation'], ['', 'inputTokens'],
    ['generation', 'revision'], ['settings', 'use_cache'], ['settings', 'eos_token_id'],
    ['promptTokenIds', '0']]) {
    const preflight = mutable(), target = level ? preflight[level] : preflight;
    Object.defineProperty(target, key, { enumerable: true, get() { throw new Error('PRIVATE_QUESTION'); } });
    assert.throws(() => inspectGeneratedSequence([5, 6], preflight), fixedError('INVALID_GENERATION_CONFIG'));
  }
  const preflight = mutable();
  preflight.generation = new Proxy(preflight.generation, { ownKeys() { throw new Error('PRIVATE'); } });
  assert.throws(() => inspectGeneratedSequence([5, 6], preflight), fixedError('INVALID_GENERATION_CONFIG'));
});

test('oversized preflight prompt metadata is refused before enumerating its values', () => {
  let keys = 0;
  const preflight = mutable(); preflight.promptTokenIds = new Proxy(Array(2049), {
    ownKeys() { keys++; throw new Error('PRIVATE'); },
  });
  assert.throws(() => inspectGeneratedSequence([5, 6], preflight), fixedError('INVALID_GENERATION_CONFIG'));
  assert.equal(keys, 0);
});

test('ordinary mutable and null-prototype preflight records are validated without mutation', () => {
  const preflight = mutable(), before = structuredClone(preflight);
  const nullRecord = Object.assign(Object.create(null), preflight);
  nullRecord.generation = Object.assign(Object.create(null), preflight.generation);
  nullRecord.settings = Object.assign(Object.create(null), preflight.settings);
  assert.equal(inspectGeneratedSequence([5, 6], nullRecord).termination, 'empty-output');
  assert.deepEqual(preflight, before);
  assert.equal(Object.isFrozen(preflight), false);
  assert.equal(Object.isFrozen(preflight.promptTokenIds), false);
  assert.equal(Object.isFrozen(preflight.settings), false);
});
