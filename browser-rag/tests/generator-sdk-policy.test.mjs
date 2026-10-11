import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GenerationConfig }
  from '../node_modules/@huggingface/transformers/src/generation/configuration_utils.js';
import { PreTrainedModel } from '../node_modules/@huggingface/transformers/src/models.js';
import { preflightGeneration } from '../generator-contract.mjs';

// These expectations are independently specified, rather than copied from
// the production policy or generated from the SDK's default configuration.
const expectedPolicy = (maxLength, maxNewTokens) => ({
  max_length: maxLength, max_new_tokens: maxNewTokens, min_length: 0, min_new_tokens: null,
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
const QWEN_DEFAULTS = {
  bos_token_id: 151643, do_sample: true, eos_token_id: [151645, 151643],
  pad_token_id: 151643, repetition_penalty: 1.1, temperature: 0.7,
  top_k: 20, top_p: 0.8, transformers_version: '4.43.4',
};
const fixture = () => ({ config: {}, generation_config: structuredClone(QWEN_DEFAULTS) });
const prepare = (model, config, kwargs) =>
  PreTrainedModel.prototype._prepare_generation_config.call(model, config, kwargs);
const knownKeys = Object.keys(expectedPolicy(5, 3));

test('the pinned installed SDK knows exactly the 46 explicit generation fields', () => {
  const installed = JSON.parse(readFileSync(
    new URL('../node_modules/@huggingface/transformers/package.json', import.meta.url), 'utf8'));
  assert.equal(installed.version, '3.8.1');
  assert.equal(knownKeys.length, 46);
  assert.deepEqual(Object.getOwnPropertyNames(new GenerationConfig({})).sort(), [...knownKeys].sort());
});

test('legacy eight caller settings leave the downloaded repetition penalty active', () => {
  const model = fixture(), before = structuredClone(model);
  const legacy = {
    do_sample: false, num_beams: 1, num_return_sequences: 1, max_new_tokens: 3,
    eos_token_id: [151645, 151643], pad_token_id: 151643,
    return_dict_in_generate: false, use_cache: true,
  };
  const merged = prepare(model, null, legacy);
  assert.equal(merged.do_sample, false);
  assert.equal(merged.repetition_penalty, 1.1);
  assert.equal(merged.temperature, 0.7);
  assert.equal(merged.top_k, 20);
  assert.equal(merged.top_p, 0.8);
  assert.deepEqual(model, before);
});

for (const route of ['generation_config', 'kwargs']) {
  test(`the full policy overrides all SDK fields through ${route} without model loading`, () => {
    const model = fixture(), before = structuredClone(model);
    const preflight = preflightGeneration([5, 6], { maxNewTokens: 3 });
    const merged = route === 'generation_config'
      ? prepare(model, preflight.settings, null) : prepare(model, null, preflight.settings);
    assert.equal(merged instanceof GenerationConfig, true);
    assert.deepEqual(Object.fromEntries(knownKeys.map(key => [key, merged[key]])), expectedPolicy(5, 3));
    assert.deepEqual(Object.getOwnPropertyNames(merged).filter(key => !knownKeys.includes(key)),
      ['transformers_version']);
    assert.equal(merged.transformers_version, '4.43.4');
    assert.equal(Object.hasOwn(preflight.settings, 'transformers_version'), false);
    assert.equal(preflight.generationMode, 'not-run');
    assert.deepEqual(model, before);
    assert.equal(Object.isFrozen(merged), false);
    merged.max_length = 6;
    assert.equal(merged.max_length, 6);
    assert.equal(preflight.settings.max_length, 5);
  });
}

for (const [inputTokens, maxNewTokens, maxLength] of [[1, 1, 2], [1920, 128, 2048],
  [2047, 1, 2048], [1536, 512, 2048]]) {
  test(`SDK merge preserves the ${inputTokens}/${maxNewTokens} bounded output policy`, () => {
    const preflight = preflightGeneration(Array(inputTokens).fill(5), { maxNewTokens });
    const merged = prepare(fixture(), null, preflight.settings);
    assert.deepEqual(Object.fromEntries(knownKeys.map(key => [key, merged[key]])),
      expectedPolicy(maxLength, maxNewTokens));
    assert.equal(merged.max_length, maxLength);
    assert.equal(merged.max_new_tokens, maxNewTokens);
  });
}
