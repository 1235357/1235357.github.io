# Zhentong Ye — technical writing site (local staging)

Status: local construction only; no remote, publication or license grant.

## Classroom handoff — 2026-10-07

Earlier classroom availability check: the stopped blog and CUDA evidence
inspector were restored without model downloads or public tunneling. That was
a dated observation, not a perpetual uptime claim. During the subsequent
Archify work on October 7, both ports were again found without listeners.
Only the static blog was restored on loopback 8765 (owned PID 68076);
the original inspector on 7861 was not restarted by the figure work.
Availability is not a new answer-quality result.

Local blog: http://127.0.0.1:8765/index.html. Separate original classroom
inspector: http://127.0.0.1:7861/ (not embedded, not public).
Both were opened in the earlier rehearsal; current figure review uses only
the static blog in Codex IAB. Recheck the inspector before scheduling a live demo.

User clarification: keep both the enterprise Python API and a future truly
browser-native variant, with both reader-selected PDFs and NVIDIA examples
after permission review. This confirms the requested scope, not completion of
the runtime or permission to redistribute every source PDF. Browser model,
index, download progress and quality must be independently accepted; do not
present a Python-backed page as local inference in the reader's browser.

Start with `What was NVIDIA's annual revenue in FY2025?`, then show outcome,
one architecture diagram (article 01), API responsibilities (article 02), and
evaluation labels (article 06). Do not read all six articles aloud.
The live CUDA inspector returned PDF page 18 as its first candidate, score
0.814609, at threshold 0.78; page 144 contains a candidate income-statement
excerpt with 130,497 in millions. These are candidate excerpts, not an accepted
generated answer or an accuracy estimate. Generation was explicitly OFF.
Earlier traces with different query text/scope have different scores and must
not be presented as this rehearsal's output.

Say plainly: retrieval visualization works in this local run; a stable generated-
answer MVP, browser-native execution, independent answer-quality evaluation and
production deployment remain unfinished. No GitHub publication was performed.

Final content check: articles 03/05/06 now connect specified CS461/CS496 original
pages to cosine/softmax, weighted fusion versus RRF, generation controls and
stage-level evaluation. Course PDFs and screenshots were not copied into the
site; explanations are original project-specific interpretations. Article 01
explicitly distinguishes the Python-hosted classroom demo from the unfinished
browser-native variant. The six static build/navigation/figure-source tests
passed after these content edits. No restart was needed for those content edits;
the later stopped-service recovery is recorded at the top of this section.

## Scoped browser layout check — October 4

Figure 4 was subsequently opened inside article 04 at its structured-data anchor
in the Codex in-app browser. The desktop screenshot showed the entire diagram,
its implemented/proposed caption, and both editable-source links without visible
label overflow. This is embedded-SVG desktop visual acceptance only: actual
download interaction, mobile usability, draw.io import and PlantUML rendering
remain unverified. The loopback server had stopped before this check and was
restarted only after a refused HTTP connection and missing listener confirmed it
was not serving. Its successful browser load is a dated availability observation.

The generation chapter was opened in the Codex in-app browser at a 1280px
viewport: its article measured 780px, and document scroll width was 1265px,
with no page-level horizontal overflow. At a temporary 390px viewport its
article measured 331px and document scroll width 375px. The architecture
article's SVG measured 640px inside a 331px figure container with 640px internal
scroll width; document scroll width remained 375px. This verifies containment,
not manual horizontal-scroll usability, all-page visual acceptance or accessible
diagram reading. The narrow screenshot output did not provide a clear full-size
diagram review. Temporary viewport overrides were reset after each check.
The original RAG demo was not changed or restarted by these checks.

## Presentation direction — one live walkthrough, two learning surfaces

The earlier objective retired the long PPT and old Obsidian expansion as primary
deliverables. The latest personalization instruction supersedes the Obsidian
portion: retain the staged technical blog and reusable repository for the external
portfolio, and restore the personal vault as a visual Excalidraw learning surface.
That is a requested migration, not a completed one. Preserve historical files;
do not delete them or recommend presenting the entire 49-slide deck. The technical
blog holds deep explanations; a live walkthrough starts with one core architecture
diagram and then the question, answer/outcome and only the relevant trace details.

Mentor feedback reviewed from the local October 2 transcript: 00:55:57 asks for
question/answer before detail; 00:57:38–00:59:59 asks for fewer slides and one core
diagram; 01:01:15 asks for golden labels and judge-based evaluation. These are
directions, not evidence that the current generation-OFF demo fulfills the
requested end-to-end question/retrieval/generated-answer MVP.

Latest local observation (2026-10-04): an isolated run on port 7871 used cached
Qwen2.5-0.5B-Instruct on CPU and CUDA query encoding. The FY2025 annual-revenue
question reached generation, but the raw response omitted document/page citations.
The UI reported `Citation-format gate: REFUSE` and released no generated answer.
This proves execution of that path and one observed rejection, not a reliable
answering MVP, financial accuracy, latency acceptance or production deployment.
Port 7861 was the separate generation-disabled teaching baseline. The default
generation-OFF header on 7871 is potentially confusing; its explicit generation
panel is the authority for this historical run. A subsequent local listener check
found no listeners on 7861, 7871 or 8765; neither demo nor blog HTTP availability
was established by that check. Later on October 4, the generation-OFF baseline
was restarted on 7861 and its startup script confirmed CUDA and local reachability.
The blog was separately served on 8765 and opened in the in-app browser for the
desktop review below. These are dated observations, not perpetual uptime claims.

The first series follows the NVIDIA financial-report retrieval project through
implementation decisions, failures and evaluation. It must distinguish working
code, synthetic regression evidence, real-source diagnostics and proposed
production architecture. No classroom slides or transcripts are redistributed.

## Mentor-source decisions and next acceptance gates

The October 2 local transcript lines 481–820 were reread without truncation.
This is a partial source review, not completion of the entire transcript.
Subsequent source reading covered lines 1–480 and 1071–end; the earlier review
covered 821–1070. The supplied cleaned record has therefore been read across
all sections, but its summaries and reconstructed screen descriptions are not
independent verification of the original recording or external websites.
In particular, the summary's "graduation adjustment confirmed" is stronger than
the student's actual wording at 00:01:47–00:02:41 (a proposed arrangement).
It is not evidence of TGS/OISS approval. The broad labor-market statements are
the mentor's opinions, not facts verified by this project. No career or academic
authority is changed from this transcript alone.
At 00:27:49–00:29:20 the mentor stresses the complete application path: frontend,
API, backend and database responsibilities. At 00:23:15–00:25:34 he distinguishes
algorithm interview practice from coursework and project construction. Apply
these as learning priorities; do not publish private transcript text or treat
his broad industry/course opinions as independently verified market facts.

The RAG application must therefore demonstrate more than an attractive notebook:

1. Trace one request from browser input through validation, retrieval, optional
   generation and a structured success/refusal/error response.
2. Document which layer owns each contract, how a consumer replaces a retriever,
   and what happens on unavailable dependencies or incompatible index artifacts.
3. Separate document/index storage from request-session state. A persistent
   database is not automatically required for a small stateless retrieval MVP;
   explain its need before adding one.
4. Tie performance claims to measured corpus size, hardware, warm/cold state,
   concurrency, timing boundaries and quality labels. GPU use alone is not a
   scalability result, and a module diagram is not deployment evidence.
5. Keep personal algorithm exercises and English design explanations as separate
   learning work. Assistant-generated project code cannot certify interview skill.

Source gates: the complete supplied cleaned transcript has been read; the
original recording has not been independently checked. CS381 layering and CS310
client/server and multi-tier PDFs have full-page text inspection, not complete
visual inspection. Specified original CS461 Word Vectors/Bengio and CS496 class2/
class1_mdp pages have been inspected and connected to articles 03/05/06. This is
not full coverage of the four courses, recordings or later teaching materials.

## Official reference coverage — checked through 2026-10-07

The following ten pages' navigation bodies have been read in the Codex in-app
browser. The earlier overview-only/next-to-read statements are superseded.
Authorship and publication dates are not established for the docs pages; record
them as UNKNOWN rather than infer authorship from the mentor's employer.
Copyright years are not publication dates. Reading is not implementation.

| Official page | Project-specific consequence, not a completed feature |
|---|---|
| [Overview](https://docs.anyscale.com/rag) | Separate ingestion, retrieval and generation failures. |
| [Basics](https://docs.anyscale.com/rag/basics) | Chunk-size/overlap heuristics are starting points, not an optimum. |
| [Quickstart](https://docs.anyscale.com/rag/quickstart) | Read all seven notebook descriptions; their code, videos and hosted workspace have not been executed or completely reviewed. |
| [Evaluation](https://docs.anyscale.com/rag/evaluation) | Define labeled relevance units and evaluate actual answers separately. |
| [Quality overview](https://docs.anyscale.com/rag/quality-improvement) | Freeze a baseline and compare one change at a time, including quality, cost and latency. |
| [Ingestion](https://docs.anyscale.com/rag/quality-improvement/data-ingestion-strategies) | Preserve financial period, table headers, row/column, unit and recoverable PDF location. |
| [Retrieval](https://docs.anyscale.com/rag/quality-improvement/retrieval-strategies) | Compare dense, lexical/hybrid and reranking on the same cases; preserve original/resolved/encoder inputs. |
| [Generation](https://docs.anyscale.com/rag/quality-improvement/generation-strategies) | Budget context, handle conflicting evidence, verify numbers and references; structured output alone is not truth. |
| [Structured data](https://docs.anyscale.com/rag/structured-data) | PDF text extraction is not a native database or a finished Text-to-SQL product. |
| [Production](https://docs.anyscale.com/rag/production-scalability) | Separate ingestion/serving resources and cache identities; measure stages before claiming scale. |

Two full technical blog bodies and their diagrams were also inspected:
[Building Scalable RAG Pipelines with Ray and Anyscale](https://www.anyscale.com/blog/rag-pipelines-how-to)
explicitly credits **Kunling Geng**, June 4, 2025.
[AI agents on Ray Serve: Single to multi-agent architecture](https://www.anyscale.com/blog/ai-agents-on-ray-serve-single-to-multi-agent-architecture)
credits **Kunling Geng and Aydin Abiar**, May 7, 2026. The
[official author list](https://www.anyscale.com/blog?author=kunling-geng) supports
these blog attributions, not authorship of every RAG docs page. No tutorial
notebook, video, Ray cluster or paid workspace was run for this reading review.

Apply their writing pattern: state the problem, show a deliberately limited
baseline, explain one architecture change, then show reproducible evidence and
failure boundaries. The RAG article's document-processing timings and the Agent
article's Qwen3-4B FP8/L4 24GB example are their scenarios, not measurements of
our RTX 4060 8GB or proof that those configurations fit it. An editable diagram
must expose responsibilities, protocol and resource boundaries, not imply that
drawn boxes are already independently deployed services.

## Next-work control — 2026-10-07

1. Continue the enterprise consumer contract: the pristine API-only missing-HTTPX
   defect is now fixed and accepted through actual RED/GREEN environments (article
   02). Explicit outcome semantics and dependency-aware readiness remain open;
   owned-process cleanup exists but is not a production-recovery claim.
2. Review the stepwise implementation plan under the already approved design
   before coding: PDF.js parsing and a modular worker-based Transformers.js
   embedding/generation path are the chosen first experiment. Python API remains
   independent. A WebLLM adapter is a later
   evidence-driven option, not a prerequisite for calling a page browser-native.
3. Release no end-to-end or quality claim until a real generated answer, original
   PDF checks, frozen independent cases and an actual calibrated stronger-model
   judge run exist. Downloaded models, citations and passing gates are insufficient.

Two data entrances remain in scope: explicitly selected reader PDFs and NVIDIA
samples only after permission review. Browser PDF/index/model/cache artifacts need
their own identities and evaluations; no reuse of the Python 0.78 threshold as a
validated browser operating point. No new runtime, cloud inference or sample-PDF
redistribution was implemented by this documentation update.

Latest user instruction restores Obsidian as a personal visual-learning delivery
surface, with Excalidraw as its preferred interface. The blog and independent
repository remain the external portfolio artifacts; they are not replaced by a
private vault. The read-only RAG migration inventory is complete; its bounded
findings and recommended structure are below. No bulk deletion, plugin change or
completed vault migration is claimed by this update.

<details>
<summary>Personal Excalidraw learning surface: inventory and structure for review</summary>

### Verified inventory, October 7

The full vault contains 959 Markdown files, including six `.excalidraw.md`
drawings. The NU subtree contains 200 Markdown files and no Excalidraw drawings.
These are inventory counts, not a judgment that 959 files are useless. Other
course/research/career threads own content outside this RAG slice.

The RAG authority page has 2,714 lines and 766,274 bytes. Its source and vault
mirror have equal SHA-256 `D140ECF12AC0E3E639B32390C939182BF7213202A694CF2EADEC6B6DFBBD6D62`.
It has 32 unique same-page wikilinks and eight cross-page expressions pointing to
seven notes; active incoming links are in 09, 00B and 00H. Two links in 09 target
exact headings. Moving the page without migrating those links is not cleanup.
The page was not read in its entirety during this inventory, so no content has
been judged redundant or removed on the basis of file size alone.

The enabled Excalidraw plugin is locally 2.27.3. The
[official plugin README](https://github.com/zsviczian/obsidian-excalidraw-plugin#markdown)
explains that modern drawings themselves are Markdown, can retain a Markdown
body before Text Elements, and support links/transclusions. Thus deleting every
`.md` file would also delete the requested drawing format. No plugin update was
performed; this was a README review, not a full audit of its source or every feature.

The handbook sync is one-way, source to vault mirror. A missing mirror file is
copied back from the source; deleting the source preserves its old mirror.
Therefore one-sided deletion cannot complete migration. The 16:57:56 -05:00
status snapshot showed healthy sync, zero conflicts and ten mirror-only files
preserved. This is a dated snapshot, not perpetual synchronization evidence.

### Recommended structure, awaiting the user's structure choice

Use one RAG `.excalidraw.md` as the visual entrance, not a new daily page or one
file for every concept. Keep three clearly labelled frames in that same drawing:

1. **Map:** current Python path versus approved/not-implemented browser path,
   course concepts, and an explicit start-reading order.
2. **Practice:** one question, the actual query/encoding/ranking/context stages,
   source verification and the learner's reproduce/test/explain checkpoints.
3. **Acceptance:** the API installation RED/GREEN lesson, retrieval versus answer
   quality, failure outcomes and the remaining evidence gates.

Detailed original explanations, exercises and source locators remain in the same
drawing file's Markdown body. The canvas links to those sections instead of
covering the screen with paragraphs. Preserve the two exact 09 target headings
until their replacement links have been tested. A drawn runtime boundary is not
proof of execution or personal mastery.

If that structure is chosen, the written migration specification must name the
source drawing, mirrored drawing, affected incoming links, external figure assets,
metadata and exact recoverable archive destinations before any move. The default
source location stays inside the existing handbook sync scope; the vault-root
Excalidraw folder is outside that scope and must not silently become a second
editable authority. Archive collisions and old-basename link ambiguity need
explicit checks. No source/mirror move or incoming-link rewrite has happened yet.

The acceptance sequence is: reconcile the source/mirror authority; validate all
required Properties plus drawing data and click targets; verify backlinks and
anchored reading; inspect the actual Obsidian drawing/reading views; only then
archive the old active reading entrance recoverably. `vault_check.py` alone cannot
validate the drawing UI. This proposal does not claim a completed migration or
authorize deleting other threads' active pages.

</details>

<details>
<summary>Browser-native RAG: approved written design, October 7</summary>

### Goal and scope

Keep two independent deliverables: a reusable Python API and an embedded static-
site browser RAG. The latter must run PDF parsing, embedding, retrieval and real
answer generation on the reader's device. It must not iframe or call our Python
service while claiming local inference. Both reader-selected PDF files and
permission-reviewed NVIDIA examples remain in scope. No GitHub publication is
authorized by this design.

The user reviewed and accepted this written design on October 7, requesting
further visual polish and mandatory Archify figures. This is an approved
specification, not an implemented runtime or benchmark. The implementation plan
below remains a plan for review, not completion evidence.

### Alternatives and chosen first architecture

1. **Chosen first version:** PDF.js plus Transformers.js for both embedding and
   generation. Keep separate parser, representation, retrieval and generator
   interfaces despite one inference library. This minimizes duplicate loading/
   cache/runtime configuration, not necessarily time or memory.
2. **Growth alternative:** retain Transformers.js embedding and replace only the
   generator with WebLLM. Add this adapter if measured quality, compatibility or
   serving behavior justifies the extra runtime; a longer model list is not proof.
3. **Resource alternative:** measured WASM/CPU embedding plus WebGPU generation
   when simultaneous GPU resources cannot fit. Do not promise WASM generation
   for a model/quantization combination that has not passed runtime tests.

PDF.js parses explicitly selected bytes in its own parsing worker. A computation
worker owns chunking, representations, ranking, context policy and generation;
the main thread renders controls and results. Messages carry protocol version,
request ID, stage, progress and typed outcome, so an old/cancelled operation cannot
overwrite a newer document or question. Model/index state survives normal queries,
not arbitrary browser or worker termination. Separate module interfaces remain
replaceable without requiring independently deployed services.

### Two data entrances, one evidence identity

The local-file input reads a user-selected PDF, not an arbitrary filesystem path.
Do not execute embedded PDF scripts or treat extracted instructions as authority.
Keep file name/hash, physical page number and PDF page label distinct. Preserve
text-item positions and span identities for source inspection. PDF.js text items
do not inherently establish table rows/columns, OCR text or financial meaning.
Empty/scanned pages and ambiguous table relationships are explicit limitations,
not fabricated extraction results. Render cited source pages and inspect metric,
financial period, column, amount and unit before accepting a financial claim.

NVIDIA samples use a separately reviewed source registry containing original URL,
document identity/hash, fiscal period and permission decision for distribution/
display. A public download URL or the parser's Apache license does not grant
redistribution rights to source PDFs. Until that review passes, the sample selector
must visibly say unavailable; the local-PDF path can still work. Never relabel the
legacy corpus's empty attribution as a completed permission review.

The browser index identity binds source hashes, parser/chunker versions, exact
embedding model/revision/tokenizer, pooling/normalization, dtype and dimension.
Rebuild after an incompatible representation change. Do not load the Python NumPy
index as though a similarly named browser model produced the same vectors. Use
exact cosine ranking first; compare alternatives only on registered cases. A cosine
score is not calibrated confidence. The historical Python threshold 0.78 is not a
validated browser threshold.

### Model lifecycle and privacy

Use pinned package/model artifacts selected after license and compatibility
review; include their exact identity in the runtime trace. Official examples with
Qwen2.5-0.5B q4 show a feasible test path, not sufficient financial-answer quality.
The release model must pass the declared source-checked cases; do not shrink the
dataset to conceal weak-model failures. The cached Python 0.5B failure stays as
historical evidence, not an accepted browser result.

Before model download, show required artifact bytes, source host, precision and
estimated resource needs, and require the reader to initiate it. Progress reports
download, initialization and indexing separately. Model downloads access external
hosts even though files/questions should stay local. No backend upload, remote
generation fallback, analytics containing document/query text or hidden telemetry
is permitted. Any required remote font/CMap/runtime/model asset must be documented
and included in the network audit. Do not claim completely offline use until a
warm-cache reload under disabled network has actually passed.

Detect WebGPU and request an adapter in a secure context. A detected API, 8GB GPU
label or per-buffer limit is not available-memory proof. Bound batch/context/
output budgets, serialize competing heavy operations, and handle adapter loss,
out-of-memory and initialization failures. An unsupported device gets a clear
unsupported state or an individually accepted local fallback, not silent cloud
inference. A terminating worker can require model reinitialization.

Cache model artifacts using named application/library namespaces and keep document
data in memory by default. Persist source/index data only by an explicit reader
choice. Browser storage is per origin and best-effort, not guaranteed disk capacity.
Handle quota/eviction; expose separate clear-model and clear-document/index actions.
Cancel active work before clearing, remove only owned data, then reload and verify
the cleared state. Do not describe namespace cleanup as deleting all site data.

### Query result, failure and notebook-style trace

Result states distinguish candidates-only, generated-draft, released-answer,
evidence-refusal, source-ambiguity, format-refusal, cancelled and runtime-error.
Show the answer/outcome first. Details then show original question, resolved
question, exact encoder input, chunk IDs/page references, vector dimension/norms,
top-k scores, selected context/token budget, generator identity and citation check.
These are actual computed intermediates, not invented private chain-of-thought.
Do not equate citation syntax or JSON validity with factual support.

Release policy and evaluation remain separate: generated answers must cite existing
evidence; a failed citation or financial-field check withholds the answer with a
specific reason. UI escaping and strict rendering prevent PDF/model text from
being executed as HTML. No arbitrary URL fetch, shell/tool execution or financial
transaction capability is added by this version.

### Acceptance gates and evidence

- Unit tests: deterministic chunk/span identity, known-vector cosine calculation,
  dimension/version mismatch rejection, budgets and state transitions. Synthetic
  fixtures test software behavior, not financial accuracy.
- Worker tests: cancellation and stale-message isolation, initialization failure,
  document replacement, GPU-loss/memory failure and safe cleanup. An injected
  model tests protocol behavior; a real model run is a separate mandatory gate.
- Runtime acceptance: close/stop the separately owned Python demo/API only in an
  isolated acceptance session, then show a reader PDF → actual embedding → actual
  retrieval → actual generated answer. A static file server may serve assets, but
  it must not compute the RAG answer. Preserve the classroom baseline during work.
- Privacy: record network requests for cold download, parsing, indexing, querying
  and warm use. Reject any PDF/query text transmission; document expected model/
  runtime/asset hosts. Disabled-network warm use is a separately reported test.
- Quality: freeze and source-review a separate browser acceptance registry before
  tuning. Include single-year facts, comparative-period requests, table-column
  ambiguity, unanswerable questions and document prompt injection. Record actual
  predictions, period/metric/column/amount/unit verdicts, citations, refusals and
  failures; an actual stronger-model judge needs its own permission/configuration
  and human calibration. Do not send a private reader PDF to that judge by default.
- Performance: record cold bytes/download/init, parse/index time, query encoding,
  ranking/context time, generation TTFT/total time, browser/device/model identities
  and resource measurements. Do not fabricate browser VRAM precision where an
  instrument cannot measure it. Report missing measurements as missing.
- Corpus breadth: local PDF and permission-reviewed example modes must each pass;
  broader filings and licensed third-party analyses remain a separate acquisition/
  evaluation stage, not unreviewed mass additions to the accepted index.

### Official technical sources read for this design

Accessed in Codex IAB on 2026-10-07; recommendations do not prove our implementation.
Official APIs are authoritative for their documented behavior (Tier 1). The two
company technical blogs above are engineering examples (Tier 2); vendor performance
claims are not independent measurements. This architecture recommendation has
medium confidence from primary capability documentation; quality/performance on
our device remain unmeasured. No market-adoption claim is made.

- [Transformers.js v3.8.1 overview](https://huggingface.co/docs/transformers.js/v3.8.1/index): ONNX Runtime, browser WASM default and explicit WebGPU; selected overview/task sections, not the entire model catalogue.
- [WebGPU guide](https://huggingface.co/docs/transformers.js/v3.8.1/guides/webgpu): text embedding with pooling/normalization; its October 2024 support percentage is historical, not a 2026 compatibility figure.
- [Quantization guide](https://huggingface.co/docs/transformers.js/v3.8.1/guides/dtypes): per-model dtypes and q4 Qwen generation example; no guarantee of financial quality or fit.
- [Vanilla tutorial](https://huggingface.co/docs/transformers.js/v3.8.1/tutorials/vanilla-js): actual local file selection; warns against heavy main-thread work.
- [Environment API](https://huggingface.co/docs/transformers.js/v3.8.1/api/env): remote-model defaults, browser Cache API and separate filesystem caching semantics.
- [WebLLM overview](https://webllm.mlc.ai/docs/), [basic usage](https://webllm.mlc.ai/docs/user/basic_usage.html), [advanced usage](https://webllm.mlc.ai/docs/user/advanced_usage.html): observed docs version 0.2.85, worker interfaces, progress and cache behavior. OpenAI-style local API is not a remote OpenAI call; service workers may be terminated.
- [PDF.js](https://mozilla.github.io/pdf.js/) and [generated API](https://mozilla.github.io/pdf.js/api/): selected getDocument/TextItem/getTextContent/pageNumber/getPageLabels contracts; not a full parser-source or every API review. Code and documentation licenses differ from input-PDF permission.
- [MDN WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API): secure context, adapter/device boundaries and GPU failures; selected capability/error sections, last modified September 2, 2026.
- [MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): full article, quota estimates, best-effort storage/eviction; last modified January 5, 2026.

### Asset selection: verified evidence, not installed or benchmarked

The following primary pages were opened in Codex IAB on October 7. These are
**pilot candidates**, not an accepted runtime registry. No model was downloaded
by this audit. The model file page/pointer establishes upstream metadata; it is
not a checksum of bytes downloaded on this machine.

| Candidate | Observed identity and boundary | Consequence for implementation |
|---|---|---|
| PDF.js | [Getting started](https://mozilla.github.io/pdf.js/getting_started/) currently displays stable 6.4.299. Its [official FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions) requires the API and worker to be the **exact same version**. | Confirm the registry package, vendored worker and target-browser compatibility before installing/pinning. A current documentation label alone is not package acceptance. Reject a mismatched or stale worker rather than continue silently. |
| Embedding | [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) documents `pooling: 'mean', normalize: true` and 384 dimensions. Observed full repository head: `751bff37182d3f1213fa05d7196b954e230abad9`. | Bind query and passage representations to the same whole-repository revision, tokenizer, pooling, normalization, dtype and input policy. Do not reuse the Python BGE index merely because its vectors also have 384 dimensions. |
| Embedding weights | The [fp32 ONNX file page](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/main/onnx/model.onnx) reports **90.4 MB (rounded)** and content SHA-256 `759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e`. The raw pointer navigation was blocked by the browser; exact bytes are not recorded here. | This is one file, not the total tokenizer/runtime transfer or GPU-memory requirement. fp32 WebGPU is a proposed first trial; actual backend/operator compatibility still needs a real run. Do not fetch every precision variant. |
| Generator | The [Transformers.js 3.8.1 dtype guide](https://huggingface.co/docs/transformers.js/v3.8.1/guides/dtypes) shows Qwen2.5-0.5B-Instruct with q4 and WebGPU. [Observed ONNX repository](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/tree/main) head: `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`. | Pin the **whole model revision**, not only a weight checksum. The tokenizer template changed in the observed head while the weight commit was older. A moving `main` can change behavior without changing weights. |
| Generator weights | [q4 file page](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/blob/main/onnx/model_q4.onnx) / raw LFS pointer: **786,156,820 bytes**, content SHA-256 `09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296`. q4f16 is listed as 483 MB, rounded. | Parameter count is not download size. q4f16 has not been accepted on this device, so its smaller listing is not a promise of a working fallback. Cache keys must include revision, dtype and asset identity. |

The [upstream MiniLM card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
describes a sentence/short-paragraph encoder and a default truncation boundary of
256 word pieces. The pilot must inspect its selected tokenizer and count tokens;
silently embedding only the start of a long financial chunk changes evidence
coverage. English narrative retrieval is a pilot scope, not established Chinese
retrieval, table understanding or financial-answer quality.

The Xenova and upstream MiniLM cards show Apache-2.0. The
[upstream Qwen card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) also shows
Apache-2.0. The selected ONNX generator page did not surface a separate license
file/tag in the inspected view. Record conversion provenance and fulfill notice/
attribution obligations before redistribution; this audit is not blanket license
clearance for the ONNX package or any financial PDF. Download URLs are not rights
decisions. Neither model is promoted by a general benchmark or a parameter label.

</details>

<details>
<summary>Archify figures: local delivery and verification, October 7</summary>

### What changed

Archify 3.0.1 was installed from the user-requested
[upstream repository](https://github.com/tt-a1i/archify), fixed source commit
`73aaa0696e8f72c232ea710e6fa94fd953f3e773`. Its required authoring/delivery
references and JSON schemas were read before generation. No upstream browser
checker was used: it launches external Chromium, contrary to the user's IAB-only
workflow. Static checks and manual IAB checks are separate evidence.

- `figures/two-lifecycles.archify.json` → standalone interactive HTML: CURRENT
  Python-hosted retrieval, default generation OFF. Query encoding → ranking →
  context is now visually left-to-right, consistent with the authored edges.
- `figures/browser-native.archify.json` → standalone interactive HTML: PLANNED,
  user-approved browser-native design, explicitly NOT IMPLEMENTED. The three
  execution responsibilities, asset-only download and opt-in persistence boundary
  are distinct. The parser-to-compute arrow is explicitly logical data lineage
  via PDF.js's main-thread proxy, not a direct worker-to-worker channel. Concrete
  proxy/worker-message plumbing still belongs to runtime implementation.
- Article 01 embeds both viewers as full main-grid stages rather than squeezing
  them into the text column. Each has a full-size link and canonical JSON link.
  The diagram iframe is an architecture viewer, never claimed to be the RAG demo.
- The build copies only named `*.archify.html` / `*.archify.json` figure assets
  and the MIT/third-party/font notices. Local delivery receipts are not copied
  into `dist`. Original draw.io/PlantUML sources are retained.
- Git attributes preserve generated viewer/spec/receipt and bundled-notice
  bytes across Windows checkouts. The upstream HTML contains trailing whitespace;
  it is not manually reformatted because that would invalidate its delivery hash.
  Source-only whitespace checks therefore exclude the two generated viewers.

### Actual acceptance versus remaining gates

Both final artifacts passed `validate --quality showcase`, `deliver`, and
`check --require-provenance`: 9/9 static checks, zero composition errors/warnings,
current artifact provenance. The browser-design composition estimate's minimum
projected text was 7.44px at the tool's legacy 930px budget; it did **not** meet
the requested 7.5px projection target despite passing the hard-floor gate. This
is why static PASS is not advertised as complete visual acceptance.

At the Archify/stage-layout milestone the site suite had 8 passing tests. New behavior tests first failed because
interactive assets were omitted and because figures stayed inside the reading
column; minimal build fixes made them pass. A test scratch copy is separate from
the blog; final tests/build also ran against this local repository.

Codex IAB at its normal 908px viewport displayed both embedded diagrams. Article
scroll width was 893px, figure width 833px and frame width 831px, without whole-
page horizontal overflow. Clicking the ranking node showed two incoming and one
outgoing authored relationships. The browser-design iframe loaded its planned
heading and rendered all six nodes; it is not a browser inference run.

A temporary 390×844 viewport measured document width 375px and figure width
331px. The compute-node passport and refusal/design card were inspected, with
readable inspector text; the entire overview is small at this width. Use zoom,
node inspection or the full-size viewer for detailed graph reading. This does
not claim every mobile interaction, export format or keyboard path is accepted.
Viewport overrides are reset after review. A desktop sticky-sidebar overlap
found during visual review was fixed by making that sidebar non-sticky on pages
with wide architecture stages.

The later proxy-wording revision delivered a new browser-design artifact:
specification SHA-256 `fe11f58ec415464237e739c712955bdb8864f4983cbdc9dc3af5c115d80765f1`,
HTML SHA-256 `c1896f5bc114d3501721cdeead726b85dc7d7e66a46b4099c131fb154dde8913`.
`deliver` and strict provenance `check` again passed 9/9, with zero errors/warnings.
Independent read-only review confirmed the source, receipt, article caption and
copied `dist` bytes agree. Manual IAB review of these new bytes at 908×851 opened
the compute-node passport and showed the `Spans via main` relationship; document
scroll width was 893px. The overview labels remain small at this normal narrow
desktop size; focus/zoom is needed for details. The earlier 390px review predates
this wording revision and is not a fresh mobile acceptance of the new bytes.

No `finalize`, automated external-browser receipt, draw.io import or PlantUML
renderer was accepted. No GitHub push, model download, RAG backend source change,
public tunnel or answer-quality claim was made by this figure milestone.

</details>

<details>
<summary>Browser-native implementation plan — proposed sequence for review</summary>

The accepted architecture is unchanged. Build one inspectable vertical slice,
then qualify it. Planned paths below are not files that already exist, and the
commands are proposed checks rather than reported results. Keep this plan here
instead of creating another stand-alone planning document.
The end-to-end sequence below is still a roadmap, not completion evidence. The
next bounded increment is specified after it. Independent review identified six
contracts: exact worker/message state; source-span/chunk identity with an actual
PDF fixture; paired runtime/model assets; representation/context interfaces;
generation versus release; and build closure. The static HTML build defect is
now repaired and its 14 tests pass, but this is **not** module/worker/WASM closure
or browser-model acceptance. Architecture and the two entrances are already
approved; they are not being sent back for another architecture vote.

1. **Define contracts before inference.** Add `browser-rag/protocol.mjs` and
   `browser-rag/tests/protocol.test.mjs`. Freeze versioned request/document IDs,
   message kinds, budgets, cancellation, stale-result rejection and typed refusal/
   error states. Start with failing `node --test browser-rag/tests/*.test.mjs`
   cases for a replaced document and cancelled request. Injected-model tests
   establish only protocol behavior, never real model quality.
2. **Make one source inspectable.** Add `browser-rag/pdf-source.mjs`,
   `browser-rag/chunking.mjs` and their tests. Pin the PDF.js package/worker pair;
   use its main-thread proxy to collect text/page identity, then explicitly
   hand reviewed records to the compute worker. Diagram data-flow arrows do not
   promise a direct PDF.js-worker-to-compute-worker MessagePort. Preserve source
   hash, physical page/page label and text-position spans; reject scanned/empty
   text and ambiguous table assertions. Initially use a synthetic selectable PDF,
   not silently redistributed private or NVIDIA PDFs.
3. **Run actual local representations.** Add `browser-rag/compute.worker.mjs`,
   `browser-rag/model-registry.mjs` and `browser-rag/retrieval.mjs`. Review model
   license, revision, pooling/normalization, dtype, artifact sizes and backend
   compatibility before download. Test known-vector cosine, representation
   mismatch and context budgets; then separately run an actual pinned embedding
   model in IAB. Do not reuse the Python NumPy index or threshold 0.78.
4. **Generate and check a real answer.** Add `browser-rag/generator.mjs` and
   `browser-rag/release-policy.mjs`. First test missing/nonexistent citations and
   unanswerable cases with deterministic fixtures; then execute actual local
   generation. A model invocation and citation syntax alone are not accepted
   financial answering. Show answer/refusal first, then actual intermediates.
5. **Embed the tested slice.** Add `browser-rag/demo.html`, `browser-rag/app.mjs`
   and `browser-rag/demo.css`, and an explicit asset allowlist in `build.py`.
   Integrate into the existing article with clear download consent/progress,
   source inspection, model/index lifecycle and cancel/clear controls. Wire up
   local PDFs and a separately reviewed sample registry; keep sample mode visibly
   disabled until the permission gate passes. Use existing Archify figures and
   update their canonical JSON only when real boundaries change.
6. **Qualify, do not decorate failures away.** Add bounded
   `browser-rag/acceptance/` fixtures and a frozen source-checked registry.
   Actual IAB tests must show cold/warm asset requests, no PDF/query upload,
   independent parsing/embedding/generation with no Python inference service,
   supported-device failure states and measured stage timings. Test offline warm
   reload separately. Record actual predictions and source verdicts; independent
   acceptance cases must not be tuned on. Preserve failures and do not label the
   result enterprise-ready or personal mastery without the corresponding proof.

Every step updates the existing article/README and relevant tests, rather than
creating daily duplicate pages. Heavy runtime/model operations are serialized;
the unrelated career/Forge/course threads and their browser sessions are not
touched. Public GitHub release remains a separate user decision.

### Next increment: operation contract, before runtime dependencies

**Goal:** prevent cancellation, a replaced document, or an old worker from
committing into newer state. Implement a pure controller and deterministic
tests first. No PDF.js/Transformers.js installation, model download, browser
inference, sample corpus, persistence or public deployment belongs to this step.
This separation makes failure ordering testable without substituting a fake
model for the later mandatory real generation acceptance.

Implemented files: `browser-rag/protocol.mjs` and
`browser-rag/tests/protocol.test.mjs`. The pure controller uses built-in
`node:test` / `node:assert/strict`; no npm dependency was installed for this increment.
Node 24.16.0 was used for the protocol suite; Python 3.13.5 ran the build suite.
The commands below were run on October 7. This completes the controller
increment, not the browser-native PDF/model pipeline.

**Contract.** `createController(runtimeId)` returns `begin(operation)`,
`accept(event)`, `cancel()`, `replaceDocument()`, `replaceRuntime(runtimeId)`
and `snapshot()`. Snapshot is an immutable copy, never a live mutable state object.
Initial `documentEpoch` is 0; replacing/clearing a document increments it before
any asynchronous work through `replaceDocument()`; `begin('clear')` does not
increment it a second time. Beginning an operation requires no active operation;
the caller must explicitly cancel/complete it first. Each accepted `begin` has a
new monotonically increasing operation ID within that worker incarnation.

`begin` returns a detached, deeply frozen identity with exactly the first five
fields of the event below. Unknown operation or overlapping work throws without
changing state. `snapshot()` returns a deeply frozen, detached object:

```js
{
  runtimeId: 'runtime-a', documentEpoch: 0,
  active: null, // or { ...identity, lastSeq: 0, stage: null, progress: null }
  terminal: null // or { ...identity, kind, stage, seq, payload }
}
```

Starting a new operation resets the previous terminal receipt to `null`.
Worker messages use the stages `model-load: download/initialize`,
`ingest: parse/index`, `query: encode/rank/context/generate/release`,
and `clear: clear`. Stages identify the operation's legal vocabulary, not an
enforced order: adapters, not this controller, own their actual execution order.

```js
// Implemented controller schema; not an actual worker execution receipt.
{
  protocolVersion: 1,
  runtimeId: 'runtime-a',
  operationId: 'op-1',
  documentEpoch: 0,
  operation: 'ingest', // model-load | ingest | query | clear
  kind: 'progress',   // progress | result | cancelled | error
  stage: 'parse',     // download | initialize | parse | index | encode | rank | context | generate | release | clear
  seq: 1,            // positive safe integer, strictly increasing for this operation
  payload: { completed: 1, total: 2, unit: 'pages', estimated: false }
}
```

`accept` returns `{accepted: false, reason}` for an invalid version/schema,
mismatched runtime/operation/epoch, duplicate/out-of-order sequence, or event after
a terminal outcome; rejected events cannot alter *any* state. Progress must use
finite nonnegative values with `completed <= total` when the total is known, and
a declared unit (`bytes`, `pages`, `chunks`, or `tokens`); an
unknown total is `null`, not an invented percentage. Allowed stages are restricted
per operation. A result/error/cancelled event closes the active operation once.
Malformed events do not advance `seq`. The protocol controls lifecycle, not
financial truth or model/index validity; production adapters must commit their
document/index/UI changes only after this acceptance verdict.

Successful `accept` returns `{accepted: true}`. Progress payload has exactly
`completed`, `total`, `unit`, and Boolean `estimated`; `total: null` is allowed.
Terminal payloads are `result: {data: JSON-like value}`,
`error: {code: nonempty string, message: nonempty string}`, and
`cancelled: {reason: 'worker-cancelled'}`. Terminal `data` is lifecycle metadata,
not a financial-answer schema or a generation receipt. Copy it before committing;
reject cyclic values, nonfinite numbers, functions, typed arrays, non-plain
objects, nesting deeper than 32 and more than 4096 visited values. No file/model
buffers belong in controller state. Result data's JSON representation must be at
most 256 KiB in UTF-8; individual strings/keys over 256 Ki UTF-16 code units are rejected
before serialization. Additional/missing keys in event/payload
objects are rejected, and input is not mutated. Structured-clone worker messages
are the intended boundary; adversarial JavaScript Proxy/getter objects are not.

`cancel` closes and invalidates the operation synchronously, then the adapter may
request cancellation/termination. A direct cancellation records the active
identity with `kind: 'cancelled'`, `seq: null`, the last stage (possibly `null`),
and a reason of `user`, `document-replaced` or `runtime-replaced`. Cancelling
without active work is a no-op; repeating it cannot create another terminal.
`replaceDocument` cancels first, increments
epoch, and invalidates document/index state in the future adapter; compatible
model assets may remain. `replaceRuntime` requires a nonempty, never-reused
incarnation ID: validate it **before** cancellation and reject same/reused IDs
without changing state. Then cancel, switch incarnation ID and reset that
incarnation's operation counter; the epoch is not reset. Keep the seen-runtime-ID
set inside the controller. Test A → B → A explicitly: reject the final A rather
than recreate a historical `runtime-a/op-1` pair. Late work from the old
incarnation remains ineligible. A worker may finish physically
after cancellation, but cannot publish that completion into the newer session.

#### Task 1 — fail the simplest lifecycle test

- [x] Write `protocol.test.mjs` importing `createController` from `../protocol.mjs`.
   Begin `ingest`; send valid progress; send result; assert the terminal state
   and assert a second terminal result leaves the entire snapshot unchanged.
- [x] Run `node --test browser-rag/tests/protocol.test.mjs`. Before the module
   exists, record the missing-module failure as setup evidence; then write the
   minimal controller shell and rerun to get a behavior assertion failure.
   Do not present import failure as the final behavioral RED receipt.
- [x] Implement only that behavior and watch the test pass. Commit these two
   paths only, not unrelated staging files. No runtime or generation claim.

#### Task 2 — prove cancellation/replacement isolation

- [x] Add failing tests: cancel operation A, begin B, deliver A's late progress,
   result and error; compare B's **entire** snapshot before/after.
- [x] Add a document replacement test requiring the epoch to increment before
   B starts. Deliver a correctly formed A event with the old epoch and ensure
   it cannot commit. Replacing the worker must also reject old runtime IDs.
- [x] Reject `begin` during active work rather than silently overlap GPU operations.
   Implement these transitions only after recording each behavioral failure.
- [x] Run the full protocol suite. Cancellation here is a synchronous state
   invalidation test, **not** proof of a cancelled PDF task or GPU kernel.

#### Task 3 — close the message validation boundary

- [x] Table-drive invalid version, missing/unknown operation, unsafe/negative seq,
   repeated/out-of-order seq, wrong stage, negative/nonfinite progress, and
   completed-greater-than-total; every rejected event preserves state exactly.
- [x] Add valid unknown-total progress (`completed: 3, total: null`) and assert
   the state contains no fabricated percentage. Strict-mode mutation of a deeply
   frozen snapshot must throw `TypeError`. Mutating an original accepted input
   payload afterwards must not change state. Reject malformed higher-sequence
   progress, then accept valid progress with that same sequence: rejection did
   not consume it. Rejected `null`/non-object input must also preserve state.
- [x] Run `node --test browser-rag/tests/protocol.test.mjs` and
   `python -m unittest test_build -q`. Write actual results and limitations into
   this section and the existing learning article; do not open another daily page.
- [x] An independent review checks exactly-one terminal, stale-commit rejection,
   and adapter obligations. Only then wire this contract into real workers.

**October 7 scoped receipt:** Task 1 has 6 retained Node tests and Task 2 expanded
them to 15. Task 2's nine newly failing behavior tests passed after implementation.
For Task 3, the expanded suite first reported 18 passing / 9 failing tests, then
27 passing / 0 failing after validation was implemented. Each increment passed
separate specification and code-quality reviews. Independent Task 3 probes also
checked exact 256 KiB UTF-8 JSON boundaries, escaped strings, accepted depth 32,
null-prototype metadata and each identity-field mismatch. The Python static-build
suite passed 14 tests. No PDF parser/model dependency was installed, no model was
downloaded, and no real worker/generation/cancellation was exercised. The actual
work ordering and document/index/UI commit obligations remain adapter work.

**Controller teaching figure:** the existing second article now embeds
`figures/browser-operation.archify.html` with its editable Archify JSON. Archify
3.0.1's finalize receipt passed validate, deliver, strict check and browser-check;
the final source and built copies have identical SHA-256 hashes. This is a
contract illustration, **not repository-provenance validation**: the staging
repository has no remote and the repository evidence gate rejected a local
`file:` URL. That failed candidate is preserved in the ignored `.archify/`
audit directory; no invented GitHub identity was supplied. The explanatory
validation/rejection boxes are not stored controller states, and a recorded
terminal can be result, error or cancellation.

At 2026-10-07 23:47 UTC the loopback listener on 127.0.0.1:8765 belonged to local
Python PID 5700. In the Codex in-app browser, the embedded and full-size figure
were visually inspected in default dark mode; headings, six nodes and directed
routes were visible. This is a desktop observation, not mobile acceptance,
ongoing uptime, PDF/model execution or public deployment. A separate read-only
delivery reviewer passed document/controller agreement, figure byte equality
and all 27 Node / 14 Python tests. No site was published.

**Next acceptance boundary, not hidden inside this increment:** a source-owned
selectable PDF, actual PDF.js API/worker pairing and genuine text-item extraction.
Each span must preserve source SHA-256, parser version, physical page, page label,
text-item index, half-open UTF-16 offsets, quote and geometry. Search-normalized
text is separate from original quoted text. A synthetic record is not a real PDF
extraction test. The later index binds parser/chunker/model identity; generation
receipts distinguish `real`, `test-double`, and `not-run`. Financial release
requires independently checked metric/period/column/amount/unit and evidence
spans, not merely citation syntax. These later modules remain planned.

</details>

## Planned article sequence

1. One question, two lifecycles: offline ingestion versus online requests.
2. From CS381 responsibility boundaries to injected retrievers and API contracts.
3. From CS310 client/server boundaries to deployment, timeouts and resource limits.
4. Embeddings, cosine ranking and why fiscal-year verification is separate.
5. Retrieval versus agent action: bounded follow-up context, permissions and failure.
6. Evaluation: page labels, financial correctness, development exposure and latency.

Course linkage must be based on inspected local course sources, with original
explanation rather than copied teaching material. Independent-practice examples
are supplemental exercises, not proof that the professor assigned or endorsed
the RAG design. Each article needs source links, editable figures, a reproducible
exercise and a clear statement of what remains unverified.

## Local build and figure maintenance

Run `python build.py`, then serve only the generated directory with
`python -m http.server 8765 --bind 127.0.0.1 --directory dist`.
The build currently renders six articles and the series index; it does not publish.
Build regression command: `python -m unittest test_build -q`. The October 7
fresh-output repair passed **14 tests**, including six added fixture regressions
that failed before the repair. An independent reviewer reran all six fresh-build
cases and a separate promotion-plus-rollback failure fixture.

Each build renders into a new owned staging directory, validates literal local
HTML `href`/`src` targets and HTML fragments (including nested viewers), and only
then promotes it. Missing source assets cannot be rescued by yesterday's `dist`.
An unchanged path/byte manifest does not create another recovery copy. Changed
output is moved into a unique `.build-recovery/` directory before promotion;
never recursively delete the old `dist`. On promotion failure, rollback is tried;
if rollback also fails, the error names the intact retained output. Only the
current invocation's guarded disposable stage is removed.

This is two directory renames, **not** continuously atomic Windows replacement;
real open handles can prevent a rename. Lock failure was injected in tests, not
reproduced with live locked handles. Root/child escapes and links/junctions are
refused. Sources remain unchanged. Old HTML checks do **not** cover JS imports,
CSS URLs, dynamic runtime downloads, WASM assets or real browser inference; the
future browser build needs its own complete asset-graph/privacy acceptance.

The October 7 classroom preview uses a default dark theme, with a light canvas
for existing diagrams so their labels retain contrast. It remains a static local
blog: no browser-native RAG runtime is embedded, and nothing is published.
Each article displays its filename chapter number and the index displays SERIES.
This validates generated labels, not browser appearance or complete site acceptance.
Figure distribution checks cover every supported source asset, not only Figure 1.
Local links and anchors are checked, and Figure 4's draw.io node references and
solid/dashed edge boundary are structurally checked. None invokes a renderer.
The build copies the selected figure assets into `dist/figures`.

Figure 1 has two editable representations: the inline SVG in article 01 is the
currently displayed drawing; `figures/two-lifecycles.puml` is the corresponding
PlantUML architecture source. The latter is not yet renderer-validated because
this environment has no discovered Java/PlantUML command. They are maintained
manually for now, not generated from a shared model; do not claim automatic
equivalence. `figures/two-lifecycles.drawio` now supplies an editable counterpart
with the same six responsibilities and five directed connections. Its XML and
references are checked locally; import/render acceptance in draw.io is not yet
verified. Three representations are maintained manually, not from one model.

Desktop browser inspection found and fixed the SVG default-fill defect in its
query-to-ranking polyline. Six draft articles now exist; full course-original
source alignment, complete responsive acceptance, and diagram-source render
acceptance remain unfinished. This README is not the requested final blog.
## Desktop browser review — 2026-10-04

Opened the generated first article in the Codex in-app browser through a loopback
static server on port 8765. Visually inspected its opening and Figure 1 at the
initialization section: title/body were readable, six boxes and connecting arrows
were visible, and the query-to-ranking polyline was not filled. Offline and online
rows remained distinct. Editable source links were present in the rendered page.
This is one desktop viewport check, not mobile acceptance, draw.io import or
PlantUML rendering. No user tabs were closed and no site was published.
