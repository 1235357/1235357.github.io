# Owned-generation figure: rendering policy and verification

This permanent note records why the locally staged figure uses a task-local Archify 3.0.1 adaptation. It does not package the installed skill or its vendor assets. The resulting HTML is a standalone viewer; rebuilding it with the unmodified stock renderer does not reproduce the typography and default reading policy described here.

## Final artifact identity

| Artifact or receipt | Current identity |
|---|---|
| `figures/owned-generation.archify.json` | SHA-256 `d652b53bae541e58efb6c27de4fb409f7bd182c7cf8df6b14c41b89fa2073be0`; 7,971 bytes |
| `figures/owned-generation.archify.html` | SHA-256 `dfe2307b29d40a6685479f207b96e2f7f4610c56ea79000a41e0c31bc13157a0`; 776,436 bytes |
| `figures/owned-generation.archify.delivery.json` | Receipt `6433d247-5065-46d2-946d-68192b868d39`; status `current` |
| Source-code audit | Seven source blobs at commit `10f962e4097f925eec87d4f783f4fb19ad0e922b` |
| Deterministic checks | 9/9 showcase checks, zero composition errors, zero warnings; strict artifact provenance `current` |

The strict check was run with the unmodified installed Archify CLI, independently of the adapted renderer. The staged repository has no origin remote; the figure is a code-sourced contract illustration with a separate local Git-blob audit, not an Archify repository-provenance acceptance or evidence of financial correctness.

## Why the task-local renderer differs

Stock sequence typography uses 11px showcase message labels, 9px phase captions and 7px role subtitles. An actual Codex in-app-browser review found these too small. The local adaptation uses 16px message and primary role labels and 14px phase captions, with corresponding measured label-box sizes. Short role details moved into explanation cards. Phase captions use the theme-aware `t-muted` class, which preserves dark/light contrast without a fixed color override. The full 16 message IDs, endpoints and variants remain unchanged; concise labels retain their complete meaning in the cards and source notes.

A second actual review at 1280×720 found a responsive bug: the tall 920×1488 SVG was being drawn at roughly 345×558, reducing 16px messages to about 6px. The stock reader's bottom-notes path clears the comfortable primary width, computes a width from the available viewport height, then shrinks overflowing content down to its hard text floor. This is unsuitable for this long sequence.

Only the adapted auto-height sequence is tagged `data-reader-width-scroll="true"`. In default desktop reading, its scoped reader branch keeps the available width, capped at 1440px, and permits ordinary vertical page scrolling. It bypasses height fitting and overflow-settling, keeps notes below the figure and hides the unavailable note-rail placement control. The default SVG/container has auto height. Embed, explicit Presentation Stage and print are excluded from this branch; the existing camera, zoom and export code is retained. `readerLayout.active()` recognizes the added policy.

The stock JSON schemas and strict checker are unchanged. The adaptation also keeps timeline height when an auto-height sequence hides its legend; hiding the legend must not collapse a late timeline to the stock 760px fallback.

## Actual browser observations and their scope

Root's final Codex IAB review of the current HTML reported the following:

| Context | Observed geometry and result |
|---|---|
| Full viewer, 1280×720 | SVG 1171×1893.96 for viewBox 920×1488; document scroll height 3275; no horizontal overflow; readable roles/messages/phase captions |
| Article iframe | SVG 722×1167.75; readable dark figure with vertical scrolling |

The full-viewer screenshot is `docs/acceptance-2026-10-11/owned-generation-readable-final.jpg`. These are root's actual IAB observations, not a browser run performed by the figure author. They validate those inspected contexts, not arbitrary devices, model execution, the financial output gate, public deployment or reader mastery.

Archify `finalize` and `browser-check` launch external Chrome/Chromium, so neither was run under the user's IAB-only requirement. **Automated Archify browser evidence remains `skipped`.** Manual IAB review does not overwrite that status.

## Local policy, renderer and audit paths

The paths below are local reproduction/audit references, not files added to the public site package:

- Request folder: `D:/Desktop/GitHub-Staging/zhentong-ye-site/.archify/sequence-owned-generation-20261011-090101/`
- Policy and exact source replacement pairs: `.archify/sequence-owned-generation-20261011-090101/readable-renderer-policy.json`
- Adapted sequence renderer: `.archify/sequence-owned-generation-20261011-090101/readable-archify/renderers/sequence/render-sequence.mjs`; byte SHA-256 `b8efa91452217d07f32e921b79fc33c5b60a15d9cb8cbc5ac747a1c4ca18fefa`
- Adapted viewer template: `.archify/sequence-owned-generation-20261011-090101/readable-archify/assets/template.html`; byte SHA-256 `3ed398e4c38da8e212c6b04f80f226c808f82c956f6be5258a4d28dc074f1d9b`
- Local CLI: `.archify/sequence-owned-generation-20261011-090101/readable-archify/bin/archify.mjs`
- Relationship-preservation audit: `.archify/sequence-owned-generation-20261011-090101/readable-relationship-preservation.json`
- Committed source evidence: `.archify/sequence-owned-generation-20261011-090101/repository-evidence.json`
- Final strict-check receipt: `.archify/sequence-owned-generation-20261011-090101/width-scroll-strict-check.json`
- Controlled reader regression: `.archify/sequence-owned-generation-20261011-090101/width-scroll-reader-check.mjs`
- Current handoff: `.archify/sequence-owned-generation-20261011-090101/site-handoff.json`

The policy records byte hashes separately from normalized-text hashes because Windows newline translation can make them differ. MIT license and notices were retained in the task-local copy. The installed global skill was not edited or updated. The failed split candidates and their pending journal are preserved under `.archify/sequence-owned-generation-20261011-090101/split-candidates-rejected/`, outside `figures/`.

## Reproduce locally

Run from `D:/Desktop/GitHub-Staging/zhentong-ye-site`. These commands use the existing task-local copy; no package installation, external browser or server is needed:

```powershell
& 'C:\Users\zye12\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.archify/sequence-owned-generation-20261011-090101/readable-archify/bin/archify.mjs' deliver sequence 'figures/owned-generation.archify.json' 'figures/owned-generation.archify.html' --quality showcase --json
& 'C:\Users\zye12\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\zye12\.codex\skills\archify\bin\archify.mjs' check 'figures/owned-generation.archify.html' --require-provenance --json
& 'C:\Users\zye12\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.archify/sequence-owned-generation-20261011-090101/width-scroll-reader-check.mjs'
```

The reader regression executes the real reader-layout IIFE against a declared DOM double: 1280×720 uses reader width 1232, 1440×900 uses 1392, and 1920×1080 uses 1440. It checks exclusion of embed/present/print and natural-width behavior at 908px. This is controlled behavior evidence, not pixels, browser geometry or export acceptance. After a renderer/template/spec change, redeliver, repeat the unmodified strict check, rebuild the site, and record a fresh IAB observation bound to the new artifact hash.
