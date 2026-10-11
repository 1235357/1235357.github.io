import { prepareGenerationPrompt } from './prompt-contract.mjs';
import { copyFinancialGenerationInput, copyFinancialGenerationOptions } from './financial-generation-input.mjs';
import { runNativeGenerator } from './generator-native-core.mjs';
import { copyFinancialNativeReceipt } from './financial-generator-contract.mjs';

export const FINANCIAL_MAX_DECODED_UTF16 = 16384;

/** Complete financial prompt over the shared pinned, owned native loader.
 * The runtime receipt proves invocation only: output inspection, accepted
 * drafts and financial correctness require separate downstream evidence.
 * Precondition: call only once in a fresh owned native Worker/SDK realm.
 * Concurrent calls or sequential retries must not share the imported SDK
 * singleton. Importer/test injection does not make this a reusable shared
 * main-thread engine. */
export async function runFinancialGenerator(contextInput,generationOptions={},runtimeOptions={}) {
  const snapshot=copyFinancialGenerationInput(contextInput);
  const options=copyFinancialGenerationOptions(generationOptions);
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
  return copyFinancialNativeReceipt({...native,preparedPrompt,outputInspection:'not-run',financialCorrectness:'unestablished'},snapshot,options);
}
