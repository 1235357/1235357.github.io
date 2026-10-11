# Dot handoff - 2026-10-11

## Release checkpoint

- Site: [1235357/1235357.github.io](https://github.com/1235357/1235357.github.io), deployment `dad0b721279497e1badd3ab686bf98f2af013e99`; [Actions 38180951673](https://github.com/1235357/1235357.github.io/actions/runs/38180951673): all three jobs **PASS**. [Manifest](acceptance-2026-10-11/public-owned-diagnostics-ci.json): **314 files / 919,316,456 bytes / 16 pins**. Historical `7c7a2c3` and earlier `368ba196`, `e497b2f`, `5a673bc` inventories remain dated records; their module-equality statement does not cover changed loaders.
- API: [1235357/nvidia-financial-rag](https://github.com/1235357/nvidia-financial-rag), `082c208a120a54090a186f16b530fe45859e056f`. [Actions 38160052284](https://github.com/1235357/nvidia-financial-rag/actions/runs/38160052284): all three jobs **PASS**. No hosted API service.
- HTTPS: [article](https://1235357.github.io/07-operational-receipts.html), [lab](https://1235357.github.io/browser-rag/inspector.html). Source-cell replay/cancellation retained. Encoder preparation: **8 bodies / 113,629,084 verified bytes / 1,176,598.5 ms**; [receipt-contract replay PASS](acceptance-2026-10-11/public-encoder-preparation-replay.json). Generator preparation [timed out](acceptance-2026-10-11/public-generator-preparation-timeout.json) at 30 minutes: no complete receipt. Completion/public Qwen execution remain **open**.
- [Public CSS](acceptance-2026-10-11/public-css-readback.json): historical exact CI body, `position: static`. The historical 7c7a2c3 public session opened complete geometry and all five source-span disclosures; its source/chunk records are archived separately. Query-token disclosure still requires an accepted current query.
- Earlier public encoder path: **2 pages / 5 chunks / 2,426 UTF-16 units / 687 mapping fragments**. WebGPU/FP32 passages: **644 tokens / 384 dimensions / 3,851.2 ms**; query: **39 / 384 / 1,300.2 ms**. Each reported **113,629,084 CacheStorage-verified body bytes / 0 fetched asset-body bytes**. Top K 3: E4/E1/E2; context: three complete units, no omissions. [DOM metadata](acceptance-2026-10-11/public-native-encoder-view.json) is not a full passage terminal; the [1,199-byte query terminal](acceptance-2026-10-11/public-native-query-prepared.json) retains query/retrieval summary. These are individual samples.
- Historical `7c7a2c3` HF v2/WASM/PDF increment: **2,827/2,827 Node + 155/155 Python PASS**, followed by the three successful jobs in Actions38173108409. That public parsing/chunking and passage encoding passed; subsequent [query](acceptance-2026-10-11/public-current-session-query-refusal.json) refused. Both explicit HF preparation attempts refused with no complete receipt or physical-response observation. Their failure causes remain unestablished.
- Separate `7c7a2c3` localhost: **1,745 prompt token IDs / 33 generated token IDs / EOS / 48,873.8 ms**, after actual encoder/query/context success. [Complete RAW](acceptance-2026-10-11/local-current-loader-native-raw.json) and [actual original eight-field input](acceptance-2026-10-11/local-current-loader-original8.json) passed [independent contract replay](acceptance-2026-10-11/current-loader-archive-review.json) as a draft. Local success does not establish public generation or financial truth. Actual future dot pull/reproduction has not been observed.
- Diagnostic release `dad0b721279497e1badd3ab686bf98f2af013e99`: **2,879/2,879 Node + 155/155 Python PASS**, then [Actions 38180951673](https://github.com/1235357/1235357.github.io/actions/runs/38180951673) all three jobs PASS. [Actual CI manifest](acceptance-2026-10-11/public-owned-diagnostics-ci.json): **314 / 919,316,456 / 16**; eleven generated-text CRLF/LF differences account for 3,781 local bytes, without a full byte-reproducibility claim. [Forty native parent-page bodies](acceptance-2026-10-11/public-dad0-module-identity-audit.json) match CI.
- New [HF refusal](acceptance-2026-10-11/public-dad0-generator-hf-refusal.json): Ready/command accepted, worker `asset-fetch`, generator index 4, sequence 10, 11,744.1 ms; HTTP 200/CORS from official `us.aws.cdn.hf.co` rejected by the prior finite policy. Exact-origin compatibility passed independent SPEC/QUALITY and **62/62 transport + 2,892/2,892 Node + 155/155 Python** locally; new CI/public complete receipt still required. A separate [parser-script preflight](acceptance-2026-10-11/public-dad0-parser-preparation-refusal.json) exceeded its fixed 120-second static budget, before native parse. Historical failures keep their original unknown causes.

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

Historical `7c7a2c3` v2: site default; explicit HF prepares only five immutable model files, with three runtime files/SDK imports on site and logical cache keys/pins unchanged. No automatic fallback. Those attempts did not establish native CORS/accepted routes/throughput; current v3 and the dad0b72 physical-response refusal are recorded above. Historical v1 remains read-only evidence. Owned WASM reuse adds a **21,596,019-byte ArrayBuffer**, not zero-copy. Public PDF hook verifies **2,229,713 script bytes** within **120s static**, then original **10s native readiness**; HTTP cache reuse is advisory. No Blob/substitute Worker; ordinary/private omit it.

Work deadlines: **120s passages / 120s query / 300s generation**. Qwen: **2,048 combined tokens / 128 default output tokens**, complete v4 JSON and strict EOS/schema/citation gate. Output remains unverified. Cancel/edits/replacement revoke ownership before cleanup.

Diagnostic source channel: preparation command/packets **3** and ready marker `asset-preparation-v3`, containing unchanged successful receipt schema **2**; passage command/packets explicitly `embedding-v2`, unchanged successful artifacts. Query worker remains `query-v1` and gains client-only provenance. Preserve session-owned failure siblings, finite safe-code/phase grammar and lazy disclosure revocation. Diagnostics identify a boundary, not CORS/CDN cause or successful asset/model execution.

Fixed revisions: MiniLM FP32 `751bff37182d3f1213fa05d7196b954e230abad9`; Qwen2.5-0.5B Instruct Q4 `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`. Pins: [encoder](../browser-rag/embedding-assets.json), [generator](../browser-rag/acceptance/generator-probe-assets.json). Asset cache, KV/prefix reuse and GPU memory are distinct.

## Evidence, licenses and next actions

Source-cell lookup: six explicit fields, full snapshot/native roles/digest, literal unit/`$`, `normalizedCurrency: null`. [Public replay](acceptance-2026-10-11/public-source-cell-runtime-replay.json) checks source/contract agreement; correctness is unadjudicated. Human gold: **zero**. Preserve local six-month errors: Revenue `30,040` vs candidate `56,084`; Net income `16,599` vs `31,480`, both public 120-second timeouts and the compression defect.

Site-owned work uses [MIT](../LICENSE); parser/runtime/model/figure notices and input-document terms remain separate. API: **AGPL-3.0-or-later**, including PyMuPDF/MuPDF obligations. The [license audit](2026-10-11-public-license-audit.md) covers the exact distributed graph. Pages excludes input PDFs, private classroom materials, credentials, npm trees and model caches.

1. Publish and inspect the exact HF US CDN compatibility correction; retain both diagnosed refusal and fresh complete preparation separately. Diagnostic release dad0b72 already passed actual CI/native boundary inspection; older 7c7a2c3 records keep their own scope.
2. Complete generator preparation and public Qwen raw input/output/gate read-back; preserve owner identities.
3. Preserve DOM metadata versus complete terminals; retain failures.
4. Keep mobile, human labels/negatives and performance distributions separate.
