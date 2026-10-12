---
title: Labels before scores
category: technical-blog
status: local-draft
created: 2026-10-04
updated: 2026-10-12
source_type: implementation-and-course-review
tags: [rag, evaluation, evidence]
---

# Labels before scores

## Separate the questions an evaluation asks

[Anyscale's evaluation guide](https://docs.anyscale.com/rag/evaluation), read
2026-10-04 and rechecked in the in-app browser on 2026-10-11, recommends assessing retrieval and generation separately. Retrieval
metrics require labeled relevant items; generation correctness needs verified
reference answers. Faithfulness measures support from context, whereas relevance
asks whether the answer addresses the question. Automated judges need calibration
against human review because they can have systematic biases. These are reference
recommendations, not evidence that this project already implements all metrics.

## The local labels are not an independent acceptance set

The October 11 registration audit covered all 15 JSONL files in the local Python
project's `evaluation` directory. No row registered
`evaluation_usage.purpose: acceptance_candidate`. All ten rows of
`annual_multiyear_heldout.jsonl` register `purpose: development`,
`development_exposed: true` and a null freeze date. Its filename and question IDs
retain the historical word “heldout”; that does not make them independent now.
Other files contain development or unregistered rows. A prospective filename,
PDF hash or assistant source-review note does not certify independent human
annotation, student reproduction or current remote-byte equality. This was a
registration audit, not a new verification of every financial label.

These questions remain useful for regression: a change should not casually lose
previously understood behavior. They cannot be reused as unseen acceptance evidence
after tuning against their answers. Do not rename them to conceal exposure.

No completed stronger-model judge run comparing actual RAG predictions with
source-checked reference answers is established here. A rubric, mock judge,
hand-calculated retrieval metric or withheld generation result is not that run.
The mentor's requested closed loop still needs actual predictions, PDF-reviewed
targets, a recorded judge/model configuration and calibration against human checks.

## Choose the relevance unit before computing a score

This project's inspected labels list document/page pairs, while retrieval returns
chunks. A relevant page can contain an unrelated chunk. Consequently a page hit
is a location proxy, not automatically chunk relevance or answer sufficiency.

Proposed evaluation layers:

| Layer | Label needed | Permissible conclusion |
| --- | --- | --- |
| Source location | Document + PDF page | Correct labeled location retrieved |
| Passage support | Chunk/span + relevance verdict | Returned passage supports the requested fact |
| Financial answer | Period, metric, column, amount, unit | Answer matches reviewed financial target |
| Claim grounding | Answer claims mapped to evidence | Each reviewed claim has supporting context |
| Refusal | Answerability + reason | Appropriate withholding rather than invention |

This is an evaluation design, not a newly completed annotation campaign. Before
reporting Recall@k, establish the relevant-item denominator. A few positive pages
do not prove an exhaustive relevant-chunk set. Before reporting Precision@k,
decide how duplicates and overlapping chunks count. Record retrieval candidates
separately from post-threshold evidence so an evidence gate cannot silently change
the evaluated population.

## Work a retrieval metric by hand

Define the relevance unit as a reviewed passage, not merely a PDF page. For one
query, suppose the complete labeled relevant set is `{A, C, E}` and the ranked
top-three results are `[B, C, A]`. There are two relevant retrieved passages:

- Precision@3 = 2 / 3: how much of the returned set is relevant.
- Recall@3 = 2 / 3: how much of the complete relevant set was recovered.
- Reciprocal rank = 1 / 2: the first relevant result is at rank two.

These equal fractions are coincidental. If the labeled relevant set contained six
items, the same retrieval would have Recall@3 = 2 / 6, while Precision@3 would
remain 2 / 3. Mean reciprocal rank averages reciprocal ranks over the registered
query set, assigning zero when no relevant result is found within the evaluated
cutoff. Always report that cutoff and the number of evaluated queries.

This is a synthetic teaching example, not a project benchmark. It also explains
why incomplete labels are dangerous: an unlabeled but genuinely relevant result
may be incorrectly treated as a false positive. For overlapping chunks, establish
whether relevance is attached to each chunk or to deduplicated evidence spans
before counting; do not change that policy after seeing the scores.

Retrieval relevance still does not establish financial correctness. A passage
about revenue can be relevant to the topic yet insufficient for the requested
year. A separate sufficiency label must preserve the period, metric and unit.

## A financial rubric that a reviewer can actually use

For an annual-net-income question, check five fields in the original source:
financial period, metric row, date column, amount and unit. Then ask whether the
returned passage preserves their relationship. Literal occurrence of a number
does not prove the correct column. A well-formed citation does not prove its page
supports that claim. Store a reviewer verdict and reason, not just a boolean pass.

A proposed independent acceptance set should be frozen before tuning, include
answerable and unanswerable cases, and cover different years, table structures,
paraphrases and ambiguous requests. Keep its registration, source hashes and
review provenance. Select operating thresholds using development data, then
evaluate the frozen set without adjusting the system to its individual failures.

The browser variant needs its own strict registration rather than an unchanged
copy of the legacy loader. The inspected Python `load_questions` carries
`financial_ground_truth` and `evaluation_usage`, but does not carry prospective
rows' top-level `source_pdf_sha256`, `gold_table`, `gold_row` or `gold_asof_date`.
A field present in a JSONL file can therefore disappear before evaluation. A
browser acceptance loader should reject missing required provenance instead of
quietly retaining a question while losing its source identity.

Register the original PDF hash, physical page and PDF label, exact supporting
span, statement and row, complete period/column header, signed amount, currency
and unit. Record answerability with a reason, reviewer and procedure, freeze
time, exposure history and fact-family identity. Paraphrasing an exposed revenue
cell does not create an unseen case. Freeze source labels independently of model
outputs; an assistant-run table inspection remains a development source check
unless an independent reviewer actually validates it. Store an explicit
`reviewer_type` and review receipt. Independent assistant review does not establish
independent human verification; an unknown or missing human-review status must
remain unknown, not be promoted by a filename, registration flag or absent
objection.

Keep four output boundaries separate: a generated token sequence, valid decoded
JSON, recognized citation IDs, and source-supported financial claims. Rejecting
malformed or truncated JSON is not an appropriate evidence refusal. A recognized
`E` citation is not entailment. Record real predictions and claim-level review
before calculating scores, and keep runtime errors, overflow, cancellation,
false refusals and false accepts as different outcomes. Calibration controls
with deliberately wrong years or units can test a judge, but cannot be reported
as real model accuracy or human-calibrated judgment without the actual reviews.

## Valid structure is not verified content

The browser implementation now has a pure `inspectFinancialOutput` boundary.
It inspects the complete decoded string, recomputes termination from the full
token sequence and canonical generation configuration, parses exactly the
three required JSON fields, and resolves citation IDs against the original
selected provenance input. It does not invoke a model or determine whether a
financial claim follows from the evidence. This section describes the initial
pure inspection increment. The later owned browser integration and native draft
observations are described in [generation is not verification](05-generation-is-not-verification.html).
The boundary remains post-generation inspection, not token-level constrained decoding.

Consider this deliberately fabricated output from a synthetic test, not a
native-model prediction or a quotation from NVIDIA:

```json
{
  "answer": "Revenue was $999999999 billion in fiscal 2099.",
  "citations": ["E2"],
  "insufficient_evidence": false
}
```

In that fixture, `E2` is a selected source unit. The object has the required
types, a nonblank answer and a recognized citation, so it can pass shape and
citation-identity inspection. Its receipt still says
`financialCorrectness: "unestablished"` and `claimSupport: "unestablished"`.
The fixture's source does not supply this financial fact. A correct citation
identity cannot turn an invented claim into a supported one.

| Boundary | What is checked | What remains unproven |
| --- | --- | --- |
| Full sequence | Prompt prefix, vocabulary, effective settings and terminal EOS | Decoded answer meaning or financial truth |
| Decoded object | Complete bounded JSON, unique decoded keys and exact field types | Whether the explanation follows from evidence |
| Citation identity | Unique selected source-ordinal IDs and their exact retained mappings | Correct fiscal period, row, column, amount and unit |
| Financial review | Source-supported fields and claim-level verdicts | This review has not yet been completed for browser predictions |

Termination matters before parsing. Even a valid-looking object is withheld
when the token sequence ended at its output-length limit rather than EOS.
The inspector does not cut out a convenient object, strip outer code fences,
repair a missing brace or accept a second object after the first. Escaped
duplicate keys also fail: `"answer"` and `"\u0061nswer"` name the same decoded
field. Otherwise a last-key-wins parser could silently replace the answer that
a reviewer thought was inspected.

Source ordinal and retrieval rank are also different identities. In the test
ordering `[E2, E1, E3]`, the highest-ranked unit is still `E2`; selecting only
that unit does not rename it `E1`. Accepted bindings retain physical page,
nullable PDF label, complete quote and source/presentation segments. Inserted
presentation newlines are not invented PDF source spans. Later mutation of a
caller input cannot retarget the detached, frozen receipt.

An explicit `insufficient_evidence: true` disposition requires an empty citation
array, but it is still a model-declared abstention, not an independently judged
appropriate refusal. An explanatory sentence in the `answer` field could itself be
wrong. A format rejection, cancellation, dependency error and appropriate
evidence refusal must therefore remain distinct evaluation outcomes.

This is a concrete CS381 responsibility boundary: presentation displays the
labelled outcome, while the contract owns structure and identity checks. CS310
adds the separate question of whether the asynchronous attempt still owns the
right to commit. Session/Worker integration and its later native observations
require their own evidence; they are not established by the pure inspector alone.
CS461 supplies another distinction: model token IDs, decoded UTF-16 units and
financial claims are three different representations with different checks.

Run the synthetic contract exercise locally:

```powershell
node --test browser-rag/tests/financial-output-contract.test.mjs
```

Before reading its expectations, predict why an unknown citation, a length-ended
sequence and a fabricated number with a recognized citation have different
outcomes. Then identify which fields in a primary PDF would be needed to judge
the fabricated claim. Passing this test suite is inspection-contract evidence,
not browser inference, calibrated financial evaluation or personal mastery.

## Pair quality with operational measurements

### Course connection: measure interfaces and stages, not one success flag

The CS496 course-posted `class1_mdp` original is attributed to Manling Li on its
first page. Physical PDF page 192 separates module inputs/outputs; pages 195–196
distinguish fine-grained measures, planning success, execution success and task
success. We borrow that diagnostic discipline for RAG, not the numerical results
or an MDP implementation. The current retriever is not thereby an autonomous
planner or embodied agent.

For the classroom FY2025 revenue query, write down each state separately:
the source exists; candidates were ranked; some passed the evidence gate;
the original page still needs a claim-specific check; generation is disabled;
no generated answer was released. A wrong fiscal year, a missing unit and a
missing citation describe different failures. Calling all three a retrieval
failure would hide where to intervene. The API can report `can_answer=true`
while returning `answer=""` in evidence-only mode: that flag is not proof that
an answer was generated or financially verified.

### Diagnose the failing stage before selecting an optimization

The [Anyscale quality-improvement overview](https://docs.anyscale.com/rag/quality-improvement)
was reread in the in-app browser on October 7. It separates ingestion, retrieval
and generation failures, and recommends evaluating each change against a simple
baseline while considering quality, latency and cost. Its three strategy
subpages were also read on October 7: [ingestion](https://docs.anyscale.com/rag/quality-improvement/data-ingestion-strategies),
[retrieval](https://docs.anyscale.com/rag/quality-improvement/retrieval-strategies)
and [generation](https://docs.anyscale.com/rag/quality-improvement/generation-strategies).
Their recommendations are not implemented experiments merely because they were read.

For this project, use the following proposed diagnostic decision sequence:

1. **Source absent:** confirm whether the corpus contains the requested period
   and information. Reranking cannot recover a document that was never ingested.
2. **Source present, extraction broken:** compare PDF row/column relationships
   with extracted text. Change parsing only after identifying the lost structure.
3. **Correct evidence stored, not retrieved:** compare the same query and scope
   across dense and lexical controls. Do not alter generation to hide a retrieval miss.
4. **Evidence retrieved, answer wrong:** inspect context selection, synthesis,
   arithmetic and source attribution separately.
5. **Answer refused:** distinguish an intended evidence-policy refusal from a
   format rejection or dependency failure; these have different remediation paths.

This sequence is a project-specific application of the source, not a completed
diagnosis of every corpus case. For example, the observed missing-citation
generation rejection establishes a format failure; it alone cannot establish
whether the underlying financial answer was correct or whether retrieval failed.

Report errors and refusals alongside latency. A system that immediately refuses
every query may be fast but useless. Separate query encoding, retrieval, context
assembly and generation timing; record hardware, model/index revision, concurrency
and cold/warm state. An HTTP process-time header is one measurement boundary,
not a complete end-to-end benchmark.

## October 12: reproduce a real failure before choosing a repair

Consider a question asking for NVIDIA's fiscal 2035 second-quarter revenue.
That report is absent from the frozen ten-report registry. Nevertheless, the
global dense search returned a FY2024 annual-report passage from physical page
160 with cosine **0.780718**, just above the fixed **0.78** gate. The service
accepted evidence. It had no financial fact from the requested report.

This is an actual observed development trace from the local Python variant,
not a browser prediction or a fabricated teaching example. The complete query,
scope, frozen input identities, source IDs and unrounded score are preserved in the
[expanded diagnostic metadata](https://github.com/1235357/nvidia-financial-rag/blob/main/docs/acceptance/expanded-development-runtime-20261012.json).
The example shows why a similarity threshold cannot establish that a requested
report exists. Raising or lowering it would need its own evaluation; the
diagnostic retained the original setting.

Before that run, eighteen cases were frozen: twelve previously exposed positive
source-cell candidates, four refusal candidates and two clarification candidates.
The source replay verified the original PDF hashes, selected row/date/duration
and column/value boxes, and mapped their essential roles into the corpus's
unsorted text coordinates. A number appearing on the right page could not pass
that check by itself. Sorted review offsets were never reused against differently
ordered corpus text.

The producer executed 35 case/scope requests and saved both the returned float32
query vectors and the actual normalized float64 vectors consumed by retrieval.
A separate tool, with no model, retriever, service or PDF imports, reconstructed
all scoped scores, candidates, evidence, citations and context digests. All 35
rows and 175 scalar Top-5 dot-product checks matched. That establishes a
reproducible calculation, including a reproducible wrong-report retrieval.

| Observed scope | Positive cases with complete fields in Top-5 | Positive cases with complete fields after the gate | Provisional negative candidates accepted |
| --- | ---: | ---: | ---: |
| All ten reports | 1 / 12 | 0 / 12 | 5 / 6 |
| Explicit requested report | 10 / 12 | 0 / 12 | 2 / 5 |

“Complete fields” here means the union of selected chunks contains every required
source range from the same cell and page: statement, unit, currency glyph,
duration, date, metric row and selected value. A header from a different page
cannot fill the gap. This is mechanical source-candidate coverage, with provisional
currency normalization; it is not independent financial adjudication.

The unavailable-report case has only a global scope, explaining the different
negative denominators. The other negative candidates test a wrong date, unsupported
one-month amount, absent FX evidence, missing duration and contradictory column
instructions. Their labels were frozen before querying and remain exposed
assistant-reviewed development material. A gate accepting them is a provisional
failure observation, not a calibrated financial false-accept rate.

The [source-cell selection figure](figures/table-cell-selection.archify.html) illustrates
the earlier Python source-bound selection experiment. It depicts a logical sequence
within one Python process. The expanded replay checks twelve distinct source
bindings; the illustration alone does not prove those bindings. Its PyMuPDF
coordinates are separate from the browser's PDF.js bindings and lookup profile.

The useful next changes follow the failing responsibilities: verify report
selection, preserve table headers and dated columns, and compare same-scope
lexical/structured candidates on this same frozen set. Each variant needs its
own score semantics and refusal policy. The current run generated no answer and
has zero independent human gold. Its financial-readiness result remains **FAILED**.

To reproduce the diagnostic, start with the companion repository's
[exact producer and no-model replay commands](https://github.com/1235357/nvidia-financial-rag/blob/main/docs/expanded-financial-comparator.md),
retain fresh output directories, and inspect the failures before changing a gate.
The published metadata contains no original PDFs, corpus text, tensors or weights;
those prepared inputs require their own acquisition and identity checks.

## Keep the row and its column together

The first repair experiment now takes a different route through the same source
material. It builds a quarterly income-statement index directly from pinned PDFs,
before loading any evaluation question or expected answer. Instead of asking
whether a paragraph resembles the question, it asks whether the original words
select one unambiguous table row and dated column.

For example, a three-month amount ended July 28, 2024 and a six-month amount
ended on that same date are different cells. Their shared date cannot replace
the duration header. The new index carries the statement heading, metric row,
date, duration, current/comparison role, amount, scale and printed currency
occurrence together. Each binding retains native text offsets and a rectangle
on the original PDF page. A repeated number must still identify its own source
occurrence.

The [editable source-selection architecture](figures/structured-income-selection.archify.html?theme=dark)
shows two inputs joining at the selector: a source-only table index and the
original question with its operator-selected report scope. Click a component
to inspect its responsibility and source location. The four possible outcomes
are a source candidate, a request for clarification, a refusal and an unsupported
request. The existing dense retrieval path stays separate; this experiment does
not turn a literal field match into a cosine score.

<figure class="architecture-figure" id="quarterly-source-selection" aria-label="Source-only quarterly income-statement index and literal query selection">
<div class="figure-heading"><span class="figure-status">08 / SOURCE-PINNED PYTHON PATH · DEVELOPMENT CANDIDATES</span><h3>A value travels with its row and column.</h3><p>Build the source index first. Parse the original question and report scope. Select one candidate, or expose the reason it cannot be selected.</p></div>
<iframe src="figures/structured-income-selection.archify.html?theme=dark" title="Quarterly source index and literal selection architecture" loading="lazy"></iframe>
<figcaption>Figure 8 · Quarterly checkpoint <code>224d02d</code>: logical responsibilities inside the opt-in Python source-selection path. Source locations are pinned to that reviewed implementation; the illustration is not a financial verdict, a deployment topology or a browser execution trace. <a href="figures/structured-income-selection.archify.html?theme=dark">Open full-size ↗</a> · <a href="figures/structured-income-selection.archify.json">Editable JSON</a>.</figcaption>
</figure>

The actual local build registered all ten reports. Four quarterly statements
provided **204 cells**: 156 monetary values, 24 earnings-per-share values and
24 weighted-average-share values. The six annual reports retained their hashes
and report identities but recorded `ANNUAL_LAYOUT_NOT_IMPLEMENTED`. This distinction
matters: an available report with an unfinished parser is a development gap,
while the absent FY2035 report is missing source data.

An independent program reopened the four PDFs and performed **8,531 checks** of
the cell payload, including amounts, periods, row sections, source spans and
rectangles. Exact decimal construction preserves EPS decimals and negative
parentheses. An ambiguous row or column is withheld, and a printed dash is not
invented as a zero.

The selector then consumed all 35 original query/scope inputs from the frozen
development set. Only after every selection finished did the comparison tool
use the expected source-cell targets for mechanical assessment.

| Original scope | Source candidates | Refused | Needs clarification | Unsupported |
| --- | ---: | ---: | ---: | ---: |
| All ten registered reports, 18 requests | 12 | 3 | 2 | 1 |
| Explicit requested report, 17 requests | 12 | 2 | 2 | 1 |

All 24 positive selections matched the exposed expected source-field tuples.
The eleven provisional negative request rows were withheld. Those observations
show that the narrow parser preserves these selected fields on this already
exposed set. They do not establish held-out accuracy or prove that every
withheld request received the best financial response.

The limits are visible in the interface. A dollar glyph establishes a printed
symbol, not USD; an explicit ISO-currency request needs further source evidence.
General wording, arithmetic, multiple metrics, FX and scale conversion remain
unsupported. Although the index preserves EPS and share counts, this first
natural-query grammar selects monetary rows only. A future section-qualified
adapter must make “Basic” earnings per share distinct from “Basic” share count.

This is an opt-in Python development path. The published browser notebook and
default HTTP service have not yet been connected to it. That integration needs
its own visible state transitions, source review and runtime checks. The local
checkout at quarterly checkpoint `224d02d` passed **646 tests**; actual model encoding, generation and independent
human gold were all zero in this source-index experiment. Financial readiness
remains unestablished.

The companion [source-selection guide and reproducible command at that checkpoint](https://github.com/1235357/nvidia-financial-rag/blob/224d02d912152b6e1c66d3e0ee6b211790913c5e/docs/structured-income-selection.md)
explain the operator inputs and completion guards. Its
[sanitized observation](https://github.com/1235357/nvidia-financial-rag/blob/224d02d912152b6e1c66d3e0ee6b211790913c5e/docs/acceptance/structured-income-development-20261012.json)
preserves exact input and implementation hashes and all 35 dispositions. This
connects the software-design responsibility to a concrete outcome: report
availability, table layout, query interpretation and financial judgment can
now fail separately and be improved separately.

## An annual period needs its own representation

The quarterly experiment and diagram above retain checkpoint `224d02d`. The
later annual extension at `00dc452` addresses a different source structure.
An annual `Year Ended` header does not establish twelve calendar months.
NVIDIA's [FY2021 Fiscal Year note, physical PDF page 52](https://s201.q4cdn.com/141608511/files/doc_financials/2021/q4/0ec16816-55e2-4812-8f77-75cab5909247.pdf#page=52)
identifies fiscal 2021 as 53 weeks, while 2020 and 2019 contain 52. Its
[FY2026 note, physical page 144](https://s201.q4cdn.com/141608511/files/doc_financials/2026/ar/2026-Annual-Report-Web.pdf#page=144)
records 52 weeks for fiscal 2026, 2025 and 2024. Those conventions qualify the
period; an end date alone cannot supply its length.

Annual cells therefore retain `duration_months=None`. Their `period_kind`
property derives `fiscal_year` from the annual extraction profile; it is not
an added serialized field. This preserves the earlier quarterly cell bodies
and IDs while keeping the literal period header in the source bindings.
A twelve-month request cannot silently match an annual cell, and combining
annual and month-duration instructions requires clarification. The parser
does not calculate a period-start date or week count for each cell.

Date representation also follows the PDF. FY2021–FY2023 use separate month/day
and year groups, bound as `date` and `date_year` with their own native slices
and rectangles. FY2024–FY2026 use a complete date group. Both layouts produce
an ISO end date without inventing a contiguous quotation. Three descending
columns retain one current and two prior-comparison roles; column numbers
distinguish the comparisons without changing the source report's identity.

The ten-report build now contains **531 cells: 204 preserved quarterly cells
and 327 annual cells**. Six printed placeholders receive explicit column
omissions; neighboring supported values survive. A dash still never becomes
zero. This annual policy preserves the quarterly parser's existing whole-row
withholding when a value is unsupported.

The original **35 question/scope rows** retain 24 source candidates, five
refusals, four clarifications and two unsupported outcomes. A separate freeze
derives eighteen questions from inspected annual dates, uses global and
explicit report scopes, and adds six controls. Its **42 requests** return
36 candidates, two refusals, three clarifications and one unsupported result.
These are exposed, source-derived development questions, with held-out and
human-gold counts both zero.

The local checkout passed **661 tests**. Separately,
[workflow 38284747999](https://github.com/1235357/nvidia-financial-rag/actions/runs/38284747999)
completed its Linux, Windows and container jobs at `00dc452`. Packaging and
synthetic API checks do not establish financial correctness. The
[fixed annual guide](https://github.com/1235357/nvidia-financial-rag/blob/00dc45211f4703e49a53a6e9635d195ff69a0b0a/docs/annual-income-selection.md)
and [sanitized development receipt](https://github.com/1235357/nvidia-financial-rag/blob/00dc45211f4703e49a53a6e9635d195ff69a0b0a/docs/acceptance/annual-income-development-20261012.json)
preserve the scope and identities. This source-only path runs no encoder or
generator and remains separate from the default HTTP service and browser
notebook; its candidates still need independent financial review.

## Reproduce this reasoning

1. Inspect one registered development question and its original PDF locator.
2. Decide whether a retrieved chunk merely shares the page or actually supports
   the answer. Write the reason before looking at its similarity score.
3. Check all five financial fields, then explain one plausible wrong-column answer.
4. Design an unseen question and state how it will stay outside tuning.

The registration audit, browser output contract and actual Python diagnostic
answer different questions. The October 12 trace adds a measured failure
breakdown and independently reproducible arithmetic, while financial accuracy,
calibrated judge performance, latency/load benchmarks and human acceptance remain
open. Use the exact preserved observations to decide what to improve next.
