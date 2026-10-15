---
title: A RAG answer needs an execution contract
tags: [rag, observability, api, software-design, evaluation]
category: technical-blog
status: development-notes
created: 2026-10-11
updated: 2026-10-14
source_type: implementation-and-official-documentation-review
---

# A RAG answer needs an execution contract

The browser has displayed `16,599`, with a citation to E4. What has actually
succeeded? A model returned text, the text matched a required format, and E4
identified retained evidence. Those checks still do not decide whether the
amount belongs to the requested metric and financial period.

This is an actual exposed development case, not a fabricated success example.
The public Qwen run asked for three-month Net income ending July 28, 2024 and
kept its result **UNVERIFIED**. Earlier six-month questions returned three-month
values despite passing the same shape and citation-identity checks. We will
follow the successful public operation through the notebook, then use those
failures to locate what its execution contract does and does not establish.

**The learning goal:** given a browser action and its retained artifacts, explain
which result still belongs to the current document and question, what work must
run next, and which source check remains before accepting a financial claim.
An execution contract is the set of conditions for starting work, accepting its
messages, retaining its result and ending its ownership. It is more specific
than a progress spinner or a promise that the model ran.

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

Start with [the live workspace](browser-rag/inspector.html), or read the recorded
case without downloading a model. The first half explains the mechanism; the
later sections retain the dated experiments and failures that changed it. The
Python API has a separate integration path, explained in
[the startup chapter](08-source-bound-startup.html).

<details>
<summary>Reader-interface reference and its scope</summary>

<p>The reader experience was also informed by the user's <a href="https://tool.hoothin.com/zh-CN/image-upscaler">browser image-upscaler example</a>. Its visible interface places input beside the result, exposes the selected model and backend, and explains that the first run loads model assets. Those affordances informed this lab's outcome-first view, explicit model actions and preparation guidance. The example's local-processing statement is the publisher's claim; this chapter's acceptance records concern the RAG implementation's own observed behavior.</p>

</details>

## The reader's browser owns the work

The current public entry composes responsibilities on the reader's device.
Source records return through the session owner before chunking, representation,
retrieval and complete context assembly. Generation and source-cell lookup follow
different paths. Static asset preparation supplies verified files; a native worker
still has to initialize and execute, and a financial claim still needs source review.

In our case, the document is a separately hashed two-page excerpt, not the full
NVIDIA report. Its physical pages 1/2 carry PDF labels 3/4. PDF.js extracts text
and source positions; the chunker creates five inspectable windows; MiniLM maps
passages and the question into vectors; ranking selects evidence; Qwen writes a
draft from the assembled context. The session decides whether each result can
commit. Neither the architecture diagram nor the model knows a financial claim
is correct merely because those stages completed.

<figure class="architecture-figure" aria-label="Current reader-owned browser RAG responsibilities">
<div class="figure-heading"><span class="figure-status">IMPLEMENTED RESPONSIBILITIES / SOURCE 7C7A2C3</span><h3>One owned source. Separate computation and answer gates.</h3><p>Follow the selected PDF through parser records, retrieval, context, Qwen and raw-output inspection. The explicit-field lookup and static preparation have separate contracts.</p></div>
<iframe src="figures/reader-owned-rag.archify.html?theme=light" title="Archify overview of implemented reader-owned RAG responsibilities" loading="lazy"></iframe>
<figcaption>Current source architecture, pinned to commit 7c7a2c3. Arrows summarize owned relationships, including session-mediated data flow; they do not connect workers directly or establish native financial acceptance. Editable <a href="figures/reader-owned-rag.archify.json">JSON</a> · <a href="figures/reader-owned-rag.archify.html?theme=light">Open full-size ↗</a>. The Python API is a separate integration surface and is not called by this lab.</figcaption>
</figure>

## Start with the outcome, preserve the computation

Use the main workspace for the next action and the notebook for the reason that
action is available. On a new visit, **Waiting for a PDF** is an accurate outcome:
there is no accepted source or index. Choosing a document is not permission to
start every model. Build chunks first; explicitly embed them; run the question;
inspect the candidates; assemble context; then explicitly generate a draft.
The six-stage overview can stay collapsed while the current action remains in
view.

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

The [retained public case](#a-public-model-run-with-its-evidence-preserved) makes
those nouns concrete. Read each row as a transformation, rather than six copies
of a generic “complete” badge:

| Boundary | Artifact in this recorded case | Question to ask in the notebook |
| --- | --- | --- |
| PDF → source | Two excerpt pages, PDF labels 3/4, exact text spans and item geometry | Is this the intended source, and which page coordinate system am I reading? |
| Source → chunks | Five source-linked chunks | Which original spans make up E4's quote? |
| Chunks/question → vectors | Five 384-dimensional passage vectors; one 384-dimensional query vector | Were both representations produced for this accepted source and question? |
| Vectors → retrieval | Ordered candidates E4/E1/E2 | Does a high rank identify supporting evidence, or only similarity? |
| Retrieval → context | Three complete evidence units, with no omissions | Did the complete selected text reach the prompt? |
| Context → output | 1,745 prompt IDs, 33 generated IDs, EOS; draft `16,599` citing E4 | Did output validation bind the citation, and does its source support the requested period and unit? |

E4 is a citation identity, not “page 4.” The archived replay locates it at chunk
ordinal 3 on physical excerpt page 2, whose PDF label is 4, with UTF-16 range
`[0,512)` and 105 mapping segments. Those distinctions let a reader inspect the
quote without inventing a page mapping. The
[archive audit](https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/public-d75-independent-archive-audit.md)
checks consistency and replay; it does not authenticate full-report lineage or
judge the amount's financial meaning.

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

Consider two actions on the same accepted Net income question. Cancelling a
generation attempt stops that attempt from publishing; it can leave the accepted
query and context available for an explicit retry. Editing “three months” to
“six months” changes the question itself. The old context must then disappear,
even though the PDF bytes and passage vectors have not changed.

| Event | Still reusable | No longer authorized |
| --- | --- | --- |
| Cancel generation A, without changing the accepted question | Source, chunks, passage vectors, accepted retrieval and context | A's pending output; retry B needs its own attempt identity |
| Edit the question or Top K | Source, chunks and passage vectors | Previous query vector, retrieval, context and generation |
| Replace the selected PDF, including another selection of identical bytes | Verified asset files may still be in browser cache | The old document session's accepted computation and output |

The source for that distinction is the session's
[`cancel`, `clearQuery` and invalidation paths](https://github.com/1235357/1235357.github.io/blob/5826c786848a73b00f3a40f8cfa8593110344403/browser-rag/pdf-session.mjs#L126-L200).
The UI sends question and Top K edits through `clearQuery`. Revoking an owner
first means a late A reply cannot overwrite B or resurrect a result after an
edit. Stopping computation and deciding who may publish are separate duties;
requesting an abort alone does not prove all GPU work has already ended.

<figure class="architecture-figure" aria-label="Generation attempt ownership and cancellation sequence">
<div class="figure-heading"><span class="figure-status">CODE-SOURCED CONTRACT / COMMITTED CORE 10F962E</span><h3>One attempt owns its messages and output</h3><p>Launch, execute, inspect and revoke across the session, worker transport, fresh worker, native runtime and output gate.</p></div>
<iframe src="figures/owned-generation.archify.html?theme=light" title="Archify sequence of owned financial generation" loading="lazy"></iframe>
<figcaption>Figure 2 · Original Archify figure traced to seven committed source files. Deterministic showcase validation and strict artifact provenance pass; Codex browser visual review is separate from Archify's external browser gate. This is a code-sourced contract illustration, not repository-provenance or runtime acceptance. <a href="figures/owned-generation.archify.html?theme=light">Open full-size ↗</a> · <a href="figures/owned-generation.archify.json">Editable JSON</a>.</figcaption>
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
native receipt completes, its recorded stage starts can produce inspectable
intervals. First distinguish that timing record from byte progress.

For a small **synthetic accounting example**, suppose the pinned asset total is
100 bytes, 80 bytes have arrived, and only one complete 60-byte file has passed
its length and hash checks and been written to cache. Verified-body progress is
`60 / 100 = 60%`.
Calling it 80% would count unverified bytes; calling the model 60% initialized
would use the wrong denominator altogether. In the actual case, the generator
preparation's 815,725,938 verified cache bytes likewise establish file
availability, not loaded weights, token decoding or an answer.

Given accepted stage-start timestamps, the interval calculation is:

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

## Inspect a source candidate through its own HTTP contract

A host application may need to inspect a table cell before asking a model to write an answer. The Python API now exposes that operation at `POST /v1/statement-candidates`. It returns the selector's result directly. HTTP 200 means the selection completed; the `disposition` tells the caller whether it found a `source_candidate`, needs clarification, refuses the requested fields, or does not support the operation. A candidate still carries `financial_correctness="unestablished"`. No language model runs on this route.

Before serving requests, the operator builds an immutable index from registered PDFs whose bytes match their recorded hashes, then injects that index into the application. Requests supply the original question and optional registered document IDs. They do not supply a local PDF path. For example, this request narrows selection to one reviewed annual report:

```json
{
  "question": "What was net income for the year ended January 26, 2025, in millions of dollars?",
  "document_ids": ["nvidia-fy2025-annual"]
}
```

The caller must use the identifiers configured by its operator. An unknown identifier withholds the whole requested scope. An annual fiscal-year period also stays distinct from a three-, six- or twelve-month duration. Conflicting wording requires clarification rather than silently choosing a nearby column.

When exactly one cell matches, the response preserves its amount as a string, along with the PDF and page-text hashes, physical page, nullable PDF label, row, dated column, unit, and native text spans and rectangles. It also retains the original question, parsed mentions, index hash and request ID. These fields let the consuming application show what was selected and where it came from. The selection uses exact supported source fields; it has no cosine score or generated answer.

Operational failure follows a separate path. A missing startup index or a selection, validation or serialization fault returns HTTP 503 with `disposition="unavailable"` and empty cells. Private exception details and partial results are withheld. Malformed input receives a fixed validation error. Bearer authentication precedes body parsing, and the adapter limits the actual streamed JSON to 8,192 bytes.

The [configured-consumer guide](https://github.com/1235357/nvidia-financial-rag/blob/1fb5a50dc48645dbbf4fc50159d2986bcf12d687/docs/statement-http-api.md) documents this boundary. Its [dated local metadata](https://github.com/1235357/nvidia-financial-rag/blob/1fb5a50dc48645dbbf4fc50159d2986bcf12d687/docs/acceptance/statement-http-development-20261012.json) binds 711 checkout tests and 28 fresh installed-wheel checks using synthetic native PDF tables and real loopback HTTP. Complete candidate fields and text spans were replayed; the strengthened check also rejected deliberately corrupted coordinates. These observations do not supply a financial accuracy denominator. The browser lab continues to own its selected PDF and separate native computation. Packaging an HTTP selector supplies an integration contract; it does not establish hosted service availability, independent financial accuracy or generation quality.

The installed startup path is explained separately in [From installation to a source-bound service](08-source-bound-startup.html). It follows verified corpus inputs, optional explicit fiscal declarations, pre-listen checks and the distinction between unconfigured and invalid statement mode. The dated HTTP receipt above remains its original checkpoint.

## Enlarge the knowledge base without losing its meaning

More documents can increase coverage and can also increase ambiguous candidates.
A financial corpus should retain document version, fiscal period, physical PDF
page, displayed label, table identity, row/column headers and unit. A text offset
alone does not recover the relationships in an income statement.

The first corpus audit on October 11 exposed a representation problem: an
experimental structured variant omitted Net income even though the original
report contained it. More ranking methods could not recover an absent field.
The bounded repair extracted a cell together with its row, duration, dated
column and literal unit. The two current-year values were `16,599` for three
months and `31,480` for six months; those are distinct columns, not two spellings
of one answer. These exposed source bindings remain financially unadjudicated.

Three boundaries matter when enlarging this system:

| Object | What it preserves | What it cannot establish on its own |
| --- | --- | --- |
| Raw text chunks | Searchable words and their source spans | Which repeated date heading owns a nearby amount |
| Structured source cell | A supported row/column/unit relationship and exact original bindings | Natural-language retrieval quality or generated-answer support |
| Browser PDF.js snapshot | This parse owner's UTF-16 text and item geometry | Identical offsets in a Python/PyMuPDF extraction or authenticated full-report lineage |

The original eight-PDF audit and experimental chunk counts below are dated
development records, not the current corpus inventory or a deduplicated sum
across representations. Later installed corpus and report-scope work appears in
[the startup chapter](08-source-bound-startup.html).

<details>
<summary>October 11 corpus audit and exact-cell experiment</summary>

<p>The local corpus audit found eight original NVIDIA PDFs, 1,153 physical pages
and 4,126 experimental chunks. Existing suites overlap: 109 memberships across
15 JSONL files represent 104 unique question IDs, rather than 109 independent
cases. Four duration/metric questions now have portable source bindings to the
FY2025 Q2 income statement. Their replay verifies PDF bytes, extraction identity,
headers, row, date column, value spans and cell boxes. They remain assistant-reviewed
development candidates with <code>human_acceptance=false</code>. This validates source
binding; it measures neither retrieval nor generation accuracy.</p>
<p>The audit also found a concrete coverage gap: the existing structured quarterly
variant contains revenue and operating income, but no net-income fields. The raw
report contains net income. Adding another retrieval algorithm cannot recover a
field that a structured ingestion variant omitted. A separate bounded experiment
now derives the four Net income cells from the original physical page 3. It reads
the statement, row, three/six-month headings, dated columns, unit and value boxes
from PyMuPDF text and word geometry, without reading expected-answer labels.</p>
<p>The resulting cells contain 16,599 and 31,480 for the current-year three/six-month
columns, plus 6,188 and 8,232 for the corresponding prior-year columns. Every
named text binding replays against the declared page-text hash. Twenty-one tests
exercise missing or duplicate headers, ambiguous columns, displaced values,
source-hash changes and artifact tampering. An independent reviewer re-extracted
and deep-compared all four cells. Ten monitored original, corpus, package and
wheel files remained byte-identical. This supplies experimental field coverage;
it does not yet establish retrieval or generation improvement. The original text
baseline and earlier structured variant remain separate comparisons, and counts
across variants are not a deduplicated expanded corpus.</p>
<p>The sidecar records the source unit literally as “In millions, except per share
data” and the currency glyph as <code>$</code>. It leaves normalized currency unset. Its
code-point spans and PDF-point boxes belong to the pinned PyMuPDF extraction
profile. The browser uses PDF.js UTF-16 spans on a separately hashed two-page
excerpt; copying page numbers or offsets between them would break provenance.</p>
<p>The executed bounded comparison uses explicit metric, duration, end-date and unit
profiles, rather than guessing those fields from natural language. The frozen
raw baseline retains all four reviewed value spans and the requested words. It
does not bind a repeated date header to the correct amount merely because both
are present. The Net-income-only sidecar selects the two exact Net income cells
and correctly reports no exact cell for the two Revenue profiles. Nine synthetic
contract controls refuse missing fields, unsupported rows/periods/units and
duplicate or conflicting cells. Twenty-four additional tests and independent
actual-source replay pass. These are field coverage and selection contracts,
with zero model runs; they supply no financial false-accept rate or general
natural-language retrieval score.</p>

</details>

<figure class="architecture-figure" aria-label="Source-bound Net income cells and explicit field selection">
<div class="figure-heading"><span class="figure-status">EXECUTED LOCAL EXPERIMENT / ARTIFACT DIGEST AUDIT</span><h3>Bind the column before selecting the value</h3><p>The bounded Python experiment separates raw lexical coverage, source-cell geometry and exact metric/period/date/unit selection. The Net income sidecar explicitly leaves Revenue uncovered.</p></div>
<iframe src="figures/table-cell-selection.archify.html?theme=light" title="Archify sequence of source cells and explicit field selection" loading="lazy"></iframe>
<figcaption>Figure 3 · Original Archify illustration of the two executed Python increments. Its creation-stage audit bound local scripts and immutable receipts by SHA-256; the source was uncommitted at that delivery, so native Archify repository-source verification was unsupported. The experiment scripts are now published in <a href="https://github.com/1235357/nvidia-financial-rag/tree/082c208a120a54090a186f16b530fe45859e056f/acceptance">API source commit 082c208</a>. The separate browser PDF.js lookup is implemented below; these PyMuPDF cells are not fed into browser retrieval or generation. <a href="figures/table-cell-selection.archify.html?theme=light">Open full-size ↗</a> · <a href="figures/table-cell-selection.archify.json">Editable JSON</a>.</figcaption>
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

The browser comparator separately selected the current-year six-month literal
`31,480`, while the frozen six-month Qwen answer remained `16,599`. It did not
repair that model output: the two results have different owners and contracts.
The retained eight browser cases cover two statements and four duration/date
combinations. Unsupported Revenue and normalized-unit requests refused. All are
development cases, with no independent human financial acceptance.

Reloading identical PDF bytes can also change parser-owned internal font names
and therefore the complete snapshot digest. Replay must use the receipt's own
snapshot, rather than rewriting names to force two parses to match.

<details>
<summary>Eight exposed browser cell cases and fresh-owner replay</summary>

<p>Actual Codex browser execution selected all four duration/date combinations for
each of the two statements. The separately requested statements returned the
following literal amounts, with their distinct unit headings and source pages
retained in every receipt:</p>
<table>
<thead>
<tr>
<th>Duration</th>
<th>Exact period-end heading</th>
<th>Selected amount literal</th>
</tr>
</thead>
<tbody>
<tr>
<td>3 months</td>
<td>Jul 28, 2024</td>
<td>16,599</td>
</tr>
<tr>
<td>3 months</td>
<td>Jul 30, 2023</td>
<td>6,188</td>
</tr>
<tr>
<td>6 months</td>
<td>Jul 28, 2024</td>
<td>31,480</td>
</tr>
<tr>
<td>6 months</td>
<td>Jul 30, 2023</td>
<td>8,232</td>
</tr>
</tbody>
</table>
<p>These are eight exposed source-cell development cases, with financial correctness
unadjudicated. The six-month selection remains distinct from the frozen Qwen
output that answered <code>16,599</code>. Its original output and shape-only receipt remain
unchanged. Unsupported Revenue and normalized-unit requests refused; edits,
clearing, explicit retry, main-question edits and source replacement were read
back in the actual interface. Native hashing finished before a pending Cancel
state was observed. Delayed-digest cancellation and late A → retry B publication
are separately established by controlled DOM tests.</p>
<p>Reloading identical PDF bytes also demonstrated why ownership and capture identity
are separate. A fresh parse at epoch 7 retained exactly the same text, spans and
geometry, while all 345 internal font names changed from <code>g_d0_*</code> to <code>g_d4_*</code>.
The complete snapshot digest therefore changed from <code>dd0855…</code> to <code>44cbca…</code>.
Both complete records remain archived; each result replays from its own snapshot
and its own exact-byte digest. No font names were rewritten to force equality.
Independent replay checked 216 exact native item references across the initial
eight receipts and the fresh-owner result. This establishes source-bound
derivation and ownership behavior, rather than a held-out financial accuracy score.</p>

</details>

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

The six-month failure tells us what the next test must distinguish. A draft
`16,599` can have an existing E4 citation and valid JSON while selecting the
three-month amount for a six-month question. A citation-identity label asks
whether E4 exists and maps to the retained quote. A financial-support label asks
whether that quote establishes this metric, duration, date, amount and unit.
Neither label can substitute for the other.

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

**Predict before opening the feedback.** This new authored scenario starts
after retrieval and context assembly have completed. Generation A is active.
The reader cancels A, starts generation B without editing the question, and then
changes the question from three-month to six-month Net income before B finishes.
A late output arrives from each worker. Which artifacts can remain, may either
output become the new answer, and which actions are required before another
generation attempt?

<details>
<summary>Compare the cancellation and question-edit boundaries</summary>

<p>Cancelling A revokes its generation ownership but retains the accepted query and context, so an explicit B can reuse them. The later question edit calls <code>clearQuery</code>: source, chunks and passage embeddings remain, while the previous query vector, retrieval, context and generation ownership are discarded. Neither late output can commit. The new question needs retrieval and context assembly before another explicit generation. Reusing the PDF does not authorize reuse of an answer to a different question.</p>

<p>If you discarded the passage vectors, distinguish document work from question work. If you accepted B because it was newer than A, inspect whether B still owns the current question. These predictions follow the current session contract and controlled tests; they are authored practice, not a new GPU cancellation observation or evidence that a learner has mastered the topic.</p>

</details>

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

The private October 11 sequence first exposed a format problem, then a
financial one. Prompt versions v1–v3 produced truncated, non-JSON or incomplete
responses; the unchanged output gate refused all four format diagnostics. V4
passed structure and citation identity, yet both six-month questions reused the
three-month amount:

| Requested duration | Revenue candidate / decoded output | Net income candidate / decoded output |
| --- | --- | --- |
| Three months ended July 28, 2024 | `30,040` / `30,040` | `16,599` / `16,599` |
| Six months ended July 28, 2024 | `56,084` / `30,040` | `31,480` / `16,599` |

Candidates were assistant-reviewed, not independent gold. All four outputs passed
the actual shape/citation-identity inspection; that result did not validate the
chosen duration or an extra irrelevant citation. This exposed positive-only
diagnostic supplies no financial accuracy, false-accept or refusal-rate estimate.

It also showed why a native receipt and the original eight-field input must be
retained together. Replaying citation identity requires reconstructing the exact
context from that original input. Fresh paired archives supplied that boundary;
the older incomplete archives remain incomplete. An actual cancellation covered
asset preparation, not demonstrated cancellation during GPU execution. The full
prompt, token, timing, replica and release records remain below.

<details>
<summary>October 11 prompt versions, four-question runs and archive repair</summary>

<p>On October 11, the actual private browser lab ran a separately hashed two-page
financial excerpt, parsed as native physical pages 1/2 with PDF labels 3/4. The source produced
five chunks. The question asked for revenue for the three months ended July 28,
2024. The pinned Qwen2.5 0.5B q4 model, 2,048-token window, 128-token output reserve
and strict financial output gate remained fixed throughout these diagnostics.</p>
<table>
<thead>
<tr>
<th>Diagnostic</th>
<th>Selected evidence</th>
<th>Prompt / generated tokens</th>
<th>Native elapsed</th>
<th>Observed output and disposition</th>
</tr>
</thead>
<tbody>
<tr>
<td>Prompt v1</td>
<td>Top K 3</td>
<td>1,551 / 128</td>
<td>49.750 s</td>
<td>Fenced, truncated evidence-metadata echo; length termination refused</td>
</tr>
<tr>
<td>Prompt v2, concrete schema example</td>
<td>Same complete user JSON</td>
<td>1,664 / 5</td>
<td>38.928 s</td>
<td><code>brief answer from evidence</code>; EOS, invalid JSON refused</td>
</tr>
<tr>
<td>Prompt v3, concise schema instructions</td>
<td>Same complete user JSON</td>
<td>1,627 / 27</td>
<td>37.738 s</td>
<td>Plain revenue sentence naming $30,040 million; EOS, invalid JSON refused</td>
</tr>
<tr>
<td>Prompt v3, explicit Top K 1 comparison</td>
<td>One selected complete evidence unit</td>
<td>794 / 11</td>
<td>29.730 s</td>
<td><code>{"answer":"30,040"}</code>; EOS, missing schema fields refused</td>
</tr>
<tr>
<td>Prompt v4, task framing outside the data</td>
<td>Original Top K 3; unchanged complete data JSON</td>
<td>1,726 / 37</td>
<td>40.281 s</td>
<td>Three-key JSON with answer <code>30,040</code>, citations E1/E4 and <code>insufficient_evidence=false</code>; EOS, shape and citation identity accepted</td>
</tr>
</tbody>
</table>
<p>These are individual wall-clock samples, not a latency distribution. Complete
native receipts retain the exact prompts, input/output token IDs, raw decoded
text, cache/SDK-read records, stage boundaries and cleanup. Each attempt disposed
its inputs, result and model, closed its cache and destroyed its owned device.
The v1, v2 and v3 top-three runs preserve byte-identical user data JSON. The
v3 Top K 1 row explicitly changes the selected evidence and is a separate
complexity diagnostic. v4 returns to Top K 3 and wraps that complete data JSON
in versioned task instructions; its full user message consequently differs.</p>
<p>The small model can produce a plausible amount while failing to provide the
required structure and citation. A strict gate refused the first four diagnostics.
We did not strip fences, insert missing fields, repair output or label
the plain sentence a verified answer. The example in v2 became the entire output;
removing it improved the observed content but still failed the contract. The
bounded v4 experiment places explicit response instructions around the complete
untrusted input data, with a new prompt version and an independently checked token
budget. It passed the unchanged format and citation-identity gate. Actual citation
navigation selected retained native physical pages 1/2 with PDF labels 3/4 without changing the raw
receipt or launching another model call.</p>
<p>That accepted shape exposed the next quality problem. The answer contains only
the amount; it omits an explicit metric, period and unit. E1 includes the revenue
row and headers supporting the amount, while E4 is a comprehensive-income chunk
that does not support the revenue claim. A valid existing citation can therefore
be irrelevant. Format acceptance must not silently become citation-support or
financial correctness acceptance. Four previously frozen development questions
were then run under the same v4 prompt, Top K 3, model and budgets, with no tuning
between cases:</p>
<table>
<thead>
<tr>
<th>Requested field, all ending July 28, 2024</th>
<th>Assistant-reviewed candidate amount (source unit: millions; literal currency glyph: $)</th>
<th>Actual decoded answer</th>
<th>Native elapsed</th>
<th>Development observation</th>
</tr>
</thead>
<tbody>
<tr>
<td>Revenue, three months</td>
<td>30,040</td>
<td><code>30,040</code></td>
<td>35.444 s</td>
<td>Numeric value agrees; E4 remains an irrelevant extra revenue citation</td>
</tr>
<tr>
<td>Revenue, six months</td>
<td>56,084</td>
<td><code>30,040</code></td>
<td>34.868 s</td>
<td>Wrong duration column, despite valid JSON and existing citation IDs</td>
</tr>
<tr>
<td>Net income, three months</td>
<td>16,599</td>
<td><code>16,599</code></td>
<td>34.517 s</td>
<td>Numeric value agrees; E4 contains the Net income row on native physical page 2 (PDF label 4)</td>
</tr>
<tr>
<td>Net income, six months</td>
<td>31,480</td>
<td><code>16,599</code></td>
<td>32.807 s</td>
<td>Wrong duration column, despite valid JSON and existing citation IDs</td>
</tr>
</tbody>
</table>
<p>All four emitted EOS and passed the actual session's shape/citation identity
inspection. Two numeric outputs agree with the assistant-reviewed candidate
values; both six-month questions reused three-month values. This is an exposed
four-positive development diagnostic, not an independent accuracy estimate.
There are no negative cases here, so it provides no false-accept or refusal-rate
denominator. The amount-only answers also omit explicit metric, duration and unit.
An alternate supporting page must be reviewed on its contents rather than marked
wrong merely because the original candidate listed page 3.</p>
<p>The diagnostic also exposed an archive design gap. The complete native receipt
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
replay; a new attempt's input is not retroactively attached to an earlier attempt.</p>
<p>All four fresh replicas retain the same question, complete model input, prompt
and token budget as their corresponding earlier cases. They returned the same
amounts, again exposing both six-month errors. Their individual native wall-clock
times were 39.542, 37.709, 35.138 and 36.301 seconds in table order. These values
are development observations, not independent repeats for a latency percentile.</p>
<p>An actual cancellation during asset preparation revoked output ownership and
retained the accepted query/context. An explicit retry in the same mounted
session then completed and supplied the first full replayable pair. Cancellation
showed no original-input disclosure; editing or clearing the question removed
the previous RAW/input details, and clearing the source removed the retained
index and disabled the subsequent actions. This does not prove cancellation
during GPU execution. The local server acceptance also exposed real
integration defects in shared-file inventory and exact encoder routing; those
were repaired before these model runs. Contract tests and a diagram alone had
not exposed them.</p>
<p>The site and reviewed browser profile are published on
<a href="https://1235357.github.io/07-operational-receipts.html">GitHub Pages</a>. Deployment
<code>7c7a2c39375c29bdef3675d88a4e9a8aa8b610a7</code> passed all three jobs in
<a href="https://github.com/1235357/1235357.github.io/actions/runs/38173108409">workflow 38173108409</a>. Its
<a href="https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/public-hf-wasm-pdf-ci.json">independently inspected manifest</a>
records 311 files / 918,499,608 bytes / 16 pins and exact agreement for all
20 authored public modules. Previous <code>368ba196</code>, <code>e497b2f</code> and <code>5a673bc</code>
inventories remain separate dated records. Their earlier module-equality
statement does not cover the changed loaders. The public lab composes the
generator and source-cell comparator explicitly; private probes and complete
acceptance archives are outside the deployed tree. Public Qwen execution remains
a separate gate from local native receipts and successful deployment.</p>

</details>

## What the HTTPS release exposed

Moving the same workflow to HTTPS exposed two different boundaries. First,
the host served a 364-byte compressed representation of a 650-byte pinned config.
Fetch returned the decoded body; comparing a wire-length header to its decoded
pin wrongly refused a correct file. The repair kept decoded length and SHA
verification and treated supported wire encoding separately.

Next, two embedding attempts exhausted their 120-second whole-operation budget
before committing vectors. Static preparation became an explicit operation with
its own fixed 30-minute deadline, verified-file progress and cancellation. That
separation lets a reader prepare files without sending a PDF or question to the
preparation worker; it does not declare a model loaded.

Early encoder evidence included a DOM-only metadata view, which was not a
complete passage terminal archive. A later generator preparation ended with
`ASSET_PREPARATION_TIMEOUT` and no complete receipt. Neither a source-cell
candidate nor a successful cache preparation could fill those evidence gaps.
The notebook's sticky-panel overlap was also repaired; the current site uses
the shared light theme. Detailed successes, failures and historical UI checks
remain together below; the later completed public run has its own section.

<details>
<summary>Early HTTPS attempts: body encoding, preparation, metadata and timeouts</summary>

<p>The first public reader path accepted the two-page excerpt and five chunks. Its
explicit Comprehensive Income / Net income / six months / July 28, 2024 lookup
returned source literal <code>31,480</code>, with 24 selected-role and complete-column item
references independently replayed against its own frozen snapshot. The result
remains a source-cell candidate with financial correctness unadjudicated.</p>
<p>The first model preparation then refused a correct config body. GitHub Pages
sent a 364-byte gzip representation of the 650-byte pinned MiniLM config. Fetch
decoded the body but retained the wire <code>Content-Length</code>; our reader had compared
that header to the decoded pin. The repaired reader distinguishes supported wire
encoding metadata from decoded-body identity and keeps the exact decoded length,
SHA, size limit and cancellation checks. Real gzip, Brotli, deflate and chained
encoding regressions passed. On the next deployed version the 650-byte config
passed, exposing the next operational limit.</p>
<p>Two public embedding attempts reached the download stage and exceeded the
120-second whole-operation deadline before new vectors committed. Independent
local reads of the public tokenizer returned HTTP 200 and the exact decoded pin,
but took approximately 116 seconds without compression and 77 seconds with gzip.
Those reads do not locate the delay in Pages, the CDN or the local network path,
and a verified-byte total does not reveal how many unverified stream bytes were
already received by the browser.</p>
<p>The subsequent implementation gives static-file preparation its own explicit
worker and receipt. The reader starts the encoder or generator download, sees
verified decoded-body progress, and can cancel. Preparation receives no PDF,
question or context and invokes neither the SDK nor a GPU. Its fixed 30-minute
deadline includes worker readiness and is never renewed by progress. A complete
receipt means the eight exact pinned bodies were verified and written to cache;
it does not mean the model loaded or inference succeeded. Completed entries may
survive cancellation, and the browser may later evict them. Every model action
still verifies its cache bodies, with the original 120-second encoder/query and
300-second generation limits. Asset bytes are distinct from browser heap, GPU
allocation and live KV state.</p>
<p>The preparation increment passed the clean Linux/Windows contracts and deployed
at runtime commit <code>5a673bc</code>. Actual public cancellation removed the pending
preparation result and re-enabled an explicit retry. Encoder preparation later
completed all eight pinned bodies: 113,629,084 verified bytes in 1,176,598.5 ms.
The archived <code>static-assets-prepared-not-loaded</code> result records 113,628,434
verified decoded body bytes sourced from fetch and 650 from CacheStorage. Those
are body-source counts, not measured wire traffic or a wholly uncached transfer.
An independent offline replay passed its exact receipt/profile/pin metadata.
That replay did not independently rehash browser bodies, and the preparation
receipt itself loaded no model.</p>
<p>The next public native path parsed the two-page excerpt and built five chunks,
retaining 2,426 UTF-16 units and 687 mapping fragments. Explicit passage encoding
and query encoding then reported the same WebGPU/FP32 representation. Their
individual observations were:</p>
<table>
<thead>
<tr>
<th>Operation</th>
<th>Token count</th>
<th>Vector dimensions</th>
<th>Reported attempt elapsed</th>
<th>Saved evidence scope</th>
</tr>
</thead>
<tbody>
<tr>
<td>Passage encoding</td>
<td>644</td>
<td>384</td>
<td>3,851.2 ms</td>
<td>Visible DOM metadata; no complete passage terminal archive in that file</td>
</tr>
<tr>
<td>Query encoding</td>
<td>39</td>
<td>384</td>
<td>1,300.2 ms</td>
<td>Current query terminal with query/retrieval receipt summary</td>
</tr>
</tbody>
</table>
<p>Both operations reported 113,629,084 verified CacheStorage body bytes and zero
fetched asset-body bytes. Top K 3 returned three candidates in the order E4, E1
and E2; context assembled three complete evidence units with no omissions.
The saved public encoder view is explicitly DOM metadata. The separate query
terminal is 1,199 bytes; it does not supply a missing complete passage terminal.
These records establish the observed preparation/encoding/retrieval/context
boundary, rather than a latency distribution, speedup, isolated GPU timing or
proof that every operation ran on the GPU. Ranked candidates and complete context
still require source review before a financial answer can be accepted.</p>
<p>The desktop read-back also exposed a presentation failure. The sticky answer
panel extended across the later full-width notebook row and intercepted a query
token disclosure. A native DOM hit test landed inside the answer panel at the
disclosure's center. The bounded stylesheet correction lets the answer scroll
with its question row. In the local native browser, a parser-item disclosure then
opened and its center hit the source panel; the answer ended above the notebook.
At that historical checkpoint, the question/answer columns, dark theme and
computation data remained unchanged. The current site uses the unified light
theme across the profile, lab, journal and figures.
The <a href="https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/public-css-readback.json">published stylesheet read-back</a>
received the exact 17,952-byte CI body and observed computed <code>position: static</code>.
This confirms delivery and that CSS property. A later current-session public
read-back opened the complete geometry disclosure and all five source-span
disclosures. Query-token inspection still requires an accepted current query.</p>
<p>The embedded public generator preparation subsequently ended with
<a href="https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/public-generator-preparation-timeout.json"><code>ASSET_PREPARATION_TIMEOUT</code></a>
at its fixed 30-minute budget. Previously completed verified cache entries may
remain, but no complete preparation receipt was committed. This attempt supplies
no public generator loading or financial output evidence. Generator preparation
completion and actual public Qwen generation remained open at that historical checkpoint; no alternative download
transport has native acceptance in these records.
Independent financial gold, calibrated judging and load measurements remain
open. The earlier wrong six-month outputs and zero independent human gold are
preserved alongside this new public encoder evidence.</p>

</details>

## Prepare exact bytes before runtime initialization

The loader has to bind a file it verifies to the file its runtime consumes.
Preparation can use the site or an explicitly selected, pinned Hugging Face
transport. Five model/tokenizer files have immutable external mappings; runtime
files and SDK imports stay on the site. Logical cache keys, lengths and hashes
remain fixed, with no automatic transport fallback.

The verified WASM body is handed to the runtime as an owned 21,596,019-byte
ArrayBuffer. That extra object has a lifetime and memory cost; it is not a
zero-copy or performance claim. The public PDF worker preflight separately
verifies 2,229,713 decoded script bytes under a 120-second static budget, before
the extractor's unchanged 10-second native readiness limit. Script verification
does not prove executable readiness or which later HTTP-cache response a Worker
will use.

At this checkpoint, a public query ended with `QUERY_TIMEOUT` while preserving
its accepted passage vectors, and two explicit HF preparations refused without
complete receipts. A separate localhost Qwen run produced a replayable unverified
`16,599` draft. That localhost result did not turn the failed public attempts into
successes. The later completed HTTPS attempt is recorded separately below.

<details>
<summary>7c7a2c3 transport, WASM handoff, PDF preflight and separate localhost run</summary>

<p>The increment deployed at <code>7c7a2c3</code> keeps the default site transport and adds an explicit
Hugging Face option to preparation v2. Exactly five model/tokenizer files map to
immutable full-commit URLs; the registry, three inference runtime files and SDK
imports stay on the site. Logical cache keys, byte/SHA pins, model revisions and
remote-model SDK restrictions stay fixed, with no automatic fallback. The
<a href="https://huggingface.co/docs/huggingface_hub/v2.2.0/en/package_reference/file_download#huggingface_hub.hf_hub_url">official file-download reference</a>
supports revision-specific URLs, while the
<a href="https://huggingface.co/blog/migrating-the-hub-to-xet">Xet migration description</a>
explains bridge delivery. The implementation's final-origin/path policy is
deliberately narrow; it does not establish an exhaustive host list or verified
redirect chain. V2 receipts distinguish logical cache keys from bounded external
response observations and omit signed query text. Historical v1 receipts remain
read-only evidence. Those historical HF attempts did not establish native CORS,
accepted final routes or throughput. The later dad0b72 observation below retains
its separate physical-response refusal.</p>
<p>The pinned ONNX Runtime factory supports a <code>wasmBinary</code> input, as shown in its
<a href="https://github.com/microsoft/onnxruntime/blob/89f8206ba4/js/web/lib/wasm/wasm-factory.ts">corresponding source</a>.
The local encoder and generator now pass the verified runtime body through that
input before model initialization. This adds an owned 21,596,019-byte ArrayBuffer,
about 21.6 decimal MB, which can remain in the worker/library realm until teardown.
It is not zero-copy, a peak-memory measurement or a demonstrated speedup. SDK/MJS
imports retain their same-origin paths; inference clocks remain 120 seconds for
passages, 120 for queries and 300 for generation. Controlled handoff and cleanup
tests verify the source contract, without proving that this change resolves the
earlier public initialization refusal.</p>
<p>The public mount also has an optional preflight for the fixed PDF.js 6.4.299 worker
script: consume and verify 2,229,713 decoded bytes and its pinned SHA at EOF within
a separate 120-second static budget, then invoke the unchanged extractor and its
10-second native readiness limit. This phase receives owned signal/progress
metadata, never the selected file or question. Received script bytes, verified
static bytes and executable readiness are different states. Ordinary HTTP cache
reuse is advisory: the later Worker may revalidate, fetch again or still refuse
readiness, and the static receipt does not prove which bytes it executes. No Blob
or substitute Worker is introduced; ordinary/private entries omit this hook.
The locally implemented increment passed bounded source reviews and focused
controls, followed by 2,827/2,827 Node and 155/155 Python local passes. The
<a href="https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/local-hf-wasm-pdf-combined-checks.json">prior local public build</a>
recorded 311 files / 918,503,041 bytes / 16 pins; prose changes require a refreshed
inventory. Historical 7c7a2c3 CI/deployment subsequently passed in Actions38173108409.
That public entry completed static script verification, selected-PDF
parsing and five source-linked chunks. Its complete geometry and five separately
disclosed chunk records were archived before the next action. The subsequent
MiniLM attempt committed 644 token IDs / 384 dimensions, with a complete terminal
summary and 92,214.1 ms reported elapsed. It reverified 113,629,084 cache-body
bytes and fetched no model-asset bodies; this does not establish zero network
traffic. The next query refused with <code>QUERY_TIMEOUT</code>, retaining those passage
vectors. Two explicit HF preparation attempts also refused without complete
receipts. These failures do not identify CORS, CDN behavior or a loader cause.</p>
<p>The same source and 7c7a2c3 code completed a separate localhost chain. After
actual passage/query encoding and three complete context units, Qwen finished
1,745 prompt token IDs / 33 generated token IDs / EOS in 48,873.8 ms. Its complete
<a href="https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/local-current-loader-native-raw.json">RAW receipt</a>
and actual
<a href="https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/local-current-loader-original8.json">eight-field input</a>
passed independent pure source/chunk/context/native-output replay. The output
gate accepted <code>16,599</code> / E4 as an unverified draft. A separately requested
three-month source-cell candidate also retained literal <code>16,599</code>; agreement on
this exposed example is not an independent accuracy score. At that checkpoint public generator completion was open. Financial evaluation and human acceptance remain open. Earlier
successes and failures retain their original scope.</p>

</details>

## Make a failure boundary inspectable

The next diagnostic increment keeps every readiness and inference clock. A
client-side readiness timeout says the expected fresh Worker announcement was
not accepted; a work timeout says its separate work timer won after readiness.
Neither identifies a network cause. A native Worker error and a validated worker
error packet are different observations. The latter can carry a finite loader
or initializer phase; a client cannot infer that phase from a progress label or
missing response. Query failure records remain client-only.

The inspectable record captures the current identity, ready/command flags, last
accepted sequence and nullable elapsed observation. It excludes raw exception
messages, signed URLs, PDF text, questions, context and model data. A session
retains it beside the committed terminal, rather than altering the existing
code/message lifecycle error. Opening its lazy disclosure after an edit, retry,
Clear or replacement cannot recover stale authority.

A later diagnostic captured an HF response with HTTP 200/CORS, followed by a
local origin/path policy refusal during `asset-fetch`. The body had not earned a
complete verification receipt. This was a concrete observed boundary, unlike a
generic timeout: the correction admitted that exact observed HTTPS CDN origin
under the existing narrow path grammar, retaining full body pins.

The successful retry below does not establish the causes of older failures.
Another PDF script preparation also exceeded its separate 120-second static
budget. These records locate the next engineering action; they are not network
diagnoses, financial scores or latency distributions.

<details>
<summary>dad0b72 diagnostics and the observed CDN policy refusal</summary>

<p>The active preparation
channel advances to version 3 around the unchanged schema-2 successful receipt;
passage packets require <code>embedding-v2</code>, while the query worker grammar stays
unchanged. Local full checks passed 2,879/2,879 Node and 155/155 Python. These
checks establish controlled boundary behavior. The diagnostic release
<code>dad0b72</code> then passed Windows, Linux build and Pages deploy in
<a href="https://github.com/1235357/1235357.github.io/actions/runs/38180951673">workflow 38180951673</a>.
Forty completed parent-page module bodies in the actual Codex browser match its
CI manifest. That served-source identity is distinct from Worker or model execution.</p>
<p>The next explicit HF generator preparation supplied the missing boundary:
Ready and command accepted, terminal sequence 10, <code>asset-fetch</code> at asset index 4,
11,744.1 ms elapsed. Its separate physical-response observation retained HTTP
200/CORS from <code>us.aws.cdn.hf.co</code>, followed by a policy refusal. The model body
had not earned a complete verification receipt. The
<a href="https://huggingface.co/docs/hub/datasets-downloading">official download guide</a>
and <a href="https://huggingface.co/.well-known/meta.json">provider domain list</a> identify
that hostname as a current CDN endpoint; the native observation supplies this
particular Xet bridge path. The correction adds only that exact HTTPS origin
under the existing anchored path grammar, preserving full decoded-body length
and SHA pins. The failing test first reproduced the refusal; 62 focused controls
then passed, followed by 2,892 Node and 155 Python checks. The correction subsequently passed d75 CI and the fresh public native chain recorded below.</p>
<p>This record does not explain older failures. The same current public session
also exceeded the separate 120-second PDF script preparation budget before
starting its native parser. Neither observation supplies an answer-quality
score or a performance distribution. They give the next engineering action a
specific owner, stage and preserved refusal.</p>

</details>

## A public model run with its evidence preserved

The next served release, `d75cc26`, passed all three jobs in [workflow 38184423254](https://github.com/1235357/1235357.github.io/actions/runs/38184423254). It adds the exact observed HF US CDN origin, retaining the fixed path grammar and body pins. A fresh browser session then asked: “According to NVIDIA's fiscal 2025 second-quarter report, what was net income for the three-month period ended July 28, 2024, in millions of dollars?” The model's JSON draft answered `16,599`, citing E4. The interface kept it **UNVERIFIED**. A number and valid citation are the start of financial evaluation, rather than a correctness certificate.

The reader path now has a complete operation record. Static preparation reverified eight cached bodies totaling 815,725,938 bytes, without fetching asset bodies. The selected two-page excerpt parsed with PDF labels 3/4 and became five chunks, retaining all source spans. Passage encoding produced 644 token IDs and five 384-dimensional vectors. The query produced 39 token IDs and a vector of the same dimension; canonical cosine ranking selected E4/E1/E2. Three complete evidence units became the prompt context. Qwen's explicit retry consumed 1,745 input IDs and produced 33 output IDs, reached EOS, and disposed its inputs, result, model, cache and owned device. Its 88,347.8 ms elapsed value describes this single attempt.

Why retain all that detail when the interface can just display a number? Each transformation can introduce a different error. The wrong source page is a retrieval problem; a lost column heading is a context problem; a malformed JSON response is an output-contract problem. Binding the exact PDF bytes, text geometry, chunk ranges, vector rows, question, context and output lets another developer inspect which input actually reached the model. It also keeps a later replay from silently substituting a different question or source. The [complete RAW receipt](https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/public-d75-native-raw.json) and [original eight-field input](https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/public-d75-original8.json) passed [28 independent archive-consistency and canonical-replay checks](https://github.com/1235357/1235357.github.io/blob/main/docs/acceptance-2026-10-11/public-d75-independent-archive-audit.md).

The retry did not erase the first generation timeout. Its specific timer branch remains unknown, and the earlier partial preparation has no complete terminal. Both records remain separate. The successful preparation describes cache verification, and the six sealed SDK reads describe local consumption, not six network downloads. Likewise, archive consistency does not authenticate full-report lineage, judge financial column meaning or establish human gold. The next evaluation step must compare the draft against independently reviewed report evidence and include refusals and misleading nearby periods. Expanding the Python corpus and checking installed-package retrieval are separate engineering gates underway in the companion project.
