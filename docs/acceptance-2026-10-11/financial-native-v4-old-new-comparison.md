# Four fresh canonical native receipt replicas

All four fresh receipt/input pairs independently replay through the existing strict gate as drafts: EOS, exact JSON/schema and selected citation identities pass, and each actual eight-field input rebuilds the context archived in its own receipt. Financial correctness and human acceptance remain unestablished. The complete gate report is [financial-native-v4-four-case-canonical-replay.json](./financial-native-v4-four-case-canonical-replay.json); its SHA-256 is `d33e5d7e91184653619c216e7fcdb9f68cf838d4140512ffb3ea18a9eeb2b6cc`.

The question, model input, chat messages, rendered prompt, prompt IDs, generated IDs and raw output are identical between each older attempt and its fresh replica. The original archive remains missing its original input; no new input was retroattached to an old archive. [financial-native-v4-old-new-comparison.json](./financial-native-v4-old-new-comparison.json) retains the separate old/new receipt hashes, actual input hashes, exact question hashes, source bindings, citation text, token counts, timings and comparison flags. Its SHA-256 is `da8fb59cdd65ff25f66b67aeb29809dec6fcd76b3dd40d0d605b9cfb20d3791a`.

| Exact frozen question profile | Assistant-reviewed candidate, in millions of dollars | Fresh raw answer / citations | Prompt / output IDs | EOS; one fresh attempt |
|---|---:|---|---:|---:|
| Revenue, three months ended July 28, 2024 | 30,040 | `30,040` / E1, E4 | 1744 / 37 | 39,541.8 ms |
| Revenue, six months ended July 28, 2024 | 56,084 | `30,040` / E1, E4 | 1744 / 37 | 37,709.1 ms |
| Net income, three months ended July 28, 2024 | 16,599 | `16,599` / E4 | 1745 / 33 | 35,138.1 ms |
| Net income, six months ended July 28, 2024 | 31,480 | `16,599` / E4 | 1745 / 33 | 36,300.7 ms |

Two of four bare amounts agree with exposed assistant-reviewed candidates; both six-month questions again select the three-month amount. This is a development diagnostic count, not an accuracy estimate. Answers still omit the metric, period and unit. All four questions are positives, so no negative false-accept rate or rejection denominator exists. No retrieval-recall, heldout-quality or performance-distribution claim is made.

E1 contains the Revenue row, both duration/date columns, unit and dollar literals, and both current-year revenue amounts. The six-month revenue error occurs despite the requested value appearing in that citation. E4 has no Revenue row, so it adds no Revenue support. E4 does contain the Net income row and both current-year amounts in the Comprehensive Income statement; the original report's physical page 4 was independently reopened read-only and agrees. It is valid alternate Net income evidence even though the candidate binds original page 3. The six-month Net income error is a selection of the wrong duration within that cited evidence.

The original 80-page PDF and the native two-page excerpt have distinct SHA-256 identities. Candidate spans use PyMuPDF 1.28.2 sorted Unicode code points; native spans use PDF.js 6.4.299 parser-item order and UTF-16 units. The report preserves those extraction profiles and the native physical 1/2 to original physical 3/4 mapping. It does not substitute one source identity or span system for the other.

This audit made zero model calls. It used complete input disclosures saved from the fresh attempts and the unchanged pure validator; no output repair or gate relaxation was applied. Hashes bind supplied bytes without independently authenticating how those bytes were produced. Source review is by CodexAI, with `humanAcceptance=false` throughout.
