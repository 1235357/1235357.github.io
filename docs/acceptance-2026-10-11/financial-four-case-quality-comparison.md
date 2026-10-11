# Four native v4 development cases: amount, period and citation review

The first four frozen native v4 Top3 outputs contain a concrete period-selection failure: both six-month questions return the three-month amount. Two of four bare numeric outputs agree with their assistant-reviewed development candidates. That count is not an accuracy estimate, independent human acceptance, or a heldout result. Every case is a previously exposed positive question; there is no negative/refusal denominator.

The complete machine-readable record is [financial-four-case-quality-comparison.json](./financial-four-case-quality-comparison.json). It retains each exact question and its UTF-8 SHA-256, original question-record hash, source-candidate span/profile, untouched native receipt hash, raw output and hash, prompt hash, selected citation text/identity, token counts, and single-attempt elapsed time. Source review is by CodexAI and `humanAcceptance=false` throughout.

| Frozen question | Candidate amount, in millions of dollars | Actual bare answer | Actual citations | Prompt / output IDs | EOS; one attempt |
|---|---:|---:|---|---:|---:|
| Revenue, three months ended July 28, 2024 | 30,040 | 30,040 | E1, E4 | 1744 / 37 | 35,444 ms |
| Revenue, six months ended July 28, 2024 | 56,084 | 30,040 | E1, E4 | 1744 / 37 | 34,868.4 ms |
| Net income, three months ended July 28, 2024 | 16,599 | 16,599 | E4 | 1745 / 33 | 34,517 ms |
| Net income, six months ended July 28, 2024 | 31,480 | 16,599 | E4 | 1745 / 33 | 32,806.6 ms |

All four runs use the same pinned Qwen2.5-0.5B model revision, WebGPU q4, v4 framing, Top3 retrieval, deterministic generation and 128-token reserve within a 2048-token context. These elapsed values are single native attempts, not a distribution, p95, isolated GPU time, TTFT measurement or load test. The saved raw answers omit the metric, unit and period in the answer string; a numeric match does not establish a complete financial answer.

E1 is the first income-statement chunk: native excerpt physical page 1, printed label 3, ordinal 0, UTF-16 span `[0,512)`. Its selected text includes the Revenue row, three/six-month headings, current/prior date columns, the unit heading, dollar literals, and both requested current-year revenue amounts. Case 2 therefore returns the wrong period's amount even though the requested six-month amount is inside its cited evidence. E4 is native physical page 2, printed label 4, ordinal 3, span `[0,512)`. Its comprehensive-income text contains no Revenue row; its inclusion in the revenue answers establishes citation identity only, without Revenue support.

E4 does contain the Net income row, both durations, date columns, dollar literals, the `In millions` heading, and both current-year values. The exact registered original PDF was reopened read-only: original physical page 4 repeats Net income `16,599 / 6,188 / 31,480 / 8,232` under the appropriate three/six-month columns. It is valid alternate Net income evidence despite the frozen candidate's page-3 label. Case 4 nevertheless selects the three-month value from that same cited text. The provisional semantic judgments in the JSON are source-review observations by the assistant; they are not a new automated entailment gate or human adjudication.

The source identities remain separate. The portable candidates bind the 80-page original PDF SHA-256 `35d94221f0ed30f974b4fe6536fa54ff40945265d8b354b0ae17066c8856a861` using PyMuPDF 1.28.2 sorted text and half-open Unicode code-point spans. Native generation reads the two-page excerpt SHA-256 `8e668f014d42e1ece74a67e1431dea6542b48c60ed8bcd7a0e187e6b954e7428` using PDF.js 6.4.299 item order, 512 UTF-16-unit chunks and 64-unit overlap. Excerpt physical pages 1/2 map to original physical pages 3/4 through the selected excerpt and printed labels. These are different PDF bytes and extraction profiles; their offsets are not interchangeable.

The four original saved receipts predate canonical-input disclosure. [financial-four-case-replay-before-input-disclosure.json](./financial-four-case-replay-before-input-disclosure.json) independently recomputes EOS/token counts but marks all four `incomplete-archive`: their actual original eight-field generation inputs are absent. The assembled `preparedPrompt.context` projection cannot substitute for the original input. Canonical citation-gate acceptance remains unestablished for these old archives. Fresh attempts with matching, actually disclosed input sidecars must be replayed separately, preserving these historical receipts.

The pure replay helper accepts exact receipt paths and exclusive report creation:

```powershell
node browser-rag/acceptance/replay-financial-receipts.mjs --out docs/acceptance-2026-10-11/NEW-replay.json EXACT-receipt.json --original-input EXACT-receipt.json ACTUAL-original-input.json
```

It performs no model call, PDF parse or output repair. A supplied sidecar must rebuild an assembled context exactly equal to the one archived in its receipt; hashes identify supplied bytes without authenticating their original production. Format/citation identity acceptance from a complete replay must remain separate from row/period/unit support and independent human acceptance.
