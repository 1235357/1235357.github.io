# Shared light figures

> Historical design record: the October 14 requirement supersedes the dark-journal and optional dark-figure policies below. The current site uses one light theme throughout; see [the current theme contract](2026-10-14-unified-light-site.md).

Every interactive figure now opens in the same light palette as the profile and RAG workspace. Article embeds and full-size links explicitly select `theme=light`. The detailed journal keeps its dark reading surface; its illustrations remain light and readable inside that surface. A reader can still choose a dark figure through the toolbar or an explicit `theme=dark` link.

This applies to all seven Archify figures: `two-lifecycles`, `browser-native`, `browser-operation`, `owned-generation`, `reader-owned-rag`, `table-cell-selection`, and `structured-income-selection`. The standalone evidence SVG and the two editable draw.io/PlantUML pairs also use the shared light colors and dark text. Every node identity, label, relationship direction and source meaning is preserved. The three oldest interactive figures also receive a measured typography and layout revision described below.

| Before | After | Why |
| --- | --- | --- |
| Some plain URLs followed the operating system or an old shared dark preference; two figures forced a dark default | Light before first paint, with a new preference key for each figure | A returning browser receives the intended design without inheriting an unrelated older figure's choice |
| Article links explicitly requested dark figures | Every figure iframe and full-size link requests light | The same illustration has a consistent appearance in the article and its standalone page |
| Light secondary text and ordinary arrows used pale gray | Secondary text and ordinary arrows use `#46536b`; primary text uses `#172033` | The palette's contrast against white is 7.75:1 and 16.27:1 respectively |
| The three older viewers used 8–11px intrinsic relationship and node text, with some 7px tags | Their renderers now use 18px primary labels, 16px subtitles/relationships and 14px tags/legend text, with matching measured boxes | Readability is authored into the diagram and its exports; a color change alone would leave these figures too small |
| Editable sources used the earlier cream, green and serif palette | Cool white surfaces, dark text, cobalt emphasis and system sans-serif text | Exportable sources belong to the same visual family as the workspace |

The implementation uses the installed Archify 3.0.1 skill. Task-local copies preserve the existing readable sequence and architecture renderers. Because some retained HTML included later viewer adjustments absent from the older renderer copies, each template was recovered from its exact archived viewer by replacing only the typed generated SVG, cards, title, subtitle, locale and source-evidence slots. The existing first-paint and toolbar theme behavior was then adapted in that template. Its private `applyTemplate` seam accepts and emits a light root. Delivery regenerates the HTML; no delivered artifact is patched afterward.

Every delivered figure passes the installed stock strict checker with current artifact provenance: nine checks, zero errors and zero warnings. The initial palette revision compared each canonical SVG tree, text and geometry against its archived predecessor. Four current figures retain that exact SVG geometry: `owned-generation`, `reader-owned-rag`, `table-cell-selection` and `structured-income-selection`.

Subsequent actual browser inspection found small default text in the three older figures. A second revision enlarges their source fonts and corresponding measured label plates, node widths and spacing. Browser-native responsibilities fit two columns; the lifecycle's terminal remains its original state and uses the third grid column rather than a fourth, while its obsolete authored return channel is removed so the existing planner can route around the enlarged states. The two-lifecycles figure keeps its left-to-right request path. Every label, graph identity, relationship direction, card and source meaning is compared separately from geometry and remains unchanged. The viewer declares a 16px minimum and 18px primary reading target; the actual projected CSS pixels are assessed in the separate Codex IAB inspection rather than inferred from source font sizes.

That inspection also found a lifecycle route cropped despite passing the artifact checker: the automatic `valid terminal` trunk reached x=1323 in a viewBox only 1313 units wide. A focused correction keeps the same canvas, state geometry and font sizes while declaring that relationship's right-hand corridor at x=1290. A separate deterministic audit now checks the centerline and stroke bounds of all nine relationships against the canvas. The correction passes a fresh delivery and strict 9/9 provenance check; the corresponding actual browser bounds and visual inspection are recorded separately. This measured repair preserves readable scale instead of widening the whole canvas and shrinking every label.

JSON semantics and source references remain unchanged apart from permitted presentation geometry and the table-cell figure's now-correct light-default note. This is a presentation revision of historical illustrations, not a new runtime or financial acceptance claim. Both the original figures and the first light revision are preserved with their earlier receipts in the ignored local history archives.

The actual commands are run per figure, using its task-local package and explicit repository root where its JSON declares committed source evidence:

```text
node <task-local-package>/bin/archify.mjs deliver <type> figures/<stem>.archify.json figures/<stem>.archify.html --quality showcase --json [--repo-root <matching-repository>]
node <installed-skill>/bin/archify.mjs check figures/<stem>.archify.html --require-provenance --json
```

A controlled VM audit executes each generated first-paint script and toolbar code. All 63 cases pass across the seven figures: dark/light operating-system preferences, ignored old shared preferences, valid new figure preferences, URL priority, blocked storage, invalid preferences, toolbar persistence and subsequent operating-system changes. Those cases verify behavior in a controlled environment. They do not replace the separate real Codex in-app browser inspection of pixels, viewports and downloaded exports. Archify's external browser gate is not run under the user's in-app-browser-only requirement.

Canonical SVG Light and SVG Dark export options remain available, and raster export keeps the current viewer theme. The shared palette variables are collected by Archify's existing SVG export code. Actual exported image appearance needs the browser download and visual check recorded separately.
