# Shared feedback and readable technical tables

## Problem

The workspace's sole session-status region lives inside the draft card even when
the current operation parses a PDF or builds passages. Its location gives a
document operation the visual meaning of an answer result. The layout should
show this feedback as shared by the document, question and draft. Separately,
the article-wide `overflow-wrap:anywhere` reaches table cells and code, splitting
short technical identifiers in chapter 08 and other reading pages.

## Technical plan

Move the existing status region, with its unchanged IDs and live-region
attributes, into a shared full-width row immediately after the document card and
before the question/draft row. This places it below document actions and above
the two later stages. Keep one feedback region and the existing lifecycle
renderer; do not duplicate announcements, move focus automatically, or invent
an aggregate completion percentage. Keep the row in normal flow, so feedback
never overlays controls or consumes a sticky strip on a narrow screen.

Use the same light surface, Manrope, navy text, cobalt edge and spacing as the
rest of the workspace. On desktop put the existing label/title beside the
detail, with the progress bar below. At 780px and below stack these parts. Use a
22px title and a 15px detail, readable without making feedback compete with the
three main stage headings. Preserve the complete visible detail and honest
empty state. Long diagnostics wrap within the region.

For reading-page tables only, reset cell `overflow-wrap` to `normal` and keep
inline table code together with `white-space:nowrap`. Preserve normal wrapping
of prose and the existing table-local horizontal scrolling. Keep article
`min-width:0`, all light tokens, and existing typography sizes.

## Alternatives

Repeating a status in each card adds multiple live regions and synchronization
work. Keeping status in the draft card preserves misleading ownership. A sticky
region can cover controls and use excessive narrow-screen height when a real
progress message is long. A shared normal-flow row is a small HTML/CSS change
with explicit placement on both layouts. It improves shared ownership and
distance; it does not promise that status remains onscreen while scrolling.

For tables, forcing all text onto one line would produce unnecessarily wide
prose tables. Arbitrary manual line breaks would alter individual source
identifiers and require repeated article edits. Protect only code tokens, while
the table's own scrollport contains genuinely wide technical content.

## Detailed implementation and acceptance

Change `browser-rag/inspector.html`, `browser-rag/inspector.css`, `style.css` and
this note. Move the existing `.status-block` out of `.generation`, immediately
after `.document`, adding class `session-status` and a heading wrapper. Keep
`status-title`, `status-detail`, `operation-progress` each exactly once, with all
their current attributes/text. Add `status status` / `status` to the desktop /
narrow grid template areas. Scope the new two-column feedback layout to
`.session-status`; leave global progress rendering and model behavior alone.
The existing generation heading rule must not be needed to style the moved
title. Do not change JavaScript, entry points, CSP, iframe URLs, disclosures,
model contracts, parser/model actions or notebook navigation.

Use the installed EGM skill's proportionate-change path for this presentation
increment: freeze these design/source inputs, obtain a fresh design review,
reconcile findings, then implement and obtain a fresh code review. This does not
claim the optional Python completion adapter validates browser behavior.

Acceptance:

1. Actual local IAB at desktop and 390px: one shared status region appears in
   source order and visual order after the document and before question/draft;
   no document horizontal overflow, clipped detail, overlap or sticky overlay.
2. A small local PDF parse and chunk action update the same status node in its
   new position. Clear source restores the waiting state. No encoder/generator
   action is required or authorized by this UI check; a parse is not model or
   financial-quality evidence. Existing progress/cancel/refusal lifecycle tests
   cover the unchanged renderer and must pass.
3. Chapter 08's `currency_literal` and `per_share/basic` remain intact. A
   prose-heavy table still wraps normal text. At 390px the document remains
   within the viewport while a wide table can be scrolled to its final column;
   confirm visually as well as by computed CSS/geometry.
4. Existing workspace/navigation checks and the public build pass. Inspect the
   public page after the exact release CI succeeds; report public and local
   viewport observations separately from physical-phone/user acceptance.
