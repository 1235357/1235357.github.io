---
title: Preserve evidence before embedding
aliases: [Source-linked chunking]
tags: [rag, ingestion, financial-data]
category: technical-blog
domain: rag
status: local-draft
created: 2026-10-04
updated: 2026-10-14
source_type: implementation-and-test-review
metadata_version: 1
---

# Preserve evidence before embedding

**Question.** What is Net income for the year ended January 31, 2025?

Start with an **authored, fictional teaching table**, not an NVIDIA report or
an accepted parser fixture. Its heading prints `$` and
`(In millions, except per share data)`:

| Printed row | Year ended January 31, 2025 | Year ended January 31, 2024 |
| --- | --- | --- |
| Net income | 240 | 180 |
| Basic earnings per share | 0.80 | 0.60 |

The requested Net income candidate is `240` in millions. `180` has the right
row but the wrong date; `0.80` has a different metric and a per-share unit.
Retaining the number alone loses the information needed to distinguish them.
The printed dollar symbol also does not, by itself, establish an ISO currency
such as USD.

**The learning goal:** given a source page and a chunk, trace the exact text back
to its source, distinguish a physical page from its printed label, and identify
which row, period or unit relationship still needs checking. Then explain why
an exact source-cell match and an independently reviewed financial value are
different outcomes.

A revenue value without its fiscal column and unit is not a financial fact.
This chapter traces what the current ingestion code preserves, what it loses,
and which experiments must remain separate from the classroom baseline.

## The source recommendation and our implementation are different evidence

The [Anyscale ingestion guide](https://docs.anyscale.com/rag/quality-improvement/data-ingestion-strategies)
was read on October 4 in the in-app browser. It recommends native extraction
when embedded text exists, preserving layout and table headers, attaching
structural metadata, validating serialization, and assessing chunk boundaries.
It also covers source freshness, human review and domain representation.
These are design guidance, not proof that our parser satisfies them.

## Trace one document through the actual code

`core.extract_pdf_pages` opens the PDF with PyMuPDF and extracts embedded text.
It retains one-based physical PDF page numbers, including pages with no text.
Those numbers are not necessarily the printed page labels inside the report.
The alternative `coordinate_sorted` mode changes reading order; it does not
reconstruct a table schema or run OCR. A scanned page may consequently yield
little or no searchable text. No automatic OCR fallback is implemented here.

`core.chunk_pages` tokenizes each page using the configured tiktoken encoding,
then advances by `max_tokens - overlap_tokens`. In a 400/50 configuration,
starts are 0, 350, 700 and so on until the final window. Its chunk ID hashes
document ID, physical page, token start and decoded text. This offers a
deterministic locator, not a semantic boundary or a collision-proof source ID.

Each page is processed independently. A table starting on one page and finishing
on the next will not automatically become a single table chunk. Overlap can
repeat nearby tokens on the same page; it cannot recover a missing header from
another page. Also, this tokenizer's budget is not necessarily the embedding
model's tokenizer budget. Inspect the actual encoder input and truncation before
calling every 400-token chunk fully represented.

In the teaching table, a chunk containing only `Net income 240 180` would retain
the amounts while losing their date headers. Making its vector more precise
cannot recreate the missing relationship. A page locator lets a reviewer return
to the table; it does not turn this incomplete chunk into a reviewed value.

## The browser variant uses a different, explicit chunking contract

The independent browser variant must not silently reuse those Python token
offsets. Its pure `browser-rag/chunking.mjs` module consumes the accepted
PDF.js source artifact and returns **chunked; not embedded** records. The
explicit Build button starts a separate operation after parsing; it does not
create vectors. Its offsets count UTF-16 code units in text, whereas the Python
window budget counts tokens from its configured tokenizer.

<details>
<summary>October 8 browser integration checkpoint</summary>

<p>On October 8 the browser chunker was connected to the <a href="01-two-lifecycles.html#browser-source-lab">selected-file inspector</a> through an owned native ES-module computation worker. Node tests and actual Codex-IAB fixture execution remain different evidence.</p>

</details>

The initial policy is deliberately mechanical: retain parser item order,
join nonempty item strings with an authored newline, and form bounded windows
inside each physical page. It is **not** a sentence-aware or semantic chunker,
not a recovered table, and not a claim that parser order matches reading order.
Empty item strings do not create separators; original whitespace in nonempty
strings stays intact. Entirely blank pages create no chunks, but their physical
page numbers are not renumbered.

### Walk one chunk back to the source

Suppose a page contains item 0, `Alpha`, followed by item 1, ` Beta`.
The leading space belongs to item 1. Joining them produces `Alpha\n Beta`:
11 UTF-16 code units, including one newline authored by the chunker.
Choose a maximum of 8 code units and overlap of 2. Predict the following
before reading the test output. In this table, `\u0020` explicitly denotes one
space and `\n` one newline; they are escape notation, not literal added letters:

| Window in the joined page | Exact text, with whitespace escaped | Original source fragments | Authored separator |
| --- | --- | --- | --- |
| `[0, 8)` | `Alpha\n\u0020B` | item 0 `[0, 5)` → `Alpha`; item 1 `[0, 2)` → `\u0020B` | joined position `[5, 6)` → `\n` |
| `[6, 11)` | `\u0020Beta` | item 1 `[0, 5)` → `\u0020Beta` | none |

The two windows overlap at joined positions `[6, 8)`. Their total output length
is 13, although the joined page has length 11. Repeated overlap must count against
the output budget. The newline also counts as an output fragment, but it has
**no source-span ID**: displaying it as original quoted evidence would invent
content. Each source fragment instead retains its original full span ID,
item-relative start/end, exact quote, and corresponding start/end in the chunk.
Those are three different coordinate systems: original item, joined page, chunk.
None is a raw PDF byte offset or a model token count.

Every chunk ID includes the selected-file SHA-256, parser and extraction policy,
chunking policy, configured size/overlap, physical page and joined-page offsets.
A displayed PDF page label remains separate metadata. Changing a label must
not silently change which physical page the chunk references. This identity
is a replay locator, not a publisher signature or financial verification.

### Why not cut every string at exactly the nominal size?

JavaScript strings use UTF-16 code units. In `A😀B`, the emoji occupies two
units. With maximum 2 and overlap 0, safe windows are `[0, 1)` → `A`,
`[1, 3)` → `😀`, and `[3, 4)` → `B`; blindly slicing at offset 2 would
split a valid surrogate pair. The chunker adjusts the boundary and guarantees
forward progress. It can reduce effective overlap to avoid splitting a pair.
It does not normalize accents, repair lone surrogate units, or infer words.
The separately accepted embedding adapter now uses the **actual model tokenizer**
and refuses oversized input without silent truncation. The UTF-16 budget still
cannot substitute for that step; a window can pass chunking and fail encoding.

### Budgets are separate from model quality

Default windows are 512 UTF-16 units with 64 overlap. Independent output caps
are 10,000 chunks, 4,000,000 output code units and 200,000 fragments; callers can
lower those caps, not enlarge them. The input contract also checks the consumed
extractor fields, physical page/item order, dense arrays, parser identity and
full source spans before joining text. Unsupported or inconsistent records get
a typed refusal; crossing an output cap throws the entire call rather than
returning a silently truncated corpus. These are accepted-artifact boundaries,
not a browser-memory sandbox or a latency measurement.

Finding the first intersecting text run uses binary search; only the overlapping
runs are then visited for that chunk. This avoids rescanning all items for each
window. It does not make heavy overlapping configurations free: duplicated text
and fragment output still consume their own budgets. An architectural reason
to run this work in the approved computation worker is preserving interaction
and cancellation boundaries, not turning a module into a network microservice.

### A correct quote can still have a wrong location

During independent review, an adapter accepted a first fragment attributed to
the second item when both items contained `Alpha`. The string matched, but the
location did not. Another mutated reply shifted a valid window beyond the
joined page's length. The repair checks numeric item starts and the positions
of authored separators against the submitted source before accepting a reply.
It does not run a second chunker on the main thread. Predict why string equality
alone cannot reject the identical-item error, then inspect the retained tests
in `browser-rag/tests/compute-source.test.mjs`.

The worker owns construction; the adapter owns validated transfer and cleanup;
the session owns commit rights. Chunk work uses a fresh runtime incarnation
but the same document epoch. Cancellation keeps the accepted source and no
partial chunks. A stale worker's event retains its old identity rather than
being relabelled with the current operation. The controller receives the small
receipt, never the full source or chunk list. These CS381 responsibility and
CS310 asynchronous-owner boundaries are concrete project practice, not a claim
of deploying distributed services.

<details>
<summary>Reproduce the mapping, then explain it without the table</summary>

<p>Run from the locally staged site repository:</p>

<pre><code class="language-powershell">&amp; 'C:\Program Files\nodejs\node.exe' --test browser-rag/tests/chunking.test.mjs
</code></pre>

<p>The suite contains ordinary record fixtures plus two original PDFs parsed by
the pinned legacy PDF.js <strong>Node fake-worker</strong> path. The latter is a real parser
integration test, not a real browser worker or an embedding-quality test.
The tests check exact fragments, coverage, page identity, Unicode boundaries,
detachment, budgets and typed failures. Do not convert a count of passing tests
into recall, financial correctness, browser performance or personal mastery.</p>

<p>Your exercise: sketch the two windows above; label the three offset systems;
explain why the newline cannot be quoted as source evidence; then predict what
changes with zero overlap. Preserve your prediction and test observation.
Try an intentionally wrong source-span quote only in a disposable synthetic
record, and explain why it must be rejected before an encoder sees the text.</p>

<p>English rehearsal: “I preserve source-relative spans while building page-local
windows. Authored separators are labelled separately. The windows are bounded
in UTF-16, not model tokens, so tokenization and truncation require another
contract. This stage creates attributable candidates, not verified answers.”</p>

</details>

This is independent practice applying CS381 responsibility boundaries and
CS310 work/resource boundaries, not a graded course deliverable. Parsing owns
source records; chunking owns window construction and source mapping; the
encoder owns its tokenizer and representations. Keep these changes
testable independently before tuning end-to-end retrieval.

### The encoder is a separate accepted artifact

Passage encoding accepts its own artifact: ordered token-ID lists and normalized
384-dimensional rows, tied to the exact chunk IDs, file SHA-256 and frozen
representation contract. That state is **embedded; not retrieved**. An explicit
question must still be encoded and ranked; even sourced candidates do not
establish the correct financial row or authorize an answer.

<details>
<summary>October 9 toy-PDF passage-encoding receipt</summary>

<p>The October 9 passage-encoding receipt marks <strong>embedded; not retrieved</strong> as its own accepted stage. The later explicit query advances to sourced candidates, not an answer. MiniLM FP32/WebGPU returns ordered token-ID lists and normalized 384-dimensional rows tied to the exact chunk IDs, file SHA-256 and frozen representation contract. The two-page toy PDF yielded two rows and 24 total encoded IDs. That passage receipt alone does not demonstrate ranking, financial relevance or generation; the later question run has its own artifact and receipt. The <a href="01-two-lifecycles.html#a-real-representation-receipt-not-a-retrieval-benchmark">first/cache-run receipt</a> records the actual bounded observation rather than inferring it from passing tests.</p>

</details>

Cancellation retains accepted source/chunks but prevents partial vector commits;
replacing the selected document invalidates all dependent artifacts before old
work can update the page. Download/cache receipts describe verified asset bodies,
not document uploads, complete network traffic or GPU memory. The implemented
query encoder and ranker check that same representation and source/order contract;
equal vector dimensions alone are insufficient compatibility evidence. Editing
the question preserves passage vectors; replacing the source invalidates them.

## Provenance helps replay, not truth verification

`ingest.build_corpus_artifacts` requires source declarations with pinned hashes,
checks the PDF bytes against those hashes, rejects duplicate document IDs and
duplicate chunk IDs, and writes JSONL plus a manifest. The manifest records
source URLs, filenames, chunking choices, document/page counts and the chunk-file
hash. These properties make a particular corpus build inspectable.

A hash proves correspondence to those bytes, not the correctness of the report,
an analyst interpretation or a parser's recovered table. Counts establish size,
not coverage: 903 nonempty pages would not prove that every needed fact survived.
The single-PDF builder and corpus builder also have different manifest fields;
do not assume their contracts are interchangeable without checking consumers.

## Keep the table experiment honest

`table_structure.py` is explicitly a conservative candidate generator, not a
general-purpose table parser. The inspected date helper supports a limited
month vocabulary and uses spatial tolerances to associate words. That is a
layout-dependent heuristic, not universal financial-document understanding.
The `Chunk` type can retain `amount_bbox`, `metric_bbox` and `period_bbox`.
Its rectangle checks ensure finite, nonnegative, positive-area geometry; they
do not establish that all three boxes belong to the same financial cell.

In `table_structured` corpus mode, ordinary text chunks remain and additional
table candidates are appended. This is not replacement of the entire corpus
with validated rows. A later retrieval filter must distinguish candidates and
human verification must still return to the source PDF.

This older experimental corpus mode is distinct from the later source-bound
income selectors described below. Neither a rectangle with valid coordinates
nor a unique mechanical match is an independent financial review.

The code explicitly prevents experimental extraction and declared third-party
sources from overwriting the protected default output path. That is a useful
baseline guard, not a general sandbox or a license grant. Expansion remains a
separate source- and rights-reviewed corpus with its own evaluation.

## A proposed acceptance checklist for each financial cell

1. Locate the physical PDF page and the complete table, including its title.
2. Record the exact row label, column header, reporting date and unit.
3. Compare the value including parentheses, decimals and footnotes.
4. Check whether the extracted representation keeps those relationships.
5. Inspect adjacent columns and rows for plausible but wrong alternatives.
6. Mark ambiguity as unresolved instead of filling a guessed cell.

For example, a report can discuss both annual revenue and quarterly revenue.
Finding the same keyword does not make those periods equivalent. A statement
denominated in millions and a narrative amount denominated in billions require
explicit unit interpretation, not a string-level equality check.

This checklist is a proposed reviewer procedure. It is not a claim that every
stored table candidate has already passed it or that an independent test set
has been accepted. Changing parsing, chunk boundaries or the encoder should
create a separately identified artifact, not silently overwrite the baseline.

## Native structured data is not a recovered PDF table

<figure>
<img src="figures/04-evidence-to-calculation.svg" alt="Document retrieval produces candidates. A separate proposed source-review path accepts explicit rows before reviewed-value lookup or calculation." style="display:block;width:100%;min-width:640px;height:auto">
<figcaption>Solid arrows show the document-retrieval path. Dashed arrows describe a proposed independently reviewed values layer and calculation boundary. The implemented mechanical source-cell selectors below return candidates; they do not complete this diagram's review-and-calculation path. This is a conceptual design, not a deployed verified-values service.</figcaption>
</figure>

Editable sources: [draw.io diagram](figures/04-evidence-to-calculation.drawio)
and [PlantUML diagram](figures/04-evidence-to-calculation.puml).
The displayed SVG was authored separately; source import/render acceptance
remains pending and these formats are not asserted to produce identical pixels.

The [Anyscale structured-data guide](https://docs.anyscale.com/rag/structured-data)
was read in the in-app browser on October 4. It distinguishes native databases,
CSVs and spreadsheets from tables recovered from documents. It describes
metadata-filtered lookups, hybrid retrieval, and controlled SQL or DataFrame
tools for relational and numerical questions. Tool execution needs security
controls; retrieving the right data still does not verify the final reasoning.

Our PDF cell candidates are not an authoritative relational database. Putting
them into a CSV would change the container, not validate their fiscal columns.
Before structured queries can be trusted, each accepted row needs its original
source locator, period, metric, unit, value and reviewer status. Unresolved
candidates must not silently enter an accepted-values table.

**Implemented selection, checked October 14.** Exact lookup is no longer only
a proposal in the source code. The implemented mechanisms have a narrower
outcome than the reviewed-values layer in the figure:

| Implemented entry | Explicit input and selection | What a match establishes |
| --- | --- | --- |
| Python `POST /v1/statement-fields` | Section-qualified row path, native period/date and unit contract, with optional report/column constraints, over an operator-configured income snapshot | One matching native cell, returned as `source_candidate`; `financial_correctness="unestablished"` and no cosine score |
| Configured public browser lab's Source-cell lookup | Accepted PDF.js source plus explicit statement, Net income metric, supported period, exact date/unit heading and dollar glyph | One cell bound by the supported annual or quarterly geometry profile; `financialCorrectness="unadjudicated"` and `normalizedCurrency=null` |

These selectors do not ask an encoder to infer the requested field. The Python
route does not turn its fields into a natural-language question; the browser
lookup needs no chunks, encoder or generator. The browser's supported Net income
profiles are not a general parser for every row in the opening teaching table.
Both preserve source identity while withholding missing, ambiguous or unsupported
matches. Neither converts the dollar glyph into an established USD denomination
or performs the proposed growth calculation. An absent Python statement index
returns an authenticated unavailable response, rather than falling back to
similarity ranking. The source implementation is not hosted-service acceptance.

For example, the Python field `per_share/basic` and `count/basic` can both
originate from rows printed as **Basic**. The first requests a per-share amount
at scale `"1"` with printed currency `"$"`; the second requests a share count at
scale `"1000000"` with `currency_literal=null`. Row identity and units must agree;
asking for another scale is not permission to convert it. Matching these fields
selects retained source data; it does not independently adjudicate the value.
The [installed-startup chapter](08-source-bound-startup.html#ask-for-a-field-with-its-unit)
follows this typed request at the HTTP boundary.
The versioned [typed selector](https://github.com/1235357/nvidia-financial-rag/blob/e74d7adeb3209a763ba7e71d0c232d5de4c351b2/src/nvidia_rag/statement_fields.py)
and [HTTP adapter](https://github.com/1235357/nvidia-financial-rag/blob/e74d7adeb3209a763ba7e71d0c232d5de4c351b2/src/nvidia_rag/statement_fields_api.py)
keep the native-field matching and unavailable outcomes inspectable.

Keep three distinct tasks in view:

| User question | Operation at the required acceptance level | Remaining verification |
| --- | --- | --- |
| Find the discussion of revenue growth | Retrieve relevant narrative passages | Does the passage address this period and metric? |
| Look up annual revenue for a specified fiscal year | Exact selection from source-checked rows | Is the accepted row correctly extracted and current? |
| Compute year-over-year revenue growth | Select two accepted rows, normalize units, then calculate | Are periods comparable and is the denominator appropriate? |

For the last operation, the proposed calculation is `(current - prior) / prior`.
It should reject missing inputs and a zero denominator, preserve both source
locators, and distinguish nominal reported values from adjusted comparisons.
This formula does not prove the inputs correct. It is not currently a verified
SQL agent, calculator API or financial-answer feature in the classroom demo.

CS 381's responsibility boundary is useful here: parsing proposes candidates,
review accepts source-backed records, lookup selects records, and calculation
operates on explicit inputs. None should silently substitute for another.
CS 310's deployment questions come later: a database service is warranted by
measured access, consistency and operational requirements, not merely by the
presence of numbers in a document. A future LLM-generated-query route would
also need read-only access, constrained queries and resource limits; it must not
execute arbitrary generated Python against the developer's machine.

## Your learning task

**Predict before opening the feedback.** A new synthetic page has item 0,
`Revenue`, followed by item 1, ` 240` with one leading space. Set the browser
window maximum to 9 UTF-16 units and overlap to 2. Write the joined text, each
window's offsets and total output length. In the second window, which part has
an original source span? Does its exact `240` authorize a dated, unit-qualified
financial answer?

<details>
<summary>Check the new window and the missing financial relationships</summary>

<p>The joined page is <code>Revenue\n\u0020240</code>, length 12. Here <code>\n</code> denotes one authored newline and <code>\u0020</code> one original space, rather than literal escape letters.</p>
<table>
<thead><tr><th>Joined-page window</th><th>Exact text, escaped</th><th>Source and presentation mapping</th></tr></thead>
<tbody>
<tr><td><code>[0, 9)</code></td><td><code>Revenue\n\u0020</code></td><td>Item 0 <code>[0, 7)</code> maps to chunk <code>[0, 7)</code>; authored newline maps to chunk <code>[7, 8)</code>; item 1 <code>[0, 1)</code> maps to chunk <code>[8, 9)</code>.</td></tr>
<tr><td><code>[7, 12)</code></td><td><code>\n\u0020240</code></td><td>Authored newline maps to chunk <code>[0, 1)</code>; item 1 <code>[0, 4)</code> maps to chunk <code>[1, 5)</code>.</td></tr>
</tbody>
</table>
<p>The total output is 14 UTF-16 units: 9 + 5. The overlap repeats both the authored newline and the original space. The newline has no original source-span ID in either window. Exact item-relative spans identify the source text, but these two items contain no dated column or unit heading. They therefore cannot establish which fiscal value <code>240</code> represents.</p>
<p>The pure chunking module was run against this authored source record to check these windows and fragments. No PDF parser, encoder or generator ran for this example. Once feedback has been read, this case is a worked example; a reader's own prediction on a different page and configuration is still needed to assess understanding.</p>

</details>

Choose one original report page. Sketch the row/column structure yourself,
then compare plain extraction, one chunk and any experimental cell representation.
Explain what metadata was preserved and what still requires human interpretation.
Do not start with a similarity score: the error may exist before embedding.
Retain your prediction and observed result separately. If they differ, identify
whether the mistake concerned source location, window construction, fiscal
identity or acceptance of a value, then try another page before claiming mastery.

Continue with [ranking semantics](03-ranking-is-not-confidence.html) and
[evaluation design](06-evaluation-labels-before-scores.html).
