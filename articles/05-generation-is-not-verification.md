---
title: Generation is not verification
tags: [rag, generation, evidence]
category: technical-blog
status: local-draft
created: 2026-10-04
updated: 2026-10-10
source_type: implementation-and-course-review
---

# Generation is not verification

The classroom baseline is evidence-only: generation is disabled. Generator code
paths exist, but this chapter does not demonstrate an accepted generated-answer
MVP. The recorded Qwen run is a rejected-output diagnostic, not a successful
financial answer. Running a generator does not itself verify a retrieved passage.
This chapter reviews the inspected prompt, validator and local model adapter in
`src/nvidia_rag/generation.py`. Other helper branches still need separate review.

## The official guidance is not an acceptance certificate

The [Anyscale generation guide](https://docs.anyscale.com/rag/quality-improvement/generation-strategies)
was read on October 4. It discusses context ordering and compression, source
metadata, citations, verification, numerical tools and output-format constraints.
For our project these are possible interventions, not existing capabilities.
In particular, tool execution still requires correct source data, intent, units,
code and permissions. Structured output constrains form, not factual support.
We should not adopt absolute reliability language as a project guarantee.

## Read the prompt as a contract proposal

`build_grounded_prompt` requires gated evidence. It includes the question,
quoted context and a list of authorized document/page references. Instructions
ask the model to use only evidence, ignore instructions inside quoted data,
cite factual claims and abstain when information is insufficient.

These instructions express desired behavior; they do not enforce it by themselves.
A source passage can contain malicious or irrelevant instructions, and a model
can ignore the requested citation format. Keeping source data distinct from
instructions is necessary, but no complete prompt-injection defense is proved.

### Course connection: token prediction and evidence enforcement are separate

The current CS461 Canvas download of *Bengio Language Model*, physical PDF
pages 5, 9 and 15, develops logits, softmax/cross-entropy and numerical stability.
Its cover and footer retain Spring 2026, David Demeter; a Fall directory does not
make it a newly authored Fall deck. The model's training objective predicts a
target token, not whether a financial claim is supported by an external report.

A synthetic calculation makes the distinction tangible:

```text
logits                 = [2, 0, -1]
subtract maximum       = [0, -2, -3]
stable softmax         = [0.843795, 0.114195, 0.042010]
first-token loss (nats) = -ln(0.843795) = 0.169846
```

These are teaching values, not our model's observed outputs. A low token loss
does not check the financial row, date column or unit. Separately, the CS496
course-posted `class2` slides credited to Hung-yi Lee distinguish model-level
instructions from external execution control (physical page 23), and illustrate
summarization/context trimming (pages 29 and 47). Our project-specific lesson is
to keep prompt requests, external vetoes and human source review separate.
If a summary removes a fiscal date or unit, fluent generation can become less
supportable. This explanation does not claim a new context-compression feature.

The service retrieves before generation and returns an evidence-stage refusal
when the context gate fails. An evidence gate based on similarity is still not
a fact checker. Inspecting one request should reuse its exact gated context,
not perform a second retrieval that silently changes the evidence displayed.

## Understand what the validator actually rejects

The inspected validator checks an empty response, incomplete brackets, missing
citations, unauthorized citation IDs, substantive text after the final citation,
and lack of a substantive answer. Additional bounded checks examine explicit
currency, certain canonical table-period/metric requests, numeric support and
limited metric or relationship patterns. Multiple inline citation groups are
checked against their local cited pages rather than pooling all pages together.

These are vetoes: detecting one violation can reject an answer. Not detecting a
violation is not proof of full entailment. Paraphrases, negation, forecasts,
cross-sentence relationships and unsupported nonnumeric assertions remain
important limitations. A complete citation can point to a page without actually
supporting the claim. Passing the validator must therefore be followed by a
separate answer-quality review, not renamed "financial truth verified."

The diagnostic `raw_answer` field is explicitly distinct from the released
`answer`. If the latter is empty because validation rejected the output, displaying
raw text as a successful answer would undo that boundary. Demonstration and API
consumers must preserve the same distinction.

## Token budgets have two boundaries

The local Transformers adapter builds the full chat template, including system
instructions, before counting input tokens. It uses `truncation=False`; an input
over the configured budget fails instead of silently dropping evidence.
It separately checks input tokens plus reserved output against the model's
context-window configuration. A long context can be valid in size yet poor in
relevance, so fitting the budget does not establish quality.

Generation uses `do_sample=False` and checks final token IDs for normal EOS
termination before decoding. A syntactically complete citation at the output
budget is not enough to establish normal completion. Greedy decoding does not
prove repeatability across model revisions, hardware or software versions, and
it certainly does not prove correctness.

## Browser lesson: a context record is not yet a prompt

The browser-native implementation is independent of the Python service above.
Its next boundary is `assembleProvenanceContext` in
`browser-rag/context-contract.mjs`: a pure source module independently reviewed
on October 10, not an enabled or preview-packaged generator. The result is explicitly named
`context-not-generated`. It retains the question exactly as typed and associates
ranked candidates with complete source-linked evidence units. There is no model
download, prompt rendering or inference in this function.

Consider the synthetic fixture used by its regression tests. The best-ranked
passage has source ordinal 1, so its citation is `E2`; the next passage has
ordinal 0 and citation `E1`. Rank answers “which candidate comes first for this
query?” while citation identity answers “which chunk in this accepted document
does this refer to?” Giving the first-ranked passage a new identity on every
query would conflate those responsibilities. A citation remains stable within
the accepted source and chunking configuration, not across a changed index.
These fixture ranks are not results from an NVIDIA financial report.

The full chunk record is necessary here. The encoder's smaller `{id, text}`
projection is useful for inference, but it omits the physical page, nullable PDF
page label, exact text range and source-item segments required for inspection.
The new boundary checks the entire declared sequence of chunk windows, not just
the windows that happened to be returned. Removing a middle window and updating
the aggregate counts must still fail. An inserted presentation newline also
remains distinguishable from a quotation taken from a PDF text item. This is an
application of the CS381 responsibility-boundary lesson: transport validation,
retrieval ranking and source attribution have separate contracts even when they
run in the same application.

To study this boundary, run the context contract tests and read the fixture's
source, chunk, retrieval candidate and evidence unit together. Change one page
identity or remove one window, then explain why the operation must refuse it.
After that, explain what it cannot detect: structurally consistent source data
can still be misleading, a correct citation can support the wrong financial
metric, and this pure module does not bind a typed question semantically to its
embedding. Session ownership and financial evaluation remain separate checks.
Passing a programming test is not evidence that the learner has completed this
exercise or mastered it.

### From evidence units to an exact prompt

The locally implemented `prepareGenerationPrompt` makes that next boundary
explicit. Its independent specification and code-quality reviews have passed
for local prompt preparation; the module is not enabled or packaged in the browser demo.
It revalidates the original provenance input, then creates a model-facing JSON
record containing the unchanged question and every selected whole quote, with
its citation, rank, document, page and text-window identity. The full inspection
record separately retains the scores, vectors, receipts and source-item mapping.
Removing those trace-only fields from the model payload is not shortening the
quotes or silently dropping evidence to fit a token budget.

The two messages have fixed roles: system instructions, followed by the JSON
data. Angle characters in the JSON are escaped losslessly before the SDK renders
the pinned Qwen chat template. For example, a source string containing a literal
`<|im_start|>` becomes JSON data containing `\u003c|im_start|\u003e`; parsing
that JSON recovers the original string. This prevents that literal spelling from
becoming a role delimiter in this template. It does **not** establish resistance
to ordinary-language prompt injection, nor does asking for JSON guarantee that
the model will return the required structure.

The adapter requires the SDK's exact full rendered template and tokenizes that
whole string with truncation disabled. System text, JSON metadata, quotation
text, role markers and the assistant prefix all count. It accepts the copied
token IDs only if input length plus reserved output fits the configured window.
UTF-16 offsets locate JavaScript text; they are not token counts. An over-budget
prompt fails instead of hiding a shorter quotation behind a successful status.

A local Node diagnostic used the actual downloaded, SHA-256-checked Qwen
tokenizer pair and the installed SDK with two **synthetic** source paragraphs
and synthetic retrieval vectors. Its 1,745-UTF-16 prompt encoded to **489 input
tokens**. Reserving **128 output tokens** accepted a **617-token** window and
refused a **616-token** window. The two quotes and raw question survived exactly,
including Unicode, whitespace and marker spellings; the tokenizer saw only the
intended three role starts and two role ends. This is a concrete tokenizer and
budget observation, not an NVIDIA evaluation or a generated answer. The result
is still named `prompt-prepared-not-generated`, with `generationMode: not-run`.

For your own learning check, first explain why source ordinal and retrieval rank
are different, then follow one complete quote into the JSON and back. Predict
which extra text contributes tokens before running the tokenizer. Finally,
explain why a correct budget receipt cannot prove that the future model's answer
is financially supported. Reading these results is not evidence that you have
performed that exercise. Weight loading, actual browser inference, output
inspection, citation release and independent financial evaluation remain open.

## Explain the observed failure without exaggeration

A prior local Qwen2.5-0.5B-Instruct run reached generation but omitted the required
document/page citation; the interface reported a citation-format refusal. That
historical observation supports one concrete failure case. It does not establish
current uptime, general answer quality, a throughput benchmark or the best model.

To reproduce the learning, record one question, exact evidence, full prompt,
model/runtime revision, raw response, rejection reason and a human source verdict.
Review the answer independently of whether the validator accepted it. Include
both valid answers wrongly refused and unsupported answers wrongly accepted;
otherwise a stricter refusal policy can look artificially better.

## A safe next experiment, not a new feature promise

Compare prompt variants using the same evidence and model settings. Freeze
review criteria before inspecting outputs. Record format compliance separately
from factual support and answer completeness. Do not repair a missing citation
by attaching the top-ranked page automatically: that manufactures attribution.
Numerical aggregation should remain out of scope until inputs and calculations
have an explicit verifiable contract.

For interviews, be ready to explain one rejected output and one validator gap.
That is stronger engineering evidence than saying "RAG eliminates hallucinations."
Continue with [evaluation labels](06-evaluation-labels-before-scores.html).
