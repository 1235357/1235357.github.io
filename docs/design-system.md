# One design language across the portfolio

## Problem

Readers move from the profile to a project, its notebook, a technical article
and a full-size figure. Those destinations belong to one site. A light outer
page around a dark document or figure breaks that continuity. Small type and
too many controls at once also make the project difficult to explore.

The current pages already share a light theme. This contract preserves it when
new articles or Archify figures are generated. It does not treat a passing
source check as a visual review or as evidence of financial answer quality.

## Technical plan

Use the same semantic colors everywhere:

| Role | Value | Use |
| --- | --- | --- |
| Paper | `#f7f8fa` | Page, reading surface and workbench surround |
| Panel | `#ffffff` | Forms, cards and figure canvas |
| Ink | `#172033` | Main text and headings |
| Secondary ink | `#46536b` | Supporting instructions and captions |
| Accent | `#234ccf` | Actions, links, selected state and focus |
| Divider | `#d8dfeb` | Boundaries between related content |

Manrope is the self-hosted interface and reading family. Technical code and SVG
labels may retain their monospace family. Font choice follows the information's
role; visual presets must preserve interface typography. Figure exports must
carry their fonts rather than depending on a font installed on the reader's
computer.

Keep the hierarchy suited to each task:

| Destination | Initial reading path | Detail available on request |
| --- | --- | --- |
| Profile | Identity, focus, selected work and project links | Contributions, further projects and academic detail |
| RAG lab | Document, preparation, question and draft | Model contracts, source-cell comparator and computation notebook |
| Article | A concrete problem, explanation and source-backed figure | Execution records and practice feedback |
| Figure | Named roles and their relationships | Source notes, semantic inspection and export controls |

Body type currently uses 18px on the profile, 17px in the lab and 19px in desktop
articles (18px on narrow reading pages). Inputs stay at least 16px. These scales
share a family and clear contrast without making every page equally dense.
The workbench uses the available page width; prose retains a readable 780px
measure. Wide figures span the reading grid. Tables scroll locally on narrow
screens. Essential next actions, current state and download implications remain
visible. Secondary detail uses native disclosures with descriptive labels.

## Alternatives

A single stylesheet for every destination would couple the workbench and the
reading layout, and adding a runtime CSS import would introduce another
dependency and cache boundary. The current separate stylesheets suit their
layouts. A CI contract compares their shared roles and tests the actual figure
theme entry points, so divergence is caught before publication.

An Archify visual preset may change diagram presentation. Its page theme and
interface family remain consistent with the portfolio. Legacy dark URL,
storage and operating-system preferences must leave the figure light; exports
also remain light. Upstream dormant dark CSS is not a reachable site option.

## Implementation and acceptance

`browser-rag/tests/design-system.test.mjs` runs with the existing `npm test
--prefix browser-rag` CI step. It checks shared CSS declarations, all tracked
Archify viewers, each actual first-paint script and theme API with legacy dark
inputs, plus the complete SVG serializer in a controlled DOM/color fixture to
check its resulting theme, background and color bindings with legacy options. Existing
figure tests cover font readiness for raster, share-card and video exports.

When adding or regenerating a figure, retain the site light, typography and
export adaptations before committing it. Run the checks, then review the actual
page and a downloaded SVG/PNG in the Codex in-app browser. Source checks do not
evaluate the complete CSS cascade, image pixels, screen-reader behavior or
physical-phone usability. A changed rendering path requires fresh browser and
export review.

Apply [Emil's design engineering skill](https://github.com/emilkowalski/skills)
to useful defaults, immediate keyboard actions and restrained pointer feedback.
Use [Archify](https://github.com/tt-a1i/archify) for source-backed diagrams.
Apply the learning and writing skills to the article structure: connect each
explanation to a concrete case, keep claims supported, and offer practice before
revealing its feedback. A working example and a reader's understanding require
separate verification.
