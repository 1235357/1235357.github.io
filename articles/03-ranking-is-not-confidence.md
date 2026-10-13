---
title: Ranking is not confidence
tags: [rag, retrieval, engineering]
category: technical-blog
status: local-draft
created: 2026-10-04
updated: 2026-10-13
source_type: implementation-and-course-review
---

# Ranking is not confidence

The retrieval stage answers a narrow question: which stored passages are most
similar to this query under a particular representation and candidate scope?
It does not answer whether a financial claim is true. This chapter follows the
actual local implementation in `src/nvidia_rag/retrieval.py`, rather than a
proposed vector-database architecture. No benchmark improvement is claimed.

## First understand the exact calculation

For a query vector q and passage vector d, cosine similarity is:

```text
cos(q, d) = sum(q[i] * d[i]) / (norm(q) * norm(d))
```

`DenseRetriever._normalize` divides each vector by its L2 norm. After that,
`candidate_matrix @ query_matrix[0]` is the vectorized dot product for every
eligible passage. This is exact dense search over an in-memory NumPy matrix;
it is not approximate nearest-neighbor search. Document vectors can be supplied
from a previously built artifact; the query encoder still runs for the request.

A hand-calculation makes the operation concrete. For q=(3,4), A=(6,8), and
B=(4,-3), normalized q=(0.6,0.8), A=(0.6,0.8), B=(0.8,-0.6). Their scores are
1 and 0. A wins the ranking, but that says nothing about A containing the right
fiscal year or revenue column. These are synthetic vectors, not model outputs.

The implementation rejects nonfinite vectors, zero vectors, overflowing norms,
and mismatched query/document dimensions. Those checks prevent invalid arithmetic.
They do not establish model compatibility: two models can both produce 384
dimensions and nevertheless represent text in incompatible spaces. Artifact
provenance and encoder revision belong to the loading contract as well.

### Course connection: a normalized score is not calibrated truth

The CS461 *Word Vectors* original posted in Canvas, physical PDF pages 5, 6
and 11, discusses distance/inner-product/cosine comparisons, softmax and the
limits of intrinsic embedding quality for predicting downstream performance.
The deck is labeled Fall 2026, David Demeter. Its examples concern word vectors;
our retriever uses query/passage representations. The following connection is
our project-specific inference, not a claim that the lecture implements this RAG.

Normalizing vectors makes the dot product equal to cosine similarity. Applying
softmax to candidate scores would instead normalize over a particular candidate
set. Adding an unrelated candidate changes its denominator without changing the
financial facts in an existing passage. Neither operation calibrates a
probability that the requested fiscal period, metric, amount and unit are correct.
Those fields require downstream source-based evaluation, not a higher cosine score.

## Candidate scope comes before ranking

`inspect` can restrict candidates by trusted document IDs and a predicate.
It retains original indices so each ranked vector maps back to the correct chunk.
If the selected scope has no chunks, the inspection returns no candidates, zero
considered chunks and no top-passage vector. That is not a successful answer.

The fiscal-year wrapper introduces another decision. A single explicit known
year can select a report; unknown-year handling refuses unavailable scope.
However, a report may contain comparative columns for several fiscal years.
Selecting the FY2025 report alone does not prove a retrieved amount belongs to
FY2025. The row, column, date and unit still require source verification.

The task-source wrapper also scopes before ranking, using separately validated
source declarations. It does not infer licenses, classify arbitrary questions or
verify claims. This distinction matters when earnings-call or analyst materials
are eventually added: more documents do not automatically mean better evidence.

## Top-k is a ranking budget, not a quality guarantee

The current code uses `np.argsort(scores)[::-1][:top_k]`: calculate all eligible
scores, fully sort them, then keep k. For N candidates of dimension D, the dense
arithmetic is approximately O(ND), while full sorting is O(N log N). An
argpartition-based selection could reduce sorting work, but would need explicit
tie behavior and regression checks before replacement. It is a possible change,
not an implemented optimization.

Notice another measurement trap: the constructor converts vectors with
`np.asarray(raw_matrix, dtype=float)` and then normalizes them. On the usual
NumPy configuration this means float64, even if the stored artifact uses
float32. For 2,399 vectors of dimension 384, raw float32 storage is 3,684,864
bytes; a float64 matrix alone is 7,369,728 bytes. Neither number is process RAM.
Temporary matrices, model weights, Python objects and other allocations are
additional. Measure dtype and peak memory before claiming a memory improvement.

Similarly, a CUDA query encoder does not make the NumPy CPU matrix multiplication
or argsort run on the GPU. Profile the stages separately before choosing a new
backend. A larger corpus might justify ANN indexing or a service boundary, but
neither is proved necessary by the present corpus size alone.

## Lexical and semantic signals have different failure modes

The lexical control uses `TfidfVectorizer(stop_words="english")` and cosine
similarity over TF-IDF vectors. It can reward exact terms that matter in financial
reports, but can miss paraphrases. Dense representations can find semantically
related text, but can over-rank neighboring fiscal periods or similar metrics.
There is no measured winner yet: compare both on the same labeled questions,
corpus snapshot and source scope.

### Course connection: weighted hybrid scoring is different from RRF

The CS496 course-posted `class2` original, physical PDF page 42, shows a weighted
combination of literal and semantic scores, `s = a*s1 + b*s2`, followed by Top-K.
Its first page credits Hung-yi Lee's ML2026 slides. That diagram does not specify
RRF and is not evidence that our isolated fusion helper implements the same policy.

For a synthetic example, let dense scores for A/B/C be `.9/.8/.2` and lexical
scores be `1/9/8`. Their equally weighted sum selects B. Divide all lexical scores
by 100: their lexical order is unchanged, but the sum now selects A. RRF uses
positions rather than these magnitudes, so this rescaling does not change its
result. This demonstrates score-scale dependence, not a measured quality advantage.

## Why reciprocal-rank fusion cannot use the dense threshold

The optional `reciprocal_rank_fusion` combines rankings, not raw similarities:

```text
RRF(document) = sum(1 / (60 + rank_in_list))
```

Suppose dense ranks A first, B second; lexical ranks B first, C second.
A receives 1/61, B receives 1/62 + 1/61, and C receives 1/62. B wins through
agreement across the lists. These numbers are synthetic worked values, not
observed retrieval quality. They are neither cosine similarities nor
probabilities. Reusing the dense 0.78 threshold on them would be meaningless.

The implementation rejects duplicate chunk IDs within one ranking and conflicting
chunk contents across rankings. It breaks fused-score ties by chunk ID. These
identity checks preserve the meaning of fusion; they do not verify financial
facts. Hybrid retrieval remains an isolated experiment, not the default classroom
acceptance path.

## Connect the arithmetic to software design

### Map official strategies to explicit experiment boundaries

The [Anyscale retrieval-strategy guide](https://docs.anyscale.com/rag/quality-improvement/retrieval-strategies)
was read in the in-app browser on October 4. It discusses query reformulation,
multiple queries, hybrid search, reranking, RRF, and exact structured predicates.
It distinguishes runtime hypothetical-document generation from indexing-time
hypothetical questions, with different latency, storage and quality tradeoffs.
Those options are not a checklist that every application must implement.

For this project, the implementation reviewed here establishes a dense baseline,
a TF-IDF control and an isolated RRF function. TF-IDF is not BM25. RRF is not a
cross-encoder. The inspected fiscal-year wrapper is rule-based routing, not
general query decomposition, SQL generation or an autonomous agent. Neither
HyDE nor reverse HyDE is established by these implementations.

Before any future variant is promoted, register its question set, candidate scope,
encoder/index revisions, score semantics and latency boundary. Use the same
source snapshot across variants. A proposed comparison should change one factor
at a time: lexical control versus dense; then fusion versus those controls;
then any reranker over a recorded common candidate pool. A reranker cannot
recover a relevant passage absent from that pool, so record candidate recall
before comparing final ranks. These are proposed measurements, not results.

For rewriting experiments, retain original and rewritten query text and have a
reviewer check whether the fiscal period and metric changed. A plausible
synthetic answer used for retrieval must never become the factual evidence or
the expected answer label. For structured lookups, exact period/metric fields
must derive from verified source structure rather than a guessed extraction.

This is a concrete application of the responsibility and dependency boundaries
discussed in the CS381 layering materials: a retriever owns candidate scoring,
not financial validation or UI wording. An injected encoder lets a consumer
replace representation without making the UI own model loading. The interface
still needs a score-semantic contract: the same `ScoredChunk` shape does not make
cosine and RRF interchangeable for a downstream threshold.

The CS310 client/server and multi-tier materials raise a separate question:
where should this work execute? A clean Python boundary helps testing, but does
not itself establish a network tier, scalability, latency isolation or production
deployment. First measure the existing request path, then justify a boundary.
The CS461/CS496 connections above cover the specified original pages, not entire
courses. They establish concepts to explain, not proof of personal mastery.

## One real CUDA trace, not a correctness score

The independent installed package was exercised on October 4 with the pinned
cached BGE encoder on `cuda:0` and the integrity-checked annual-report matrix.
`acceptance/real_retrieval.py` accepts an external reviewed artifact directory;
it neither copies nor modifies the classroom index and disables model downloads.

For the exact question `What was NVIDIA annual revenue in FY2025?`, the five
candidate PDF pages were 18, 170, 162, 144 and 149 of `nvidia-fy2025-annual`,
scoring 0.807257, 0.797554, 0.788096, 0.784264 and 0.765803. The similarity gate
passed, but the fifth candidate was below 0.78. Top-k retrieval and threshold
selection are consequently visible as separate operations in a real trace.

Preserve the exact question string with the trace. The October 7 classroom query
`What was NVIDIA's annual revenue in FY2025?` is a different observation from the
October 4 wording above. Its top score was 0.814609; that difference is not an
optimization result and must not overwrite the earlier receipt.

This is a single observed candidate ranking, not a held-out quality measurement.
No answer was generated, no HTTP API was exercised, and this run did not inspect
the original PDF's revenue row or fiscal-year column. Your next step is to check
the top candidate against the source and explain whether it answers the question,
not to treat `gate=True` as a correctness label. CUDA encoded the question; it
does not imply that the NumPy ranking arithmetic ran on the GPU.

### Follow the top candidate back to the original page

A subsequent source check identified the top chunk as
`nvidia-fy2025-annual:p18:50cdb6ce95041a87`. The local source PDF's SHA-256
matched its corpus-manifest record. Text extraction and a rendered-page review
then checked physical PDF page 18, whose printed footer is page 4. Its FY2025
results summary associates consolidated revenue with **$130.5 billion**; the
top chunk contains the corresponding narrative as well as the flattened summary.
This supports that one rounded reported figure, not a more precise amount or
every passage in the returned context.

The distinction is practical: on the same page, segment and market-platform
revenue figures appear alongside the consolidated result. A generator could
select a real number from the wrong scope. The displayed report's period,
consolidated-versus-segment metric and dollar/billion unit must all agree with
the question. Physical PDF page numbers and printed report page numbers also
must not be silently interchanged in citations.

Source: [NVIDIA FY2025 annual report](https://s201.q4cdn.com/141608511/files/doc_financials/2025/annual/NVIDIA-2025-Annual-Report.pdf).
This is an assistant-reviewed, already-exposed example, not an independent
held-out label or system accuracy result. The second candidate's page discusses
segment reporting among other topics; its high score alone does not establish
that the particular returned chunk answers the consolidated-revenue question.

## Reproduce before describing this as interview evidence

### Browser pilot: an encoder contract is more than a model name

Native parsing, source-linked chunking and **explicit passage encoding now have
bounded native-browser receipts**. The original two-page toy PDF produced two
384-dimensional rows and 24 actual encoded IDs on October 9. That observation
does not by itself establish query retrieval, financial relevance or generation.
The later owned question workflow separately completed native encoding and ranking
in the standalone lab and blog iframe. Independent code reviews passed; the
[question-to-page walkthrough](01-two-lifecycles.html#from-your-exact-question-to-its-candidate-page)
records the actual bounded run. Primary model
cards were read in Codex IAB to specify this experiment, not to claim a new
benchmark. The [fixed Xenova MiniLM ONNX card](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/README.md)
shows mean pooling, normalization and 384-dimensional vectors. Its
[upstream card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
describes short English sentences/paragraphs and default truncation beyond 256
word pieces. A 500-word financial chunk cannot simply be declared fully encoded.
The selected tokenizer must measure the actual inputs. This pilot refuses more
than **256 total encoded IDs including special tokens**, rather than silently
truncating. That is an explicit conservative policy: the downloaded tokenizer
configuration declares a maximum of 512, and neither declaration proves every
long financial window is usefully represented. Source-linked UTF-16 windows and
model tokens are different measurements.

For the pilot, both passage and query encoding must bind to the same repository
revision, tokenizer, pooling, normalization, dtype and token-length policy. The
fixed revision is `751bff37182d3f1213fa05d7196b954e230abad9`.
`embedding-contract.mjs` freezes this identity, 384 dimensions, attention-mask
mean pooling and L2 normalization. The fp32 weight file was downloaded into an
ignored local cache: 90,387,606 bytes, with its upstream SHA-256 independently
matched. All five model files total 91,100,408 bytes. Downloaded bytes are not
process RAM or GPU memory. The separately recorded passage trial used the complete
113,629,084-byte model-plus-runtime asset set, not only the weight file. Its attempt
receipt includes loading, initialization, encoding and cleanup; it is not isolated
GPU time or a general performance benchmark.

The pinned Transformers.js 3.8.1 high-level feature-extraction implementation
sets `truncation:true`. Our shared lower-level encoder instead tokenizes explicitly
without truncation and validates the IDs **before inference**. For token hidden
vectors `h[t]` and attention mask `m[t]`, the representation is:

```text
pooled[i] = sum_t(m[t] * h[t,i]) / sum_t(m[t])
vector[i] = pooled[i] / sqrt(sum_j(pooled[j]^2))
```

The mask excludes padding; it does not identify the correct financial column.
The current pure boundary rejects missing rows, nonfinite coordinates, zero
vectors and norms outside `abs(norm - 1) <= 1e-4`; it does not repair a bad vector
and report success. Contract tests establish those refusal boundaries; they are
not substitutes for native model output or independently labelled retrieval quality.
The [fixed WebGPU guide](https://huggingface.co/docs/transformers.js/v3.8.1/guides/webgpu)
and [local model settings](https://huggingface.co/docs/transformers.js/v3.8.1/custom_usage)
provide the runtime basis; selecting a WebGPU provider is not proof every
operator or the JavaScript pooling step executes on the GPU.

### Read the browser ranker without importing the Python threshold

The browser's `retrieval.mjs` consumes the accepted page-window artifact, its
ordered passage vectors and a separately encoded query with the exact same
representation contract. It validates source SHA-256 and chunk order before
scoring. At most 512 rows enter this pilot; it scans all 384 components of every
row, sorts by descending cosine and breaks an exact score tie by original ordinal.
It retains the dot product and both norms rather than assuming unit norms are
mathematically exact. Top-k controls returned candidates, not financial confidence.

The owned query worker uses the shared real encoder, then this pure ranker.
Before publishing, the main-thread boundary copies the numerical artifact and
recomputes the same ranking to reject altered scores, source identities or order.
This check protects transfer consistency. It is not a second model, a relevance
judge, or evidence that the selected passage answers the question. Controlled
worker tests exercise that composition. The separate native fixture receipt
contains eight query token IDs, a finite 384-dimensional vector and candidate
cosines 0.358194 / 0.199773 for physical pages 2 / 1. These numbers establish
execution on this toy fixture, not financial relevance, calibration or an answer.

There is no question rewrite or instruction prefix in this variant. The original,
resolved and encoder-input strings must be the same captured raw question. The
query has its own token/vector artifact and asset-attempt receipt; the historical
passage receipt is not charged again as a new passage-encoding run. No browser
0.78 gate is inherited from the Python BGE index. A MiniLM score belongs to this
representation and candidate scope, not to that earlier experiment.

Ask yourself: why can two encoders both output 384 floats yet produce
incompatible indexes? Why can mean pooling over silently truncated text make a
retrieval candidate misleading? Answer those questions before swapping the
Python BGE matrix into a browser demo. Matching dimensions is necessary but not
sufficient. Retrieval similarity and financially checked release remain
different responsibilities even when all computation moves into a browser.

### Follow the browser's score from its 384 component products

Open the lab's **Notebook** after a successful query, then expand **Inspect how similarity selects passages**. The comparison includes every retained passage, not just
the selected Top K. Each row identifies its source chunk and physical page, shows
its signed cosine, and names whether it was selected. Exact ties keep the original
source ordinal. The Top K boundary is a selection budget; it is not a truth
threshold, and no Python BGE `0.78` gate is applied to these MiniLM scores.

Choose a passage to inspect the arithmetic. The component table preserves the
384 model coordinates in order. For each coordinate it shows the query value,
passage value, their product and the cumulative dot product. The displayed scalar
formula then divides the final dot product by the separately measured query and
passage norms. A norm accepted within the existing `1e-4` tolerance need not be
exactly one, so silently using only the dot product would explain the wrong
calculation. This follows the normalized-dot-product definition in the
[scikit-learn cosine reference](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.pairwise.cosine_similarity.html).

The view is explicitly a **post-acceptance inspection recomputation**. It reads
the accepted source, chunk, passage and query artifacts, uses the same exact
ranker over all retained rows, and checks the selected prefix and scalar values
against the accepted retrieval before showing anything. It does not call the
encoder again, add a worker receipt, change the accepted ranking, or populate a
missing result with sample data. A failed consistency check withholds the view
while leaving the underlying session artifacts intact.

Row windows keep large comparisons readable. Complete JSON downloads retain all
rows and the unrounded numerical values; the chart's concise labels are a display
choice. Negative values extend left of zero, positive values extend right, and
selection is also named in text. Each dimension is a learned model coordinate;
this view does not assign it a word, topic or financial meaning. It explains how
a passage was ranked, not whether its amount, period or citation is correct.

For a synthetic rehearsal, use q=(0.6,0.8), A=(1,0), B=(0,1), and C=(-1,0).
The component sums are 0.6, 0.8 and -0.6, and all norms are one. With K=2, B and
A are selected; C remains visible below the boundary. This is a hand-worked
example, not an observed model result. In the actual notebook, compare the
component record with your downloaded query and passage vectors, then follow
the selected chunk back to its PDF page before treating it as evidence.

### The generator has a different token budget

At the October 9 checkpoint, the next browser increment was still planned.
The later [public native draft](07-operational-receipts.html#a-public-model-run-with-its-evidence-preserved)
has its own dated execution and archive evidence; that observation does not
establish financial accuracy or performance on other devices. The declared
software window reserves 128 output tokens within a combined
2,048-token prompt/output ceiling. That leaves at most 1,920 input tokens, not
2,048 tokens of evidence. The input includes the system instruction, your exact
question, selected evidence headers and text, chat-role delimiters and the
assistant-generation prefix. It must be counted with the paired Qwen tokenizer
after rendering the complete prompt, without silent truncation. Neither 512
UTF-16 units per chunk nor MiniLM's 256-ID encoding budget answers that question.

The [fixed Qwen model configuration](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/blob/22942cb7d7ba4cc81bb4673549ca4d4614469b5e/config.json)
declares 32,768 model positions. That architectural limit does not prove a
reader's GPU can run that context; the smaller 2,048-token pilot limit is a
software policy, not a measured memory guarantee. For rehearsal, suppose the
whole rendered prompt has 1,921 tokens and the output cap is 128. Explain why the
first policy must refuse it even though it is far below 32,768. Shortening your
question invisibly would change the request; cutting a financial quote could
remove its period or unit. A future explicit whole-evidence omission policy must
retain its omissions and recount the exact prompt rather than claim all
candidates reached the model.

1. Hand-calculate the two-dimensional cosine example without an assistant.
2. Find normalization, candidate selection and sorting in the source.
3. Explain why the report year can differ from a financial column year.
4. Calculate the RRF example and explain why 0.78 cannot be transferred.
5. Trace a real candidate back to its PDF and verify the period, metric and unit.

Only a personally reproduced explanation and source check supports a mastery
claim. Passing a software test or watching the demo is not a substitute.

Next: [evaluation labels before scores](06-evaluation-labels-before-scores.html).
