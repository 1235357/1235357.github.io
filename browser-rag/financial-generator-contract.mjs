import { copyPreparedGenerationPromptWithSnapshot } from './prompt-contract.mjs';
import { copyNativeGeneratorReceiptWithSnapshot } from './generator-native-core.mjs';
import { createReceiptSnapshot } from './receipt-snapshot.mjs';

const NATIVE_KEYS=['schemaVersion','status','generationMode','modelId','revision','device','dtype',
  'promptTokenIds','generatedTokenIds','text','preflight','inspection','cachePreparation','sdkReads','elapsedMs','stages','cleanup'];
const RECEIPT_KEYS=[...NATIVE_KEYS,'preparedPrompt','outputInspection','financialCorrectness'];
export class FinancialGeneratorReceiptError extends Error {
  constructor() {
    super('The financial generator receipt is invalid.');
    this.name='FinancialGeneratorReceiptError';this.code='INVALID_FINANCIAL_RECEIPT';
  }
}

// Complete detached receipt only. Invocation provenance, actual tokenizer
// correspondence, decoded-text correspondence, session attempt ownership and
// financial correctness remain separate evidence. The original provenance is
// revalidated, not authenticated with a byte-identity seal.
export function copyFinancialNativeReceipt(value,originalContextInput,options={}) {
  try {
    const snapshot=createReceiptSnapshot(),captured=snapshot.record(value,RECEIPT_KEYS);
    const preparedPrompt=copyPreparedGenerationPromptWithSnapshot(captured.preparedPrompt,originalContextInput,options,snapshot);
    if(captured.outputInspection!=='not-run'||captured.financialCorrectness!=='unestablished')throw Error();
    const nativeInput={};for(const key of NATIVE_KEYS)nativeInput[key]=captured[key];
    const native=copyNativeGeneratorReceiptWithSnapshot(nativeInput,preparedPrompt.preflight,16384,snapshot);
    return Object.freeze({...native,preparedPrompt,outputInspection:'not-run',financialCorrectness:'unestablished'});
  } catch {throw new FinancialGeneratorReceiptError();}
}
