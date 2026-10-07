---
title: Labels before scores
category: technical-blog
status: local-draft
created: 2026-10-04
updated: 2026-10-07
source_type: implementation-and-course-review
tags: [rag, evaluation, evidence]
---

# Labels before scores

## Separate the questions an evaluation asks

[Anyscale's evaluation guide](https://docs.anyscale.com/rag/evaluation), read
2026-10-04, recommends assessing retrieval and generation separately. Retrieval
metrics require labeled relevant items; generation correctness needs verified
reference answers. Faithfulness measures support from context, whereas relevance
asks whether the answer addresses the question. Automated judges need calibration
against human review because they can have systematic biases. These are reference
recommendations, not evidence that this project already implements all metrics.

## The local labels are not an independent acceptance set

The first two inspected rows of `evaluation/annual_multiyear_heldout.jsonl`
explicitly register `purpose: development`, `development_exposed: true` and a null
freeze date. Their filename and question IDs retain the historical word “heldout”;
that does not make them independent now. Each contains assistant-reviewed financial
ground truth and a primary-PDF locator. Neither certifies domain-expert review,
student reproduction or current remote-byte equality.

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

No new quality score, independent review, latency benchmark or acceptance result
is claimed by this chapter. It records inspected label boundaries and the next
measurement design. Remaining corpus rows and evaluation implementation need
their own audit before a complete dataset claim.
