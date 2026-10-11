# Dot handoff - 2026-10-11

Preserve dated receipts and failures.

## Release checkpoint

- Site: [1235357/1235357.github.io](https://github.com/1235357/1235357.github.io). Runtime `5a673bc76b5f984fc93182ebc01efc83f0cbcccf`; [Actions 38165566626](https://github.com/1235357/1235357.github.io/actions/runs/38165566626): all three build/Windows/deploy jobs **PASS**. Linux artifact: **309 files / 918,459,894 bytes / 16 pins**, with [CI and module identity receipt](acceptance-2026-10-11/public-preparation-runtime-ci.json). The preceding `a47a89e` deployment and its failures remain dated history.
- API: [1235357/nvidia-financial-rag](https://github.com/1235357/nvidia-financial-rag), `082c208a120a54090a186f16b530fe45859e056f`. [Actions 38160052284](https://github.com/1235357/nvidia-financial-rag/actions/runs/38160052284): all three Linux/Windows package and Linux nonroot container/HTTP jobs PASS. No hosted API service.
- Actual HTTPS: [article](https://1235357.github.io/07-operational-receipts.html), [full-size lab](https://1235357.github.io/browser-rag/inspector.html). Public parsing/chunking and the six-month source-cell raw result/replay are accepted on the preceding runtime. New preparation controls mounted; [actual cancellation](acceptance-2026-10-11/public-preparation-cancel.txt) committed no full receipt and enabled explicit retry. Complete public native preparation, passage/query encoding, retrieval and generation acceptance remain **pending**.
- Local candidate checks: **2,721 Node + 155 Python PASS**, with [full regression record](acceptance-2026-10-11/asset-preparation-full-regression.json). Independent preparation [SPEC/QUALITY review PASS](acceptance-2026-10-11/asset-preparation-independent-review.json) covers source/contracts, not browser execution.

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

Ordinary generation/lookup OFF: materialize with `--embedding-only`, then `python build.py`. Checks: `npm test --prefix browser-rag`; `python -m unittest discover -p "test_*.py" -q`. API setup has separate environment/constraints in its [README](https://github.com/1235357/nvidia-financial-rag#readme); Pages cannot execute Python.

## Contracts to preserve

Preparation verifies eight pinned bodies/profile: five model/tokenizer files plus three shared runtime files. Encoder: **113,629,084 bytes**; generator: **815,725,938 bytes**. Its fresh static-only worker has a **30-minute absolute deadline including readiness**, with a **10-second ready cap**. Receipt: `static-assets-prepared-not-loaded`. No PDF/question, GPU, model or inference is invoked; later model actions reverify advisory cache bodies.

Inference work deadlines remain **120s passage encoding / 120s query encoding / 300s generation**. Qwen retains **2,048 combined prompt/output tokens**, default **128 output tokens**, complete v4 evidence JSON and strict EOS/schema/citation-identity gate. Accepted output is an unverified draft. Cancel/edits/replacement revoke stale ownership before cleanup.

MiniLM FP32 revision `751bff37182d3f1213fa05d7196b954e230abad9` and Qwen2.5-0.5B Instruct Q4 revision `22942cb7d7ba4cc81bb4673549ca4d4614469b5e` stay fixed. Body identities: [encoder](../browser-rag/embedding-assets.json), [generator](../browser-rag/acceptance/generator-probe-assets.json). Asset caching, KV/prefix reuse and live GPU memory are separate.

## Evidence, licenses and next actions

Source-cell lookup needs six explicit fields and its own full snapshot, native roles and exact-byte digest; literal unit/`$` remain, with `normalizedCurrency: null`. [Public replay](acceptance-2026-10-11/public-source-cell-runtime-replay.json) establishes source/contract agreement; financial correctness is unadjudicated. Independent human gold: **zero**. Local v4 six-month outputs were Revenue `30,040` versus candidate `56,084`, and Net income `16,599` versus candidate `31,480`. Retain both public 120-second download timeouts, the compression defect and these wrong-duration outputs.

Site-owned work uses [MIT](../LICENSE); parser/runtime/model/figure notices and input-document terms remain separate. API: **AGPL-3.0-or-later**, including PyMuPDF/MuPDF obligations. The [license audit](2026-10-11-public-license-audit.md) covers the exact distributed graph. Pages excludes input PDFs, private classroom materials, credentials, npm trees and model caches.

1. Pull the accepted runtime and preserve its CI/artifact identity when making the next change.
2. Read back HTTPS preparation, complete receipt, cancel/retry and cache revalidation.
3. Run public encoding/retrieval/generation; archive raw input/output and inspect the unchanged gate separately from truth.
4. Keep mobile, human labels/negatives and performance distributions separate; change one bounded mechanism at a time.
