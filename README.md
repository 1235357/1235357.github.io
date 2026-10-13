# Zhentong Ye — personal portfolio and engineering journal

A personal GitHub Pages site introducing a Northwestern MSCS student, selected engineering projects and research, and a continuing technical journal. The homepage reflects the six experiences in the formal 2026-10-10 CV/CL; anonymous client work retains its design/prototype stage. The financial-RAG browser lab lets a reader choose a local PDF and inspect the source and computation behind a draft. The companion Python API is a different runtime and integration surface.

**Unified profile and RAG design:** the homepage, embedded workbench and standalone RAG page share cool light surfaces, dark navy text, cobalt actions and self-hosted Manrope, with consistent controls. The complete RAG UI includes source, token, vector, geometry and draft inspection under that same light theme. Six project/research records remain available; the journal keeps its separate dark reading layout. The selector uses one same-origin frame and supports future entries in `portfolio.json`. [Design notes](docs/light-home-design.md) record actual Emil skills installation, the complete interface refactor and scoped verification. The [historical light-home acceptance](docs/acceptance-2026-10-11/public-light-home-acceptance.json) binds `b4037fd`; its lab still used a dark theme. A [later retained-tab observation](docs/acceptance-2026-10-11/public-light-home-embedded-runtime.json) accepted parsing and five chunks; two explicit encoder attempts timed out. Historical runtime failures remain separate from the visual refactor.

**Historical personal-site publication:** the earlier six-project homepage and separate [engineering journal](https://1235357.github.io/journal.html) were accepted at `e86c50d63ffd80c935e41d56391dece306f92971`. [Workflow 38190839016](https://github.com/1235357/1235357.github.io/actions/runs/38190839016) passed Windows, Linux build and Pages deployment. The [scoped public acceptance](docs/acceptance-2026-10-11/public-personal-home-acceptance.json) retains that 315-file / 919,345,093-byte / 16-pin inventory and served-page checks. It does not accept the newer light design or repeat native financial evaluation.

**Accepted runtime release:** [1235357.github.io](https://1235357.github.io/) at `d75cc26a8fdf547537b3310e351a0a3fbbc7f9c5` passed Windows, Linux build and Pages deploy in [workflow 38184423254](https://github.com/1235357/1235357.github.io/actions/runs/38184423254). Its inspected [CI manifest](docs/acceptance-2026-10-11/public-hf-us-cdn-ci.json) records **314 files / 919,318,338 bytes / 16 pins**. The exact HF US CDN correction preserves path grammar and body pins. A fresh public session completed [generator preparation](docs/acceptance-2026-10-11/public-d75-generator-preparation.json), PDF parsing, five chunks, MiniLM passage/query encoding, three context units and native Qwen generation. The complete [RAW receipt](docs/acceptance-2026-10-11/public-d75-native-raw.json) and [original input](docs/acceptance-2026-10-11/public-d75-original8.json) passed [28 independent archive/replay checks](docs/acceptance-2026-10-11/public-d75-independent-archive-audit.md). Output `16,599` / E4 remains an **UNVERIFIED draft**. Financial gold and answer-quality evaluation remain open. The personal-homepage increment has its own publication gate; the d75 inventory does not describe its new HTML.

Historical `7c7a2c3` passed [workflow 38173108409](https://github.com/1235357/1235357.github.io/actions/runs/38173108409), with [311 files / 918,499,608 bytes / 16 pins](docs/acceptance-2026-10-11/public-hf-wasm-pdf-ci.json). That public session accepted parser preflight, two pages, five chunks and MiniLM passage vectors, then refused with [QUERY_TIMEOUT](docs/acceptance-2026-10-11/public-current-session-query-refusal.json). Earlier HF refusals had no physical-response observation and cannot acquire the new attempt's diagnosis. Prior `368ba196`, `e497b2f` and `5a673bc` records retain their dated scopes.

That deployed increment adds preparation v2 with an explicit Hugging Face option for five pinned model files (site remains the default), owned verified WASM-binary reuse, and a public-only PDF worker-script preflight. Pins, logical cache keys, SDK restrictions and inference deadlines stay fixed. Combined local checks passed **2,827/2,827 Node and 155/155 Python**. The same release also completed a separate [localhost native generation](docs/acceptance-2026-10-11/local-current-loader-generation-observation.json): 1,745 prompt token IDs / 33 generated token IDs / EOS. Its complete RAW receipt and actual eight-field input passed [independent contract replay](docs/acceptance-2026-10-11/current-loader-archive-review.json) as an unverified draft. Local success, public delivery and financial truth remain separate gates. See the [release guide](docs/public-release-guide.md).

The diagnostic increment adds a lazy, current-attempt failure boundary record. It distinguishes the client readiness/work timer, native channel failure and validated loader/initializer boundary without disclosing exception text or document/model data. Successful preparation receipts remain schema 2; the active preparation channel is version 3, and passage workers use the explicit `embedding-v2` marker. Query worker grammar remains `query-v1`. Its historical checkpoint passed **2,879/2,879 Node and 155/155 Python**, with a **314-file / 919,318,521-byte / 16-pin** build before final prose changes. Historical dad0b72 [deployment](docs/acceptance-2026-10-11/public-owned-diagnostics-ci.json) and [native HF refusal](docs/acceptance-2026-10-11/public-dad0-generator-hf-refusal.json) retain their own scope. The later d75 CDN correction and complete public native chain have their separate evidence above.

## Start locally

The CI toolchain is Python 3.13 and Node.js 24. From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci --prefix browser-rag
python scripts/materialize-browser-assets.py
python build.py --public
python -m http.server 8765 --directory dist --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. The materializer reconstructs exact fixed-revision model assets in an ignored cache and verifies their byte lengths and SHA-256 values. The public build uses the separately named public entry; it does not serve the private diagnostic server or acceptance archives. See the [release guide](docs/public-release-guide.md) for asset scope and publication read-back.

For the ordinary inspector with generation and source-cell lookup OFF:

```powershell
python scripts/materialize-browser-assets.py --embedding-only
python build.py
```

## What the reader can inspect

The original preparation control passed independent source review and full local/CI checks before this new increment. Its public encoder preparation completed eight pinned bodies / 113,629,084 verified bytes in 1,176,598.5 ms; the [static receipt](docs/acceptance-2026-10-11/public-encoder-preparation.json) and [offline receipt-contract replay PASS](docs/acceptance-2026-10-11/public-encoder-preparation-replay.json) establish that dated preparation result. It does not load a model or establish v2 transport acceptance.

The subsequent public native path parsed two pages into five chunks, retaining 2,426 UTF-16 text units and 687 mapping fragments. WebGPU/FP32 passage encoding reported 644 tokens / 384 dimensions and 3,851.2 ms in the [visible DOM metadata](docs/acceptance-2026-10-11/public-native-encoder-view.json); that file is not a complete passage terminal archive. The [current query terminal](docs/acceptance-2026-10-11/public-native-query-prepared.json) records 39 tokens / 384 dimensions and 1,300.2 ms. Both operations reported 113,629,084 verified CacheStorage body bytes and zero fetched asset-body bytes. Top K 3 returned E4, E1 and E2; context retained three complete evidence units with no omissions. These are individual operation observations, without a latency distribution, isolated GPU timing or financial-answer acceptance.

- PDF.js parsing preserves physical page numbers, displayed PDF labels, source identity and exact original item text/spans.
- Page-window chunking keeps original UTF-16 source fragments separate from presentation separators.
- Original item and selected-chunk records use complete bounded JSON pages and exact UTF-8 downloads. Large original quotes have a complete TXT viewer; mapping rows have independent 100-segment windows and complete JSON. Repeated selection and source/window changes dispose their previous content and download URLs.
- Explicit asset preparation verifies the fixed model/runtime files in browser cache without invoking a model; its receipt is separate from loading and inference.
- Passage and query encoding expose complete token IDs and ordered 384-dimensional vectors through bounded pages and exact JSON downloads, with separate attempt receipts.
- Retrieval exposes ranked candidates and source fragments. A cosine score is not an answer-confidence probability.
- Context assembly preserves the selected evidence identities and complete model input. Each card has exact quote, complete mapping and evidence-unit records; repeated renders/windows revoke old controls. Active work revokes context presentation, and idle remounts the retained artifact with fresh owners.
- The public profile can run the pinned Qwen/WebGPU generator explicitly, preserve its complete raw output/receipt, and inspect output shape and citation identity separately from truth.
- Generation details now use the same consecutive text pages as source-cell evidence. Original input, prompt context, token IDs and native receipts retain complete JSON exports; decoded output and the rendered prompt retain exact plain-text exports. Closing, clearing or rendering another record releases the previous viewer and its download URL.
- The independent Net income lookup requires an explicit period basis, statement, metric, period-end date, exact unit heading and currency glyph. Months additionally requires a 3- or 6-month duration. Fiscal year uses a separate three-column `Year Ended` profile and keeps `durationMonths: null`; complete dates and native date/year pairs retain their original records. Switching period basis clears the previous inputs and result. It exposes the frozen geometry snapshot, source-role bindings and a digest of the complete snapshot bytes. Complete JSON uses consecutive text pages (at most 24 Ki UTF-16 units or 160 lines per page) and an exact full UTF-8 download without a trailing newline. Closing a disclosure or changing its source/request clears old text and revokes its download URL.
- Owned attempts, cancellation, replacement and field edits revoke stale publication. Citation/source inspection does not rerun a model.

The answer panel precedes expandable computation details. The homepage introduces the project above its frame, so that same-origin embedded lab opens on the stage rail and working controls without repeating the large introduction. The standalone page keeps its full overview, with the same light theme and typography. Original Archify figures explain responsibility, ownership and source-cell selection; their editable JSON is delivered alongside the HTML viewers. Figures and static tests are not native runtime or financial-quality acceptance.

## Models, downloads and source data

The browser uses PDF.js 6.4.299, Transformers.js 3.8.1, MiniLM FP32 and Qwen2.5 0.5B Instruct Q4 at fixed revisions. The model/runtime pins are in [embedding-assets.json](browser-rag/embedding-assets.json) and [generator-probe-assets.json](browser-rag/acceptance/generator-probe-assets.json). That second file is a reviewed pin manifest; diagnostic programs and raw acceptance archives stay outside Pages.

The uncached generator manifest totals **815,725,938 bytes** (815.73 MB / approximately 777.94 MiB) before notices, registry and HTTP overhead. MiniLM has 91,100,408 model bytes and shares the runtime. Downloads are explicit and verified; cache state changes transfer behavior. Browser computation uses the reader's supported device. Selected-PDF processing and asset downloads are distinct from a blanket all-network/offline/privacy claim.

The site artifact bundles no reader-selected or financial input PDFs. Its source repository includes small synthetic parser fixtures for tests. The browser corpus is the PDF the reader selects; the supported source-cell profile is a narrow horizontal Net income table contract, not a general financial parser.

A separate Python experiment preserved raw financial text and added four geometry-bound Net income cells, then compared exact-field coverage on four exposed development questions. It used that parser's own source bindings and did not transfer PyMuPDF offsets into the browser's PDF.js spans. Corpus/embedding differences remain explicit; the Python and browser variants do not share one interchangeable index.

## Read the engineering series

The built site contains eight chapters. Start with [A RAG answer needs an execution contract](articles/07-operational-receipts.md), then follow the series through ingestion/query lifecycles, service contracts, representation/ranking, evidence preservation, generation and evaluation. [From installation to a source-bound service](articles/08-source-bound-startup.md) explains the installed corpus entry, optional statement snapshot and pre-listen checks with a light Archify map.

- [Public source review](docs/source-review.md): ten official RAG documentation pages, bounded blog/application observations and original course-to-project connections.
- [Native source-cell acceptance](docs/2026-10-11-native-source-cell-acceptance.md): explicit development cases, source ownership and the distinction between actual IAB actions and synthetic races.
- [Annual browser and bounded evidence](docs/2026-10-12-annual-browser-and-bounded-evidence.md): separate fiscal-year requests, six actual native receipt downloads, consecutive full-text browsing and exact exports.
- [Complete generation details](docs/2026-10-12-complete-generation-details.md): bounded JSON/plain-text presentation, complete actual browser downloads, stale-view cleanup and a compact embedded workbench.
- [A wider workbench](docs/2026-10-12-wide-workbench.md): primary design research, a separate full-width application grid, bounded prose and actual responsive before/after measurements.
- [A fluid workspace with fullscreen](docs/2026-10-12-fluid-workspace.md): removes the remaining display-width caps, simplifies controls and preserves a loaded PDF session while expanding the existing workspace.
- [Complete source and chunk records](docs/2026-10-12-complete-source-and-chunk-records.md): original item text/geometry, full chunk/mapping exports, independent row windows and three actual native annual-source browser checks. The subsequent context/query/vector increment is documented below.
- [Complete context and vector records](docs/2026-10-12-complete-context-and-vector-records.md): complete context mappings/evidence units, selected/query arrays, preparation/failure records, fresh presentation ownership and independently audited historical browser downloads.
- [Public runtime license audit](docs/2026-10-11-public-license-audit.md): exact distributed-runtime inclusion and preserved dependency provenance.
- [Release guide](docs/public-release-guide.md): clean-checkout setup, public asset boundary, artifact budget and deployment read-back.

## Companion API

The companion [1235357/nvidia-financial-rag](https://github.com/1235357/nvidia-financial-rag) publishes the installed corpus startup guide and scoped release metadata at `b94c92f`. The [versioned guide](https://github.com/1235357/nvidia-financial-rag/blob/b94c92f0fa4c98914e5a2907e5044a943bea134a/docs/verified-corpus-startup.md) covers verified lexical inputs, optional explicit fiscal declarations, shared document scope and final identity rechecks. [Corrected startup workflow 38428973799](https://github.com/1235357/nvidia-financial-rag/actions/runs/38428973799) supplies installed API-only and read-only nonroot container evidence for source `9687491`; `b94c92f` adds documentation with unchanged production modules.

The historical package/API checkpoint `082c208` and [workflow 38160052284](https://github.com/1235357/nvidia-financial-rag/actions/runs/38160052284) remain dated evidence. The API preserves request IDs and distinguishes semantic refusals from dependency failures. It has its own AGPL-3.0-or-later license, package, corpus preparation and runtime requirements; no public API service is hosted by this site.

GitHub Pages hosts the static browser application. It does not run the Python API. The browser's Qwen result and source-cell comparator do not call that service or turn this site into a backend deployment. API packaging tests do not establish production capacity or financial accuracy.

## Verification

Run the reproducible contract and delivery checks after installing dependencies:

```powershell
npm test --prefix browser-rag
python -m unittest discover -p "test_*.py" -q
```

The finite public-build/manifest checks can also be run directly:

```powershell
python -m unittest test_public_browser_assets test_release_manifest -q
python build.py --public
python scripts/release-manifest.py
```

CI uses the same locked source and model materializer on Windows/Linux. It builds the explicit public tree, records its file sizes/digests and publishes only that tree after the required checks. The separate release manifest identifies static artifact bytes; it is not a GPU execution or financial-quality receipt. Real WebGPU/IAB acceptance and device/cache observations are recorded separately. Mobile acceptance remains unverified.

## Limits and next experiments

Native generation can return an unverified draft only when the unchanged output contract accepts its shape/citation identity. A syntactically accepted answer can still choose the wrong duration: the exposed six-month native diagnostics reused three-month amounts. They are retained as failures, not repaired or presented as an accuracy score.

The explicit lookup returns a **source-cell candidate · financial correctness unadjudicated**. It preserves literal `$`, the exact unit heading and `normalizedCurrency: null`. Unsupported requests, ambiguous headers/rows, unsupported orientation and split amount tokens refuse. It neither infers natural-language intent nor changes Qwen output.

Independent human adjudication, held-out financial negatives, calibrated judging, broader-table compatibility, performance distributions and complete network/privacy acceptance remain separate work. New corpus, model or retrieval variants need frozen source/pin identities and their own comparisons before improvement claims.

## Licenses and collaboration handoff

Original project-owned site code and authored explanations/figures use the [MIT license](LICENSE). Preserve the separate notices for third-party parser/runtime/model assets, Archify, fonts and marks. Input documents retain their own terms; the site license does not relicense them. The [runtime audit](docs/2026-10-11-public-license-audit.md) distinguishes an unresolved installed dependency from its exclusion in the exact distributed graph.

For a new contributor, start from the checked commit, install the lockfile, materialize the pinned assets, and reproduce the build/tests before changing contracts. Keep source spans, raw model receipts and output inspection separate. A fresh PDF parse can change parser font identifiers and its snapshot digest even when text/geometry match; do not attach new parse evidence to an old model owner.

Change one bounded responsibility at a time, preserve failing development cases, and record the actual artifact/device/scope of acceptance. A different model, broader corpus or public capability is a new experiment, not a silent rewrite of historical evidence. The local raw development history is preserved outside the public README; relevant reviewed RAG receipts remain separately archived and Git history retains prior source revisions.
