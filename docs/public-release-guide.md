# Public site release guide

This is the release procedure for the [published engineering-notes site and browser financial-RAG lab](https://1235357.github.io/). Runtime commit `5a673bc76b5f984fc93182ebc01efc83f0cbcccf` passed all three jobs in [workflow 38165566626](https://github.com/1235357/1235357.github.io/actions/runs/38165566626). Its Linux artifact has 309 files, 918,459,894 bytes and the same 16 pinned asset bodies. It adds explicit static-file preparation after two actual public download-stage encoding timeouts. The preceding `a47a89e` runtime passed HTTPS parsing/chunking and explicit source-cell lookup. Its initial CI model-card failure was recovered by rerunning only failed jobs, with the precise original cause unestablished. Public preparation and GPU/model acceptance remain separate pending gates. Dated local native receipts are separate evidence and are not a live service-status monitor.

## Consumer setup

The accepted CI toolchain is Python 3.13 and Node.js 24. API metadata permitting Python `>=3.11` is a separate compatibility declaration; that metadata does not establish a Python 3.11 CI run. From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci --prefix browser-rag
python scripts/materialize-browser-assets.py
python build.py --public
python -m http.server 8765 --directory dist --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. These are the clean-checkout commands used by the public-build profile. The materializer downloads exact fixed-revision model/card bytes into ignored `browser-rag/.model-cache/`, verifies their sizes and SHA-256 values, and refuses mismatches. Model weights are not Git blobs. `npm ci` preserves the lockfile's runtime versions; model/runtime revisions are not chosen from an unpinned latest alias.

For the ordinary inspector profile, materialize only MiniLM and omit the public switch:

```powershell
python scripts/materialize-browser-assets.py --embedding-only
python build.py
```

The default profile retains generation OFF and omits private geometry/table/lookup capability. The separately named public entry enables the reviewed generator, geometry disclosure and explicit-field source-cell lookup through configured factories; runtime contracts, byte pins and output gates remain the same. The loopback acceptance server's private entry/probes are not deployed. Do not treat its localhost receipts as a test of GitHub Pages delivery.

## Reader contract and asset budget

The reader chooses a local PDF and starts each model action explicitly. PDF parsing and source-cell lookup use that accepted local source. Passage/query embeddings and native generation run on the reader's device with the supported WebGPU profile. State the selected-PDF upload behavior and the first-run download separately: the app's browser computation is local, while model/runtime assets are fetched from the site. No blanket all-network, universal offline, every-device or financial-accuracy claim follows from this architecture.

The explicit preparation worker verifies static files without receiving a PDF, question or context or invoking a model/GPU. Its fixed 30-minute absolute budget includes a 10-second readiness limit and is not renewed by progress. A complete receipt covers eight pinned bodies and successful cache writes. Later model actions verify the cache again and retain their original 120-second encoder/query and 300-second generator limits. Cache eviction or a missing body can still affect a later action. Preparation, model loading and inference have separate receipts and acceptance gates.

The accepted generator manifest contains **793,197,262 model bytes + 22,528,676 shared runtime bytes = 815,725,938 bytes** (815.73 decimal MB; approximately 777.94 MiB), before notices/registry/HTTP overhead. MiniLM has 91,100,408 model bytes and uses the same runtime. The two models plus one runtime total 906,826,346 bytes. Model-cache and browser-cache availability can change what a particular run downloads; distinguish first/cached runs rather than call the same transfer size a latency measurement.

During the 2026-10-11 pre-release audit, the ordinary `dist` had 280 files / 125,094,183 bytes. Adding the accepted Qwen model files once gave an estimate of 918,291,445 bytes before new public modules, registry and Qwen notices. The later accepted `a47a89e` Linux Pages artifact measured **306 files / 918,425,062 bytes / 16 pinned bodies**. Each increment must preserve its measured inventory/digests and pass the conservative 1,000,000,000-byte build limit. Do not duplicate the shared runtime or commit the 786,156,820-byte weight file to Git.

Native generation produces an **unverified financial draft** only when the unchanged output contract accepts its shape and citation identities. A source-cell lookup produces a separately labeled **source-cell candidate · financial correctness unadjudicated**. It requires explicit statement, metric, duration, period-end date, exact unit heading and currency glyph; it does not parse natural-language questions or fix a Qwen draft. Preserve literal `$`, the exact unit heading and `normalizedCurrency: null`. Existing exposed development cases and synthetic refusals are not an independently adjudicated accuracy score.

## Public source versus deployed files

The GitHub repository and Pages artifact have different boundaries. `build.py` constructs the deployed tree from articles/styles, accepted figure HTML/editable JSON and license notices, and the reviewed named browser/model/runtime assets. It does not copy `docs/`, acceptance probes/archives, source maps, tests, npm trees, model caches, credentials or original source PDFs into Pages.

The 2026-10-11 pre-release audit selected public repository files deliberately, and each increment receives the same source review. `.gitignore` excludes dist/staging/recovery folders, `.archify/`, node_modules, the model cache and local environments; it does **not** exclude `docs/acceptance-2026-10-11/` or every local coordination document. Static-build exclusion alone does not keep a file private in a public Git repository. Preserve original artifacts locally while reviewing the public source set.

The reviewed source partitions below retain separate public-repository decisions; stage each increment's selected files explicitly:

- `docs/acceptance-2026-10-11/`: full native inputs, PDF-derived text/geometry, raw outputs, host URLs, ownership records and screenshots.
- `docs/2026-10-11-reference-coverage.md`: internal mentor/course review and personal-planning context; use the public article's original explanations and bounded citations instead of redistributing private records.
- `figures/*.archify.delivery.json`, `table-cell-selection.archify.source-audit.json` and `table-cell-selection.archify.strict-check.json`: frozen local provenance, including absolute filesystem paths; they are excluded from Pages. A portable public audit can be added later without rewriting these accepted originals.
- Local `.archify/` requests: private course locators, rejected candidates and task-local rendering copies; they remain ignored. The permanent renderer notes describe the bounded policy, but the Pages build copies accepted figure pairs rather than regenerating them from this ignored workspace.

There are no private course PDFs, slide screenshots, PPTX or DOCX documents in the inspected site source/public-build inventory. The owned synthetic parser fixtures are under `browser-rag/acceptance/` and stay outside Pages. Course names/concepts and physical-page ranges can remain in the original blog explanations; local course filename locators in older prose can be shortened for readers without copying or modifying their private originals. Do not promote an assistant-written exercise to a course submission, grade, endorsement or mastery claim.

## Notices and figure distribution

The site-root [MIT license](../LICENSE) covers original project-owned site code and authored explanations/figures. Third-party code, model files, fonts, marks and input documents retain their own terms. Preserve the separate parser/runtime/model notices and the copied Archify MIT, third-party-mark and JetBrains Mono OFL texts.

The [public runtime audit](2026-10-11-public-license-audit.md) records why the installed `guid-typescript` package remains unresolved while its legacy implementation is outside the exact distributed runtime. This finding does not clear an npm-tree redistribution or future bundle. Qwen model/conversion attribution belongs to the separately named QWEN notices; it must not be folded into the site's MIT grant.

Accepted Archify HTML and editable JSON are public figure artifacts; delivery receipts/source audits have separate scopes. Pair integrity, source review and actual IAB visual observations are different evidence. Preserve the owned-generation and table-cell-selection pair bytes and captions. Their source-provenance statements describe the state when each figure was authored; a later repository push does not retroactively become their original repository-verification receipt. Reader-facing release prose can date that boundary without changing frozen evidence or inventing Git proof.

## Deployment and release read-back

Root owns the GitHub repository, Actions/Pages workflow and live acceptance. The user-site destination mounts at `/`; a project-site alternative would mount at `/zhentong-ye-site/`. Browser workers, manifests, models, parser resources and local links use the served module-relative base. Validate the actual chosen mount, its full asset graph and hashes rather than append a future project prefix to a localhost URL.

A Pages workflow should build from the locked source, materialize verified ignored-cache assets, run the required checks, and upload only the final `dist` artifact. Keep the clean-checkout recipe and final measured artifact inventory reproducible. No PAT belongs in source or emitted HTML. The public workflow/repository setup is separate from the private acceptance server; it must not expose diagnostic aliases or acceptance archives.

After a successful push/workflow, record the actual commit, workflow URL/result, Pages URL and served artifact identity. Then use Codex IAB for the actual reader path: site/article/figures, PDF selection, explicit supported source-cell request/refusal, model download, query/context/native generation and source disclosure. Preserve device/browser, cache state, scope and observed failures. Desktop evidence is not mobile evidence; fast digest completion does not fabricate an observed pending cancellation.

Record static publication after successful CI/deployment and HTTPS read-back at a named URL/commit. Record public embedding, retrieval and generation acceptance separately; these remain pending until their native receipts complete. Update current status in README, the build's header/index and article 07's public/private description to match the delivered profile. Keep dated failure histories, the wrong six-month Qwen diagnostics, unadjudicated currency/cell claims, privacy limits and pending independent financial quality work explicit. Publication alone does not close those gates.
