---
title: From installation to a source-bound service
tags: [rag, api, packaging, software-design, provenance]
category: technical-blog
status: development-notes
created: 2026-10-13
updated: 2026-10-13
source_type: implementation-and-official-documentation-review
---

# From installation to a source-bound service

Installing a package gives an application code to run. It does not tell that application which financial reports it may use, which fiscal periods those reports represent, or whether the files on disk still match the prepared corpus.

That was a practical gap in this project. The HTTP source-cell selector could receive an index from Python, but an operator needed a supported way to assemble that index from local inputs after installing the wheel. The installed `nvidia-rag-serve-corpus` command now performs that assembly before opening a listener. Its lexical query route returns passages; its optional statement route selects supported Net income cells from original PDFs.

This chapter follows that startup boundary. For the reader-device model workflow, [open the browser lab](browser-rag/inspector.html). For the request and response fields, [read the execution-contract chapter](07-operational-receipts.html#inspect-a-source-candidate-through-its-own-http-contract).

## Decide what the service will serve

Suppose an operator registers an annual report as `nvidia-fy2025-annual`. A caller can then ask for Net income for the year ended January 26, 2025 and explicitly select that registered ID. The ID and date in this example are meaningful only when they match the operator's own report and configuration.

Three inputs serve different purposes:

- **The source registry** names reports and records their PDF hashes and source metadata. A hash is a fingerprint of bytes: a different PDF cannot quietly reuse the recorded identity.
- **The completed corpus** contains `manifest.json`, `chunks.jsonl` and `build-receipt.json`. Startup verifies their hashes, source associations, actual memberships and counts before building the TF-IDF passage service.
- **The optional fiscal declarations** bind an explicit fiscal year and annual/null or quarterly/1–4 identity to registered PDF bytes. A separate PDF directory holds the originals from which statement cells are extracted.

The loader does not infer a fiscal year from a filename or a calendar end date. Declarations carry `reviewed_by` and `source_locator` metadata, but those strings do not verify that an independent person reviewed the report. Matching hashes establish local byte identity; they do not establish publisher authenticity or financial correctness. The [versioned startup guide](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/docs/verified-corpus-startup.md) defines the exact input schema and path limits.

<figure class="architecture-figure" aria-label="Installed corpus API startup and optional statement snapshot">
<div class="figure-heading"><span class="figure-status">INSTALLED CORPUS STARTUP / SOURCE B94C92F</span><h3>Prepare the application before opening its listener.</h3><p>Follow accepted settings through verified passage data, the optional statement snapshot and a final input check. The dashed branch leaves statement selection unconfigured.</p></div>
<iframe src="figures/corpus-startup.archify.html?theme=light" title="Archify map of the installed corpus startup path" loading="lazy"></iframe>
<figcaption>Startup composition, with each component linked to its pinned source. Only accepted inputs advance; a failed startup check prevents listening. Original PDFs can produce retained layout omissions without invalidating startup. Editable <a href="figures/corpus-startup.archify.json">JSON</a> · <a href="figures/corpus-startup.archify.html?theme=light">Open full-size ↗</a>. This diagram explains the installed corpus launcher; it does not depict a GPU model run.</figcaption>
</figure>

## Build once, then select from the snapshot

The factory resolves the private API token and checks the statement option pair before corpus I/O. CLI argument parsing happens earlier. It then captures the corpus identities, loads the verified artifacts and builds the lexical service for the configured document scope.

When both statement options are present, startup reads only the selected declared PDFs, checks their exact bytes and extracts source cells. The index retains cells and omissions in immutable tuples. The same `document_ids` scope constrains the lexical service and the statement snapshot; an unknown scope cannot silently fall back to all documents. These responsibilities meet in [the installed factory](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/src/nvidia_rag/serving.py#L81-L105) and [the statement loader](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/src/nvidia_rag/statement_startup.py#L221-L256).

After application construction, the factory rechecks the retained registry, corpus, declaration and selected-PDF identities. A changed input at this boundary prevents listening. This is a bounded startup check. It does not lock the filesystem or continuously watch it after startup; replacing files later does not refresh the in-memory index. A new reviewed input set needs a new application startup.

Requests carry the original question and registered document IDs. They do not carry local PDF paths, reload PDFs or build the index. The selector uses the snapshot to find exactly supported fields; the HTTP adapter handles authentication, input bounds and response serialization. That split lets another application consume a stable response without owning the PDF parser.

## Leaving a feature off differs from configuring it incorrectly

An operator may want lexical evidence without statement selection. That is a supported mode. Supplying an incomplete or invalid statement configuration is a different event.

| Startup configuration | Listener | Authenticated statement request |
| --- | --- | --- |
| Both statement options omitted; valid remaining startup inputs and settings | Starts with the lexical service | HTTP 503, `STATEMENT_INDEX_NOT_CONFIGURED` |
| Both supplied with accepted inputs | Starts after construction and rechecks | Selector completes with a candidate, clarification, refusal or unsupported outcome |
| One option missing, invalid requested inputs, or a failed retained-input check | Does not start | There is no listening service to answer |

For statement requests, authentication precedes body parsing: invalid credentials receive 401. A successful selection returns HTTP 200, while its `disposition` describes the content outcome. An operational selection or serialization failure returns 503 with empty cells. A source candidate remains explicitly financially unadjudicated. A caller therefore needs to read both the HTTP status and the result fields. The [statement HTTP contract](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/docs/statement-http-api.md) documents the exact response and error behavior.

## Make installation an actual entry point

The package declares `nvidia-rag-serve-corpus = "nvidia_rag.serving:main"` in `pyproject.toml`. The [PyPA guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#creating-executable-scripts) explains how the `project.scripts` table creates an installed command. Keeping the entry point inside the package makes it usable outside a source checkout.

After installing the selected wheel with its `[api]` dependencies and privately setting `NVIDIA_RAG_API_TOKEN`, an operator can use the equivalent isolated module entry:

```text
python -I -B -m nvidia_rag.serving --artifact-dir <absolute-corpus-dir> --source-registry <absolute-registry.json> --statement-source-dir <absolute-PDF-dir> --statement-fiscal-declarations <absolute-declarations.json> --document-id nvidia-fy2025-annual --threshold 0.01 --top-k 5
```

Replace every bracketed path with a prepared absolute local path and use a registered document ID. The threshold is an explicit lexical inspection setting, not a calibrated financial accuracy threshold. The default listener is `127.0.0.1:8000`. The guide also supplies a Python factory example and a container recipe with external inputs mounted read-only.

Different entry points own different work:

| Runtime | Retrieval and output | Statement startup scope |
| --- | --- | --- |
| Installed corpus command | TF-IDF passages; optional native PDF source-cell selection; no model download or generation | Repeatable `--document-id` constrains both services |
| Source-tree `run_api.py` | BGE retrieval and its configured optional generator | Optional three-flag statement configuration binds to the full configured registry and corpus; no `--document-id` startup option |
| Browser lab | Reader-owned PDF, MiniLM embeddings and explicit Qwen generation on the reader's device | Independent local PDF and explicit-field comparator; does not call this Python API |

The [model launcher](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/run_api.py#L113-L200) retains its model configuration and rechecks the optional statement inputs after model/application construction. Wiring that configuration is separate from executing and evaluating those models.

A later CPU run exercised the current model launcher with the original ten-report corpus, cached BGE and generation disabled. Three model queries and six statement requests completed through actual HTTP. The first attempt failed an observation check; a corrected probe then recorded one model construction and three encodes, with unchanged inputs and owned shutdown. The detailed [model startup diagnostic](https://github.com/1235357/nvidia-financial-rag/blob/0a87ba5435798db65ced77f4ea600859452a050a/docs/current-source-model-http.md) keeps both attempts and their separate results.

The run also exposed a concrete retrieval problem. Both questions about Q2 Net income passed the similarity threshold but returned the annual overview, which lacks the requested row, date and three-month or six-month column. The existing annual router had selected the wrong report before ranking. A working listener therefore does not establish that its passages support a financial question. That observation motivated the source-bound annual and quarterly routing described below; lowering the threshold or rewriting these questions would not repair that boundary.

## Choose the report before comparing passages

The next implementation separates report identity from the date of a financial column. Its catalog binds each report to the retained PDF hash and fiscal declaration, while column dates and durations come from the extracted source cells. A question naming the fiscal 2025 Q2 report first selects that report; its valid 2023 comparison column can still be used. Conflicting or ambiguous restrictions yield no unrelated fallback passages.

The same three exposed questions then ran with the original PDFs, chunks, cached BGE and threshold. Both quarter questions now ranked only within the Q2 report's 211 passages. The annual response remained exactly the same. An independent audit recomputed every considered dot product from the retained passage vectors and captured query vectors; all three maximum score differences were zero.

| Q2 question | Highest candidate before the gate | Returned evidence at the unchanged 0.78 gate |
| --- | --- | --- |
| Three-month Net income ended July 28, 2024 | Q2 physical page 4; score 0.78718 | One Q2 passage |
| Six-month Net income ended July 28, 2024 | Q2 physical page 3; score 0.77838 | Empty |

The first post-change attempt timed out before observing model or HTTP work. The preserved retry changed only repeated path construction in the passive observer and kept the same 180-second limit. It completed one model construction, three encodes and 16 HTTP responses, then closed its owned processes and listener. These are development integration observations. Correct report scope still leaves the six-month retrieval gap visible, and neither a cosine score nor an empty response supplies a reviewed financial answer. The [source-bound routing guide](https://github.com/1235357/nvidia-financial-rag/blob/2e49c25308c71499c417904c7fbd9d7a4735557f/docs/source-bound-period-routing.md) keeps the implementation boundary and acceptance details.

## Keep the row and its column together

A report can be correct while its passage representation loses the relationship a question needs. Plain PDF text can put four values after one row label without preserving which date and duration own each value. A source-field passage now keeps that row, column, date, duration, comparison role and unit together, with the original text spans and page rectangles attached.

The unit is part of the evidence. Two rows both named **Basic** can describe different quantities:

| Source section and row | Retained meaning | Scale |
| --- | --- | --- |
| Monetary statement · Net income | A monetary amount with the printed currency symbol | Source millions |
| Net income per share · Basic | An amount per share | One per-share unit |
| Weighted average shares · Basic | A share count without currency | Source millions of shares |

The new builder produced 531 passages from ten original reports and retained six extraction omissions. A fresh reader rebuilt the original source index and reproduced the complete artifact; an independently installed wheel produced identical files. Printed `$` is retained without inferring an ISO currency code. This completes source representation and replay, while new field-vector ranking and financial answer evaluation remain open. The [source-field guide and dated evidence](https://github.com/1235357/nvidia-financial-rag/blob/7039b98daea7fd25c3f3d0f2e87284211605637a/docs/source-field-passages.md) describe that boundary. The original raw passages and vectors remain available for comparison.

## Connect the design to the course work

CS310's introduction to web services describes addresses, request/response messages, headers, bodies and status codes. Those ideas matter when a consuming application distinguishes a missing statement feature from a completed selection. In this project, a running service provides a terminal HTTP result; a failed startup is an operator error before the client can connect. The relevant lecture is `cs310-intro-web-services.pdf`, physical pages 4, 6, 9 and 17.

CS381's continuation on layering separates presentation, domain and data-source responsibilities and discusses dependency direction and oversized classes. Here, the startup factory composes dependencies, the source loader reads files, the selector matches supported financial fields, and the HTTP adapter presents the result. This particular split is a project design choice. The relevant lecture is `slides-software-architecture-layering-cont_2026-10-08.pdf`, physical pages 6, 11, 14 and 16; its allowed dependencies are broader than a single mandatory call chain.

A useful learner exercise is to change one dependency and predict the caller's experience:

1. Omit both statement options. Explain why lexical evidence can remain available while an authenticated statement request returns 503.
2. Supply only one statement option. Identify which owner refuses the configuration and why no request-time response exists.
3. With valid inputs, simulate an input change during application construction. Identify the final check that prevents listening, then sketch which components read files and which select a cell from memory.

This is a proposed exercise, not a claim that a learner completed it. Replacing source I/O while keeping the selector and HTTP response unchanged is a concrete way to examine the dependency boundary.

## Read the acceptance evidence at its actual scope

The [official corrected startup run](https://github.com/1235357/nvidia-financial-rag/actions/runs/38428973799) used revision `9687491a8c006a91ae2902689c1594a28cfe3e2c`. Its downloaded Linux and Windows archives each bind 842 passing tests, 20 exact installed production modules, 27 valid wheel records and 44 real loopback HTTP checks across three startup modes. The container archive separately records 26 HTTP checks across configured and unconfigured services with a read-only root and source mount, UID/GID `10001:10001`, dropped capabilities and owned shutdown. Docker healthcheck status during stop is not deployment-health acceptance.

The [sanitized release metadata](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/docs/acceptance/enterprise-startup-release-20261013.json) preserves those archive identities and the earlier permissions failure. Revision `b94c92f` publishes the guide and metadata with unchanged production modules. These installed checks use independent synthetic native tables to test transport and startup behavior. They do not provide a human-reviewed financial accuracy denominator or demonstrate a new model run.

[Anyscale's production RAG guide](https://docs.anyscale.com/rag/production-scalability#decouple-storage) separates expensive ingestion from storage ingestion so a later failure need not repeat all computation. This project's completed-corpus boundary applies that separation at a local scale; it does not implement Ray Data or a distributed vector database. The guide also calls for [quality evaluation in CI](https://docs.anyscale.com/rag/production-scalability#automate-testing). The next evaluation gate here needs independently reviewed financial questions, source fields and expected outcomes. Packaging, public hosting, tenant authorization, load measurements and financial adjudication remain distinct work.

Continue with [the computation lab](browser-rag/inspector.html#computation-notebook) to inspect the browser's intermediate artifacts, or [the earlier execution-contract chapter](07-operational-receipts.html) for context ownership, cancellation and failure semantics.
