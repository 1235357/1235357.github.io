# A fluid document workspace with a retained-session fullscreen view

The profile's embedded RAG workspace now fills the available application width. The previous 2,080-pixel outer cap and 1,800-pixel inner cap are removed. Fixed gutters and a bounded controls column give the document, answer and notebook records the remaining space. Profile prose retains its reading measure; widening an application does not require stretching every sentence.

| Before | After | Why |
| --- | --- | --- |
| Outer and inner maximum widths stopped growing on a large display | Fluid workspace with 24-pixel desktop gutters | Let a large display show more document and evidence content |
| Controls could occupy 520 pixels | Controls range from 360 to 460 pixels on a wide desktop | Give the answer and notebook the additional width |
| Large bordered controls and source cards competed with the answer | Quiet controls and source sections; a white answer surface | Make the document task and its result easier to distinguish |
| Six workflow steps occupied about 122 pixels vertically on a wide display | Compact number/title row with a separate state row, about 81 pixels | Recover useful height without reducing the label fonts |
| A single project appeared as a selected tab button | Plain product label plus workspace actions | Avoid suggesting a choice when only one project exists |
| A larger view required opening a separate page | Expand/exit the existing workspace with the Fullscreen API | Preserve the loaded document, chunks and current session |

The fullscreen action never changes the iframe URL. A `fullscreenchange` listener updates the action and `aria-expanded` state, including native exit. Unsupported browsers retain the full-page link; a rejected fullscreen request offers the same link and allows a later retry. Concurrent requests are ignored until the current request settles.

## Design research applied

The implementation follows [Emil Kowalski's Agents with Taste](https://emilkowal.ski/ui/agents-with-taste) and the locally installed official design-engineering skill: deliberate typography, subtle control feedback and readable information density. [Apple's layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout) informs grouping, hierarchy and adaptation to the available space. [IBM Carbon's 2x Grid](https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/overview) informs the fluid application area with fixed gutters and aligned columns. These primary pages were read through the Codex in-app browser.

Ordinary answer/status/context prose remains bounded at 72ch. Record pages, tables and source mappings can use the larger work area. The profile and standalone/embedded lab share light surfaces, blue accents and Manrope; the detailed journal retains its dark reading theme.

## Actual local browser verification

Measurements below are CSS pixels from the running local site in the Codex in-app browser. A vertical scrollbar accounts for part of the difference between the requested viewport and available content width.

| Requested viewport | Embedded frame | Answer/notebook column | Workflow rail height |
| --- | ---: | ---: | ---: |
| 1,280 | 1,215 | 768 | 104 |
| 1,600 | 1,535 | 1,018.20 | 80.5 |
| 1,920 | 1,855 | 1,308 | 80.5 |
| 2,560 | 2,495 | 1,948 | 80.5 |

All eight checked widths (320, 390, 780, 1,100, 1,280, 1,600, 1,920 and 2,560) had equal document client/scroll widths in both profile and embedded lab. The lab body remained 17-pixel Manrope and visible buttons were at least 46 pixels high. Narrow displays retain stacked sections and wrapping workflow steps; the wide-display rail height is not a mobile measurement.

A native file chooser loaded the original 74,085-byte, two-page NVIDIA PDF with SHA-256 `8e668f014d42e1ece74a67e1431dea6542b48c60ed8bcd7a0e187e6b954e7428`. The current PDF.js worker parsed it and the app built five chunks. Fullscreen entry and exit preserved the complete accepted parser receipt and five-chunk state exactly. The document was then cleared. This check did not invoke an encoder or generator.

Three focused fullscreen tests cover entry/exit without iframe writes, native exit, unsupported browsers, rejection and retry. The complete final local suite passed 3,048 Node tests and 156 Python tests. Fullscreen and layout evidence is separate from new model execution, financial correctness, physical-phone acceptance and the user's final aesthetic judgment.

Sanitized [local browser acceptance metadata](acceptance-2026-10-12/browser-fluid-workspace.json) records the measured widths and retained-session check. Full parser receipts and screenshots remain outside Pages.

The profile's expected graduation date was also corrected to June 2028 following the user's current personal plan. This is an expected date, not school or work-authorization approval.
