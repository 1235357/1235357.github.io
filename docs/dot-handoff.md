# Dot handoff - 2026-10-11

## Release checkpoint

- Site: [1235357/1235357.github.io](https://github.com/1235357/1235357.github.io). Delivery `e497b2f60ae5d1e79623715e5bdd59f3bce54f6e`; [Actions 38166407011](https://github.com/1235357/1235357.github.io/actions/runs/38166407011): all three jobs **PASS**. [Manifest receipt](acceptance-2026-10-11/public-handoff-delivery-ci.json): **309 files / 918,460,230 bytes / 16 pins**. Original runtime `5a673bc`: **309 / 918,459,894 / 16**; six reviewed module hashes unchanged. Preserve failures.
- API: [1235357/nvidia-financial-rag](https://github.com/1235357/nvidia-financial-rag), `082c208a120a54090a186f16b530fe45859e056f`. [Actions 38160052284](https://github.com/1235357/nvidia-financial-rag/actions/runs/38160052284): all three jobs **PASS**. No hosted API service.
- Actual HTTPS: [article](https://1235357.github.io/07-operational-receipts.html), [lab](https://1235357.github.io/browser-rag/inspector.html). Earlier public source-cell raw/replay and cancellation are retained. Encoder preparation: **8 bodies / 113,629,084 verified bytes / 1,176,598.5 ms**, with [receipt-contract replay PASS](acceptance-2026-10-11/public-encoder-preparation-replay.json). Generator preparation and public Qwen execution remain **pending**.
- Public encoder path: **2 pages / 5 chunks / 2,426 UTF-16 units / 687 mapping fragments**. WebGPU/FP32 passages: **644 tokens / 384 dimensions / 3,851.2 ms**; query: **39 / 384 / 1,300.2 ms**. Each reported **113,629,084 CacheStorage-verified body bytes / 0 fetched asset-body bytes**. Top K 3: E4/E1/E2; context: three complete units, no omissions. [DOM metadata](acceptance-2026-10-11/public-native-encoder-view.json) is not a full passage terminal; the [1,199-byte query terminal](acceptance-2026-10-11/public-native-query-prepared.json) retains query/retrieval summary. These are individual samples.
- Local checks: **2,721 Node + 155 Python PASS**. Independent preparation [SPEC/QUALITY PASS](acceptance-2026-10-11/asset-preparation-independent-review.json) covers source/contracts.

## Reproduce the checkout

Existing checkout: preserve changes, `git pull --ff-only`, record HEAD. Accepted CI: Python 3.13, Node.js 24. API metadata `>=3.11` does not establish a Python 3.11 CI run.

```powershell
git clone https://github.com/1235357/1235357.github.io.git
git clone https://github.com/1235357/nvidia-financial-rag.git
cd 1235357.github.io
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci --prefix browser-rag
python scripts/materialize-browser-assets.py
python build.py --public
python -m http.server 8765 --directory dist --bind 127.0.0.1
```

Ordinary profile OFF: `--embedding-only`, then `python build.py`. Checks: `npm test --prefix browser-rag`; `python -m unittest discover -p "test_*.py" -q`. API uses separate constraints/environment.

## Contracts to preserve

Preparation: five model/tokenizer + three shared runtime files/profile; generator **815,725,938 bytes**. Deadline: **30 minutes including readiness / 10-second ready cap**. Receipt: `static-assets-prepared-not-loaded`; no PDF/question, GPU or model invocation. Actions reverify cache bodies. Loading is a phase inside the native receipt.

Work deadlines: **120s passages / 120s query / 300s generation**. Qwen: **2,048 combined tokens / 128 default output tokens**, complete v4 JSON and strict EOS/schema/citation gate. Output remains unverified. Cancel/edits/replacement revoke ownership before cleanup.

Fixed revisions: MiniLM FP32 `751bff37182d3f1213fa05d7196b954e230abad9`; Qwen2.5-0.5B Instruct Q4 `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`. Pins: [encoder](../browser-rag/embedding-assets.json), [generator](../browser-rag/acceptance/generator-probe-assets.json). Asset cache, KV/prefix reuse and GPU memory are distinct.

## Evidence, licenses and next actions

Source-cell lookup: six explicit fields, full snapshot/native roles/digest, literal unit/`$`, `normalizedCurrency: null`. [Public replay](acceptance-2026-10-11/public-source-cell-runtime-replay.json) checks source/contract agreement; correctness is unadjudicated. Human gold: **zero**. Preserve local six-month errors: Revenue `30,040` vs candidate `56,084`; Net income `16,599` vs `31,480`, both public 120-second timeouts and the compression defect.

Site-owned work uses [MIT](../LICENSE); parser/runtime/model/figure notices and input-document terms remain separate. API: **AGPL-3.0-or-later**, including PyMuPDF/MuPDF obligations. The [license audit](2026-10-11-public-license-audit.md) covers the exact distributed graph. Pages excludes input PDFs, private classroom materials, credentials, npm trees and model caches.

1. Preserve each CI/artifact and native owner identity on update.
2. Complete generator preparation and public Qwen raw input/output/gate read-back.
3. Preserve DOM metadata versus complete terminals; retain failures.
4. Keep mobile, human labels/negatives and performance distributions separate.
