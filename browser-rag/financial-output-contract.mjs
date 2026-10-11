import { assembleProvenanceContext } from './context-contract.mjs';
import { inspectGeneratedSequence } from './generator-contract.mjs';

const MAX_TEXT_UTF16 = 16384;
const MAX_CITATIONS = 512;
const ROOT_KEYS = ['answer', 'citations', 'insufficient_evidence'];
const MESSAGES = Object.freeze({
  INVALID_FINANCIAL_OUTPUT_TEXT: 'The financial output text is invalid.',
  FINANCIAL_OUTPUT_LIMIT: 'The financial output exceeds its inspection limit.',
  INVALID_FINANCIAL_OUTPUT_TERMINATION: 'The financial output did not terminate with EOS.',
  INVALID_FINANCIAL_OUTPUT_JSON: 'The financial output is not a complete supported JSON object.',
  INVALID_FINANCIAL_OUTPUT_SCHEMA: 'The financial output does not match the required schema.',
  INVALID_FINANCIAL_OUTPUT_CITATION: 'The financial output citation identities are invalid.',
  INVALID_FINANCIAL_OUTPUT_CONTEXT: 'The financial output provenance input is invalid.',
  FINANCIAL_OUTPUT_FAILED: 'The financial output could not be inspected safely.',
});

export class FinancialOutputError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'FINANCIAL_OUTPUT_FAILED';
    super(MESSAGES[safe]); this.name = 'FinancialOutputError'; this.code = safe;
  }
}
const fail = code => { throw new FinancialOutputError(code); };

// The bounded grammar is deliberately schema-directed and nonrecursive. Only
// isolated JSON string tokens use JSON.parse; decoding keys before assignment
// preserves duplicate detection that whole-object JSON.parse would lose.
function parseOutput(text) {
  let index = 0;
  const whitespace = () => {
    while (text[index] === ' ' || text[index] === '\t' || text[index] === '\r' || text[index] === '\n') index++;
  };
  const expect = character => {
    if (text[index] !== character) fail('INVALID_FINANCIAL_OUTPUT_JSON');
    index++;
  };
  const string = () => {
    const start = index;
    expect('"');
    while (index < text.length) {
      const character = text[index++];
      if (character === '"') return JSON.parse(text.slice(start, index));
      if (character.charCodeAt(0) < 32) fail('INVALID_FINANCIAL_OUTPUT_JSON');
      if (character === '\\') {
        const escape = text[index++];
        if (escape === 'u') {
          for (let digit = 0; digit < 4; digit++) {
            const hex = text[index++];
            if (hex === undefined || !/^[0-9a-fA-F]$/.test(hex)) fail('INVALID_FINANCIAL_OUTPUT_JSON');
          }
        } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) fail('INVALID_FINANCIAL_OUTPUT_JSON');
      }
    }
    fail('INVALID_FINANCIAL_OUTPUT_JSON');
  };
  const citations = () => {
    if (text[index] !== '[') fail('INVALID_FINANCIAL_OUTPUT_SCHEMA');
    index++; whitespace();
    const values = [];
    if (text[index] === ']') { index++; return values; }
    while (true) {
      // Bound the number of entries before scanning or decoding the next one.
      if (values.length >= MAX_CITATIONS) fail('FINANCIAL_OUTPUT_LIMIT');
      if (text[index] !== '"') fail('INVALID_FINANCIAL_OUTPUT_SCHEMA');
      values.push(string()); whitespace();
      if (text[index] === ']') { index++; return values; }
      expect(','); whitespace();
      if (text[index] === ']') fail('INVALID_FINANCIAL_OUTPUT_JSON');
    }
  };
  const boolean = () => {
    if (text.startsWith('true', index)) { index += 4; return true; }
    if (text.startsWith('false', index)) { index += 5; return false; }
    fail('INVALID_FINANCIAL_OUTPUT_SCHEMA');
  };
  whitespace(); expect('{'); whitespace();
  const seen = new Set(), output = {};
  if (text[index] !== '}') {
    while (true) {
      const key = string();
      if (!ROOT_KEYS.includes(key) || seen.has(key)) fail('INVALID_FINANCIAL_OUTPUT_SCHEMA');
      seen.add(key); whitespace(); expect(':'); whitespace();
      if (key === 'answer') {
        if (text[index] !== '"') fail('INVALID_FINANCIAL_OUTPUT_SCHEMA');
        output.answer = string();
      } else if (key === 'citations') output.citations = citations();
      else output.insufficient_evidence = boolean();
      whitespace();
      if (text[index] === '}') break;
      expect(','); whitespace();
    }
  }
  expect('}'); whitespace();
  if (index !== text.length) fail('INVALID_FINANCIAL_OUTPUT_JSON');
  if (seen.size !== ROOT_KEYS.length) fail('INVALID_FINANCIAL_OUTPUT_SCHEMA');
  if (output.insufficient_evidence
    ? output.citations.length !== 0
    : !output.answer.trim() || output.citations.length === 0) fail('INVALID_FINANCIAL_OUTPUT_SCHEMA');
  return output;
}

function bindCitations(citations, context) {
  // The shared context constructor already owns validated complete units.
  // The output receipt projects only the cited units, in the model's order.
  if (citations.length > context.evidenceUnits.length) fail('INVALID_FINANCIAL_OUTPUT_CITATION');
  const selected = new Map();
  for (const unit of context.evidenceUnits) selected.set(unit.citationId, unit);
  const seen = new Set(), bindings = [];
  for (const citationId of citations) {
    if (seen.has(citationId) || !selected.has(citationId)) fail('INVALID_FINANCIAL_OUTPUT_CITATION');
    seen.add(citationId);
    const unit = selected.get(citationId);
    bindings.push({ citationId, rank: unit.rank, ordinal: unit.ordinal, chunkId: unit.chunkId,
      physicalPageNumber: unit.physicalPageNumber, pageLabel: unit.pageLabel,
      startUtf16: unit.startUtf16, endUtf16: unit.endUtf16, text: unit.text, segments: unit.segments });
  }
  return bindings;
}

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Pure shape/identity inspection only: no model invocation, decode fidelity,
// financial truth or claim sufficiency is established. The future owned
// session must separately bind original input and operation/epoch/cancellation.
export function inspectFinancialOutput(generatedText, fullSequenceIds, acceptedPreflight, originalContextInput) {
  // Text is primitive and bounded before any parsing or caller traversal.
  if (typeof generatedText !== 'string') fail('INVALID_FINANCIAL_OUTPUT_TEXT');
  if (generatedText.length > MAX_TEXT_UTF16) fail('FINANCIAL_OUTPUT_LIMIT');

  // Only this direct canonical generation boundary may emit its safe errors.
  // Recompute termination; a caller-supplied receipt/flag is never accepted.
  const sequence = inspectGeneratedSequence(fullSequenceIds, acceptedPreflight);
  if (sequence.termination !== 'eos') fail('INVALID_FINANCIAL_OUTPUT_TERMINATION');

  let output;
  try { output = parseOutput(generatedText); }
  catch (error) {
    if (error instanceof FinancialOutputError) throw new FinancialOutputError(error.code);
    fail('INVALID_FINANCIAL_OUTPUT_JSON');
  }
  let context;
  try { context = assembleProvenanceContext(originalContextInput); }
  catch { fail('INVALID_FINANCIAL_OUTPUT_CONTEXT'); }
  try {
    const citationBindings = bindCitations(output.citations, context);
    return freeze({ schemaVersion: 1, status: 'unverified-financial-draft', generationMode: 'not-run',
      outputInspection: 'shape-and-citation-identity-accepted', financialCorrectness: 'unestablished',
      claimSupport: 'unestablished', disposition: output.insufficient_evidence ? 'abstained' : 'draft',
      text: generatedText, answer: output.answer, citations: output.citations,
      insufficient_evidence: output.insufficient_evidence,
      source: { ...context.source }, parser: { ...context.parser }, chunker: { ...context.chunker },
      citationBindings, termination: 'eos' });
  } catch (error) {
    if (error instanceof FinancialOutputError) throw new FinancialOutputError(error.code);
    fail('FINANCIAL_OUTPUT_FAILED');
  }
}
