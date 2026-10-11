import { assembleProvenanceContext } from './context-contract.mjs';
import { copyValidatedSource } from './compute-source.mjs';
import { prepareGenerationPrompt, PromptError } from './prompt-contract.mjs';
import { preflightGeneration } from './generator-contract.mjs';
import { runNativeGenerator } from './generator-native-core.mjs';

export const FINANCIAL_MAX_DECODED_UTF16 = 16384;
const INPUT_KEYS = ['source','chunkArtifact','embeddingArtifact','question','queryResult','topK','queryDownloadTotal','queryMetadata'];
const record = value => value !== null && typeof value === 'object'
  && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function freeze(value, seen = new WeakSet()) {
  if(value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);for(const child of Object.values(value)) freeze(child,seen);Object.freeze(value);
  }
  return value;
}
function ownInput(input) {
  try {
    if(!record(input)||Reflect.ownKeys(input).length!==INPUT_KEYS.length
      ||Reflect.ownKeys(input).some(key=>!INPUT_KEYS.includes(key)))throw Error();
    const captured={};for(const key of INPUT_KEYS)captured[key]=input[key];
    // The existing bounded source copier owns exactly the extractor values
    // consumed by provenance. Ignored geometry/extractor extras stay unread.
    captured.source=copyValidatedSource(captured.source);
    // Validate the original provenance and its existing source/vector/text
    // budgets synchronously before copying or beginning native work. Retain
    // the original eight-field input with its canonical source, not the
    // assembled context projection. Exact validated artifact shapes bound all
    // other copied fields; ignored source fields never enter structuredClone.
    assembleProvenanceContext(captured);
    const snapshot=structuredClone(captured);
    assembleProvenanceContext(snapshot);
    return freeze(snapshot);
  } catch {throw new PromptError('INVALID_PROMPT_INPUT');}
}

/** Complete financial prompt over the shared pinned, owned native loader.
 * The runtime receipt proves invocation only: output inspection, accepted
 * drafts and financial correctness require separate downstream evidence.
 * Precondition: call only once in a fresh owned native Worker/SDK realm.
 * Concurrent calls or sequential retries must not share the imported SDK
 * singleton. Importer/test injection does not make this a reusable shared
 * main-thread engine. */
export async function runFinancialGenerator(contextInput,generationOptions={},runtimeOptions={}) {
  const snapshot=ownInput(contextInput);
  const captured=preflightGeneration([0],generationOptions);
  const options=Object.freeze({contextWindowTokens:captured.contextWindowTokens,maxNewTokens:captured.maxNewTokens});
  let preparedPrompt,preparationError;
  let native;
  try {
    native=await runNativeGenerator(tokenizer=>{
      try {
        preparedPrompt=prepareGenerationPrompt(snapshot,tokenizer,options);
        return {tokenIds:preparedPrompt.tokenIds,attentionMask:preparedPrompt.attentionMask,preflight:preparedPrompt.preflight};
      } catch(error) {preparationError=error;throw error;}
    },runtimeOptions,FINANCIAL_MAX_DECODED_UTF16);
  } catch(error) {throw preparationError??error;}
  return Object.freeze({...native,preparedPrompt,outputInspection:'not-run',financialCorrectness:'unestablished'});
}
