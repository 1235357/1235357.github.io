# Profile information hierarchy — October 13, 2026

> Historical design record: the October 14 requirement supersedes the dark-journal and optional dark-figure policies below. The current site uses one light theme throughout; see [the current theme contract](2026-10-14-unified-light-site.md).

The profile should help a first-time visitor identify the person, choose a project and reach its evidence without reading every technical detail first. The latest request also requires the personal profile and RAG workspace to share their light theme.

The reference profile, [Yingda Yu's personal site](https://yingda-yu.github.io/Dean-Yu-050325.github.io/), was inspected in Codex's built-in browser by the coordinating agent. Its portrait, one identity statement, two primary actions and selected work informed the order of information here. This applies a presentation pattern; the reference author's biography and credentials are not used as source facts for this profile.

Emil Kowalski's installed `emil-design-eng` skill and the installed `frontend-design` skill informed the implementation: readable typography, restrained hierarchy, immediate native disclosures, visible focus and shared light tokens. The profile continues to use the self-hosted Manrope family already used by the lab.

| Before | After | Why |
| --- | --- | --- |
| A long hero introduction plus a separate large RAG pitch | Identity, one short purpose line, availability and two actions | Visitors can identify the person and choose an entry point first. |
| Six full project entries in the main reading flow | Three selected cards: RAG, OSEF and LLaVA; three more projects in a native disclosure | Establish priorities while keeping the complete CV project record accessible. |
| Role, dates, technology chips and detailed contribution controls competing with each project introduction | A short summary and visible project phase; contribution records contain the full role, dates, description, technology stack and detailed evidence | Preserve truthful scope without making every reader consume the full record. |
| RAG pitches repeated in a lab feature, project entry, journal feature and demo introduction | One featured RAG card with Try the RAG lab and Read the journal; a compact workspace heading | Each location serves a different action, reducing repeated explanation. |
| A prominent standalone toolkit and long academic descriptions | Compact education, visible expected June 2028 timeline, optional coursework and toolkit | Background remains available without dominating selected work. |
| A full-width embedded workbench with session-preserving expansion | The same single iframe and expansion controls | Information hierarchy changes retain the existing PDF, workers and accepted records in their current session. |

## Preserved facts and interactions

All six project IDs remain: `nvidia-rag`, `osef`, `llava-gi`, `artisk`, `ecommerce-agents` and `lead-qualification`. Original descriptions and every contribution paragraph, role, date, phase and technology remain in the authored data and generated page. The two projects in system/prototype design retain those phases outside their contribution records, so expanding the project list cannot suggest that a designed workflow is deployed.

Northwestern and Wenzhou-Kean education, the expected June 2028 date, coursework and skills remain available. The LinkedIn-hosted portrait keeps its original URL and reciprocal LinkedIn profile link. The page has one lazy iframe, with unchanged `project-demo`, expansion and full-page controls. The detailed journal keeps its existing dark reading theme; profile-scoped styles do not alter its layout.

## Validation scope

Three focused Python checks inspect the rendered hierarchy independently with `HTMLParser`: exactly three initially visible projects, three additional projects inside a closed native disclosure, the complete per-project factual record, visible phase placement outside contribution disclosures, the two hero actions, original LinkedIn portrait, expected graduation timeline and one unchanged workspace iframe.

The existing three JavaScript workspace tests pass for expansion, browser Escape, unsupported/rejected fullscreen and zero iframe source changes during expansion. These checks validate structure and session-control behavior. Actual rendered desktop/mobile review and public release verification belong to the coordinating agent's acceptance pass; this note does not claim those checks have already passed.

A separate local `HTMLParser` audit compares the default main-page reading flow with Git baseline `e80154bffc28c4472fb957b5ba526a445816fa29`. It counts 734 words before and 268 after, excluding the contents of closed disclosures while including their accessible summaries. This is a roughly 63.5% reduction in the default authored reading flow, not a viewport or user-study measurement. The same audit independently compares the authored JSON against the baseline and confirms preservation of all six original project records, original link destinations, education, skills, portrait, availability and workspace data.
