# One light theme for the personal profile and RAG workbench

The current design uses cool paper (`#f7f8fa`), navy ink (`#172033`), cobalt actions (`#234ccf`) and self-hosted Manrope across the personal profile, embedded/standalone RAG workbench, journal, every article and every figure. The October 14 requirement explicitly replaces the former dark-journal exception. Historical acceptance records below describe their original versions.

A [later retained-tab observation](acceptance-2026-10-11/public-light-home-embedded-runtime.json) accepted a two-page excerpt and five chunks in the public iframe. Selecting the current demo preserved them. Two explicit encoder attempts timed out; source/chunks remained available. This does not rewrite earlier failures, and the complete embedded query/generation chain remains open.

The personal homepage introduces Zhentong Ye as a Northwestern MSCS student, then makes the latest project available in a complete demo section at the bottom. Cool white surfaces, navy text, cobalt links and Manrope form the shared visual hierarchy. Six CV-selected experiences, education and technology details remain available. The journal keeps a long-form reading layout within the same light design system.

## Complete RAG interface refactor

| Before | After | Why |
| --- | --- | --- |
| Light profile around a dark iframe | Matching paper, text, borders and cobalt actions inside and outside the frame | Preserve one visual identity when a visitor starts the project |
| Large duplicate project introduction | Compact two-column lead, project byline and Workspace/Notebook/Profile navigation | Make the document workspace easier to reach |
| Layered dark form, result and diagnostic styles | One light stylesheet covering preparation, questions, drafts, refusal states, sources, context, tokens, vectors and geometry | Keep expanded technical views consistent with the initial workspace |
| Long implementation explanations in the initial path | Short instructions with native disclosures retaining the complete contracts | Help visitors act while keeping the engineering details available |
| Unversioned lab stylesheet | CSS content version written into the built entry and checked by a delivery test | Select the matching stylesheet after a new deployment |

The refactor preserves all sixty prior HTML IDs and all fifty-one IDs required by the runtime. Inputs, disabled defaults, limits, stage ownership and model download behavior remain intact. Native controls keep at least 44px height and 16px input text; keyboard focus is visible. Pointer press feedback uses only transform with 120ms press and 80ms release. Native disclosures and keyboard actions remain immediate; reduced-motion disables movement. Source content remains selectable.

The current local checks passed 155 Python tests and 2,892 Node contract tests. A real two-page financial excerpt produced five source-linked chunks, 2,426 output UTF-16 units and 687 mapping fragments. Source-cell lookup returned the literal `16,599` candidate with its unadjudicated status. The 390-by-844 desktop viewport had 375px document and scroll widths, including the expanded source record and chunk inspection. The independent source review and CSS color/selector audits are retained under `docs/local-history/rag-light-*`. These are UI and responsive-layout checks; this increment did not rerun encoding, retrieval or generation and does not establish financial correctness or real-phone behavior.

## Installed design skills

The official Codex skill installer downloaded all fifteen skill folders from [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/2d228630ba1446365f614a108cb8252f1feda202) at immutable commit `2d228630ba1446365f614a108cb8252f1feda202`. All twenty-three installed files match that source. The implementation and independent review used `emil-design-eng`, `mobile-native` and `review-animations`, including its standards. The installed skills are development guidance; they are not browser dependencies.

| Before | After | Why |
| --- | --- | --- |
| Dense homepage with little visual hierarchy | Spacious serif headline, contrasting name line, framed portrait and numbered contribution rows | Give the introduction and selected work a clear reading order |
| Project access through a separate link | Full bottom demo section with one native iframe and a manual selector | Let visitors use the project directly and add future choices in `portfolio.json` |
| Closely adjacent portrait caption/link | Wrapping flex caption with explicit gaps | Preserve legible labels at narrow widths |
| Small lab inputs | 16px text inputs and selects in the lab's own stylesheet | Keep focus readable while preserving browser zoom |
| Undifferentiated interaction timing | 120ms transform press, 80ms release and a strong custom ease-out | Give immediate feedback with a faster system response |

Hover effects are limited to hover-capable fine pointers. Keyboard focus remains visible; keyboard press does not scale controls. Reduced-motion preference removes entrance and press movement. Native contribution disclosures and demo selection have no decorative transition. Body content remains selectable. The bottom stage uses stable small-viewport height units.

The portrait uses the exact supplied LinkedIn image URL and links to the user's confirmed public profile. Its third-party URL includes an expiration parameter; later CDN availability is not guaranteed. No portrait copy is bundled. Demo changes are restricted to same-origin HTTP(S) URLs and replace the existing frame. Selecting the already active demo returns without reloading it; leaving the lab retains its existing pagehide cancellation contract.

## Historical light-home verification scope

The local site suite passed 155 tests in 28.940 seconds. The final public build completed with seven chapters, one homepage, a separate journal and sixteen pinned runtime/model bodies. Actual Codex in-app browser observations confirmed a loaded 800px portrait, light color scheme, spaced caption and mounted public preparation/generator/source-cell controls. At a 390px test viewport the page's document width was 375px and the frame width 341px, with no page overflow; all twelve lab inputs/selects read back at 16px. A prior local iframe session parsed a two-page PDF and built five source-linked chunks.

These are desktop-browser and responsive-layout checks. They do not establish physical-phone keyboard behavior, focus zoom, touch feel, frame rate or broad-device WebGPU support. No model generation was repeated for this design increment. Historical native draft receipts retain their own commit, device and financial-quality scope. [Public design acceptance](acceptance-2026-10-11/public-light-home-acceptance.json) binds `b4037fd` and successful workflow38205206414, with the actual 316-file / 919,354,215-byte / sixteen-pin CI inventory and matching served stylesheet. The public embedded lab eventually mounted and parsed a two-page PDF, but its first chunk action timed out; a retry terminal was not captured before the tab handle became missing. The local five-chunk result does not replace that public failure.
