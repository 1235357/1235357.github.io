---
title: "One financial question, two software lifecycles"
aliases: [RAG lifecycles and source inspection]
category: technical-article
domain: financial-rag
status: draft
created: 2026-10-07
updated: 2026-10-11
source_type: implementation-and-primary-documentation
metadata_version: 1
tags: [nu-mscs, type/article, domain/financial-rag, architecture, learning]
---

# One financial question, two software lifecycles

**Question.** What was NVIDIA's annual revenue in FY2025?

**Current answer status — Python baseline.** Generation is **OFF**. This path
returns candidate evidence, not a generated revenue answer. The retained passage
still needs a primary-PDF check of fiscal period, metric, column, amount and unit.
Displaying a retrieval score is not answering the question.

**Diagnostic status — 2026-10-04.** A separate cached Qwen2.5-0.5B-Instruct CPU
generation attempt omitted its document/page citation. Its citation-format gate
returned **REFUSE**, with **no answer released**. This is a dated failure, not a
current browser-model result; [inspect the failure and its limits](#a-real-failure-at-the-generation-boundary).

With the question and output status visible, inspect how that outcome is built.
The interactive Archify figure below describes the inspected current path, with
editable [JSON](figures/two-lifecycles.archify.json), [draw.io](figures/two-lifecycles.drawio)
and [PlantUML](figures/two-lifecycles.puml) sources. The companion external renderers
have not been accepted. A second figure separates the approved browser-native
design from implemented capability.

## The problem is not simply calling a language model

A financial question has at least four identities: the company, fiscal period,
metric and reporting unit. A passage about revenue can be linguistically similar
to a question and still contain the wrong year's revenue. The first design goal
of this project is therefore inspectable evidence retrieval, not an unrestricted
chatbot. Default generation is disabled. This article explains the current local
implementation, not a production deployment or a claim of personal mastery.

**Current execution boundary:** the browser is a client. The classroom demo runs
Python and its cached query encoder on the developer's Windows host; it is not
an in-browser deployment on a reader's own computer. The browser-native variant
has its own implemented retrieval slice and separate acceptance requirements.
The source inspector embedded below now parses selected bytes and explicitly
builds source-linked chunks in a native computation worker. An explicit next
action now runs a pinned MiniLM encoder with WebGPU. It is not the classroom
retrieval demo: it now encodes an explicit question and ranks retained MiniLM
passages in a fresh browser worker. After ranking, an explicit action assembles
the complete selected provenance context. Actual financial generation remains
disabled; the complete RAG product still requires its remaining acceptance gates.

## Offline work creates a reusable representation

Ingestion extracts PDF text, preserves document and one-based page identity,
and divides text into chunks. Encoding maps each chunk to a fixed-dimensional
vector. The vector is not the original document: extraction can lose table
relationships and chunk boundaries can separate facts. Consequently the index
must retain a route back to the original PDF, rather than discard provenance.

The baseline uses 384-dimensional BGE vectors and exact cosine ranking.
Given query vector q and passage vector p, similarity is
`(q · p) / (||q|| ||p||)`. This measures geometric proximity, not entailment.
Normalized vectors make the denominator one, but do not make a wrong-year
passage correct. Model revision, encoding convention, source bytes and chunk
order are compatibility inputs: an old vector array cannot safely be attached
to arbitrarily changed text merely because its shape still fits.

## Initialization is not an online request stage

<figure class="architecture-figure" id="current-architecture" aria-label="Current Python-hosted retrieval architecture">
<div class="figure-heading"><span class="figure-status">01 / CURRENT IMPLEMENTATION</span><h3>Build once. Inspect each request.</h3><p>Offline: chunks → passage encoder → index. Online: query encoding → ranking → evidence/context. The reusable index also feeds ranking.</p></div>
<iframe src="figures/two-lifecycles.archify.html?theme=dark" title="Interactive current retrieval architecture — generation is off" loading="lazy"></iframe>
<figcaption>Figure 1 · Interactive Archify view, not a RAG runtime. Click a node for authored inputs/outputs; zoom for detail. <a href="figures/two-lifecycles.archify.html?theme=dark">Open full-size ↗</a> · <a href="figures/two-lifecycles.archify.json">Editable JSON</a>. Boxes are responsibilities, not deployed microservices; default generation remains OFF.</figcaption>
</figure>

`build_bge_service` is the composition point. It receives the chunks, encoder,
optional precomputed passage vectors and policy settings, constructs a retriever
and injects it into `EvidenceService`. Cached passage vectors avoid repeated
passage encoding at construction. Requests still encode their incoming query;
they do not repeat PDF extraction or rebuild the corpus.

This distinction matters for latency accounting. Cold model loading belongs to
startup, offline embedding cost belongs to ingestion, and query encoding plus
ranking belongs to request processing. Adding these indiscriminately produces
a number that cannot answer either deployment or user-experience questions.
No cold/warm or concurrent-performance result is asserted here.

### Why a matching shape can still represent the wrong index

Suppose the cached matrix has N rows and 384 columns. A dimension check proves
only that a dot product can be computed. If two chunk records are swapped without
swapping vector rows, the system can return the text of B while scoring the vector
of A. The computation succeeds but its citation is misleading. A useful artifact
contract therefore binds source hashes, chunking configuration, ordered chunk
identities, model revision and encoding convention to the vector artifact. This
is a design requirement; this paragraph does not claim every check is enforced
by every loader. Audit the actual manifest and loader before changing artifacts.

For exact ranking with N passage vectors of dimension d, a single matrix-vector
comparison performs work proportional to N × d. Storing float32 vectors alone
costs about 4 × N × d bytes, excluding records and model weights. For the displayed
2,399 × 384 baseline, that is 3,684,864 bytes of vector values, not the process's
total RAM or GPU memory. An ANN index trades exact search for its own quality,
memory and tuning costs; the current default is not an ANN implementation.

## The actual request contract

### Three different strings must not be called the same query

In the mentor review, I could not clearly explain which question was actually
used for retrieval. The correction is to inspect three separate values:

1. **Original input:** what the user typed.
2. **Resolved question:** an explicit standalone question after any supported
   follow-up resolution.
3. **Encoder input:** the resolved question formatted with the embedding model's
   query instruction. An instruction prefix is not evidence of an LLM rewrite.

The current `conversation.py` uses bounded rules, not an LLM query optimizer.
After `What was NVIDIA's annual revenue in FY2025?`, it can resolve
`And FY2024?` into `What was NVIDIA's annual revenue in FY2024?`.
It rejects recognized ambiguous references such as `The previous year?`.
It does not derive a missing metric or fiscal year from a retrieved passage,
does not detect every conversational reference, and does not turn the stateless
API into a stateful agent. Session-state management belongs to its caller.

For teaching, predict the resolved question before running the demo. Then compare
the original input, resolved question and actual encoder input. A discrepancy
here is a routing/representation failure; tuning the similarity threshold cannot
repair a question that was sent to retrieval with the wrong meaning.

### A five-case rehearsal: explain before executing

Use the previous resolved question `What was NVIDIA's annual revenue in FY2025?`
unless the row specifies otherwise. The following outcomes are derived from
the inspected `resolve_demo_query` rules, not from language-model reasoning.

| Current input | Resolution | Reason |
| --- | --- | --- |
| `And FY2024?` | Annual revenue question for FY2024 | Explicit supported year plus exact revenue antecedent |
| `The previous year?` | Clarification error | Relative-year inference is deliberately unsupported |
| `What about FY2027?` | Clarification error | Target is outside the default FY2022–FY2026 range |
| `What was NVIDIA's net income in FY2024?` | Unchanged standalone question | The resolver does not replace an explicitly supplied metric |
| `And FY2024?`, with empty previous question | Clarification error | No supported antecedent from which to preserve the metric |

The antecedent and supported follow-up expressions use case-insensitive
`fullmatch`: punctuation and the complete sentence pattern matter. This is
intentionally narrow, but unfamiliar references can still pass through unchanged;
the function is not a general ambiguity detector. The caller must supply the
previous *resolved question*, not a retrieved passage or generated answer.

`runtime.py` defines the query instruction as
`Represent this sentence for searching relevant passages: `.
That prefix describes the embedding task. It neither supplies financial evidence
nor demonstrates that a generative model rewrote the user's intent. For a
supported follow-up, explain the transformation as original input → resolved
standalone question → instructed encoder input, keeping all three inspectable.

Local regression command: `python -m pytest tests/test_conversation.py -q`.
The October 4 run passed 17 parameterized cases. Those cases cover the resolver's
bounded contract, not retrieval quality, conversation completeness or an answer's
financial truth. Your exercise is to predict all five rows, run the resolver, and
explain one rejected and one unchanged input in English without reading the table.

The service follows this sequence, directly visible in `service.py`:

```text
strip and validate question
  → retriever.retrieve(question, top_k)
  → select_evidence(candidates, threshold, top_k)
  → build_grounded_context(question, evidence)
```

Blank and oversized questions fail before retrieval. The retriever chooses
candidates; the evidence policy chooses retained context; the context builder
formats evidence. A similarity threshold is not a financial fact checker.
For a retained passage, a person still checks period, metric, column, amount and
unit in the primary PDF. Empty evidence and an unavailable retrieval service
are also different outcomes, even though neither should invent an answer.

## A real failure at the generation boundary

In a local diagnostic run on 2026-10-04, the same FY2025 revenue question passed
the similarity gate and reached a cached Qwen2.5-0.5B-Instruct model on CPU.
The model produced a revenue figure but omitted a document/page citation. The
application reported **Citation-format gate: REFUSE** and released no answer.
CUDA was used for query encoding; this was not an all-GPU generation benchmark.

| Stage | Observed outcome | What it does not prove |
| --- | --- | --- |
| Retrieval | Similarity gate passed | Correct period, column or financial fact |
| Generation | Raw text was produced | A source-grounded, correct answer |
| Citation check | Missing citation caused rejection | Detection of every hallucination |
| User-facing output | No generated answer released | Production reliability or independent acceptance |

This distinction matters: a functioning model call is not a successful product
answer. Do not weaken the citation check merely to make a demonstration green.
Before changing the prompt, inspect the exact prompt and raw output, identify
the missing requirement, and compare changes on a fixed development set. Keep
an independent acceptance set separate from questions exposed during tuning.

Learning exercise: explain why adding a syntactically correct citation could
still leave a wrong amount or fiscal year. Then open the cited primary PDF and
check period, row, column, amount and unit. A citation-format check cannot replace
that reasoning. The observed number is deliberately not presented here as a
verified financial answer.

## Connecting software design to this project

The project's connection to CS381 is a design question, not a claim that this
RAG implementation was assigned in class: which responsibility changes when the
retriever changes? The injected `Retriever` protocol lets the application service
consume ranked chunks without owning encoder construction. This makes controlled
tests possible and reduces the changes required to compare retrieval strategies.
It does not remove their quality differences or establish that every retriever
supports the richer inspection interface used by the demo.

The CS310 connection is equally concrete: a module boundary is not automatically
a network boundary. Splitting retrieval into another service introduces transport
latency, failure, authentication and deployment costs. Keep the current topology
explicit and split only when a measured isolation or scale requirement justifies
those costs. Multiple boxes in a diagram do not prove microservices exist.

These are independent applications of course concepts. The inspected CS381
grounded-lookup and CS310 service-boundary exercises are assistant-created
practice scaffolds, not graded course submissions or professor-provided RAG code.
The later [course-source review](07-operational-receipts.html#turn-coursework-into-an-explanation-and-a-drill)
ties these exercises to inspected course pages without reproducing private slides.

## Bind the offline artifact to the online reader

A matrix with the expected dimensions can still belong to the wrong corpus.
The installed package's `load_passage_embedding_artifact` therefore checks more
than shape: schema version, normalization declaration, model name and revision,
chunk count, ordered chunk-ID hash, chunk-file hash and vector-file hash. It then
loads NumPy data without pickle and checks finite values, nonzero unit-norm rows,
shape and dtype against the manifest. These checks establish artifact consistency,
not whether the underlying passage or answer is correct.

The staging repository now provides a read-only reproduction command:

```powershell
.\.venv-acceptance\Scripts\python.exe -I acceptance\index_integrity.py --artifact-dir <your-reviewed-artifact-directory>
```

On October 4 it read the existing annual-report artifact without copying or
rewriting it: 2,399 chunks and a `(2399, 384)` float32 matrix passed the installed
loader's checks, including the pinned BGE model revision. No encoder was loaded,
no query was run and no original PDF claim was verified by this command. An
integrity manifest is a consistency boundary, not a signature from a trusted
publisher; an attacker replacing both data and manifest is outside this check.

Why does order matter? Row `i` is interpreted as the embedding of chunk `i`.
Reordering chunks without reordering vectors can return a plausible score beside
the wrong passage. Why does revision matter? Equal dimensions do not prove that
two model versions share a compatible representation space. The loader checks
declared identity; it does not independently inspect a live model's weights.

Before running, predict which check should reject a reordered chunk file, a
different model revision and an unnormalized matrix. Use disposable synthetic
copies for deliberate corruption, never the classroom artifact. Explain which
properties a hash can verify and which financial properties require source review.

The disposable failure experiment is implemented in
`tests/test_index_integrity_contract.py`; it does not need an embedding model.
Run it against the installed package with:

```powershell
.\.venv-acceptance\Scripts\python.exe -I -m pytest -o pythonpath= tests/test_index_integrity_contract.py -q
```

Eight cases passed on October 4: a valid matrix, wrong model name, wrong revision,
reordered chunks, changed vector bytes, and three invalid matrices whose fixture
hashes were deliberately updated. Those last cases separately reject non-unit,
zero and non-finite rows. They demonstrate why byte integrity and numerical
validity are different contracts. All files are temporary synthetic fixtures;
the test never opens or corrupts the annual-report artifact.

Learning checkpoint: before reading the expected exception, explain whether each
case should fail at identity, byte integrity or numeric validation. In particular,
updating a hash can make bytes self-consistent without making the represented
data meaningful. These eight examples are not exhaustive corruption coverage
and do not establish trusted provenance or financial correctness.

## Reproduce before putting the project on a résumé

1. Trace `EvidenceService.query` and name what each of its four stages owns.
2. Run the synthetic `examples/evidence_learning_lab.py` in the original project.
   Explain why its highest-score wrong-year passage can pass the similarity gate.
3. Change the synthetic vectors, predict the ranking first, then compare output.
4. Explain in English why a correct source page is necessary but insufficient
   for a verified financial answer.

Completion means your prediction, execution, source check and explanation agree;
an assistant-run demonstration is scaffolding, not your personal implementation
evidence. The next article examines how API contracts preserve this distinction.

## Historical browser topology — October 9

The second figure preserves the October 9 design checkpoint, intentionally
labelled **PLANNED / NOT IMPLEMENTED**. Its target topology is historical;
the [current responsibility overview](07-operational-receipts.html#the-readers-browser-owns-the-work)
explains the implemented composition and its separate acceptance gates.
Rendering either diagram does not run a browser model or validate privacy,
memory use, latency or answer quality.
The Python API remains independent and must not secretly answer browser-native
requests. A diagram iframe below is only the architecture viewer, not the
embedded RAG demo. The actual lab below uses its host's current build profile.

At the October 9 checkpoint, the operation controller was implemented and tested,
including stale-message rejection, cancellation and worker-incarnation identity.
The selected-PDF adapter used a native parsing worker and had passed the
bounded original-fixture browser checks described below. A separate native
computation worker builds source-linked page windows on an explicit button click.
Those stages, explicit MiniLM passage encoding and question-to-source ranking
had bounded native-browser receipts. The preserved figure remains that target topology,
not a live status diagram: that retrieval checkpoint did not establish
context assembly, generation, sample permission or independent financial quality.
The [commit-boundary lesson](02-contracts-before-services.html#browser-work-has-a-commit-boundary-too)
explains result ownership; article 07 records the later implemented responsibilities.

<figure class="architecture-figure" id="browser-architecture" aria-label="October 9 planned browser-native topology, preserved history">
<div class="figure-heading"><span class="figure-status planned">02 / OCTOBER 9 DESIGN HISTORY</span><h3>The reader's device owns the computation.</h3><p>This preserved target diagram separates main-thread interaction, PDF parsing and model computation. Read the current implementation overview in article 07 before using it to describe today's entry.</p></div>
<iframe src="figures/browser-native.archify.html?theme=dark" title="Historical October 9 planned browser-native topology" loading="lazy"></iframe>
<figcaption>Figure 2 · Historical approved design, with its original figure bytes retained. <a href="figures/browser-native.archify.html?theme=dark">Open full-size ↗</a> · <a href="figures/browser-native.archify.json">Editable JSON</a> · <a href="07-operational-receipts.html#the-readers-browser-owns-the-work">Current responsibilities ↗</a>. Local PDF selection and permission-reviewed samples are separate entrances; no NVIDIA sample mode is delivered. The parser-to-compute arrow is logical data lineage: page/spans return through PDF.js's main-thread proxy before being forwarded to the computation worker, not a direct worker channel.</figcaption>
</figure>

In CS381 terms, the parser, retriever and generator are replaceable interfaces
even when the same worker hosts several responsibilities. In CS310 terms,
worker messages create asynchronous failure boundaries, not proof of distributed
microservices. A request ID and cancellation protocol must stop a stale result
from overwriting a newer question. In CS461/CS496 terms, embeddings and generation
are different model tasks; tool-using agent permissions are not automatically
part of this bounded RAG. These are project interpretations, not graded-course
requirements or claims of professor endorsement.

Read the diagram critically: downloaded model assets can be cached, while
document/index persistence remains opt-in. A citation-format check does not
establish the right fiscal period, metric, column, amount or unit. Actual
browser execution, source-checked predictions, cold/warm network inspection and
device-specific performance evidence are separate from static publication.

## First browser increment: inspect before indexing

The parser's `Extracted; not indexed` state commits the selected source records.
Build chunks is a separate explicit action; neither stage creates vectors or an
answer. The later encoder, query, context and generation retain their own gates.

<figure class="architecture-figure" id="browser-source-lab" aria-label="Current embedded browser lab, capabilities selected by build profile">
<div class="figure-heading"><span class="figure-status">03 / EMBEDDED LAB · BUILD PROFILE</span><h3>Choose bytes. Ask. Inspect the source.</h3><p>This is the actual lab entry. Parse the selected file, build chunks, explicitly encode passages, retrieve your question and assemble its complete provenance context. The public build also enables explicit native generation and the separate six-field Net income lookup. Inspect the source, computation and complete receipt behind any outcome.</p></div>
<iframe src="browser-rag/inspector.html" title="Browser RAG lab — sourced candidates, explicit generation and separate lookup" loading="lazy"></iframe>
<figcaption>Each pipeline action commits its own accepted artifact; context is not an answer. A native generation result is separately inspected as an unverified draft or refusal. <a href="browser-rag/inspector.html">Open the lab full-size ↗</a> · <a href="07-operational-receipts.html">Current execution contracts ↗</a>. This iframe inherits its host's build profile: public generation/lookup are configured, ordinary development generation remains OFF. File selection and model downloads are explicit; no selected-PDF upload endpoint or NVIDIA sample mode is implemented. Native public execution and financial correctness need their own acceptance evidence.</figcaption>
</figure>

<details><summary>What was actually checked in Codex IAB on October 7?</summary>
<p>An original two-page toy PDF, not a financial report, was selected through
the real chooser in both the standalone lab and this article's iframe. The
native parser reported physical pages 1/2, labels i/1, the expected strings and
SHA-256 matching the 1002-byte local file. Item 0 on page 2 had the actual
UTF-16 span [0, 51) and transform [12, 0, 0, 12, 40, 740]. Clear removed the
source; immediate Cancel revoked commit rights; the owned empty PDF was refused
as EMPTY_DOCUMENT. The browser error/warning log was empty. This proves only
these bounded fixtures and controls. Node's separate legacy parsing test is
not this native-browser receipt. Complete offline/network privacy, arbitrary
PDFs and generated answers remain unaccepted.</p>
<p>The separate original pagination PDF returned 240 items on its first page
and one on its second. The real browser displayed 100/100/40 cards with complete
navigation, prepared one item's JSON only when opened, and removed it when
closed. Switching physical page reset the window. This checks behavior, not
browser-memory or latency performance.</p>
</details>

<details><summary>What changed in the actual browser on October 8?</summary>
<p>The standalone lab ran the same selected-file parser and a new native ES-module
computation worker. The two-page selectable fixture produced 2 chunks, 96 output
UTF-16 units and 2 mapping fragments. The pagination fixture produced 21 chunks,
10,152 output UTF-16 units and 564 mapping fragments. Its first joined-page window
was [0, 512); a source fragment for item 0 occupied [0, 36) and the next output
unit was an inserted newline with no source span. The second physical page still
displayed PDF label “1”. Clear removed the previous chunk selector; an empty PDF
was refused with no Build action. These are synthetic fixture observations,
not financial recall, GPU inference, offline privacy or performance results.</p>
<p>The worker adapter validates the reply against the source's numeric item and
separator positions. A matching quotation alone is insufficient: two items
can contain identical strings. Session cancellation revokes commit rights before
physical abort and preserves accepted source records for a later chunk retry.
During synchronous abort dispatch, new mutating calls are refused or suppressed
at that atomic boundary; ordinary calls after it returns can retry. Independent
regressions cover this reentrancy separately from the real browser checks.</p>
</details>

Start with a small selectable-text PDF. Physical page 1 is the first stored page;
its printed/PDF label can instead be `i`. Neither identifier should silently
replace the other. Each displayed item preserves the parser's string, original
item index and half-open UTF-16 span. For `A😀B`, the string contains four UTF-16
code units but three Unicode code points. A span is an offset in that parser
item, **not** an offset in raw PDF bytes or a promise of per-character boxes.

The adapter hashes the selected bytes before PDF.js transfers ownership of its
buffer. That hash binds later records to a specific file, but does not establish
its publisher or financial truth. Preview spacing must not become invented quote
content. Even with normalization disabled, PDF.js can replace whitespace; use
the [official TextContent/TextItem contract](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
to distinguish parser fidelity from content-stream fidelity.

There are two owners. The PDF adapter owns its loading task, PDFWorker wrapper
and native Worker, so it must clean up those resources. The session owns whether
a result may update the page. It revokes the old identity **before** requesting
physical cancellation, and commits the full source only after the controller
accepts matching terminal metadata, with no `await` between acceptance and commit.
Source text stays outside the controller's bounded metadata state.

This is the CS381 responsibility split and CS310 asynchronous boundary applied
to a concrete failure: choose A, then B; A's late completion must not restore A.
It is independent project practice, not a professor-assigned implementation.
The file/page/item/text budgets limit accepted output; they are not a memory
sandbox around the PDF parser. Scanned/empty PDFs are refused, not silently OCR'd.

Extraction capacity and display capacity are different budgets. The inspector
keeps the complete frozen record, but shows only 100 items per preview window.
The range and total make that limit visible; first/previous/next still reach
every item. Opening a detail formats its JSON, and closing it releases that
generated text. Changing the source or physical page resets the view. This
avoids turning a large allowed extraction into thousands of unnecessary DOM
cards; it does not establish a browser memory bound or a measured latency SLA.

Before moving to embeddings, reproduce four checks yourself:

1. Predict the distinction between physical page and PDF label, then inspect it.
2. Open one item and explain its string, UTF-16 span, transform and page geometry.
3. Clear the source. Confirm the page, receipt and current source disappear.
4. Explain in English: “Extraction gives source records, not a verified answer.
   Hashing identifies bytes; it cannot verify the revenue metric or fiscal year.”

Keep your own prediction, screenshot, source check and explanation. Agent-run
tests and a working interface do not establish your personal mastery.
The [source-linked chunking lesson](04-preserve-evidence-before-embedding.html#the-browser-variant-uses-a-different-explicit-chunking-contract)
explains the pure transform and its native-worker connection, exact source
fragments, Unicode windows and output budgets. Click Build, compare one fragment
with its original item, and explain why an inserted newline has no source span.
The explicit encoder now exposes actual tokenizer IDs and accepted representations.
The query now uses the same frozen representation to rank accepted passages.
Neither its scores nor future generation can borrow a Python threshold merely
because both encoders output 384-dimensional vectors.

### A real representation receipt, not a retrieval benchmark

On October 9, the standalone lab's actual file chooser selected the original
two-page, 1,002-byte test PDF. Native parsing and chunking produced two chunks;
an explicit MiniLM FP32/WebGPU action produced two finite 384-dimensional rows
and 24 actual token IDs in total. Chunk 1 has 11 IDs including CLS/SEP, chunk 2
has 13. Both displayed an L2 norm of 1.000000; the inspected full second row had
norm 1.00000002128878. Selecting it did not create another runtime or inference.
This is real browser model output, but the fixture contains no financial facts.
The rebuilt article's iframe was separately exercised through its actual chooser,
native parsing, explicit chunking and WebGPU encoding; it produced the same
two-row/24-token/384-dimension receipt. This is an application embedded in the
blog, not merely a diagram or a secretly Python-backed answer.

| Observed attempt | Verified asset-body bytes | Fetched / cached body bytes | Total attempt time |
| --- | --- | --- | --- |
| First observed successful run | 113,629,084 | 113,629,084 / 0 | 2,331.1 ms |
| Fresh-worker cache retry | 113,629,084 | 0 / 113,629,084 | 1,039.7 ms |

These two observations belong to this device and fixture, not a percentile,
throughput or isolated-GPU benchmark. Time includes verification, initialization,
encoding and disposal. The WebGPU provider does not prove every operator executes
on the GPU; mean pooling and L2 normalization run in JavaScript on the CPU.
Body-byte receipts are not complete network/privacy audits.

A further native attempt was cancelled during initialization: no partial vectors
were committed, source/chunks remained, and a retry used another worker. Replacing
the file with the original empty PDF cleared dependent results and returned
`EMPTY_DOCUMENT`. Clear/reselect restored the parsing path. Two earlier IAB
whole-tab crashes were not explained by these checks; successful recovery is
not evidence that their underlying cause has been fixed.

Your exercise: inspect one token list and predict why 45 UTF-16 units do not imply
45 model tokens. Open its complete vector, count 384 finite values and explain
why unit norm permits a similarity calculation but cannot verify a fiscal year.
Then cancel an encoding attempt and distinguish retained chunks from absent
vectors. The separately tested query path below uses that same frozen
representation; passage encoding alone was not retrieval and retrieval alone
is not generation.

### From your exact question to its candidate page

On October 9, the standalone inspector and this article's actual iframe each
completed an explicit question against the original two-page fixture. The raw
input was `  What does page two say?` followed by a newline; original, resolved
and encoder-input displays retained those exact characters. There is no rewrite
or query instruction in this MiniLM variant. The fresh worker produced eight
token IDs and one finite 384-dimensional vector; the retained passage vectors
were not encoded again.

| Retained candidate | Physical page / PDF label | Displayed cosine | What is established |
| --- | --- | --- | --- |
| `TEST SOURCE PAGE TWO - no financial fact or answer.` | 2 / `1` | 0.358194 | This fixture's highest-ranked source window |
| `TEST SOURCE PAGE ONE - original fixture only.` | 1 / `i` | 0.199773 | The other retained window, not a second answer |

Inspecting candidate 1 selected chunk 2 and physical page 2, with its original
UTF-16 source range `[0, 51)`. Inspection reads accepted artifacts: it does not
encode another question. The standalone query attempt took 1,236.3 ms; the
article-iframe attempt took 1,041.3 ms. Each verified 113,629,084 asset-body bytes,
all from the verified cache in these runs. These are whole-attempt observations
including loading, initialization, inference and cleanup, not isolated GPU time,
a cold-start comparison, all-network measurement or a financial benchmark.

The regression exercise is intentionally more useful than a green screenshot:

1. Run the question and predict which physical page should lead. Compare the
   **raw question**, **token/vector artifact**, **candidate** and **original item**.
2. Edit the question. Only its result and receipt disappear; source, chunks and
   passage vectors stay. Nothing is inferred until you click Run again.
3. During a fresh query, click Clear question or Cancel work. A cancelled attempt
   cannot publish a late result. Retained passage vectors are still reusable.
4. Replace the PDF. Every old dependent artifact disappears before accepting the
   replacement source—even if a previous worker finishes later.
5. Reload, then choose the same file again. The fresh session deliberately clears
   the browser-restored file control, preventing a stale filename from suppressing
   the next `change` event. It does not silently reparse a document on startup.

These are independent applications of CS381 dependency ownership and CS310
asynchronous failure boundaries. Explain in English: “The question owns a new
query artifact, but it reuses accepted passage vectors. Cancellation revokes the
right to commit; source replacement invalidates every dependent artifact.” Then
reproduce those outcomes yourself. Assistant-run checks are not your mastery
evidence. After a successful query, explicitly assemble and inspect its complete
context; actual financial generation still needs a separate implementation and
acceptance gate.

<details>
<summary>Recovery lesson: a filename is not an accepted document</summary>

A browser can restore a file control while the new application session contains
no source. Choosing the same path can then leave no changed selection for the
parser to observe. The control's filename and the session's accepted source are
different state; neither should stand in for the other.

The October 9 repair releases the file control after `pagehide` has revoked
session state. A guarded `pageshow` also releases it when there is neither an
accepted document nor an active operation. That `pageshow` handler preserves
accepted artifacts and active parsing. Leaving the page intentionally invalidates
the session; neither handler starts work automatically or erases the literal
question control. [MDN documents `pageshow`](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event)
for initial load and history restoration, including bfcache; it does not establish
IAB's actual file-restoration ordering.

Three controlled regressions failed before the production change and passed
after it. Independent specification and quality reviews passed. The rebuilt
article iframe also completed native PDF/chunk work and real GPU encoding/query
ranking; normal index navigation and Back returned an empty idle selection,
and explicit same-file choice started parsing again. This does not prove that
history used bfcache or identify the earlier whole-tab crash cause.

Your exercise: run a query, navigate to the series index, return and inspect the
current state before clicking anything. If the source is absent, explicitly
choose the PDF again. Explain: “A restored file input is not proof that the
current session has an accepted source. Recovery should restore a valid action
boundary, not silently execute the user's document.” Keep your own observation;
this agent-run regression is scaffolding, not your personal mastery evidence.

</details>

## Source and verification boundary

### A complete context can have a bounded preview

The October 11 context action binds the exact question and successful query
attempt to a detached, immutable evidence snapshot. The interface presents every
selected unit with its source-ordinal citation ID, retrieval rank, physical page,
PDF label and UTF-16 mapping. It renders at most 100 cards per window, but keeps
the complete selected set. Opening a card creates its full quote and all mapping
segments; closing it releases that display text. `omissions: []` means no selected
evidence was removed from the context, not that the retriever found all relevant
information or the model has answered correctly.

Source inspection uses retained artifacts rather than running the encoder again.
Editing or clearing a question, changing top K, replacing the document or
restarting an earlier stage revokes old context callbacks. In CS381 terms, the
presentation component controls display and navigation; the session and shared
provenance contract control ownership and consistency. That separation makes a
layout change independent of the evidence-selection policy. In CS310 terms, a
successful earlier operation is not permission for an old result to commit into
a new session. In CS461 terms, actual embedding tokens and vectors are not
generated answer tokens.

<details><summary>Actual financial-source context check in Codex IAB on October 11</summary>

This was a local development trace, not a complete corpus or independent gold
evaluation. The selected 74,085-byte PDF contained original physical pages 3–4
of the locally stored NVIDIA FY2025 Q2 report. It had its own SHA-256
`8e668f014d42e1ece74a67e1431dea6542b48c60ed8bcd7a0e187e6b954e7428`;
selected physical pages 1/2 carried PDF labels "3"/"4". The original report was
unchanged, and neither it nor the excerpt was added to the public sample build.

Both the standalone application and this article's actual iframe used the native
chooser, PDF.js worker, computation worker and MiniLM WebGPU FP32 encoding. Each
produced five chunks, 644 passage token IDs and 384-dimensional vectors. The exact
question was `"  What was revenue for the three months ended July 28, 2024?\n"`:
two leading spaces and a trailing newline remained in the context. Its encoder
used 16 token IDs. Requested top K 3 yielded citations E1, E4 and E2 at ranks
1, 2 and 3; citation identity did not change into rank identity.

| Warm-cache observation | Passage attempt | Query attempt |
| --- | ---: | ---: |
| Standalone | 1,785.5 ms | 862.9 ms |
| Article iframe | 1,530.4 ms | 1,060.3 ms |

Each attempt verified 113,629,084 asset-body bytes, all from the owned asset cache
with zero fetched asset-body bytes. These are individual attempt observations,
not isolated GPU time, a p95 benchmark, a total-network-zero claim, or generation
latency. The opened E1 quote matched the retained candidate's complete 512 UTF-16
units. E4 inspection selected physical page 2 / label "4" and chunk 4 without
changing the query receipt. Editing the standalone question then removed all
context cards and disabled Assemble while retaining accepted source/passages.
Generate remained disabled, and the iframe console had no observed warning or
error entry in this check.

Any future generated financial claim still requires a claim-specific check
against the original table's quarter and six-month columns. Mechanical source
identity, full quote retention and GPU execution do not supply that judgment.
The real selected-context prompt, Qwen generation,
decoded-answer inspection and independent quality evaluation remain unfinished.

</details>

Implementation inspected: `src/nvidia_rag/service.py`, with composition and
ranking discussed in `runtime.py` and `retrieval.py`. The local recording-model
regression verifies cached-vector/query-encoding call configuration with synthetic
vectors, not model accuracy. The current and planned interactive figures are
generated with Archify from the linked JSON sources. Their composition and
artifact provenance checks are separate from manual Codex in-app browser review.
Archify's external-Chromium browser checker was not run because this workflow
permits only the Codex in-app browser. The companion PlantUML renderer and draw.io
import remain unverified. Independent financial evaluation remains unfinished;
the [current chapter](07-operational-receipts.html) separates later static publication
from native runtime observations. Archify and its embedded font retain their bundled
[MIT notice](figures/ARCHIFY-LICENSE.txt),
[third-party notices](figures/ARCHIFY-THIRD-PARTY-NOTICES.txt), and
[SIL font license](figures/JetBrainsMono-OFL.txt).
