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

## Checks remain distinct

Content review checks that current claims match the named implementation and
that historical negative findings remain intact. The static build checks local
references and generated anchors. Browser review checks the rendered reading
path, disclosures, links and layout. A learner's new prediction and actual
feedback would be separate evidence. No such learner acceptance, independent
financial gold or held-out quality score follows from publishing these notes.
