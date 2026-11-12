# Operation lifecycle lane labels

The two longer vertical lane labels in `browser-operation.archify.html`
overlapped between the rejection and closed-operation bands. Each now uses
two explicit SVG text columns at the existing band center, keeping the 16px
type size and the complete original wording. The full accessible label is
also retained. Nodes, transitions, band centers and source references do not
change.

This is a bounded layout adaptation of the accepted HTML artifact.
`build.py` copies that artifact into the public site without regenerating it.
The editable JSON still contains the same semantic lane labels; it has no
new renderer-specific wrapping fields. Re-rendering with a stock renderer
is not asserted to reproduce this adaptation. Historical delivery receipts
retain their original identities and are not rewritten as current evidence.

The download path clones the same authored SVG, so the two-column labels
travel with SVG downloads rather than depending on page-only CSS. The
shared light export policy and portable embedded font remain unchanged.

`test_operation_figure.py` checks complete wording against the editable
specification, explicit wrapping without smaller type, and the existing
light SVG-clone export path. These source contracts do not replace browser
geometry, visual inspection or a real downloaded-file check.

The local public build was inspected in Chromium at 500px and 1180px CSS
viewport widths using the default Classic style. The two affected labels
did not overlap. At 500px, their former 20.93px overlap became a 42.19px gap.
An actual SVG download was opened as a separate SVG document: its full
wording, two-column labels, embedded font and light theme were retained,
with a 76.79px gap at the SVG's natural size. The figure's existing narrow
horizontal scrolling remains; this change does not claim to resolve every
small-screen readability issue.

The candidate passed 3,155 Node tests and the 204-test Python run, with the
Windows-only junction check skipped on Linux. The focused regression fails
on the original unwrapped artifact. This does not establish Windows CI,
other browsers, every visual preset, raster/motion output or PDF acceptance.
