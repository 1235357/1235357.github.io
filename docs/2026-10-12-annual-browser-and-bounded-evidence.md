# Annual source comparison and complete evidence browsing

The browser comparator now accepts an explicitly selected fiscal-year basis for a narrow horizontal Net income table. It uses a separate three-column `Year Ended` contract. Quarterly requests retain the existing months contract and schema 1; annual requests use schema 2 and `durationMonths: null`. This action needs an accepted PDF parse and no encoder or generator.

Complete source snapshots can be several megabytes. Rendering the whole snapshot or lookup receipt in one wrapping text block made inspection difficult; a previous FY2026 full-record DOM read timed out. That observation alone did not establish its precise performance cause. The revised geometry and lookup disclosures retain their complete serialization, display consecutive text pages, and offer an explicit download of the exact full UTF-8 JSON without an added newline.

| Before | After | Why |
| --- | --- | --- |
| Whole source JSON entered a single text block | One page contains at most 24,576 UTF-16 units and 160 hard lines | The DOM stays bounded while every source unit remains reachable. |
| Large evidence required scrolling through the full record | Previous/Next controls, a page-number field and direct page jump | Repeated inspection responds immediately without page-change animation. |
| A displayed page could be mistaken for the entire record | A range counter and a distinct complete-JSON download | The exported file contains every page and source item. |
| Changing a request could leave detached evidence controls | Disclosure close, input edits and source/session changes dispose the viewer and revoke its object URL | Obsolete handlers cannot export or overwrite a newer owner's evidence. |

Unicode pairs and CRLF remain together across text pages. Concatenating every page reproduces the original string exactly. The bytes identified by the snapshot digest remain the full snapshot, not the visible page. The controls follow the shared light theme, readable Manrope text, wrapping layout and keyboard focus treatment.

## Actual local browser verification

The original staged PDFs were selected through the actual Codex in-app browser file chooser. After native PDF.js 6.4.299 parsing, each request was entered explicitly and its complete receipt downloaded through the visible download button. The generator, encoder and model preparation actions were not used in this verification.

| Original PDF | Native pages / items | Requested date | Source amount literal | Physical page | Complete receipt bytes |
| --- | --- | --- | --- | --- | --- |
| FY2026 Annual | 175 / 23,126 | Jan 25, 2026 | 120,067 | 139 | 17,311,627 |
| FY2026 Annual | 175 / 23,126 | Jan 26, 2025 | 72,880 | 139 | 17,311,635 |
| FY2026 Annual | 175 / 23,126 | Jan 28, 2024 | 29,760 | 139 | 17,311,633 |
| FY2021 10-K | 93 / 9,304 | January 31, 2021 | 4,332 | 47 | 7,277,821 |
| FY2021 10-K | 93 / 9,304 | January 26, 2020 | 2,796 | 47 | 7,277,794 |
| FY2021 10-K | 93 / 9,304 | January 27, 2019 | 4,141 | 47 | 7,277,798 |

FY2026's record opened as 3,373 text pages. The first page contained 4,771 UTF-16 units and 160 lines; Next and a direct jump to the final page worked, and the final page included the closing ownership record. FY2021's split month/day and year items retained their separate native source bindings. Its complete geometry snapshot also downloaded successfully and matched the lookup's snapshot and digest exactly.

An independent archive audit rederived every complete result from its downloaded snapshot and exact request, checked every native source record and all 126 selected/all-column bindings, and matched each snapshot's full UTF-8 bytes and SHA-256 with its owner receipt. Each PDF's three requests retained the same complete snapshot. Both original PDF bodies were rehashed and remained stable. [Sanitized verification metadata](acceptance-2026-10-12/browser-annual-bounded-view.json) records the source and archive hashes without distributing the original PDFs or complete reader records.

Local checks passed 2,963 Node tests and 155 Python tests. The final counter-format polish passed the 38 focused component/consumer tests. These cover complete text reassembly, byte-exact exports, Unicode boundaries, all seven request edits, late callbacks, disposal, download failures and the delivery graph. CI and public serving have a separate release check.

The amounts above are source-cell candidates with `financialCorrectness: unadjudicated`, `normalizedCurrency: null` and `generationMode: not-run`. Mechanical source binding does not establish human financial correctness, held-out question performance, a production API/browser integration, broad latency distributions or physical-phone behavior. Historical quarterly receipts, failed model attempts and previous rendering observations remain separate evidence.
