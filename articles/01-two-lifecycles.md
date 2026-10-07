---
title: "One financial question, two software lifecycles"
status: draft
updated: 2026-10-07
tags: [rag, architecture, learning]
---

# One financial question, two software lifecycles

Start with the wide interactive Archify figure below, then read the explanation.
Its editable [JSON source](figures/two-lifecycles.archify.json) describes the
inspected current path. Companion [draw.io](figures/two-lifecycles.drawio) and
[PlantUML](figures/two-lifecycles.puml) sources remain available; their external
renderers have not been accepted. A second figure separates the approved
browser-native design from implemented capability.

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
is a separate design and acceptance requirement, not a completed capability.

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
Original course-source alignment still needs fuller review before publication.

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

## Browser-native RAG is a separate approved design

The second figure is intentionally labelled **PLANNED / NOT IMPLEMENTED**.
It describes the agreed next variant; rendering this diagram does not run a
browser model or validate privacy, memory use, latency or answer quality.
The Python API remains independent and must not secretly answer browser-native
requests. A diagram iframe below is only the architecture viewer, not the
future embedded RAG demo.

<figure class="architecture-figure" id="browser-architecture" aria-label="Approved browser-native design, not implemented">
<div class="figure-heading"><span class="figure-status planned">02 / APPROVED DESIGN · NOT IMPLEMENTED</span><h3>The reader's device owns the computation.</h3><p>Main thread: interaction. PDF worker: text and page identity. Computation worker: embedding, ranking, context and actual generation. External hosts supply reviewed assets, not answers.</p></div>
<iframe src="figures/browser-native.archify.html?theme=dark" title="Planned browser-native RAG — not an implemented runtime" loading="lazy"></iframe>
<figcaption>Figure 2 · Approved design only. <a href="figures/browser-native.archify.html?theme=dark">Open full-size ↗</a> · <a href="figures/browser-native.archify.json">Editable JSON</a>. Local PDF selection and permission-reviewed samples are separate entrances; sample availability still requires permission acceptance. The parser-to-compute arrow is logical data lineage: page/spans return through PDF.js's main-thread proxy before being forwarded to the computation worker, not a direct worker channel.</figcaption>
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
device-specific performance evidence must precede any release claim.

## Source and verification boundary

Implementation inspected: `src/nvidia_rag/service.py`, with composition and
ranking discussed in `runtime.py` and `retrieval.py`. The local recording-model
regression verifies cached-vector/query-encoding call configuration with synthetic
vectors, not model accuracy. The current and planned interactive figures are
generated with Archify from the linked JSON sources. Their composition and
artifact provenance checks are separate from manual Codex in-app browser review.
Archify's external-Chromium browser checker was not run because this workflow
permits only the Codex in-app browser. The companion PlantUML renderer and draw.io
import remain unverified. Independent financial evaluation and public release
are unfinished. Archify and its embedded font retain their bundled
[MIT notice](figures/ARCHIFY-LICENSE.txt),
[third-party notices](figures/ARCHIFY-THIRD-PARTY-NOTICES.txt), and
[SIL font license](figures/JetBrainsMono-OFL.txt).
