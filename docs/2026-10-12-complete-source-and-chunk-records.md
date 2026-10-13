# Complete source and chunk records in the notebook

The notebook now keeps large original parser items and complete chunk records readable through consecutive text pages. Structured mapping rows use a separate 100-segment window. The retained parser and chunk artifacts are unchanged; complete UTF-8 downloads preserve every source and inserted segment.

| Before | After | Why |
| --- | --- | --- |
| A large parser item eagerly placed its whole quote in the page | Short quotes stay immediate; large quotes open a complete TXT viewer | Keep the original text available without mounting millions of characters while collapsed |
| An opened item or chunk record mounted one complete JSON text node | One bounded text page, explicit page navigation and a complete JSON download | A scroll box alone does not bound its allocated text |
| Every mapping row mounted at once | Independent windows of at most 100 segments, plus a complete mapping JSON record | Chunk selection and mapping complexity need separate navigation |
| Detached item/chunk details retained callbacks after a presentation change | Fresh source/page/chunk/window owners and immediate disposal of old content and URLs | Repeating the same selected object still creates a new presentation |

Each opened text page contains at most 24,576 UTF-16 units and 160 hard lines. Consecutive ranges preserve Unicode pairs and CRLF separators, including the final partial page. Complete TXT contains the original string; complete JSON contains `JSON.stringify(record, null, 2)` as UTF-8, without an added newline. Downloads require an explicit click. Source-item exports retain the original geometry and duplicated `span.quote` rather than the reduced worker projection.

Closing a detail releases its current viewer and permits reopening. Page/item-window changes, repeated selection, chunk-selector changes, replacement, Clear and pagehide revoke the applicable old viewer, clear its captured text and revoke its object URL. Unrelated item navigation retains the accepted selected-chunk presentation. Source and chunk ownership does not depend on unrelated model activity.

## Current validation

The final local checks passed **3,001 Node tests** and **156 Python tests**. The helper's test-first run passed the 16 existing bounded-view tests and failed its 20 new missing-feature assertions; implementation then passed all 36. Two actual-app regressions first reproduced an eager accepted two-million-unit item and missing independent mapping navigation, then passed after integration. Native Blob downloads verify complete TXT and duplicated item JSON bytes, disposal, retained callbacks and independent selector-window behavior. Ordinary and public delivery tests verify exact authored module bytes and preserve the previous build when either shared helper is missing.

Three original annual PDFs were selected through the native file chooser in the Codex in-app browser. Native PDF.js parsing and the default native chunk worker completed. The largest audited mapping record from each document was traversed completely, downloaded and independently compared with the unchanged chunker replay over the earlier complete native source capture:

| Original source | Physical pages | Default chunks | Inspected chunk, one based | Mapping segments | Row windows | Full record/mapping text pages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FY2021 10-K | 93 | 774 | 691 | 255 | 3 | 13 / 13 |
| FY2022 annual | 207 | 1,643 | 467 | 360 | 4 | 19 / 19 |
| FY2026 annual | 175 | 1,496 | 537 | 270 | 3 | 14 / 14 |

All **885 mapping rows** matched the exact type, source range, chunk range and escaped text in original order. Six complete chunk/mapping downloads and one original item download totaled **377,165 bytes** and matched independently serialized production artifacts byte for byte. The source-item record retained every geometry field. Actual browser repeated selection and Clear removed the opened records. Separate tests cover captured callbacks and URL revocation, which DOM appearance alone cannot prove.

The actual 390-pixel browser override produced a 375-pixel document with equal client/scroll widths; controls stayed within the document and had 46-pixel heights. The default desktop document likewise had equal 1,265-pixel widths. The shared light palette and 17-pixel Manrope body text were retained; record text uses the existing 14-pixel monospace style. Temporary viewport overrides were reset. These measurements are browser emulation, not physical-phone acceptance.

Sanitized [source/chunk acceptance metadata](acceptance-2026-10-12/browser-source-chunk-complete-records.json) records exact download sizes and digests. Full source captures, actual downloads, reproduction programs and screenshots remain local.

## Remaining scope

This increment covers original items, selected chunks and their mapping rows. Complete context mappings and fresh context render/window ownership, query token/vector records, selected-vector records and the remaining small diagnostic lifecycle are still being implemented. The entire notebook and broader project goal remain active.

All three annual default chunk counts exceed the unchanged 512-chunk embedding gate. These observations establish native annual parsing/chunk inspection, not annual embedding, retrieval, generation, financial-answer quality or a production performance distribution. Physical-device testing, user aesthetic acceptance, human/held-out financial evaluation and enterprise integration retain their separate gates.
