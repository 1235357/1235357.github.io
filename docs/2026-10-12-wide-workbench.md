# A wider workbench with a separate reading rail

> Historical design record: the October 14 requirement supersedes the dark-journal and optional dark-figure policies below. The current site uses one light theme throughout; see [the current theme contract](2026-10-14-unified-light-site.md).

The embedded RAG application previously shared the profile's 1440 px container.
Once the profile's 80 px side gutters applied, its frame stopped growing at
approximately 1278 px of usable iframe width, even on 1920 and 2560 px screens.
The application then consumed more space with a second set of internal gutters.

The profile now uses named content and full-width grid tracks. Profile sections
keep their existing reading rail; the demo section occupies the full track.
Within that section, its heading, project selector, frame and note share one
centered workbench track, capped at 2080 px on ultrawide screens. The outer demo
gutter is 16–40 px. Embedded header, content and footer use the available frame
width, with 24 px desktop and 16 px narrow-screen gutters.

The lab uses a hybrid layout: at wide breakpoints, document controls occupy a
bounded 360–520 px track and the answer/evidence track expands. The notebook
spans both. Ordinary result prose remains limited to 72ch, while structured
records and tables retain the available workspace. Standalone lab content can
grow to 1800 px and keeps its full introduction.

## Design research and interpretation

Three primary design sources were read in the Codex in-app browser:

- [IBM Carbon 2x Grid](https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/overview): fluid content grids, bounded side panels, consistent spacing and aligned key lines.
- [USWDS typography](https://designsystem.digital.gov/components/typography/): comfortable body size, left alignment and controlled line length. Its general long-text target is around 66 characters; our 72ch maximum is a CSS measure rather than a guaranteed character count.
- [Microsoft Fluent layout](https://fluent2.microsoft.design/layout): fixed, stretch and hybrid grids chosen for the content, with consistent spacing and responsive reflow.

These sources support the layout direction. The actual dimensions are project
choices, reviewed against rendered screens; they are not prescribed by a source.
The installed Emil design-engineering skill guided restrained composition,
cohesion, immediate controls and the independent Before/After/Why review.

## Actual browser measurements

The same Codex in-app browser measured the previous published version and the
new local public build. Values below are CSS pixels; requested viewport width
includes a scrollbar area that the page's `clientWidth` excludes.

| Requested viewport | Previous iframe | New iframe | Previous answer card | New answer card |
| --- | ---: | ---: | ---: | ---: |
| 1280 px | 1135 px | 1211.8 px | 540.4 px | 605 px |
| 1600 px | 1278 px | 1519 px | 611.1 px | 912 px |
| 1920 px | 1278 px | 1826.2 px | 611.1 px | 1219 px |
| 2560 px | 1278 px | 2078 px | 611.1 px | 1471 px |

The iframe is about 19%, 43% and 63% wider at the latter three screen sizes.
The profile hero retained its exact measured bounds at all five original
comparison sizes. Manrope remains 18 px in the profile and 17 px in the lab.
The frame's desktop height changed from `clamp(620px,78svh,1000px)` to
`clamp(720px,86svh,1200px)`; narrow-screen height retains its existing rule.

Nine final local dimensions were checked: 320, 390, 768, 960, 1100, 1280, 1600,
1920 and 2560 px. Both documents had `scrollWidth === clientWidth` at each size;
visible buttons measured at least 46 px high. Narrow iframe viewports stacked
the working cards into one column.

The actual native file picker selected the original 74,085-byte two-page PDF,
SHA-256 `8e668f014d42e1ece74a67e1431dea6542b48c60ed8bcd7a0e187e6b954e7428`.
Native parsing and chunk construction retained five chunks. After choosing
chunk 5, resizing to 1600, 1920 and 390 px retained the same accepted document
receipt and chunk selection. Clear returned to the empty state. No encoder,
generator or financial adjudication ran during these layout checks.

## Verification limits

These are actual IAB desktop and viewport-emulation observations, not a
physical-phone gesture/keyboard acceptance claim. The change is scoped to
layout CSS; original parser, model, source and generation contracts are retained.
The detailed journal's dark base styles remain unchanged. Complete notebook
record ownership, financial human/held-out evaluation, broader performance and
production integration remain separate open work in the full project goal.
