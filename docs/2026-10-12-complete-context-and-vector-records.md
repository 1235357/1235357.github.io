# Complete context, token, vector and preparation records

The notebook now exposes every retained context mapping, complete evidence unit, selected token/vector array and query token/vector array through the same complete-record disclosure. Preparation receipts and runtime failure records also use it. Consecutive text pages preserve the original serialized values; full downloads remain explicit and exact.

| Before | After | Why |
| --- | --- | --- |
| Context ownership depended on the artifact reference | Fresh render, card-window and outer-disclosure owners | An identical object or revisited window must not authorize old controls |
| A context card mounted its full mapping JSON at once | Exact quote plus separate complete mapping and evidence-unit disclosures | Bound serialized DOM pages while keeping every source and inserted segment |
| Active generation left a retained context viewer open | Immediate revocation during active work; fresh remount on return to idle | Keep accepted context without retaining its old presentation permission |
| Selected/query arrays and candidate buttons had incomplete presentation ownership | Source/epoch/artifact/selection or captured-question owners with fresh render tokens | Retries, edits and selection changes invalidate saved controls |
| Preparation and failure records detached without clearing captured text | Shared complete-record disposal clears text and releases download URLs | Cleanup must include nodes retained outside the visible page |
| External disposal could start newer work while an older action continued | Capture presentation ownership before disposal and recheck it afterward | Preserve a new preparation owner, geometry record or active lookup |

Complete JSON uses `JSON.stringify(value, null, 2)` as UTF-8 without an added newline. Mapping and unit records read the accepted objects directly; token/vector exports include every value in its original order. Each visible text page contains at most 24,576 UTF-16 units and 160 hard lines, with Unicode pairs and CRLF separators preserved. The first-12-vector preview remains explicitly labeled as a preview, alongside the full record.

Export names use numeric identities or fixed labels: `evidence-${rank}-mapping.json`, `evidence-${rank}-record.json`, `selected-token-ids-${ordinal+1}.json`, `selected-vector-${ordinal+1}.json`, `query-token-ids.json` and `query-vector.json`. Preparation/failure exports have fixed names. No reader filename becomes a download path.

Context render/window changes, question/top-K edits, retries, rechunking, reembedding, replacement, Clear and pagehide dispose applicable old views. Selected/query artifacts can remain inspectable during unrelated source navigation or generation when their actual owner is unchanged. Context separately follows its existing idle-only inspection permission. Cleanup captures old nodes before external disposers run, so reentrant Cancel, Clear or a new selection preserves the newer presentation.

## Verification scope

The production-valid controlled context fixture has **200 evidence units and 51,000 mapping segments**, with explicitly synthetic vectors and token IDs. It reconstructs every mapping across both card windows. Independent review exported all 400 mapping/unit records: **21,511,410 bytes**, exact UTF-8 values and rank-based filenames, with all URLs revoked and the original artifact and omissions unchanged. Actual-app tests use narrow parser/worker-channel and DOM doubles while running the production session, presentation modules and native Blob URLs. They cover exact arrays, saved candidate controls, repeated selection, edits/retries, all invalidation routes and reentrant cleanup. These controlled checks establish presentation and lifecycle behavior, not new model execution.

A separate Codex in-app browser replay selected the complete original eight-field input from the previously archived public native session. The current production context assembler and view retained E4, E1 and E2, with no omissions. Six actual complete mapping/unit downloads totaled **171,138 bytes**. All visible pages and downloaded bytes matched independent production reassembly of that original archive. Each first/second unit needed six mapping and six record text pages; the third needed nine of each. Closing, same-artifact rerender, revocation, remount and Clear were observed separately.

A second local diagnostic rendered historical arrays through the shared disclosure component. It downloaded all 136 selected token IDs, 384 selected vector values, 39 query token IDs and 384 query vector values: **19,833 exact bytes** in four downloads. This diagnostic did not run the main app. Its array rendering evidence complements the separate actual-app integration tests. Neither diagnostic invoked a PDF parser, tokenizer, encoder or generator.

The context replay retained light surfaces and 17-pixel Manrope. Desktop and 390-pixel browser overrides had equal document client/scroll widths of 1,265 and 375 pixels; mobile controls were 46 pixels high. The temporary viewport was reset, selected archive files were cleared and the diagnostic servers were stopped after checking their process identities. This is browser emulation, not physical-device acceptance.

The consumer audit also reproduced an accepted preparation receipt with long, schema-valid controlled response headers: **47,776 UTF-16 units**. The complete viewer reconstructed and exported its exact value. This demonstrates why the preparation receipt needs the shared page bound even though its schema is fixed. Controlled headers are not a new physical network observation.

Additional native-Blob regression checks exercise preparation startup reentry, geometry-record replacement and lookup reentry during external disposal, including a late disclosure factory. Old captured text and controls are retired while the newer presentation remains intact. The final combined local suite passed **3,048 Node tests and 156 Python tests**, with zero Node failures, cancellations, skips or pending tests.

Sanitized [acceptance metadata](acceptance-2026-10-12/browser-context-vector-complete-records.json) lists precise browser export and layout evidence. Full archives, downloaded files, local replay programs and screenshots remain outside Pages. Source, chunk, token, model and runtime acceptance budgets were not changed.

## Remaining project gates

This increment closes the audited complete-record presentation and lifecycle gaps. Broader corpus scaling, native model compatibility/performance distributions, held-out financial evaluation, physical-phone testing, user aesthetic acceptance and production API/browser integration remain separate work. Historical model success, current static/controlled checks and financial truth are different evidence gates.
