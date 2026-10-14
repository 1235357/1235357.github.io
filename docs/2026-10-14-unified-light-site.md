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
