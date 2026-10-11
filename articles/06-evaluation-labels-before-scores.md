---
title: Labels before scores
category: technical-blog
status: local-draft
created: 2026-10-04
updated: 2026-10-11
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
financial claim follows from the evidence. The financial Generate button has
not yet been connected to this boundary. This is post-generation inspection,
not token-level constrained decoding.

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
right to commit. The session/Worker integration for that financial attempt is
the next implementation step, not a result established by this pure inspector.
CS461 supplies another distinction: model token IDs, decoded UTF-16 units and
financial claims are three different representations with different checks.

Run the synthetic contract exercise locally:

```powershell
& 'C:\Users\zye12\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test browser-rag/tests/financial-output-contract.test.mjs
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

## Reproduce this reasoning

1. Inspect one registered development question and its original PDF locator.
2. Decide whether a retrieved chunk merely shares the page or actually supports
   the answer. Write the reason before looking at its similarity score.
3. Check all five financial fields, then explain one plausible wrong-column answer.
4. Design an unseen question and state how it will stay outside tuning.

No new financial-quality score, independent financial review, latency benchmark
or financial acceptance result is claimed by this chapter. It records the
audited registration boundaries, the pure output-inspection contract and the
next measurement design. The source labels, browser predictions and judge
implementation still need their own verification before a quality claim.
