/** Replay saved native output through the existing pure strict gate.
 * No tokenizer, model, browser, network, output repair, or human adjudication.
 *
 * Usage:
 * node replay-financial-receipts.mjs --out <new-report.json> <receipt.json> [...]
 *   [--original-input <receipt.json> <actual-input-sidecar.json>] [...]
 *
 * A sidecar contains the actual eight-field input, directly or under
 * originalContextInput/contextInput. An assembled preparedPrompt.context is
 * insufficient. The sidecar must reproduce that archived context exactly.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { inspectFinancialOutput, FinancialOutputError } from '../financial-output-contract.mjs';
import { inspectGeneratedSequence, GenerationContractError } from '../generator-contract.mjs';
import { assembleProvenanceContext } from '../context-contract.mjs';

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVES = 32;
const hash = value => createHash('sha256').update(value).digest('hex');

function readArchive(path) {
  const bytes = readFileSync(path);
  if (bytes.length > MAX_ARCHIVE_BYTES) throw Error('Archive exceeds the local replay size limit.');
  return { value: JSON.parse(bytes.toString('utf8')),
    file: { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) } };
}

function inputFromSidecar(value) {
  const wrapped = ['originalContextInput', 'contextInput'].filter(key => Object.hasOwn(value ?? {}, key));
  if (wrapped.length > 1) throw Error('Original input sidecar is ambiguous.');
  return wrapped.length ? value[wrapped[0]] : value;
}

export function replayFinancialArchive(receiptPath, originalInputPath = null) {
  const archive = readArchive(receiptPath), receipt = archive.value;
  const prepared = receipt?.preparedPrompt;
  const result = {
    archive: archive.file,
    scope: 'saved native output contract replay; no new model run or quality score',
    humanAcceptance: false, financialCorrectness: 'unestablished', claimSupport: 'unestablished',
    sourceSha256: prepared?.context?.source?.sha256 ?? null,
    model: { id: receipt?.modelId ?? null, revision: receipt?.revision ?? null,
      device: receipt?.device ?? null, dtype: receipt?.dtype ?? null },
    rawText: typeof receipt?.text === 'string' ? receipt.text : null,
    rawTextSha256: typeof receipt?.text === 'string' ? hash(receipt.text) : null,
    renderedPromptSha256: typeof prepared?.renderedPrompt === 'string' ? hash(prepared.renderedPrompt) : null,
    archivedElapsedMs: receipt?.elapsedMs ?? null,
    originalInputArchive: null, originalInputContextMatch: null,
    needsOriginalInputMissing: originalInputPath === null,
    computedTermination: null, inputTokens: null, generatedTokens: null,
    archiveStatus: 'unreplayed', strictOutputStatus: 'unestablished', disposition: 'unestablished',
    errorCode: null, citationBindings: [],
  };

  let originalInput;
  if (originalInputPath !== null) {
    const sidecar = readArchive(originalInputPath);
    result.originalInputArchive = sidecar.file;
    originalInput = inputFromSidecar(sidecar.value);
    try {
      const recomputedContext = assembleProvenanceContext(originalInput);
      result.originalInputContextMatch = isDeepStrictEqual(recomputedContext, prepared?.context);
      if (!result.originalInputContextMatch) throw Error();
    } catch {
      result.archiveStatus = 'incomplete-archive';
      result.errorCode = 'ORIGINAL_INPUT_CONTEXT_MISMATCH';
      return result;
    }
  }

  try {
    const sequence = inspectGeneratedSequence(receipt?.inspection?.sequenceIds, receipt?.preflight);
    result.computedTermination = sequence.termination;
    result.inputTokens = sequence.inputTokens;
    result.generatedTokens = sequence.generatedTokens;
    // Undefined original input deliberately preserves the canonical boundary:
    // early EOS/JSON/schema refusal is reproducible, but valid JSON cannot be
    // promoted to citation acceptance without the actual eight-field input.
    const inspected = inspectFinancialOutput(receipt?.text, receipt?.inspection?.sequenceIds,
      receipt?.preflight, originalInput);
    result.archiveStatus = 'canonical-output-replayed';
    result.strictOutputStatus = inspected.outputInspection;
    result.disposition = inspected.disposition;
    result.citationBindings = inspected.citationBindings;
    result.answer = inspected.answer;
    result.citations = inspected.citations;
    result.insufficientEvidence = inspected.insufficient_evidence;
  } catch (error) {
    result.errorCode = error instanceof FinancialOutputError || error instanceof GenerationContractError
      ? error.code : 'UNEXPECTED_REPLAY_ERROR';
    if (result.needsOriginalInputMissing && result.errorCode === 'INVALID_FINANCIAL_OUTPUT_CONTEXT') {
      result.archiveStatus = 'incomplete-archive';
      result.strictOutputStatus = 'cannot-replay-citation-identity-without-original-input';
    } else {
      result.archiveStatus = result.needsOriginalInputMissing
        ? 'early-rejection-recomputed-original-input-missing' : 'canonical-output-replayed';
      result.strictOutputStatus = 'refused';
      result.disposition = 'refused';
    }
  }
  return result;
}

function argumentsFrom(values) {
  const receipts = [], sidecars = new Map();
  let output = null;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === '--out') {
      if (output !== null || !values[index + 1]) throw Error('Supply one --out path.');
      output = resolve(values[++index]);
    } else if (value === '--original-input') {
      if (!values[index + 1] || !values[index + 2]) throw Error('--original-input requires a receipt path and input sidecar path.');
      const receipt = resolve(values[++index]), input = resolve(values[++index]);
      if (sidecars.has(receipt)) throw Error('Duplicate original-input sidecar mapping.');
      sidecars.set(receipt, input);
    } else if (value.startsWith('--')) throw Error('Unknown replay argument.');
    else receipts.push(resolve(value));
  }
  if (output === null || receipts.length === 0 || receipts.length > MAX_ARCHIVES
      || new Set(receipts).size !== receipts.length) throw Error('Supply --out and 1 to 32 distinct exact receipt paths.');
  if ([...sidecars.keys()].some(path => !receipts.includes(path))) throw Error('Every sidecar mapping must identify an included receipt.');
  return { output, receipts, sidecars };
}

export function replayFinancialArchives(receipts, sidecars = new Map()) {
  const results = receipts.map(path => replayFinancialArchive(path, sidecars.get(resolve(path)) ?? null));
  return {
    schemaVersion: 1, createdAtUTC: new Date().toISOString(),
    scope: 'pure saved native receipt replay; format/citation identity only',
    humanAcceptance: false, financialCorrectness: 'unestablished', modelRuns: 0,
    results,
    limitations: [
      'Without actual original eight-field input, early output refusal can be recomputed but canonical citation acceptance cannot.',
      'Archive and sidecar hashes identify supplied bytes; this replay does not authenticate their original production.',
      'No tokenizer roundtrip, PDF reparse, model inference, answer entailment, human adjudication, or performance benchmark runs here.',
    ],
  };
}

function main() {
  const { output, receipts, sidecars } = argumentsFrom(process.argv.slice(2));
  const report = replayFinancialArchives(receipts, sidecars);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  // Token arrays remain in the untouched source archives. Console output is a
  // bounded result summary; complete raw text and bindings live in the report.
  console.log(JSON.stringify({ report: output, modelRuns: 0, humanAcceptance: false,
    results: report.results.map(row => ({ archive: row.archive.path, sha256: row.archive.sha256,
      inputTokens: row.inputTokens, generatedTokens: row.generatedTokens,
      termination: row.computedTermination, archiveStatus: row.archiveStatus,
      disposition: row.disposition, errorCode: row.errorCode,
      needsOriginalInputMissing: row.needsOriginalInputMissing })) }, null, 2));
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Saved receipt replay failed.');
    process.exitCode = 1;
  }
}
