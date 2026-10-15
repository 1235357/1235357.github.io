# Keep the next source view within reach

## Problem

The light workspace keeps detailed source views in a closed computation notebook. The document, question and draft cards explain what to inspect, but do not offer direct links to the corresponding notebook sections. A first-time visitor must find the general Notebook route, then choose a section. This small presentation change connects each action area with its existing inspection destination.

## Technical plan

Add ordinary same-document links beside the relevant controls: Source pages and Passages in the document card, Retrieved sources in the question card, and Assembled evidence in the draft card. Use the existing `installNotebookNavigation` handler: it opens the target's notebook ancestors, focuses that destination and scrolls instantly while retaining native URL/history behavior. No new JavaScript or lifecycle state is needed. Empty views keep their existing truthful messages; a link names a view and does not assert that a result already exists.

Use the current Manrope, cobalt, underline, focus and light-surface tokens. Keep links compact, wrapping and at least 44px high. The document heading's existing short hint becomes a concrete first task: build chunks, then compare a passage with its source page. It does not imply that embedding is required for that comparison.

## Alternatives

Opening the entire notebook by default would expose all empty technical views and increase first-use density. Automatically moving focus after work would interrupt reading and change the existing explicit inspection behavior. A new result-status controller would duplicate lifecycle responsibilities for a presentation problem. Instead, reuse ordinary links and the current tested router.

The separate audit finding that document-operation progress sits in the draft card is retained for a later, separately reviewed layout change. Moving the sole status region upward without examining question/generation feedback could merely reverse the distance problem. This navigation change does not claim to repair progress placement.

## Detailed implementation and acceptance

Change only `browser-rag/inspector.html`, `browser-rag/inspector.css` and this note. Add one labelled navigation group in each relevant card, using only `#notebook-source`, `#notebook-chunks`, `#notebook-retrieval` and `#notebook-context`. Place document links after the two-column document controls and before optional contracts; place the other links after each card's existing guidance. Preserve every existing ID, iframe URL, ordinary/public entry difference, CSP, worker/model action and default disclosure state. No external page or top-level navigation is introduced.

Acceptance: inspect the actual desktop and narrow local IAB view for readable light presentation and no horizontal overflow; click each new link and observe the promised notebook section, open ancestors, focused target and unchanged iframe/session identity. Empty targets must remain honest, and navigation must start no parser, model download, embedding or generation. Existing notebook-navigation checks and the relevant HTML/public-build checks must pass. A fresh code review compares the exact correction with these constraints. Public deployment and public IAB observations are recorded separately from local checks; a viewport test is not physical-phone or learner acceptance.

This is the installed EGM skill's proportionate-change path, informed by Emil Design Engineering's clear controls and immediate response principles. It does not claim the optional Python adapter verified browser interactions.

For document placement, the links follow `.document-grid` and precede `.document-options`; the existing
encoder disclosure stays inside its process column. Acceptance also includes a
keyboard activation, a same-fragment revisit and a Back/Forward round trip. The
router definition establishes compatible behavior; actual entry installation and
absence of work remain browser acceptance questions rather than inferred results.
