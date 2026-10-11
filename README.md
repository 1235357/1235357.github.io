# Zhentong Ye — engineering notes and browser financial RAG

A technical blog with an executable browser lab for financial-document retrieval. Choose a PDF, ask a question, and inspect the source and computation behind the result. A separate explicit-field comparator binds a Net income source-cell candidate to native PDF table geometry. The companion Python API is a different runtime and integration surface.

**Release status:** published at [1235357.github.io](https://1235357.github.io/). Deployment `7c7a2c39375c29bdef3675d88a4e9a8aa8b610a7` passed all three build/deploy jobs in [workflow 38173108409](https://github.com/1235357/1235357.github.io/actions/runs/38173108409). Its independently inspected [CI manifest](docs/acceptance-2026-10-11/public-hf-wasm-pdf-ci.json) records **311 files / 918,499,608 bytes / 16 pins**, including exact identity for all 20 authored public modules. The current public reader accepted the fixed PDF-worker preflight, two-page source and five chunks, then committed MiniLM passage vectors. The subsequent query refused with [QUERY_TIMEOUT](docs/acceptance-2026-10-11/public-current-session-query-refusal.json); earlier Hugging Face preparation attempts also refused. Complete public generator preparation and Qwen execution remain open. Prior `368ba196`, `e497b2f` and `5a673bc` observations retain their dated scopes; a successful retry does not explain an earlier refusal. Publication does not establish independent financial correctness.

That deployed increment adds preparation v2 with an explicit Hugging Face option for five pinned model files (site remains the default), owned verified WASM-binary reuse, and a public-only PDF worker-script preflight. Pins, logical cache keys, SDK restrictions and inference deadlines stay fixed. Combined local checks passed **2,827/2,827 Node and 155/155 Python**. The same release also completed a separate [localhost native generation](docs/acceptance-2026-10-11/local-current-loader-generation-observation.json): 1,745 prompt token IDs / 33 generated token IDs / EOS. Its complete RAW receipt and actual eight-field input passed [independent contract replay](docs/acceptance-2026-10-11/current-loader-archive-review.json) as an unverified draft. Local success, public delivery and financial truth remain separate gates. See the [release guide](docs/public-release-guide.md).

The subsequent source increment adds a lazy, current-attempt failure boundary record. It distinguishes the client readiness/work timer, native channel failure and validated loader/initializer boundary without disclosing exception text or document/model data. Successful preparation receipts remain schema 2; the active preparation channel is version 3, and passage workers use the explicit `embedding-v2` marker. Query worker grammar remains `query-v1`. Local full checks passed **2,879/2,879 Node and 155/155 Python**, followed by a **314-file / 919,318,521-byte / 16-pin** public build. Those local results do not yet establish this increment's remote deployment or native failure classification.

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
- Explicit asset preparation verifies the fixed model/runtime files in browser cache without invoking a model; its receipt is separate from loading and inference.
- Passage and query encoding expose actual token IDs and ordered 384-dimensional vectors, with separate attempt receipts.
- Retrieval exposes ranked candidates and source fragments. A cosine score is not an answer-confidence probability.
- Context assembly preserves the selected evidence identities and complete model input.
- The public profile can run the pinned Qwen/WebGPU generator explicitly, preserve its complete raw output/receipt, and inspect output shape and citation identity separately from truth.
- The independent Net income lookup requires six explicit fields: statement, metric, duration, period-end date, exact unit heading and currency glyph. It exposes the frozen geometry snapshot, source-role bindings and a digest of exact displayed snapshot bytes.
- Owned attempts, cancellation, replacement and field edits revoke stale publication. Citation/source inspection does not rerun a model.

The answer panel precedes expandable computation details. Original Archify figures explain responsibility, ownership and source-cell selection; their editable JSON is delivered alongside the HTML viewers. Figures and static tests are not native runtime or financial-quality acceptance.

## Models, downloads and source data

The browser uses PDF.js 6.4.299, Transformers.js 3.8.1, MiniLM FP32 and Qwen2.5 0.5B Instruct Q4 at fixed revisions. The model/runtime pins are in [embedding-assets.json](browser-rag/embedding-assets.json) and [generator-probe-assets.json](browser-rag/acceptance/generator-probe-assets.json). That second file is a reviewed pin manifest; diagnostic programs and raw acceptance archives stay outside Pages.

The uncached generator manifest totals **815,725,938 bytes** (815.73 MB / approximately 777.94 MiB) before notices, registry and HTTP overhead. MiniLM has 91,100,408 model bytes and shares the runtime. Downloads are explicit and verified; cache state changes transfer behavior. Browser computation uses the reader's supported device. Selected-PDF processing and asset downloads are distinct from a blanket all-network/offline/privacy claim.

The site artifact bundles no reader-selected or financial input PDFs. Its source repository includes small synthetic parser fixtures for tests. The browser corpus is the PDF the reader selects; the supported source-cell profile is a narrow horizontal Net income table contract, not a general financial parser.

A separate Python experiment preserved raw financial text and added four geometry-bound Net income cells, then compared exact-field coverage on four exposed development questions. It used that parser's own source bindings and did not transfer PyMuPDF offsets into the browser's PDF.js spans. Corpus/embedding differences remain explicit; the Python and browser variants do not share one interchangeable index.

## Read the engineering series

The built site contains seven chapters. Start with [A RAG answer needs an execution contract](articles/07-operational-receipts.md), then follow the series through ingestion/query lifecycles, service contracts, representation/ranking, evidence preservation, generation and evaluation.

- [Public source review](docs/source-review.md): ten official RAG documentation pages, bounded blog/application observations and original course-to-project connections.
- [Native source-cell acceptance](docs/2026-10-11-native-source-cell-acceptance.md): explicit development cases, source ownership and the distinction between actual IAB actions and synthetic races.
- [Public runtime license audit](docs/2026-10-11-public-license-audit.md): exact distributed-runtime inclusion and preserved dependency provenance.
- [Release guide](docs/public-release-guide.md): clean-checkout setup, public asset boundary, artifact budget and deployment read-back.

## Companion API

The companion [1235357/nvidia-financial-rag](https://github.com/1235357/nvidia-financial-rag) source release is published at commit `082c208`. [API workflow 38160052284](https://github.com/1235357/nvidia-financial-rag/actions/runs/38160052284) passed Linux/Windows checkout and fresh installed-package checks, plus Linux nonroot container HTTP. It accepts injected retriever/generator services, preserves request IDs and distinguishes semantic refusals from dependency failures. The API has its own AGPL-3.0-or-later license, package, corpus preparation and runtime requirements; no public API service is hosted by this site.

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
