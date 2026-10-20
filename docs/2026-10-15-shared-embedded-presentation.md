# One embedded workspace presentation

Actual IAB review of the published ranking chapter exposed a presentation gap:
the profile parent added `embedded-lab` after the iframe loaded, while the same
workspace in chapters 01, 03 and 07 retained the full standalone introduction.
Those articles already introduce the task in their figure heading. Repeating the
hero inside the frame pushed the working controls below another introduction.

The installed Emil Design Engineering skill informs the repair: one responsibility
for a consistent presentation, immediate access to the requested task, and no
decorative transition on this frequently used reading path.

| Before | After | Why |
| --- | --- | --- |
| The profile parent changes its child's root class after load | The lab's own small same-origin script chooses framed presentation before its stylesheet | Profile and article embeds share one rule, without a second parent-owned adjustment |
| Blog frames repeat the standalone hero | Every framed lab uses the existing compact style; its semantic h1 remains available | The outer article supplies the context and the frame supplies the controls |
| Standalone and framed modes depend on where a parent script happens to run | The lab compares its own window with top; no parent DOM or data is read | The same entry can be opened directly or embedded without changing the runtime profile |
| The repository README starts with several long release receipts | Current destinations and task-specific reading paths precede a named history disclosure | First-time visitors can choose an action before inspecting dated measurements |

The existing CSP remains unchanged. The presentation script is a named local
asset, included in the build and release inventory, with a content-versioned
reference. No inline-script permission is introduced. Frame URLs, model and
parser settings, action requirements, lifecycle ownership and fullscreen behavior
retain their existing contracts. This change starts no PDF or model work.

Independent source review also found that the private loopback diagnostic server
rejected every resource query except one authored figure alias. The new versioned
script, and the existing versioned stylesheet, therefore needed a corresponding
route. The server now accepts only these two named UI files with their exact
current-build content hash. Unknown files, stale hashes, duplicate/extra query
keys, encoded aliases and fragments remain refused. The script is also required
by the diagnostic's startup dependency check. GET/HEAD tests exercise the real
handler in memory without starting a model or binding a server.

The local final public build passed 181 Python checks and the JavaScript change
passed the complete 3,126-check suite. Actual IAB inspection confirmed compact
mode in the profile and all three article lab frames, with the same light surface,
Manrope and 17px body type. In the ranking article at a 1,070px frame viewport,
the file input moved from 682.59px to 377.49px from the frame top; the redundant
265.09px introduction no longer occupies the frame. A direct standalone reload
retains its visible introduction and public entry. These are local browser
observations; public deployment and physical-device acceptance remain separate.

Focused and complete checks, actual browser review and public deployment are
separate gates. This note describes the repair's intent; the release receipt and
IAB observations determine which of those checks have actually passed. A 390px
viewport check is not a physical-phone or user-aesthetic acceptance result.

## One project title before the controls

The later screenshot review found another concrete duplication: the profile
section title, a single-project toolbar label, and the embedded lab's brand,
navigation and idle status all preceded the PDF controls. The earlier compact
hero rule did not remove that second page header. Shared light colors and
readable type did not by themselves make this hierarchy clear.

| Before | After | Why |
| --- | --- | --- |
| Three stacked project identities and a separate toolbar row | One project heading with a short introduction and adjacent Expand / Open actions | A single demo does not need a selector naming itself |
| Embedded brand, full-page navigation and idle header status | A compact RAG stages / Notebook row; the contextual session status stays in the workspace | The host supplies identity while the frame supplies the task |
| Large stacked margins and an unnecessary section minimum height | Explicit content alignment and compact gaps, with natural tool wrapping on narrow screens | File selection appears sooner without shrinking readable controls |
| An outer footer repeats download and draft instructions | Existing instructions remain beside embedding, generation and the lab footer | The information appears where it informs the reader's action |

The same embedded rule applies to the profile and the existing lab frames in
articles 01, 03 and 07. Standalone lab identity, navigation and introduction stay
visible. Required status nodes remain in the document for the existing runtime;
only the redundant embedded header is hidden. Notebook uses the same native
fragment navigation and the existing fullscreen code retains the same iframe.
No PDF, model, source-selection, worker or artifact-acceptance behavior changes.

Current local IAB review at a 908px viewport measured the file selector about
365px below the demo section top, compared with the observed earlier 659px.
At 390px, RAG stages and Notebook fit in one 44px row and neither parent nor child
has horizontal overflow. Actual Notebook navigation opens and focuses its
summary. An authored textarea value survived Expand and explicit Exit, checking
document continuity without selecting a PDF or starting computation. The
standalone page retains its header and introduction. Screenshots and release
checks are saved separately; local rendering is not public deployment evidence.

A bounded source review also checked every article heading and the eleven
article iframe wrappers. The desktop/mobile outlines are alternate responsive
navigation, and project-card versus later lab titles identify separate contexts.
Full Archify viewers retain useful inspection controls; they are not switched
en masse to diagram-only mode merely to remove a title. Existing figures and
their source/export bodies are unchanged by this focused correction.

## Remove one same-meaning figure title

The follow-up review paired the eight article Archify wrappers with their actual
viewer titles. In article 08, the outer heading "Prepare the application before
opening its listener" repeated the inner "Before the corpus API listens" title.
Actual public IAB inspection showed the two-line outer title directly above the
viewer title, occupying space without adding a distinct explanation.

| Before | After | Why |
| --- | --- | --- |
| Two adjacent titles express the same startup boundary | The viewer names the diagram once; the outer paragraph explains the accepted and optional paths | Readers reach the diagram sooner while retaining the explanation |

Only that authored outer h3 is removed. The figure's accessible label, source
status, explanatory paragraph, caption, full-size link, editable JSON and viewer
controls remain. The other seven wrappers distinguish interpretation from diagram
identity and are retained. No diagram specification, generated viewer or export
is regenerated for this wording correction.
