# Complete generation details and a compact embedded workbench

Long model records should remain inspectable without placing the entire record
in the page at once. The production generation view now uses the shared complete
text viewer for its original input, prompt, token IDs, execution receipt and
citation mappings. Each displayed page contains at most 24,576 UTF-16 units or
160 hard lines. Unicode pairs and CRLF separators stay intact; the pages can be
reassembled to the original string.

JSON controls export the complete `JSON.stringify(value, null, 2)` UTF-8 bytes.
The decoded native output and rendered prompt use clearly labeled text controls
and `.txt` downloads containing the exact original strings. Neither format adds
a newline or limits the export to the currently displayed page. A download
starts only after an explicit click.

Each render owns its own disclosures and citation buttons, including when the
same immutable receipt is rendered again. Closing a disclosure, clearing its
source or replacing the render disposes the previous viewer, empties captured
display nodes and revokes its object URL. Synchronous owner/dependency callbacks
cannot start nested downloads or remove a later valid render.

## Actual browser evidence

The local Codex in-app browser selected the previously captured native RAW
receipt and its original eight-field input through two real file pickers. The
diagnostic explicitly displayed **Archived native receipt replay · no model
executed**. Current production consistency guards and shape/citation inspection
accepted the archive; this was a rendering replay, not a new native run.

All 18 actual downloads, totaling 796,045 bytes, independently matched their
complete expected UTF-8 bytes: 16 JSON files and two text files. The independent
audit rebuilt the complete context and checked 346 source bindings across five
chunks, including 199 bindings across the three selected units and 53 in cited
E4. Original JSON archives include a final newline; the new JSON downloads
correctly omit that extra newline while retaining the complete serialized value.

A second browser observation waited for the native disclosure `toggle` to
finish before measuring its DOM. All 18 details respected the page limits and
removed their displayed text on close. The original input navigated to page
77 of 77; the RAW receipt had 93 text pages. Rendering the same receipt again
removed all old expanded views. Clear emptied both file inputs and disabled
repeat rendering. The [sanitized acceptance metadata](acceptance-2026-10-12/browser-generation-bounded-view.json)
records download identities and the scope of these observations.

Local verification passed 2,977 browser contract tests and 156 Python build and
delivery tests. After the separate embedded presentation change, 88 relevant
build/delivery tests and the script syntax check passed. Default and public
module graphs both include the shared viewer; missing required viewer bytes
refuse a new build while retaining the previous output.

## Embedded presentation

The profile already introduces the project above the live frame. Its same-origin
frame now keeps the project header, complete stage rail and all working controls
without a second large introduction. The semantic `h1` remains available to
assistive technology. Opening the standalone lab preserves its full overview.
Both presentations retain Manrope, light `#f7f8fa` surfaces, `#172033` text and
the same cobalt controls. The detailed journal retains its separate dark theme.

Actual local public-build observation placed the file control at 461.4 px
within a 618 px iframe viewport, after parser preparation enabled it. This is a
desktop browser observation; physical-phone interaction remains unverified.

## Boundaries retained

This replay invoked no model, tokenizer or PDF parser. Archive consistency,
source bindings and exact exports do not establish financial correctness,
claim support, native execution authentication, latency distributions or
production readiness. The original historical native receipt and its known
evaluation limits are preserved.

Other notebook item, chunk and context disclosures still need their own complete
record and ownership review. This increment does not claim that the entire
notebook or the wider financial/application goal is complete.
