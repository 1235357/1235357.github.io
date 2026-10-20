---
title: From installation to a source-bound service
tags: [rag, api, packaging, software-design, provenance]
category: technical-blog
status: development-notes
created: 2026-10-13
updated: 2026-10-14
source_type: implementation-and-official-documentation-review
---

# From installation to a source-bound service

Installing a package supplies code. Starting a financial service also requires a decision about which reports it will serve. The installed `nvidia-rag-serve-corpus` command verifies prepared local inputs before opening its network listener.

Its lexical route returns passages matched by TF-IDF, a word-based retrieval method. An optional statement index holds cells extracted from original PDF tables. The literal-question route selects supported Net income cells; a typed route accepts explicit field constraints.

**The learning goal:** given a configuration and request, predict whether startup stops, a feature is unavailable, or selection completes. Identify which input controls that outcome. We will follow one annual-report configuration through those decisions.

Try the model workflow in [the browser lab](browser-rag/inspector.html), or look up request and response fields in [the execution-contract chapter](07-operational-receipts.html#inspect-a-source-candidate-through-its-own-http-contract).

## Decide what the service will serve

Suppose the operator serves `nvidia-fy2025-annual` and a caller asks for Net income for the year ended January 26, 2025. Three kinds of startup input connect that request to its source:

| Startup input | Responsibility | In this annual-report example |
| --- | --- | --- |
| Source registry | Names each report, its PDF hash and source metadata | Connects `nvidia-fy2025-annual` to one registered PDF identity |
| Completed corpus | Supplies `manifest.json`, `chunks.jsonl` and `build-receipt.json` for passage retrieval | Keeps this report's chunks associated with the same registered identity; startup verifies hashes, actual memberships and counts |
| Optional statement inputs | Supply the original PDF directory and fiscal declarations together | Bind the same PDF bytes to fiscal year `2025` and annual quarter `null`, then extract its table cells |

A **hash** is a fingerprint of bytes: replacing a registered PDF with different bytes breaks the match. A **fiscal declaration** adds a different fact: which fiscal year and annual or quarterly report those bytes represent. Quarterly declarations use `1`–`4`; annual declarations use `null`. The loader does not guess this identity from a filename or calendar end date.

The caller's ID and date must match this configuration. Matching hashes establish local byte identity, not publisher authenticity or financial correctness. Declaration strings such as `reviewed_by` and `source_locator` do not prove independent human review. The [versioned startup guide](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/docs/verified-corpus-startup.md) defines the schemas and path limits.

<figure class="architecture-figure" aria-label="Installed corpus API startup and optional statement snapshot">
<div class="figure-heading"><span class="figure-status">INSTALLED CORPUS STARTUP / SOURCE B94C92F</span><p>Follow accepted settings through verified passage data, the optional statement snapshot and a final input check. The dashed branch leaves statement selection unconfigured.</p></div>
<iframe src="figures/corpus-startup.archify.html?theme=light" title="Archify map of the installed corpus startup path" loading="lazy"></iframe>
<figcaption>Startup composition, with each component linked to its pinned source. Only accepted inputs advance; a failed startup check prevents listening. Original PDFs can produce retained layout omissions without invalidating startup. Editable <a href="figures/corpus-startup.archify.json">JSON</a> · <a href="figures/corpus-startup.archify.html?theme=light">Open full-size ↗</a>. This diagram explains the installed corpus launcher; it does not depict a GPU model run.</figcaption>
</figure>

## Build once, then select from the snapshot

The startup factory assembles the application's components. After CLI argument parsing, it resolves the private API token and checks that the statement options are paired, before corpus I/O. It captures input identities, loads the verified corpus and builds the lexical service for the configured document scope.

With both statement options present, the loader checks and extracts cells from the selected declared PDFs. Cells and extraction omissions stay in immutable tuples: requests receive a snapshot, rather than a PDF to parse again. Selecting only `nvidia-fy2025-annual` constrains both services; an unknown scope cannot silently expand to all reports. See [the installed factory](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/src/nvidia_rag/serving.py#L81-L105) and [the statement loader](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/src/nvidia_rag/statement_startup.py#L221-L256).

Before returning the application to the listener, the factory rechecks the registry, corpus, declaration and selected-PDF identities. Changes during construction stop startup. This bounded check does not lock or watch the filesystem afterward: replacing a PDF leaves the in-memory index unchanged. New reviewed inputs require a new application startup.

Now the annual Net income request can arrive. The literal route receives the question and registered document IDs; the typed route receives field constraints. Neither receives PDF paths or rebuilds the index. Selection uses the snapshot; the HTTP adapter handles authentication, input bounds and response serialization. The consuming application need not own a PDF parser.

## Leaving a feature off differs from configuring it incorrectly

Omitting both statement options supports passage retrieval alone. Supplying one without the other rejects startup. The observable difference is:

| Startup configuration | Listener | Authenticated statement request |
| --- | --- | --- |
| Both statement options omitted; valid remaining startup inputs and settings | Starts with the lexical service | HTTP 503, `STATEMENT_INDEX_NOT_CONFIGURED` |
| Both supplied with accepted inputs | Starts after construction and rechecks | Selector completes with a candidate, clarification, refusal or unsupported outcome |
| One option missing, invalid requested inputs, or a failed retained-input check | Does not start | There is no listening service to answer |

Once a listener is running, read the HTTP status and result together. Invalid credentials receive 401 before a statement body is parsed. HTTP 200 means selection completed; `disposition` tells the caller whether it found a source candidate, needs clarification, refuses, or does not support the request. A completed refusal can therefore have HTTP 200 and empty cells. An operational selection or serialization failure returns 503 with empty cells.

Even a returned candidate remains financially unadjudicated. Transport success, selection success and financial correctness answer different questions. The [statement HTTP contract](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/docs/statement-http-api.md) documents the exact response and error behavior.

## Make installation an actual entry point

The package declares `nvidia-rag-serve-corpus = "nvidia_rag.serving:main"` in `pyproject.toml`, making the service usable outside a source checkout. The [PyPA guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#creating-executable-scripts) explains this `project.scripts` entry.

After installing the selected wheel with its `[api]` dependencies and privately setting `NVIDIA_RAG_API_TOKEN`, the equivalent isolated module entry can use our annual-report configuration. Here is the PowerShell form; replace each bracketed path with a prepared absolute local path:

```powershell
python -I -B -m nvidia_rag.serving `
  --artifact-dir "<absolute-corpus-dir>" `
  --source-registry "<absolute-registry.json>" `
  --statement-source-dir "<absolute-PDF-dir>" `
  --statement-fiscal-declarations "<absolute-declarations.json>" `
  --document-id nvidia-fy2025-annual --threshold 0.01 --top-k 5
```

The first two paths supply the corpus and registry; the next two enable statement selection together. `--document-id` chooses the scope. The threshold `0.01` is a lexical inspection setting, not a calibrated financial accuracy threshold. The default listener is `127.0.0.1:8000`. The guide also gives a Python factory example and a container recipe with external inputs mounted read-only.

Different entry points own different work:

| Runtime | Retrieval and output | Statement startup scope |
| --- | --- | --- |
| Installed corpus command | TF-IDF passages; optional native PDF source-cell selection; no model download or generation | Repeatable `--document-id` constrains both services |
| Source-tree `run_api.py` | BGE retrieval and its configured optional generator | Optional three-flag statement configuration binds to the full configured registry and corpus; no `--document-id` startup option |
| Browser lab | Reader-owned PDF, MiniLM embeddings and explicit Qwen generation on the reader's device | Independent local PDF and explicit-field comparator; does not call this Python API |

The [model launcher](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/run_api.py#L113-L200) separately retains its model configuration and rechecks optional statement inputs after model/application construction. Configuring that path and observing a real model run are separate work.

A CPU development run exposed the next problem: both Q2 Net income questions passed the similarity threshold but returned an annual overview. That passage lacked the requested row, date and three-month or six-month column. The annual router had chosen the wrong report before ranking. Lowering the threshold or rewriting the questions would not repair that report boundary.

<details>
<summary>What the model startup run observed</summary>

<p>The run used the original ten-report corpus, cached BGE and generation disabled. Three model queries and six statement requests completed through actual HTTP. The first attempt failed an observation check; a corrected probe recorded one model construction and three encodes, unchanged inputs and owned shutdown. The <a href="https://github.com/1235357/nvidia-financial-rag/blob/0a87ba5435798db65ced77f4ea600859452a050a/docs/current-source-model-http.md">model startup diagnostic</a> retains both attempts and their separate results.</p>

</details>

## Choose the report before comparing passages

The repair selects the report before ranking passages. Its catalog binds each report to a PDF hash and fiscal declaration; extracted cells supply column dates and durations. A fiscal 2025 Q2 report can contain a valid 2023 comparison column. Report identity and column year are different constraints. Conflicting or ambiguous restrictions yield no unrelated fallback passages.

With that boundary in place, the same three exposed questions ran against the original PDFs, chunks, cached BGE and threshold. Both quarter questions ranked only within the Q2 report's 211 passages; the annual response remained exactly the same. This fixed report scope but left a visible retrieval gap:

| Q2 question | Highest candidate before the gate | Returned evidence at the unchanged 0.78 gate |
| --- | --- | --- |
| Three-month Net income ended July 28, 2024 | Q2 physical page 4; score 0.78718 | One Q2 passage |
| Six-month Net income ended July 28, 2024 | Q2 physical page 3; score 0.77838 | Empty |

The six-month candidate scored below the unchanged gate, so the returned evidence was empty. The three-month passage cleared the gate, but a cosine score alone does not establish that it supports a financial answer. The [source-bound routing guide](https://github.com/1235357/nvidia-financial-rag/blob/2e49c25308c71499c417904c7fbd9d7a4735557f/docs/source-bound-period-routing.md) retains the implementation and acceptance details.

<details>
<summary>Routing-run arithmetic and execution boundary</summary>

<p>An independent audit recomputed every considered dot product from retained passage vectors and captured query vectors; all three maximum score differences were zero. This checks the retained ranking arithmetic, not financial answer support.</p>

<p>The first post-change attempt timed out before observing model or HTTP work. The retained retry changed only repeated path construction in the passive observer and kept the same 180-second limit. It completed one model construction, three encodes and 16 HTTP responses, then closed its owned processes and listener. These remain development integration observations.</p>

</details>

## Keep the row and its column together

A question can reach the correct report and still lose the relationship it needs. Imagine PDF text containing one Net income label followed by four values. Which value belongs to the three-month column, and which to the six-month column? A source-field passage keeps the row, column, date, duration, comparison role and unit together, with original text spans and page rectangles attached.

The unit is part of the evidence. Two rows both named **Basic** can describe different quantities:

| Source section and row | Retained meaning | Scale |
| --- | --- | --- |
| Monetary statement · Net income | A monetary amount with the printed currency symbol | Source millions |
| Net income per share · Basic | An amount per share | One per-share unit |
| Weighted average shares · Basic | A share count without currency | Source millions of shares |

The builder produced 531 passages from ten original reports and retained six extraction omissions. A fresh reader rebuilt the source index and reproduced the complete artifact; an independently installed wheel produced identical files. Printed `$` stays literal, without inferring an ISO currency code. This established source representation and replay. Ranking those fields required a separate experiment, described next; financial answer evaluation remained open. The [source-field guide and dated evidence](https://github.com/1235357/nvidia-financial-rag/blob/7039b98daea7fd25c3f3d0f2e87284211605637a/docs/source-field-passages.md) retain that stage. Original raw passages and vectors remain available for comparison.

## A source field can still rank incorrectly

The next local experiment encoded all 531 source-field passages with the same cached BGE model and asked the same three exposed development questions. Top K stayed 5 and the cosine threshold stayed 0.78. **The native attempt failed its final module-origin audit and remains failed.** Its retained outputs support the separate diagnostic below; they do not establish an accepted end-to-end run.

The diagnostic asks a narrower question: where did the requested current field appear within its report, and would the unchanged gate retain it?

| Requested current field | Rank within its report | Cosine | Survives Top5 and threshold |
| --- | ---: | ---: | --- |
| FY2025 annual Revenue | 4 of 55 | 0.78443 | Yes |
| Q2 Net income, three months ended July 28, 2024 | 11 of 72 | 0.77810 | No |
| Q2 Net income, six months ended July 28, 2024 | 3 of 72 | 0.77460 | No |

For the three-month question, all five returned candidates passed the threshold, but described other metrics, including income before tax. The requested Net income field was absent from Top5. The six-month field ranked third but fell below the threshold. The annual result included the requested field alongside other metrics; that also does not establish a correct financial answer.

Keeping a row and column together preserves evidence relationships; it does not guarantee the encoder will rank the right relationship highly. **Source binding, similarity and answer support need separate checks.** This representation was not promoted into the production retriever.

<details>
<summary>Execution failure and diagnostic scope</summary>

<p>The native attempt completed its model encodes and queries, then failed its final module-origin audit on Torch's virtual <code>torch.ops</code> namespace. That attempt remains failed. A separate no-model process verified the retained arithmetic and replayed the original PDF bindings for all fifteen Top5 candidates; it cannot reconstruct the failed process's missing final origin inventory.</p>

<p>The <a href="https://github.com/1235357/nvidia-financial-rag/blob/e7cae56ac3700d80522f02975814bf592cd6d9ee/docs/source-field-bge-diagnostic.md">versioned diagnostic and exact values</a> preserve both outcomes. These three questions are development probes, with no independent human-gold or held-out set. The result supplies no financial accuracy or generation-quality claim.</p>

</details>

## Ask for a field with its unit

If a consuming application already knows its field, it can state the constraints directly. `POST /v1/statement-fields` accepts a section-qualified row path, native period and explicit unit contract, then selects from the same source snapshot. It does not turn those fields into a natural-language question or use cosine ranking.

Return to the two rows printed as **Basic**. A typed request separates their meanings explicitly:

| Intended quantity | `row_path` | `unit_kind` | `scale` | `currency_literal` |
| --- | --- | --- | --- | --- |
| Earnings per share | `per_share/basic` | `per_share` | `"1"` | `"$"` |
| Weighted average share count | `count/basic` | `count` | `"1000000"` | `null` |

The date and annual or month period must match too. Mixing the per-share row with the count unit withholds the candidate. Units are part of selection, rather than a display label added to an arbitrary number.

The response keeps the complete original cell: row, column, date, section, source spans and rectangles. It records the typed request and source-index hashes, with no invented question parse, generated answer or similarity score. The [versioned field-interface guide](https://github.com/1235357/nvidia-financial-rag/blob/771bbe2f11e20103def1e99ca2d4c9628dac75d0/docs/statement-fields-api.md) supplies a complete request example and refusal rules.

<details>
<summary>What the installed checks establish</summary>

<p>A fresh installed wheel reproduced all 531 retained cells from ten original reports through actual loopback HTTP, with four additional negative requests withholding cells. This makes the 60 per-share and 60 count cells accessible through an explicit typed interface; the literal selector already supported the 411 monetary cells. Independent generated PDFs separately exercised unit, source, authentication and operational-failure contracts.</p>

<p>These are installed-interface and source-derived development checks. They do not repair the dense retrieval result above, establish independent financial gold or demonstrate browser integration. The <a href="https://github.com/1235357/nvidia-financial-rag/blob/771bbe2f11e20103def1e99ca2d4c9628dac75d0/docs/acceptance/typed-statement-fields-20261014.json">dated local acceptance record</a> keeps those boundaries explicit.</p>

</details>

## Connect the design to the course work

The distinction between a failed startup and a completed refusal makes the web-service concepts concrete. CS310's introduction covers addresses, request/response messages, headers, bodies and status codes (`cs310-intro-web-services.pdf`, physical pages 4, 6, 9 and 17). Here, the client can inspect a terminal HTTP result only after a listener exists. Startup failure instead reaches the operator before a request can connect.

The responsibility split also makes layering visible. The startup factory composes dependencies; the loader reads source files; the selector matches supported fields in memory; the HTTP adapter presents the outcome. CS381 discusses presentation, domain and data-source responsibilities, dependency direction and oversized classes (`slides-software-architecture-layering-cont_2026-10-08.pdf`, physical pages 6, 11, 14 and 16). This project's split is one design choice; the lecture permits more than a single mandatory call chain.

**Predict before opening the feedback.** This newly authored practice changes the report scope and caller's intent. A valid registry and completed corpus contain both `nvidia-fy2025-annual` and `nvidia-fy2025-q2`. Both statement options are supplied with valid declarations, but startup selects only the annual ID. An authenticated client then sends a valid typed Net income request whose `document_ids` contains only the Q2 ID. Does startup read the Q2 PDF? Can this request expand the snapshot, or does it finish with an HTTP result? Write your prediction and the component responsible before continuing.

<details>
<summary>Compare your prediction with the contract</summary>

<p>Startup builds the lexical service and statement snapshot for the selected annual scope. The declaration file may cover Q2, but the statement loader does not read an unselected Q2 PDF. Once running, the typed selector finds that the requested Q2 ID is absent from its report snapshot. Selection completes with HTTP 200, <code>disposition: refuse</code>, <code>reason: OPERATOR_REPORT_UNAVAILABLE</code> and empty cells. The request neither loads a PDF nor expands the operator's startup scope.</p>

<p>If you predicted 503, compare a missing feature with a configured feature refusing this request. If you predicted a new PDF load, trace which component owns file I/O. Revise that explanation, then use a different configuration to check it again. This is authored practice with contract-based feedback, not an observed learner result, human-gold financial test or claim of mastery.</p>

</details>

## Read the acceptance evidence at its actual scope

The startup release checks answer an integration question: can an installed package accept the intended input configuration and expose the promised HTTP behavior? They use independent synthetic native tables. They do not provide a human-reviewed financial accuracy denominator or demonstrate a new model run.

<details>
<summary>Dated startup release: tests, installed files and HTTP assertions</summary>

<p>The <a href="https://github.com/1235357/nvidia-financial-rag/actions/runs/38428973799">official corrected startup run</a> used revision <code>9687491a8c006a91ae2902689c1594a28cfe3e2c</code>. Its downloaded Linux and Windows archives each bind 842 passing tests, 20 exact installed production modules, 27 valid wheel records and 44 assertions over actual loopback HTTP behavior across three startup modes.</p>

<p>The container archive separately records 26 assertions over HTTP behavior across configured and unconfigured services with a read-only root and source mount, UID/GID <code>10001:10001</code>, dropped capabilities and owned shutdown. Assertions are not counts of distinct HTTP requests. Docker healthcheck status during stop is not deployment-health acceptance.</p>

<p>The <a href="https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/docs/acceptance/enterprise-startup-release-20261013.json">sanitized release metadata</a> preserves these archive identities and the earlier permissions failure. Revision <code>b94c92f</code> publishes the guide and metadata with unchanged production modules.</p>

</details>

[Anyscale's production RAG guide](https://docs.anyscale.com/rag/production-scalability#decouple-storage) separates expensive ingestion from storage ingestion so a later failure need not repeat all computation. This project's completed-corpus boundary applies that separation at a local scale; it does not implement Ray Data or a distributed vector database. The guide also calls for [quality evaluation in CI](https://docs.anyscale.com/rag/production-scalability#automate-testing). The next evaluation gate here needs independently reviewed financial questions, source fields and expected outcomes. Packaging, public hosting, tenant authorization, load measurements and financial adjudication remain distinct work.

Continue with [the computation lab](browser-rag/inspector.html#computation-notebook) to inspect the browser's intermediate artifacts, or [the earlier execution-contract chapter](07-operational-receipts.html) for context ownership, cancellation and failure semantics.
