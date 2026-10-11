import { assembleProvenanceContext } from './context-contract.mjs';
import { copyValidatedSource } from './compute-source.mjs';
import { PromptError } from './prompt-contract.mjs';
import { preflightGeneration } from './generator-contract.mjs';

const INPUT_KEYS=['source','chunkArtifact','embeddingArtifact','question','queryResult','topK','queryDownloadTotal','queryMetadata'];
function freeze(value,seen=new WeakSet()) {
  if(value!==null&&typeof value==='object'&&!seen.has(value)) {
    seen.add(value);for(const child of Object.values(value))freeze(child,seen);Object.freeze(value);
  }
  return value;
}
// Shared complete-input ownership for the runtime and its fresh Worker channel.
// Validate before structuredClone; ignored extractor geometry remains unread.
export function copyFinancialGenerationInput(input) {
  try {
    if(input===null||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error();
    const keys=Reflect.ownKeys(input);
    if(keys.length!==INPUT_KEYS.length||keys.some(key=>!INPUT_KEYS.includes(key)))throw Error();
    const captured={};for(const key of INPUT_KEYS)captured[key]=input[key];
    captured.source=copyValidatedSource(captured.source);
    assembleProvenanceContext(captured);
    const snapshot=structuredClone(captured);
    assembleProvenanceContext(snapshot);
    return freeze(snapshot);
  } catch {throw new PromptError('INVALID_PROMPT_INPUT');}
}
export function copyFinancialGenerationOptions(options={}) {
  const captured=preflightGeneration([0],options);
  return Object.freeze({contextWindowTokens:captured.contextWindowTokens,maxNewTokens:captured.maxNewTokens});
}
