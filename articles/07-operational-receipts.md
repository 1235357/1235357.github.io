---
title: A RAG answer needs an execution contract
tags: [rag, observability, api, software-design, evaluation]
category: technical-blog
status: development-notes
created: 2026-10-11
updated: 2026-10-11
source_type: implementation-and-official-documentation-review
---

# A RAG answer needs an execution contract

A useful financial RAG demonstration starts with a question and its outcome.
The reader should immediately see an answer draft, a refusal, or an operational
failure. They can then open the evidence and computation that produced it.
When a long list of vectors appears before the outcome, the presentation hides
the very behavior the project is supposed to explain.

This chapter describes a browser computation lab and a separately packaged
Python API. They share engineering concerns and have distinct runtimes. The
browser uses PDF.js, MiniLM and Qwen/WebGPU on the reader's device. The explicit
public build serves pinned model assets from the same origin and enables
generation, geometry capture and an explicit-field source-cell lookup. Each
model action requires a reader action; the selected PDF stays in that browser
session. The default development build keeps generation disabled, and the
private loopback entry preserves the dated native acceptance path. The Python
service accepts a retriever and generator behind an authenticated HTTP boundary.
These execution contracts do not establish financial answer accuracy or an
enterprise production service.

The reader experience was also informed by the user's
[browser image-upscaler example](https://tool.hoothin.com/zh-CN/image-upscaler).
Its visible interface places input beside the result, exposes the selected model
and backend, and explains that the first run loads model assets. Those concrete
affordances carry over to this lab: put the outcome in view, show the execution
contract before an explicit model action, and keep preparation visible. The
example's local-processing statement is the publisher's claim; our acceptance
records concern this RAG implementation's own observed behavior.

## Start with the outcome, preserve the computation

<figure class="architecture-figure" aria-label="Interactive reader-owned RAG computation lab">
<div class="figure-heading"><span class="figure-status">BROWSER COMPUTATION LAB / SOURCE-OWNED SESSION</span><h3>Question → outcome → computation notebook</h3><p>Select a small local PDF, build chunks, explicitly encode passages, retrieve a question and inspect its context. The public build enables native generation and a separately labeled explicit-field Net income lookup after parsing. Inspect the device and download guidance before starting a model action.</p></div>
<iframe src="browser-rag/inspector.html" title="Question, answer and expandable RAG computation notebook" loading="lazy"></iframe>
<figcaption>Figure 1 · The actual inspector. Model actions are explicit; a first Qwen run prepares approximately 816 MB of verified assets. A generated draft still needs source review. <a href="browser-rag/inspector.html">Open full-size ↗</a>. This iframe uses the build profile selected by its host.</figcaption>
</figure>

The six-step rail reports accepted artifacts and the current operation: parse,
chunk, embed, retrieve, context and generate. A ready context is not an answer.
An active operation is not a completed artifact. A generation receipt proves
that the native path returned output; its separate output inspection decides
whether the result can be shown as an unverified financial draft or must remain
refused. Financial correctness is still unestablished until the source supports
the requested metric, period, column, amount and unit.

The computation notebook keeps the retained query, candidates, exact source
spans, token IDs, vectors, assembled evidence and full native receipt accessible.
The display can collapse; the evidence sent to the model does not change.
Citation navigation selects the retained source page and chunk without another
retrieval or generation. This makes a source check cheap enough to perform
during a demonstration rather than postponing it until after a misleading answer.

## One owner across asynchronous stages

The browser has one document session. Loading another PDF changes its epoch;
editing a question invalidates dependent query context and output. Each worker
attempt has a fresh identity. Ready handshakes, increasing sequence numbers,
terminal-event checks and deadlines reject messages from an old attempt.
Cancellation revokes ownership before asking the worker to stop. That order
matters because an abort callback can run synchronously and reenter the session.

The central invariant is simple: the displayed result must belong to the current
document, accepted question and generation attempt. Matching only the document
hash is insufficient. Two sessions can load identical bytes while still owning
different questions and different work. Relabeling a late reply with the new
session's identity would create a plausible but false result.

<figure class="architecture-figure" aria-label="Generation attempt ownership and cancellation sequence">
<div class="figure-heading"><span class="figure-status">CODE-SOURCED CONTRACT / COMMITTED CORE 10F962E</span><h3>One attempt owns its messages and output</h3><p>Launch, execute, inspect and revoke across the session, worker transport, fresh worker, native runtime and output gate.</p></div>
<iframe src="figures/owned-generation.archify.html?theme=dark" title="Archify sequence of owned financial generation" loading="lazy"></iframe>
<figcaption>Figure 2 · Original Archify figure traced to seven committed source files. Deterministic showcase validation and strict artifact provenance pass; Codex browser visual review is separate from Archify's external browser gate. This is a code-sourced contract illustration, not repository-provenance or runtime acceptance. <a href="figures/owned-generation.archify.html?theme=dark">Open full-size ↗</a> · <a href="figures/owned-generation.archify.json">Editable JSON</a>.</figcaption>
</figure>

The committed implementation at `10f962e` separates these responsibilities:

| Boundary | Responsibility | Failure it prevents |
| --- | --- | --- |
| `pdf-session.mjs` | Capture accepted query input and own invalidation/commit | A late answer replacing the current question |
| `financial-generation-source.mjs` | Own one worker, handshake, sequence and hard deadlines | Duplicate, stale or indefinitely renewed work |
| `financial-generation.worker.mjs` | Validate one command and return an identity-bound terminal | A worker result with altered provenance |
| `prompt-contract.mjs` | Preserve the selected evidence and count the complete model frame | Hidden truncation or output-budget overrun |
| `financial-generator-runtime.mjs` | Use the paired native tokenizer/model and return execution evidence | Treating preparation as inference |
| `financial-output-contract.mjs` | Inspect bounded decoded output and exact citation bindings | A malformed or unbound citation becoming an answer |

The presentation adapter reads these artifacts; it does not decide financial
truth. This is a concrete design trade-off: a fresh worker provides clear failure
ownership and cleanup, but warm model assets do not mean the model remains loaded
between attempts. Repeated model initialization can dominate an interactive run.
We need measurements before choosing a reusable worker/model lifetime.

Three caches belong to different lifetimes. The official 2026
[inference lecture](https://speech.ee.ntu.edu.tw/~hylee/ml/ml2026-course-data/inference.pdf#page=29)
connects KV reuse to causal decoding and live memory. In this implementation,
`use_cache: true` requests within-attempt KV reuse, while model/device cleanup
ends that attempt. A warm file cache establishes neither a loaded model nor
cross-attempt prompt reuse.

| Cache | Reused object | Current project boundary |
| --- | --- | --- |
| Verified browser asset cache | Pinned model, tokenizer and runtime response bodies | Every later invocation verifies files again; eviction can require another transfer |
| Model KV cache | Computed key/value tensors from earlier causal tokens | Requested within a native generation attempt; no persistent app-level KV store |
| Prefix cache across requests | State for an identical causal token prefix | Not implemented; repeated words after a changed prefix do not establish a hit |

The lecture's [prefill/decode split](https://speech.ee.ntu.edu.tw/~hylee/ml/ml2026-course-data/inference.pdf#page=5)
also clarifies a measurement gap: our bulk model-call interval supplies no separate
prefill or first-token timestamp. FlashAttention concerns attention data movement;
the current ONNX/WebGPU setting does not prove that an executed kernel uses it.
Those are bounded future instrumentation and runtime experiments, with the frozen
financial input/output baseline preserved.

## Progress has units, timing has boundaries

A percentage is meaningful only when numerator and denominator describe the
same work. For verified asset preparation, completed bytes and pinned total bytes
can support a bounded progress display. Received bytes are not verified bytes.
Repeated SDK reads are not additional downloaded model files. Download size is
also not GPU memory: runtime structures, activations and KV cache consume memory
under different accounting rules.

Model initialization has no reliable completion denominator. The inspector shows
the current stage and elapsed time rather than inventing a percentage. After a
native receipt completes, its recorded stage starts produce inspectable intervals:

```text
interval[i] = stageStart[i + 1] - stageStart[i]
finalInterval = receiptElapsed - lastStageStart
```

Those are wall-clock intervals between native boundaries. They can include
loading, initialization and cleanup. They are not isolated GPU kernel timings,
time to first token, or token throughput. The fixed greeting diagnostic recorded
elsewhere in this series demonstrates execution of eight generated tokens; it
does not benchmark the current financial workflow.

A future performance run should freeze source bytes, model/runtime revisions,
prompt/output token counts, settings and cache state. Record cold asset preparation
separately from warm preparation, initialization and per-request work. Publish
individual samples and their failure outcomes before computing distributions.
For a latency SLO, successful throughput alone is insufficient:

```text
goodput = requests completing successfully within the latency target / elapsed time
```

The target and success criterion must be declared with the workload. A refusal
can be the correct quality outcome while still having a measurable latency;
an operational timeout is a distinct failure. A handful of convenient requests
does not establish p95 behavior or capacity under concurrent load.

The [Anyscale production guide](https://docs.anyscale.com/rag/production-scalability)
discusses distributed ingestion, serving caches and observability. Our proposed
scale path follows the separation between reusable ingestion artifacts and online
serving. Ray Data, durable intermediate Parquet, a filtered vector store and Ray
Serve are future variants, not components running in this browser lab.

## An enterprise caller needs failure semantics

The staged Python API previously converted generator exceptions into a normal
response object. An HTTP caller could receive status 200 for both a deliberate
refusal and a failed model request. That ambiguity prevents a host application
from choosing a useful action: show the refusal, retry a dependency, or report
an incident.

The operational contract now separates them. All responses retain a request ID;
generation failures retain already gated evidence so the caller can distinguish
successful retrieval from unavailable synthesis. Internal exception details are
excluded from response messages.

| Outcome | HTTP status | Machine-readable meaning | Host application action |
| --- | --- | --- | --- |
| Completed answer or deliberate evidence/output refusal | 200 | `can_answer`, `evidence_passed`, `message`, `answer` and `citations` | Render the outcome and inspect its sources |
| Invalid request | 422 | Request validation error | Correct the payload |
| Missing or invalid bearer token | 401 | Authentication failure | Use the application's existing credential flow |
| Generator timeout | 504 | `generation_timeout` | Apply a bounded retry policy or surface a timeout |
| Generator transport, response or service failure | 503 | `generation_unavailable` | Treat synthesis as unavailable |
| Query dependency failure | 503 | `query_service_unavailable` | Treat the query service as unavailable |

Retries belong to the consuming application's policy. A client must not blindly
retry every refusal or keep resubmitting a large prompt until it happens to pass.
Set a deadline, attempt limit and resource budget, and preserve the original
question and source version across retries. The service currently exposes one
question per request; it is not a complete OpenAI chat, messages or responses API.

The generator adapter can call an OpenAI-compatible chat endpoint. That describes
its upstream model protocol; it does not make `/v1/query` interchangeable with
`/v1/chat/completions`. Integration should use the actual request/response schema,
authentication, status handling and installed package contract. The API's
`/readyz` currently reports application readiness; it does not probe model
availability, validate an index or prove that a financial answer can be generated.

The [mentor's October 8 serving article](https://www.anyscale.com/blog/run-coding-agents-on-your-own-gpus)
provides a useful comparison: model engines, replica orchestration and client API
compatibility are separate responsibilities. Its measurements and cost scenarios
belong to its hardware and workload. They are not speedups or cost savings measured
for this project.

## Enlarge the knowledge base without losing its meaning

More documents can increase coverage and can also increase ambiguous candidates.
A financial corpus should retain document version, fiscal period, physical PDF
page, displayed label, table identity, row/column headers and unit. A text offset
alone does not recover the relationships in an income statement.

The local corpus audit found eight original NVIDIA PDFs, 1,153 physical pages
and 4,126 experimental chunks. Existing suites overlap: 109 memberships across
15 JSONL files represent 104 unique question IDs, rather than 109 independent
cases. Four duration/metric questions now have portable source bindings to the
FY2025 Q2 income statement. Their replay verifies PDF bytes, extraction identity,
headers, row, date column, value spans and cell boxes. They remain assistant-reviewed
development candidates with `human_acceptance=false`. This validates source
binding; it measures neither retrieval nor generation accuracy.

The audit also found a concrete coverage gap: the existing structured quarterly
variant contains revenue and operating income, but no net-income fields. The raw
report contains net income. Adding another retrieval algorithm cannot recover a
field that a structured ingestion variant omitted. A separate bounded experiment
now derives the four Net income cells from the original physical page 3. It reads
the statement, row, three/six-month headings, dated columns, unit and value boxes
from PyMuPDF text and word geometry, without reading expected-answer labels.

The resulting cells contain 16,599 and 31,480 for the current-year three/six-month
columns, plus 6,188 and 8,232 for the corresponding prior-year columns. Every
named text binding replays against the declared page-text hash. Twenty-one tests
exercise missing or duplicate headers, ambiguous columns, displaced values,
source-hash changes and artifact tampering. An independent reviewer re-extracted
and deep-compared all four cells. Ten monitored original, corpus, package and
wheel files remained byte-identical. This supplies experimental field coverage;
it does not yet establish retrieval or generation improvement. The original text
baseline and earlier structured variant remain separate comparisons, and counts
across variants are not a deduplicated expanded corpus.

The sidecar records the source unit literally as “In millions, except per share
data” and the currency glyph as `$`. It leaves normalized currency unset. Its
code-point spans and PDF-point boxes belong to the pinned PyMuPDF extraction
profile. The browser uses PDF.js UTF-16 spans on a separately hashed two-page
excerpt; copying page numbers or offsets between them would break provenance.

The executed bounded comparison uses explicit metric, duration, end-date and unit
profiles, rather than guessing those fields from natural language. The frozen
raw baseline retains all four reviewed value spans and the requested words. It
does not bind a repeated date header to the correct amount merely because both
are present. The Net-income-only sidecar selects the two exact Net income cells
and correctly reports no exact cell for the two Revenue profiles. Nine synthetic
contract controls refuse missing fields, unsupported rows/periods/units and
duplicate or conflicting cells. Twenty-four additional tests and independent
actual-source replay pass. These are field coverage and selection contracts,
with zero model runs; they supply no financial false-accept rate or general
natural-language retrieval score.

<figure class="architecture-figure" aria-label="Source-bound Net income cells and explicit field selection">
<div class="figure-heading"><span class="figure-status">EXECUTED LOCAL EXPERIMENT / ARTIFACT DIGEST AUDIT</span><h3>Bind the column before selecting the value</h3><p>The bounded Python experiment separates raw lexical coverage, source-cell geometry and exact metric/period/date/unit selection. The Net income sidecar explicitly leaves Revenue uncovered.</p></div>
<iframe src="figures/table-cell-selection.archify.html" title="Archify sequence of source cells and explicit field selection" loading="lazy"></iframe>
<figcaption>Figure 3 · Original Archify illustration of the two executed Python increments. Its creation-stage audit bound local scripts and immutable receipts by SHA-256; the source was uncommitted at that delivery, so native Archify repository-source verification was unsupported. The experiment scripts are now published in <a href="https://github.com/1235357/nvidia-financial-rag/tree/082c208a120a54090a186f16b530fe45859e056f/acceptance">API source commit 082c208</a>. The separate browser PDF.js lookup is implemented below; these PyMuPDF cells are not fed into browser retrieval or generation. <a href="figures/table-cell-selection.archify.html">Open full-size ↗</a> · <a href="figures/table-cell-selection.archify.json">Editable JSON</a>.</figcaption>
</figure>

The [official ingestion guide](https://docs.anyscale.com/rag/quality-improvement/data-ingestion-strategies)
recommends preserving document structure. For this project, table-aware extraction
is a separate experiment: keep a readable representation for source inspection
and a stable structured record for exact lookups. Test whether headers remain
attached when a table spans pages. Keep the existing text baseline as a comparison.

### Capture the browser's coordinates before interpreting them

The canonical generation input deliberately projects the PDF source to exact
text and UTF-16 attribution. It drops geometry. A complete model receipt therefore
cannot prove which dated column a value occupies. During private acceptance, the notebook exposed a
separate disclosure of every retained PDF.js page and item field. That capability is also available in the public profile. Its dated private
actual browser archive contains 231,358 UTF-8 bytes and all 345 items on two pages,
including whitespace and zero-area records. An independent copier validates
dense arrays, finite geometry, positive page extents, source identities and exact
spans, then freezes a detached record. Its text/span projection equals the earlier
canonical input; the new capture is a different parse owner.

The displayed SHA-256 covers exactly the serialized JSON bytes, without a trailing
newline. Capture ownership metadata (document epoch and capture-policy label)
and the displayed digest are separate from that JSON; the JSON itself retains
parser identity and native-worker mode.
Closing, cancellation, replacement or a new render revokes delayed publication.
This makes the capture reproducible without claiming that its digest authenticates
the PDF's origin. Native physical pages 1/2 carry PDF labels 3/4; those labels do
not authenticate a derivation from the separately hashed 80-page original.

PDF.js item transforms describe baselines and extents, rather than per-glyph
boxes. In this archive, both pages have rotation 0, user unit 1 and horizontal
left-to-right items. The first Net income label and its values differ in baseline
by about 0.675 PDF units; exact equality would miss that row. A separately reviewed
coordinate profile must declare a bounded row tolerance, dated-column bands,
statement choice and exact unit text before interpreting the geometry. A moved
value or ambiguous header must refuse. The raw archive establishes the input
boundary; it does not yet establish a financial cell or correct the old model's
six-month output. Currency remains the literal `$` glyph with normalized currency
unset.

The reviewed development policy fixes the alignment tolerance at `epsilon = h / 8`,
where `h` is the discovered metric row's item height. Other nonblank baselines
outside the selected row band must remain more than `4 × epsilon` from it. For each
dated header, `c = x + width / 2`; adjacent center midpoints define the column
bands, and outer bands extend by half the neighboring center gap. The whole
currency and amount item must fit uniquely inside one band with an epsilon
margin. A center-only test could admit a value that crosses two columns. A test
using the date's text box would be too strict: these amounts extend beyond the
date text while remaining within the derived alignment band.

The first profile requires an explicit statement, exact `Net income` row,
three/six-month duration, literal date, exact unit heading and `$` glyph. It
discovers headers from their text and geometry, so parser order does not define
column meaning. Every nonblank item from the selected statement title through
the dated header line must have an explained title, unit, optional `(Unaudited)`,
duration or date role. A competing unit or period heading between those lines
cannot be discarded just because it fails a literal filter. One missing or
duplicated field, unexplained nonblank row token,
unsupported orientation, split number or ambiguous band must refuse. This narrow
contract supplies a testable alternative to choosing a plausible number from a
flattened text window. The pure binder has passed independent contract review
and replayed all eight statement/duration/date combinations from the unchanged
native archive. Every selected role and all four column proofs map to exact
source item records. This is exposed development evidence, with no model call,
PDF reparse or independent human acceptance.

During private acceptance, the notebook exposed this comparator beside the generated outcome. The public profile later enabled the same explicit-field capability; its actual public case and replay are recorded separately below.
All six fields start empty; choosing a statement does not fill its unit or date.
After parsing, an explicit lookup derives the complete frozen result and computes
the snapshot digest before committing the scalar amount. Source, exact role and
column bindings, and the complete result/ownership receipt are separate lazy
disclosures. No encoder or generator action is needed for this comparison.

Actual Codex browser execution selected all four duration/date combinations for
each of the two statements. The separately requested statements returned the
following literal amounts, with their distinct unit headings and source pages
retained in every receipt:

| Duration | Exact period-end heading | Selected amount literal |
| --- | --- | --- |
| 3 months | Jul 28, 2024 | 16,599 |
| 3 months | Jul 30, 2023 | 6,188 |
| 6 months | Jul 28, 2024 | 31,480 |
| 6 months | Jul 30, 2023 | 8,232 |

These are eight exposed source-cell development cases, with financial correctness
unadjudicated. The six-month selection remains distinct from the frozen Qwen
output that answered `16,599`. Its original output and shape-only receipt remain
unchanged. Unsupported Revenue and normalized-unit requests refused; edits,
clearing, explicit retry, main-question edits and source replacement were read
back in the actual interface. Native hashing finished before a pending Cancel
state was observed. Delayed-digest cancellation and late A → retry B publication
are separately established by controlled DOM tests.

Reloading identical PDF bytes also demonstrated why ownership and capture identity
are separate. A fresh parse at epoch 7 retained exactly the same text, spans and
geometry, while all 345 internal font names changed from `g_d0_*` to `g_d4_*`.
The complete snapshot digest therefore changed from `dd0855…` to `44cbca…`.
Both complete records remain archived; each result replays from its own snapshot
and its own exact-byte digest. No font names were rewritten to force equality.
Independent replay checked 216 exact native item references across the initial
eight receipts and the fresh-owner result. This establishes source-bound
derivation and ownership behavior, rather than a held-out financial accuracy score.

The [retrieval guide](https://docs.anyscale.com/rag/quality-improvement/retrieval-strategies)
suggests filters, lexical retrieval and reranking for different failure modes.
Our next comparison should freeze the same questions and corpus before adding
hybrid retrieval. Exact dates and fiscal-year filters need a relevance label,
not just a higher cosine score. Browser MiniLM scores and Python BGE scores come
from different representations and are not interchangeable thresholds.

For aggregation questions, the [structured-data guide](https://docs.anyscale.com/rag/structured-data)
motivates controlled database/tool execution. Correct arithmetic is only one gate:
the selected metric, period, rows, unit and permissions must also be right. A tool
that sums the wrong column returns a precise wrong answer. The current inspector
does not execute arbitrary SQL or Python generated from document text.

## Build a quality experiment before reporting a quality score

The [Anyscale evaluation guide](https://docs.anyscale.com/rag/evaluation) separates
retrieval metrics from answer quality and recommends human calibration of automated
judges. For our financial workload, relevance needs an explicit unit: document,
page, chunk or field. A page hit does not prove the selected chunk contains the
correct table cell.

First freeze a development split and an unseen acceptance split. Each case needs
the question, source digest, expected metric and fiscal period, allowed page/field
evidence, amount/unit and an answerability label. Assistant-generated labels are
candidates for review. A person must check them against the PDF before they become
independent gold. The [generation guide](https://docs.anyscale.com/rag/quality-improvement/generation-strategies)
offers verification and structured-output techniques, but neither a valid JSON
object nor a listed citation establishes that the claim follows from the source.

Run the same frozen cases through dense retrieval, the lexical baseline and any
new reranker. Report retrieval ranking separately from amount/period/unit accuracy,
supported-claim rate, answer relevance and refusal behavior. Record judge model,
prompt, rubric and agreement with human decisions. A changed judge is a changed
measurement instrument. Keep corpus/update/deletion tests separate so stale
answers cannot hide behind a high aggregate score.

## Turn coursework into an explanation and a drill

These connections use actual local course originals inspected on October 11.
Private slides are not reproduced here. The exercises are new project work;
their presence does not establish that the learner has completed them.

| Course source | Project interpretation | Independent practical drill |
| --- | --- | --- |
| CS310 web-services material, physical pages 4, 6, 9 and 17 | An interface includes request, response, status and terminal errors. Apply that to HTTP and worker transport. | Inject late, duplicate and out-of-order replies. Explain why progress must not renew a hard deadline. |
| CS381 layering continuation, physical pages 6, 11, 14 and 16 | Separate UI, session ownership, pure contracts and data/runtime adapters. Responses flowing upward do not create an upward static dependency. | Implement a failing generator adapter without a DOM or real model; describe which layer owns the failure. |
| CS461 Bengio neural-language-model material, physical pages 5, 9, 11 and 12 | Embeddings, logits and next-token probabilities explain model computation; they do not measure claim support. | Make a complete prompt fit a token budget at N and refuse at N−1. Explain cosine similarity versus next-token probability. |
| CS496 LLM-agent material, physical pages 27, 32, 40 and 41 | Retrieval can support memory/tool use. This fixed RAG pipeline is not an autonomous agent. | Establish a bounded retrieval-tool baseline, then evaluate any agent extension on task success, refusal, citations and cost. |

CS381 permits Presentation→Domain and Presentation→Data Source dependencies.
Our choice to route this use case through a session owner is a project decision,
not a claim that the course requires that route universally. Likewise, the CS461
original carries a Spring 2026 footer; using it in current study does not make
it a newly authored Fall slide deck.

## The next experiment follows the failure

On October 11, the actual private browser lab ran a separately hashed two-page
financial excerpt, parsed as native physical pages 1/2 with PDF labels 3/4. The source produced
five chunks. The question asked for revenue for the three months ended July 28,
2024. The pinned Qwen2.5 0.5B q4 model, 2,048-token window, 128-token output reserve
and strict financial output gate remained fixed throughout these diagnostics.

| Diagnostic | Selected evidence | Prompt / generated tokens | Native elapsed | Observed output and disposition |
| --- | --- | --- | --- | --- |
| Prompt v1 | Top K 3 | 1,551 / 128 | 49.750 s | Fenced, truncated evidence-metadata echo; length termination refused |
| Prompt v2, concrete schema example | Same complete user JSON | 1,664 / 5 | 38.928 s | `brief answer from evidence`; EOS, invalid JSON refused |
| Prompt v3, concise schema instructions | Same complete user JSON | 1,627 / 27 | 37.738 s | Plain revenue sentence naming $30,040 million; EOS, invalid JSON refused |
| Prompt v3, explicit Top K 1 comparison | One selected complete evidence unit | 794 / 11 | 29.730 s | `{"answer":"30,040"}`; EOS, missing schema fields refused |
| Prompt v4, task framing outside the data | Original Top K 3; unchanged complete data JSON | 1,726 / 37 | 40.281 s | Three-key JSON with answer `30,040`, citations E1/E4 and `insufficient_evidence=false`; EOS, shape and citation identity accepted |

These are individual wall-clock samples, not a latency distribution. Complete
native receipts retain the exact prompts, input/output token IDs, raw decoded
text, cache/SDK-read records, stage boundaries and cleanup. Each attempt disposed
its inputs, result and model, closed its cache and destroyed its owned device.
The v1, v2 and v3 top-three runs preserve byte-identical user data JSON. The
v3 Top K 1 row explicitly changes the selected evidence and is a separate
complexity diagnostic. v4 returns to Top K 3 and wraps that complete data JSON
in versioned task instructions; its full user message consequently differs.

The small model can produce a plausible amount while failing to provide the
required structure and citation. A strict gate refused the first four diagnostics.
We did not strip fences, insert missing fields, repair output or label
the plain sentence a verified answer. The example in v2 became the entire output;
removing it improved the observed content but still failed the contract. The
bounded v4 experiment places explicit response instructions around the complete
untrusted input data, with a new prompt version and an independently checked token
budget. It passed the unchanged format and citation-identity gate. Actual citation
navigation selected retained native physical pages 1/2 with PDF labels 3/4 without changing the raw
receipt or launching another model call.

That accepted shape exposed the next quality problem. The answer contains only
the amount; it omits an explicit metric, period and unit. E1 includes the revenue
row and headers supporting the amount, while E4 is a comprehensive-income chunk
that does not support the revenue claim. A valid existing citation can therefore
be irrelevant. Format acceptance must not silently become citation-support or
financial correctness acceptance. Four previously frozen development questions
were then run under the same v4 prompt, Top K 3, model and budgets, with no tuning
between cases:

| Requested field, all ending July 28, 2024 | Assistant-reviewed candidate amount (source unit: millions; literal currency glyph: $) | Actual decoded answer | Native elapsed | Development observation |
| --- | --- | --- | --- | --- |
| Revenue, three months | 30,040 | `30,040` | 35.444 s | Numeric value agrees; E4 remains an irrelevant extra revenue citation |
| Revenue, six months | 56,084 | `30,040` | 34.868 s | Wrong duration column, despite valid JSON and existing citation IDs |
| Net income, three months | 16,599 | `16,599` | 34.517 s | Numeric value agrees; E4 contains the Net income row on native physical page 2 (PDF label 4) |
| Net income, six months | 31,480 | `16,599` | 32.807 s | Wrong duration column, despite valid JSON and existing citation IDs |

All four emitted EOS and passed the actual session's shape/citation identity
inspection. Two numeric outputs agree with the assistant-reviewed candidate
values; both six-month questions reused three-month values. This is an exposed
four-positive development diagnostic, not an independent accuracy estimate.
There are no negative cases here, so it provides no false-accept or refusal-rate
denominator. The amount-only answers also omit explicit metric, duration and unit.
An alternate supporting page must be reviewed on its contents rather than marked
wrong merely because the original candidate listed page 3.

The diagnostic also exposed an archive design gap. The complete native receipt
contains the assembled prompt context, while the canonical citation inspector
needs the original eight accepted input fields. Those are different objects.
Early EOS/JSON/schema refusals can be recomputed from the existing archives;
accepted citation identity cannot be faithfully replayed offline without the
original input. The inspector now provides a lazy disclosure of the actual
immutable input alongside its corresponding receipt. Four fresh replicas saved
those exact eight-field inputs from the visible UI, alongside the complete native
receipts. The replay tool first reconstructs canonical context from each original
input and requires an exact match to the archived model context before applying
the unchanged strict output gate. All four independently replayed pairs pass
that complete boundary. The old archives remain incomplete for that specific
replay; a new attempt's input is not retroactively attached to an earlier attempt.

All four fresh replicas retain the same question, complete model input, prompt
and token budget as their corresponding earlier cases. They returned the same
amounts, again exposing both six-month errors. Their individual native wall-clock
times were 39.542, 37.709, 35.138 and 36.301 seconds in table order. These values
are development observations, not independent repeats for a latency percentile.

An actual cancellation during asset preparation revoked output ownership and
retained the accepted query/context. An explicit retry in the same mounted
session then completed and supplied the first full replayable pair. Cancellation
showed no original-input disclosure; editing or clearing the question removed
the previous RAW/input details, and clearing the source removed the retained
index and disabled the subsequent actions. This does not prove cancellation
during GPU execution. The local server acceptance also exposed real
integration defects in shared-file inventory and exact encoder routing; those
were repaired before these model runs. Contract tests and a diagram alone had
not exposed them.

The site and reviewed browser profile are now published on
[GitHub Pages](https://1235357.github.io/07-operational-receipts.html). The
[runtime release workflow](https://github.com/1235357/1235357.github.io/actions/runs/38165566626)
passed its Linux build, Windows contracts and deployment jobs. The public lab
composes the generator and source-cell comparator explicitly; the private
diagnostic server and complete acceptance archives are outside the deployed tree.
Actual public model execution remains a separate gate from those local native
receipts and the successful static deployment.

## What the HTTPS release exposed

The first public reader path accepted the two-page excerpt and five chunks. Its
explicit Comprehensive Income / Net income / six months / July 28, 2024 lookup
returned source literal `31,480`, with 24 selected-role and complete-column item
references independently replayed against its own frozen snapshot. The result
remains a source-cell candidate with financial correctness unadjudicated.

The first model preparation then refused a correct config body. GitHub Pages
sent a 364-byte gzip representation of the 650-byte pinned MiniLM config. Fetch
decoded the body but retained the wire `Content-Length`; our reader had compared
that header to the decoded pin. The repaired reader distinguishes supported wire
encoding metadata from decoded-body identity and keeps the exact decoded length,
SHA, size limit and cancellation checks. Real gzip, Brotli, deflate and chained
encoding regressions passed. On the next deployed version the 650-byte config
passed, exposing the next operational limit.

Two public embedding attempts reached the download stage and exceeded the
120-second whole-operation deadline before new vectors committed. Independent
local reads of the public tokenizer returned HTTP 200 and the exact decoded pin,
but took approximately 116 seconds without compression and 77 seconds with gzip.
Those reads do not locate the delay in Pages, the CDN or the local network path,
and a verified-byte total does not reveal how many unverified stream bytes were
already received by the browser.

The subsequent implementation gives static-file preparation its own explicit
worker and receipt. The reader starts the encoder or generator download, sees
verified decoded-body progress, and can cancel. Preparation receives no PDF,
question or context and invokes neither the SDK nor a GPU. Its fixed 30-minute
deadline includes worker readiness and is never renewed by progress. A complete
receipt means the eight exact pinned bodies were verified and written to cache;
it does not mean the model loaded or inference succeeded. Completed entries may
survive cancellation, and the browser may later evict them. Every model action
still verifies its cache bodies, with the original 120-second encoder/query and
300-second generation limits. Asset bytes are distinct from browser heap, GPU
allocation and live KV state.

The preparation increment passed the clean Linux/Windows contracts and deployed
at runtime commit `5a673bc`. Actual public cancellation removed the pending
preparation result and re-enabled an explicit retry. Its complete public cache
receipt and subsequent model path are still separate acceptance work; a
successful deployment or partial byte counter does not close them.

Public GPU acceptance, independent financial gold, calibrated judging and load
measurements remain open. These preserved failures let a reader examine a real
release boundary and its subsequent engineering work.
