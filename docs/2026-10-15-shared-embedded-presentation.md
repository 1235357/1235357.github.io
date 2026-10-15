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
