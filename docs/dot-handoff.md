# Dot handoff - 2026-10-11

## Release checkpoint

- Site: [1235357/1235357.github.io](https://github.com/1235357/1235357.github.io), last verified pre-increment deployment `368ba196`; [Actions 38168888277](https://github.com/1235357/1235357.github.io/actions/runs/38168888277): all three jobs **PASS**. [Manifest](acceptance-2026-10-11/public-encoder-layout-ci.json): **309 files / 918,463,134 bytes / 16 pins**. Earlier [e497b2f](acceptance-2026-10-11/public-handoff-delivery-ci.json): **309 / 918,460,230 / 16**; runtime `5a673bc`: **309 / 918,459,894 / 16**. Module equality applies to those dated inventories.
- API: [1235357/nvidia-financial-rag](https://github.com/1235357/nvidia-financial-rag), `082c208a120a54090a186f16b530fe45859e056f`. [Actions 38160052284](https://github.com/1235357/nvidia-financial-rag/actions/runs/38160052284): all three jobs **PASS**. No hosted API service.
- HTTPS: [article](https://1235357.github.io/07-operational-receipts.html), [lab](https://1235357.github.io/browser-rag/inspector.html). Source-cell replay/cancellation retained. Encoder preparation: **8 bodies / 113,629,084 verified bytes / 1,176,598.5 ms**; [receipt-contract replay PASS](acceptance-2026-10-11/public-encoder-preparation-replay.json). Generator preparation [timed out](acceptance-2026-10-11/public-generator-preparation-timeout.json) at 30 minutes: no complete receipt. Completion/public Qwen execution remain **open**.
- [Public CSS](acceptance-2026-10-11/public-css-readback.json): exact CI body, `position: static`. Local disclosure interaction passed; public interaction awaits readiness.
- Public encoder path: **2 pages / 5 chunks / 2,426 UTF-16 units / 687 mapping fragments**. WebGPU/FP32 passages: **644 tokens / 384 dimensions / 3,851.2 ms**; query: **39 / 384 / 1,300.2 ms**. Each reported **113,629,084 CacheStorage-verified body bytes / 0 fetched asset-body bytes**. Top K 3: E4/E1/E2; context: three complete units, no omissions. [DOM metadata](acceptance-2026-10-11/public-native-encoder-view.json) is not a full passage terminal; the [1,199-byte query terminal](acceptance-2026-10-11/public-native-query-prepared.json) retains query/retrieval summary. These are individual samples.
- Prior checks: **2,721 Node + 155 Python PASS**; original preparation [SPEC/QUALITY PASS](acceptance-2026-10-11/asset-preparation-independent-review.json). New HF v2/WASM/PDF increment: bounded reviews and **2,827/2,827 Node + 155/155 Python PASS**; [prior local build](acceptance-2026-10-11/local-hf-wasm-pdf-combined-checks.json) **311 / 918,503,041 / 16**. Fresh remote CI/deployment and native acceptance remain **pending**.

## Reproduce the checkout

Preserve checkout changes; `git pull --ff-only`, record HEAD. Accepted CI: Python 3.13, Node.js 24. API metadata `>=3.11` does not prove 3.11 CI.

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

Preparation: five model/tokenizer + three runtime files/profile; generator **815,725,938 bytes**. **30 minutes including readiness / 10-second ready cap**. Receipt: `static-assets-prepared-not-loaded`; no PDF/question, GPU or model invocation. Actions reverify cached bodies; loading is a native-receipt phase.

Local v2: site default; explicit HF prepares only five immutable model files, with three runtime files/SDK imports on site and logical cache keys/pins unchanged. No automatic fallback; native CORS/routes/throughput pending. Historical v1 remains read-only evidence. Owned WASM reuse adds a **21,596,019-byte ArrayBuffer**, not zero-copy. Public PDF hook verifies **2,229,713 script bytes** within **120s static**, then original **10s native readiness**; HTTP cache reuse is advisory. No Blob/substitute Worker; ordinary/private omit it.

Work deadlines: **120s passages / 120s query / 300s generation**. Qwen: **2,048 combined tokens / 128 default output tokens**, complete v4 JSON and strict EOS/schema/citation gate. Output remains unverified. Cancel/edits/replacement revoke ownership before cleanup.

Fixed revisions: MiniLM FP32 `751bff37182d3f1213fa05d7196b954e230abad9`; Qwen2.5-0.5B Instruct Q4 `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`. Pins: [encoder](../browser-rag/embedding-assets.json), [generator](../browser-rag/acceptance/generator-probe-assets.json). Asset cache, KV/prefix reuse and GPU memory are distinct.

## Evidence, licenses and next actions

Source-cell lookup: six explicit fields, full snapshot/native roles/digest, literal unit/`$`, `normalizedCurrency: null`. [Public replay](acceptance-2026-10-11/public-source-cell-runtime-replay.json) checks source/contract agreement; correctness is unadjudicated. Human gold: **zero**. Preserve local six-month errors: Revenue `30,040` vs candidate `56,084`; Net income `16,599` vs `31,480`, both public 120-second timeouts and the compression defect.

Site-owned work uses [MIT](../LICENSE); parser/runtime/model/figure notices and input-document terms remain separate. API: **AGPL-3.0-or-later**, including PyMuPDF/MuPDF obligations. The [license audit](2026-10-11-public-license-audit.md) covers the exact distributed graph. Pages excludes input PDFs, private classroom materials, credentials, npm trees and model caches.

1. Complete combined regression/CI and archive fresh deployment, then native HF/preflight/WASM evidence.
2. Complete generator preparation and public Qwen raw input/output/gate read-back; preserve owner identities.
3. Preserve DOM metadata versus complete terminals; retain failures.
4. Keep mobile, human labels/negatives and performance distributions separate.
