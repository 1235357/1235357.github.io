# Public source review — 2026-10-11

This is a public derivative of the dated source review. It keeps the RAG documentation, interface observations and original course-to-project connections; it does not replace the preserved review record or reproduce private classroom materials. The pages below were reviewed through Codex In-app Browser on October 11, 2026. These are reading observations and project decisions, not execution of upstream notebooks or replication of external benchmarks. The initial derivative used the preserved review; the later official course-page and inference-lecture read is dated separately below.

## Ten official RAG documentation pages

| Official page reviewed | Project connection |
| --- | --- |
| [Overview](https://docs.anyscale.com/rag) | Keep ingestion, query and generation as distinct quality and failure boundaries. |
| [Basics](https://docs.anyscale.com/rag/basics) | Preserve document/page metadata across the two-stage workflow. |
| [Quickstart](https://docs.anyscale.com/rag/quickstart) | The documented console template exposes seven notebook stages; this review did not create or execute its cloud resources. |
| [Evaluation](https://docs.anyscale.com/rag/evaluation) | Freeze independent labels and calibrate judges before reporting answer quality. |
| [Quality overview](https://docs.anyscale.com/rag/quality-improvement) | Select interventions from diagnosed failures and preserve a comparison baseline. |
| [Ingestion](https://docs.anyscale.com/rag/quality-improvement/data-ingestion-strategies) | Compare table/header-preserving extraction against the raw-text baseline. |
| [Retrieval](https://docs.anyscale.com/rag/quality-improvement/retrieval-strategies) | Test filters, lexical retrieval and reranking on a fixed corpus/query split. |
| [Generation](https://docs.anyscale.com/rag/quality-improvement/generation-strategies) | Preserve full context and token budgets; inspect citation identity separately from factual support. |
| [Structured data](https://docs.anyscale.com/rag/structured-data) | Keep controlled exact lookup separate from prose generation. The current bounded Net income comparator is a source-cell experiment, not arbitrary SQL/tool execution. |
| [Production](https://docs.anyscale.com/rag/production-scalability) | Separate ingestion artifacts from serving, record cold/warm stages and cache identity, and measure before making scale claims. |

This review covers those ten pages. Their links to Ray, evaluation frameworks, cloud notebooks, OCR services and other blogs were not all read transitively. Individual page authorship was not established by the review; these citations do not assign authorship based on an external attribution claim.

## Technical-blog presentation

The [Kunling Geng author listing](https://www.anyscale.com/blog?author=kunling-geng) showed six articles at the review date, including the post-training-skill article dated May 14, 2026 and the single-to-multi-agent architecture article dated May 7, 2026. This was a listing observation, not a fresh full-text review of all six posts.

[Cut coding agent costs by 90%: Secure LLM serving with Ray + vLLM on Anyscale](https://www.anyscale.com/blog/run-coding-agents-on-your-own-gpus), dated October 8, 2026 and credited to Kunling Geng, Aydin Abiar and Xing Fang, was read in full. Its useful presentation order is outcome, responsibility diagram, runnable configuration, workload-specific measurement and limitations. Model execution, replica orchestration and the client API contract are distinct layers. Its cost projections and hardware-specific results are external claims, not measurements of this RAG project.

## Original course-to-project connections

The following connections come from inspected course material and the project's actual contracts. Physical page numbers identify the reviewed conceptual source. Private slides, PDFs and screenshots are not reproduced; the exercises are original project work, not a course submission, endorsement, grade or mastery claim.

| Course material and inspected physical pages | Concrete connection and exercise |
| --- | --- |
| CS310 Scalable Software Architectures: web-services material, pages 4, 6, 9 and 17 | Request/response envelopes and error categories inform the service/worker boundaries. Trace one request ID through the Python HTTP response and compare that network service with a local Worker transport. |
| CS381 Software Design Principles and Practices: layering material, pages 6, 11, 14 and 16 | Separate presentation, domain and data responsibilities. The reviewed material permits Presentation-to-Domain and Presentation-to-Data Source dependencies; it does not require every data access to cross Domain. Map static imports and distinguish an upward response from an upward static dependency. |
| CS461 Large Language Models: Bengio neural-language-model material, pages 5, 9, 11 and 12 | Embeddings, logits, softmax and next-token loss explain computation, not external evidence support. Predict a token-budget boundary and distinguish cosine similarity from a next-token probability. The posted document carries a Spring 2026 footer; its classroom posting does not change that document date. |
| CS496 Agent AI: LLM-agent material, pages 27, 32, 40 and 41 | Memory, tools, planning, RAG and reflection provide a vocabulary for bounded components. Explain why the current fixed pipeline/explicit lookup does not demonstrate autonomous agent planning or successful reflection. |

The [execution-contract chapter](../articles/07-operational-receipts.md) develops these connections with repository behavior, source attribution, refusal paths and proposed interview exercises. Its architectural figures are authored illustrations; their stated evidence scope remains distinct from runtime deployment and financial quality.

## Additional course-page observation

The first opening of the [Hung-yi Lee 2026 Spring course page](https://speech.ee.ntu.edu.tw/~hylee/ml/2026-spring.php) timed out after showing the navigation and course heading. A later October 11 IAB read reached the complete visible schedule, homework table and footer. The schedule includes AI Agent, Context Engineering, Flash Attention/KV Cache, positional embeddings, Harness Engineering, Self-Correction and Self-Improving; the homework list includes instruction defense, fast inference and test-time scaling. This updates current page accessibility while preserving the earlier timeout observation. Listing those topics does not establish that their lectures, assignments or linked tools were all read or executed.

The official linked [inference lecture](https://speech.ee.ntu.edu.tw/~hylee/ml/ml2026-course-data/inference.pdf) was downloaded through IAB: 2,201,819 bytes, 55 physical pages, title `inference (v6)`, SHA-256 `f2eea056580ae5a14ee3de1697033041e9ebe9f1776190d73d593dfa3d434844`. Text extraction and root visual checks of physical pages 5, 35 and 55 support a bounded connection. Page 5 separates prompt prefill from autoregressive decode; the browser's current wall-clock receipt includes preparation, initialization and cleanup and supplies neither isolated prefill/decode time nor time to first token. Pages 29–35 and 55 explain KV-state reuse and its memory tradeoff. That cache is distinct from this site's SHA-verified static-file cache, which reduces repeated transfer and still requires verification before invocation. The lecture's architecture/hardware example is not a Qwen/WebGPU memory measurement. No video, linked notebook, assignment or hardware benchmark was executed for this review, and it establishes no learner-mastery claim.

## Browser application example

The [Hoothin image-upscaler](https://tool.hoothin.com/zh-CN/image-upscaler) interface and readable help text were reviewed. It exposed input/result panels, model/backend selection, a first-run loading notice, batch queue, output download and instructions describing local WebGL/WebGPU processing. No image/model action was run; its privacy/performance statements remain publisher claims. The useful project connection is a visible outcome, explicit preparation contract and inspectable progress, with this RAG app's actual behavior reviewed separately.

## Review boundaries and next evidence

The earlier ModelScope/Sirchmunk material remains a dated, unevaluated alternative; no new upstream release, source or performance verification was performed in this increment. Source/code, controlled tests, actual browser execution, deployment and financial adjudication are separate evidence. Preserve fixed questions, complete raw failures and source identities before testing a new ingestion/retrieval/model variant. No broad accuracy, all-device compatibility or production-capacity claim follows from this reading review.
