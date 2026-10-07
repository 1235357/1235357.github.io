---
title: Preserve evidence before embedding
tags: [rag, ingestion, financial-data]
category: technical-blog
status: local-draft
created: 2026-10-04
updated: 2026-10-04
source_type: implementation-review
---

# Preserve evidence before embedding

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
<img src="figures/04-evidence-to-calculation.svg" alt="Implemented document retrieval produces candidates; proposed source review must accept rows before exact lookup or calculation." style="display:block;width:100%;min-width:640px;height:auto">
<figcaption>Solid arrows show the implemented document path; dashed arrows show a proposed review-and-calculation boundary, not a deployed feature.</figcaption>
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

Consider two distinct operations:

| User question | Suitable proposed operation | Remaining verification |
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

Choose one original report page. Sketch the row/column structure yourself,
then compare plain extraction, one chunk and any experimental cell representation.
Explain what metadata was preserved and what still requires human interpretation.
Do not start with a similarity score: the error may exist before embedding.

Continue with [ranking semantics](03-ranking-is-not-confidence.html) and
[evaluation design](06-evaluation-labels-before-scores.html).
