# A coherent reading path through the RAG journal

The journal serves two related readers: a visitor deciding what this project
does, and a learner trying to explain or change one part of it. The profile,
lab, journal, articles and figures share the light design contract in
`2026-10-14-unified-light-site.md`. This document records the continuing content
reconstruction; it does not declare all eight chapters reconstructed or a
reader's understanding validated.

The applied learning guidance comes from the installed `read-xuexiguan` skill.
The relevant current text was read for this task rather than inferred from the
skill's name. Chapter 30, PDF pages 286–291, explains connecting concrete
examples to the concepts they illustrate and aligning their presentation.
Chapter 31, PDF pages 292–297, distinguishes reading an example from making a
prediction before seeing feedback. These ideas guide the editorial choices
below. They are not a scientific evaluation of this site's learning outcomes.
No book text or private course material is republished here.

## The reader's decision comes first

The journal index now pairs each chapter title with the concrete question it
helps investigate. A beginner can follow lifecycle → source preservation →
ranking → generation. A developer can go directly to the browser's computation
record or installed service startup. The paths use ordinary links and the same
typography as the rest of the site.

Each reconstructed chapter needs a complete, inspectable explanation:

1. State the decision the reader will learn to make and its input conditions.
2. Give one concrete case, with its source or an explicit synthetic label.
3. Explain the mechanism while mapping each concept to that case.
4. Contrast a nearby case that changes the outcome for a stated reason.
5. Offer a new practice input before revealing feedback; reading the feedback
   is not evidence that the reader performed the task.
6. Keep dated experiments and failures reachable with their original scope,
   while describing current software behavior from current source.

The order is a practical editorial choice, not a mandatory ritual. Long raw
receipts belong near the question they answer or behind a clearly named
disclosure. Essential behavior, current limitations and navigation stay visible.
Historic links and section anchors must continue to resolve.

## Reconstruction scope

| Chapter | Reader's concrete decision | Evidence or contrast to retain |
| --- | --- | --- |
| 01 · Lifecycles | Decide which artifacts can be reused after a question or source changes | Passage versus query work, source replacement, exact question identity, dated native traces |
| 02 · Contracts | Decide which owner may accept, refuse or cancel a result | Request/worker identity, late replies, valid evidence and downstream generation failures |
| 03 · Ranking | Recompute a ranking and distinguish similarity from support | Normalized dot products, candidate scope, Top K and threshold, wrong-period evidence |
| 04 · Preservation | Decide whether a quoted value retains its row, column, unit and source locator | Chunk windows, physical versus printed page labels, geometry and extraction omissions |
| 05 · Generation | Trace complete evidence into the prompt and inspect what a citation validates | Exact template/token budget, format refusal, explicit public generator and unresolved factual support |
| 06 · Evaluation | Choose a denominator and distinguish unknown judgments from errors | Source-qualified relevance, exposed development questions, frozen run and separate review |
| 07 · Execution | Follow an actual browser action through artifact acceptance, failure and cleanup | Reader-device workflow, complete notebook records, preserved timeout and unverified draft |
| 08 · Startup | Predict whether configuration starts a listener and what a request can select | Optional versus invalid configuration, immutable source snapshot, typed unit contract and failed ranking |

## Reconstructing the execution chapter

Chapter 07 now follows one retained public browser case from its two-page source
through five chunks, passage/query vectors, E4/E1/E2 ranking, complete context
and an explicitly unverified Qwen draft. Each transformation is paired with a
specific question the reader can investigate in the notebook. This mapping uses
the existing public archive and its consistency audit; the editorial revision
does not execute a model or turn the exposed case into independent quality gold.

The adjacent cases explain different dependencies: cancelling generation can
retain the accepted query/context for an explicit retry, whereas editing the
question or Top K invalidates dependent query and generation artifacts. The
practice combines cancellation, retry and a later question edit; feedback stays
closed until requested. The current session implementation, UI input handlers
and controlled cancellation/invalidation tests supply its contract-based answer.
No learner response or new native GPU cancellation result is claimed.

Long prompt-version, transport and replay histories remain reachable through
named native disclosures. All fourteen original H2 targets and all four original
iframe tags are retained outside those closed records. The wrong six-month
answers, format refusals, incomplete archives, public timeouts and distinction
between source candidates and financial acceptance remain visible in the main
explanation. The existing shared light styling applies to both collapsed and
expanded content; no new layout, runtime or diagram behavior is introduced.

## Foundations: reusable documents and owned outcomes

Chapter 01 now follows a change from one annual-revenue question to another.
Its table aligns document preparation, service initialization and per-question
work with their inputs and invalidation conditions. A declared synthetic
two-dimensional row swap explains why a valid vector shape cannot establish
the correct text/vector association. The FY2023 follow-up practice asks for a
prediction before feedback; a recording encoder checks that compatible cached
passage vectors require no construction-time encoding and two questions each
produce one instructed query-encoding call. These are controlled bookkeeping
checks, not model or financial performance observations.

Chapter 02 starts with a concrete evidence-only HTTP response: 200,
`can_answer=true`, and an empty answer. It follows a declared synthetic
wrong-year candidate across retrieval, the evidence gate and response mapping,
then contrasts an empty evidence result, a query exception and a generation
timeout. Its practice changes the failure location: a valid request reaches a
retriever that raises `ValueError`. The contract-based feedback distinguishes
that operational 503 response from a request-schema 422 error.

The local controlled API check also observed malformed JSON without a bearer
header returning 422 with no query call. The ordinary query route's explanatory
trace therefore does not promise authentication before JSON-body consumption.
The separately bounded statement routes retain their own body-reading contract.
No API production code, authentication policy, model adapter or diagram was
changed by this editorial correction.

Dated installation, controller, representation and replay records remain
available through named disclosures. Existing Markdown inside the first
chapter's old disclosures is converted to actual HTML so tables, code and links
render when opened. Original H2/H3 targets and iframe tags are retained outside
closed records. Current limitations and historical failures stay visible;
neither published exercises nor the agent's checks establish learner mastery.

The narrow-screen browser check also found that a wrapped Journal title had
two separate inline hit regions: its bounding-box center landed on the list
item between lines. The title link now uses an inline block with the same
font and width constraint, giving the wrapped text one continuous target.
This repair is checked by native hit testing and actual article navigation.

## Checks remain distinct

Content review checks that current claims match the named implementation and
that historical negative findings remain intact. The static build checks local
references and generated anchors. Browser review checks the rendered reading
path, disclosures, links and layout. A learner's new prediction and actual
feedback would be separate evidence. No such learner acceptance, independent
financial gold or held-out quality score follows from publishing these notes.
