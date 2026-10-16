# One light theme across the complete site

The October 14 user instruction replaces the previous dark-journal exception.
The personal profile, RAG workbench, journal, all eight articles and all eight
interactive figures now belong to the same light design system. Earlier dated
screenshots and acceptance records retain their original theme observations.

The shared stylesheet uses cool paper `#f7f8fa`, navy ink `#172033`, muted text
`#46536b`, cobalt links `#234ccf`, white panels and light blue-gray code/table
surfaces. All reading pages use the same self-hosted Manrope as the profile and
lab, with 19px desktop and 18px narrow-screen prose. Code retains a monospace
font and its full content; tables and wide figures keep local scrolling.

| Before | After | Why |
| --- | --- | --- |
| Dark base styles underneath a light profile override | The root stylesheet itself is light | Journal and article pages inherit the correct shared default |
| Green code blocks, dark table headers and pale captions | Light surfaces and navy/muted text | Expanded technical content remains readable in the same theme |
| Serif articles and monospace navigation unrelated to the homepage | Shared Manrope headings, prose and navigation | Moving between project and explanation preserves the visual identity |
| Unversioned article and journal CSS | Every reading page carries a content-derived CSS URL | A returning reader requests the new style body |
| Figure URL/storage preferences could restore dark mode | Site figure policy keeps viewers and exports light | Old links and preferences cannot reintroduce the removed theme |

The Emil design-engineering skill informed consistent defaults, explicit
typography and immediate native disclosures. Existing Archify diagrams retain
their specifications, geometry, nodes, relationships, labels and source links.
Their theme/export policy is a focused site adaptation; historical Archify
delivery receipts are historical evidence, not a fresh gate result for the
adapted files. Current file identities and actual Codex browser observations
are checked separately.

This is a presentation and delivery change. It adds no financial accuracy,
model-execution or physical-phone claim.

## Continuing the same design language

The profile and every reading page now use the same `.site-header` component
styles: the same name treatment, 15px navigation, 44px targets and responsive
left alignment. Reading pages expose Work, Journal and RAG lab even when the
article sidebar is hidden. The RAG destination is the existing profile demo
anchor, so a separately opened article does not replace an already open lab.
Publication metadata moves to the footer instead of competing with navigation.

| Before | After | Why |
| --- | --- | --- |
| Article and Journal routes disappear with the narrow-screen sidebar | Shared header with persistent destinations | Readers keep their bearings between the person, the writing and the project |
| Closed disclosures are blue throughout the lab and articles | Navy when closed, cobalt when open or hovered | Advanced content stays discoverable without competing with the primary action |
| Article disclosures have no explicit keyboard focus treatment | The same 3px cobalt outline and 4px offset across profile, reading and lab | Keyboard interaction has a recognizable, visible response |
| Reading code and lab code use slightly different gray surfaces and font order | Shared `#eef2f8` surface and Cascadia Code / Consolas fallback order | Technical detail belongs to the same family as the rest of the site |

Native disclosures remain immediate. Prose stays 19px desktop / 18px narrow;
the denser lab stays 17px. Reading columns and fluid workspaces keep their
different purposes. The existing eight Archify diagrams retain their light
theme and geometry; no diagram content is regenerated for this increment.

The review applies the installed Emil Design Engineering skill and the live
[Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md),
in particular stable navigation, semantic skip links, visible focus and reduced
visual competition. Verification receipts remain in local history separately
from this design contract.

## Reading space at intermediate widths

The article outline now moves into the existing native "On this page"
disclosure at 1100px. The centered reading area has a 780px maximum text
measure; the desktop sidebar remains available above that breakpoint. Wide
architecture figures still span the complete main grid. The shared header can
wrap naturally, and only switches to a vertical layout below 700px.

| Before | After | Why |
| --- | --- | --- |
| At about 900px, a 230px outline and wide gap compete with the article | A centered reading column with an expandable outline | The explanation gets the space it needs without losing section navigation |
| Every header becomes vertical below 960px | A compact row when it fits, natural wrapping, vertical layout below 700px | Navigation keeps the same rhythm between profile and reading pages |
| Editorial figure controls use a separate cream palette | White controls with the same cool paper, navy type and cobalt actions as the other presets | Optional presentation styles stay within the shared site theme |

These changes follow the actual Codex in-app browser review of the public
article and embedded lab, plus an independent source review. The earlier
screenshots are observations of the prior version; updated rendering and
publication checks are recorded separately.

## Figure interfaces use the same typography

All eight Archify viewer interfaces now load the site's pinned, same-origin
Manrope font. Titles, toolbar controls, explanatory card headings and preset
badges keep that family, including the Editorial preset. Technical labels
inside the SVG retain their portable JetBrains Mono. The diagram's nodes,
relationships, source references and literal SVG bodies are unchanged.

| Before | After | Why |
| --- | --- | --- |
| Figure titles and controls use a separate system UI font | Shared Manrope interface typography | Entering a figure preserves the site's visual identity |
| Editorial can replace titles and card headings with Georgia | Preset headings retain the shared UI family | Optional diagram styles preserve the surrounding design language |
| Raster export can paint before the interface font loads | PNG, JPEG, WebP, clipboard, Share Card and motion drawing wait for title and subtitle font availability | Exported titles use the same typography; a failed font request gives a fixed retry message |
| The static evidence SVG names Manrope but depends on a viewer's installed fonts | The image embeds the complete pinned Manrope TTF and its unmodified OFL notice | An isolated SVG image and a downloaded copy keep the shared family without an external font request |

The font and unmodified OFL notice are already part of the verified site asset
inventory. SVG export keeps its embedded diagram font and shared light palette;
it does not gain a network font dependency. This focused adaptation preserves
the earlier Archify receipts as historical evidence. Current tests, actual
Codex in-app browser observations and downloaded-image inspection are recorded
separately; no new stock Archify browser gate is claimed.

The static `04-evidence-to-calculation.svg` now carries the same 164,700-byte
Manrope font in a data URI and the complete license in readable SVG metadata.
Its original labels, geometry and light colors are unchanged. Focused checks
decode and hash the actual embedded bytes and reject external image/font
dependencies; this increment does not add a browser rendering claim.

## Figure keyboard interactions stay immediate

The site's keyboard interaction rule now also covers all eight figure viewers.
A small capture listener distinguishes `keydown` from `pointerdown` before the
existing menu handlers run. Their Preset and Export menus disable the opening
animation for keyboard input. Pointer opening retains the existing 160ms
transition even after keyboard use, and the reduced-motion preference
continues to remove the opening animation for either input method. Menu focus,
keyboard navigation, the shared light palette and export font gates retain their
existing behavior.

| Before | After | Why |
| --- | --- | --- |
| Keyboard and pointer opening both used the figure menu's translate/scale animation | A small identical site input policy keeps keyboard-opened menus immediate | Figure controls follow the same keyboard response as the profile and lab |

This is a site interaction-policy adaptation of the current viewer HTML. The
diagram specifications, literal SVG bodies, source references and historical
Archify delivery/audit sidecars are unchanged. Those sidecars remain historical
evidence; they do not validate the current adapted HTML. Current constrained
source checks, existing figure contracts and actual Codex in-app browser input
observations are separate evidence. No new stock Archify browser gate or model
execution is claimed.
