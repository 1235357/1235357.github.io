---
title: Contracts before services
status: draft
updated: 2026-10-11
tags: [rag, software-design, api]
---

# Contracts before services

An enterprise consumer does not integrate a screenshot. It integrates behavior:
what input is accepted, what the response means, and what happens when a dependency
fails. This chapter examines the current implementation, not a promised production
deployment. Source authority: `src/nvidia_rag/service.py` and `api.py` inspected on
2026-10-04, with an installation/contract audit and pristine API-only dependency
repair on 2026-10-07. The current repair is distinguished from dated historical
receipts below. Neither is a runtime benchmark or financial-answer evaluation.

## The smallest reusable responsibility

`EvidenceService` receives a retriever rather than constructing a model internally.
Its `Retriever` protocol asks for one operation:

```python
def retrieve(self, query: str, *, top_k: int) -> list[ScoredChunk]: ...
```

The application service strips and validates input, requests candidates, applies
the evidence policy and builds context. A consumer can inject another retriever
without moving model loading into the API layer. That is dependency injection;
it is not proof that an alternative retriever has equivalent relevance quality.

The inspection UI has a stricter requirement: `inspect()` looks for a retriever's
dense-inspection method and raises `TypeError` when absent. Implementing the basic
protocol therefore does **not** guarantee notebook-trace compatibility. This is
an integration boundary to document, not hide behind a generic “plug-and-play” claim.

## Follow one HTTP request

```text
POST /v1/query
    → bearer authentication
    → request schema validation
    → injected QueryService.query(question)
    → response mapping: evidence-only OR generated response
    → response schema + request-id/timing headers
```

`create_app()` receives a service and token; it does not load models at import time.
The request schema forbids extra fields, limits question length to 500 characters
and rejects whitespace-only input. The service also validates normalized input;
the HTTP boundary and reusable library boundary serve different callers.

The bearer token must have at least 32 characters. Length is a basic configuration
check, not a demonstration of entropy, secure storage, rotation or authorization
scopes. Token comparison uses `secrets.compare_digest`. TLS, rate limits, tenant
isolation and deployment secret management are separate requirements.

## Read response semantics, not just field names

| Response field | Current meaning | Consumer caution |
| --- | --- | --- |
| `request_id` | Safe caller ID or generated UUID | Correlation, not authorization |
| `evidence_passed` | Evidence gate outcome | Not financial correctness |
| `can_answer` | Branch-specific result flag | Must interpret with `answer` and service mode |
| `answer` | Generated answer, or empty string | Empty does not always mean service failure |
| `citations` | Context/generated-response citations | Format is not factual entailment |
| `evidence` | Ranked chunks, pages, scores and optional attribution | Treat passages as candidate evidence |

Important current ambiguity: for an evidence-only `GroundedContext`, the adapter
sets both booleans from `result.can_answer` while returning an empty `answer`.
Thus `can_answer=true` does not necessarily mean that a generated answer exists.
A consumer must not display “verified answer” from this flag. A future schema
should make mode/status explicit, but this chapter does not claim that change
has already been implemented or silently change the existing contract.

## Failure is part of the interface

Missing or invalid bearer credentials produce HTTP 401. Schema-invalid payloads
are rejected before the service runs. Exceptions during `service.query()` produce
HTTP 503 with an empty answer, empty citations and empty evidence; the handler
does not expose the exception text to the client. Successful execution may still
produce a refusal: a refusal is not identical to dependency unavailability.

The broad exception mapping trades diagnostic precision for a bounded public
error. The logger records request ID rather than the raw question or exception;
this limits exposure but also limits debugging detail. Errors later in response
mapping are outside that specific `try` block, so it is not a universal error shield.

`/healthz` reports process-level availability without authentication. `/readyz`
requires bearer authentication but returns a constant readiness value; it does
not actively probe the retriever, model or index. Do not use it as proof of
dependency health without stronger readiness behavior.

## Startup is a sequence of contracts too

The original `run_api.py` checked the API token after reading corpus metadata,
constructing the embedding model and loading vectors. In the independent local
staging copy, token validation now happens immediately after argument parsing.
The application factory receives that validated value later. This changes startup
ordering, not the request schema or retrieval policy; the original classroom
checkout was not modified.

Why does ordering matter? If configuration is already invalid, spending model
startup time and allocating device memory cannot produce a usable authenticated
service. Fail on the known configuration error before doing expensive work.
This is a composition-root concern: the launcher chooses and wires dependencies,
while the reusable query service should not read deployment credentials itself.

Two regressions execute the launcher with an absent corpus and missing/short
tokens. Stubbed model and server constructors must remain uncalled, and the
observed exception must be the token validation error rather than missing-file
failure. These tests establish the order of these startup operations. They do
not establish that real optional imports work, a model fits device memory, valid
credentials cause a successful launch, or the 32-character rule measures entropy.

The staging launcher subsequently moved its optional model/server imports behind
the token check as well. Two additional regressions intercept imports and make
`sentence_transformers` and `uvicorn` deliberately unavailable. Missing/short
tokens still produce the configuration error with zero attempted optional
runtime imports. All 37 exported tests passed after that change. The earlier
constructor stubs alone would not have caught this missing-dependency boundary.
Imports of the core API remain required; this is not a dependency-free launcher.

### An optional extra must close its transitive imports

The October 7 source audit found a packaging gap before model startup even begins:
`api.py` imports `GeneratedResponse` from `generation.py`; that module imports
HTTPX unconditionally. The historical candidate declared HTTPX under `dev` and
`generation`, not under the core package or the `api` extra. FastAPI and Uvicorn's
installed base dependency metadata did not supply it. An environment that already
contains HTTPX can therefore hide an incomplete API-only installation recipe.

```text
consumer chooses package[api]
    → api imports GeneratedResponse
    → generation module imports HTTPX
    → HTTPX must be declared or deliberately isolated from this import path
```

The next experiment tested the actual advertised consumer path. Two pristine
virtual environments outside the checkout installed only each candidate's `[api]`
extra. Neither installed the dev, model, generation or Gradio extras. Both ran
`acceptance/api_install_contract.py` with Python `-I -B` from a non-checkout working
directory. The script checks the imported API is in `site-packages` and rejects
environments containing Gradio, Torch, Transformers or sentence-transformers.

| Step | Observed result | What it establishes |
|---|---|---|
| RED: install historical wheel with only `[api]` | Installation succeeded; actual API import failed with `ModuleNotFoundError: No module named 'httpx'`. | A clean environment exposes the undeclared transitive import. |
| Minimal repair | Add `httpx>=0.27,<1` to the existing `api` extra, then rebuild a separate wheel. | Dependency declaration changes; no model or runtime refactor is claimed. |
| GREEN: install rebuilt wheel in the second fresh environment | Actual installed import and synthetic in-process HTTP acceptance passed; `pip check` passed. | This API-only Windows/Python installation and adapter contract are usable. |

The green environment used Python 3.13.5, HTTPX 0.28.1, FastAPI 0.142.4 and Uvicorn
0.54.0. The new wheel is 72,858 bytes, SHA-256
`b5a554e7d0e9b8107c01fa4b1bdaa96d90ea3dd4c3a2dffdf4afdc75106534ba`.
It remains a local candidate, not a released package. The same script verifies
200/401/422 routes, synthetic evidence with an empty answer, refusal and request-ID
mapping. It uses a generated ephemeral token, never printed or persisted.

The checkout suite was rerun: 45 cases passed with one Starlette warning. The
pristine acceptance also retained PyMuPDF and Starlette deprecation warnings.
This is not model acquisition, live socket serving, financial quality, Linux or
load acceptance. The broad ranges are not a dependency lock. The API still
imports the generation response type; this repair does not claim lazy imports.

The [Python Packaging guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#dependencies-optional-dependencies)
explains how named extras declare additional dependencies. The lesson is stronger
than “add one package”: test the exact promised consumer path. A mixed development
environment or `pip check` cannot detect an undeclared import that happens to be
installed. Installation closure and real-answer quality are different gates.

Try it yourself: predict why all 45 checkout tests could pass while the RED import
failed. Install only `[api]` in a fresh environment, run the acceptance in isolated
mode, and explain which guarantees are still missing. An agent-run receipt is not
your demonstrated mastery of these boundaries.

Reproduce the lesson: draw the startup sequence; identify the cheapest decisive
failure; explain which error should win when both token and corpus are invalid.
Then distinguish startup validation from per-request authentication. Both are
necessary contracts, but they answer different questions at different times.

## Observability has a measurement boundary

Middleware attaches `X-Request-ID` and `X-Process-Time-Ms`. The timer measures the
server's `call_next` interval, not browser round-trip latency, model cold start
across process launches or percentile behavior under concurrent load. One header
cannot establish an SLO. Record hardware, corpus/index versions, concurrency,
warm/cold state, errors and answer-quality labels before comparing performance.

## Apply course concepts without inventing course endorsement

The CS381 connection is responsibility and change isolation: replace retrieval
while keeping application policy and HTTP mapping independent. The CS310 connection
is the difference between an in-process call and a network service: HTTP brings
transport failures, authentication and operational costs. These are independent
applications to this project; the inspected original lecture connections are
documented below, while broader course coverage remains pending.

Before splitting into more services, answer: which measured bottleneck or failure
domain requires independent deployment? A library interface can be valuable even
when one process is the correct topology. Multiple diagrams do not establish
microservices, and an API adapter alone does not make integration seamless.

## Personal reproduction checklist

### Browser work has a commit boundary too

Imagine selecting report A and starting ingestion, then replacing it with report
B before A finishes. A's parser or embedding work may still finish physically.
If its completion writes straight into the screen's current index, the screen
can display B's filename while searching A's passages. A fast system can still
be wrong: cancellation and the right-to-commit are separate responsibilities.

The browser controller increment addresses only that right-to-commit. Its
identity is the tuple `(protocolVersion, runtimeId, operationId, documentEpoch,
operation)`. A message also has an increasing sequence number. Before accepting
progress or completion, the controller compares the tuple with its active
operation and validates the message. Only an accepted event permits its owned
adapter to change artifacts or UI. Rejected messages leave the whole state
unchanged, including the last accepted sequence number.

<figure class="architecture-figure" id="browser-operation-contract" aria-label="Pure operation lifecycle contract, not an executed browser RAG pipeline">
<div class="figure-heading"><span class="figure-status">03 / TESTED CONTROLLER · CONTRACT ILLUSTRATION</span><h3>Finishing work is not permission to commit.</h3><p>One active operation. Validate before writing. Reject stale messages without changing state. Cancellation closes the commit boundary before replacement.</p></div>
<iframe src="figures/browser-operation.archify.html?theme=dark" title="Operation lifecycle contract — controller only" loading="lazy"></iframe>
<figcaption>Figure 3 · Archify contract illustration, not repository-provenance validation or PDF/model execution. The validation gate and rejection boxes explain control flow; they are not additional stored states. A recorded terminal may be result, error or cancellation. <a href="figures/browser-operation.archify.html?theme=dark">Open full-size ↗</a> · <a href="figures/browser-operation.archify.json">Editable JSON</a>.</figcaption>
</figure>

Work through this ordering on paper before reading code:

```text
begin ingest A at document epoch 0
replaceDocument() → cancel A synchronously; advance epoch to 1
begin ingest B at epoch 1
late result from A / epoch 0 → reject; B remains active
result from B / epoch 1 → accept once; B becomes terminal
duplicate B result → reject; terminal receipt stays unchanged
```

The controller cannot stop a GPU kernel. It invalidates an operation immediately;
the worker adapter must separately cancel or terminate actual work and release
resources. Nor does acceptance prove that a result is factual. A lifecycle result
is not a financial-answer schema, a PDF extraction receipt or genuine generation.
Those contracts remain separate acceptance gates. The controller alone does not
implement RAG; the later parser, chunk, passage and query adapters separately
validate their full artifacts before committing them. The query adapter recomputes
ranking before its atomic commit. Source replacement invalidates its dependents;
editing or cancelling a question clears only query-owned data and retains passage
vectors. The explicit context action now binds an immutable evidence snapshot to
that accepted query; clearing or replacing the query also revokes its context.
Actual financial generation remains disabled and needs its own ownership and
answer-validation boundary.

Worker replacement has a second trap. Reusing `runtime-a` after briefly switching
to `runtime-b` could recreate an old `runtime-a/op-1/epoch-0` identity. Therefore
each incarnation ID must be new, and invalid replacement is rejected before
cancelling current work. Keeping a seen-ID set is small but consequential state;
resetting every field because it looks tidy can reintroduce a stale-write bug.

For the CS381 connection, identify the policy owner: the controller validates
lifecycle messages, the worker adapter performs computation, and the view renders
accepted state. For CS310, identify the boundary: worker messages are asynchronous
serialized communication, not a second HTTP server or a deployed microservice.
This is an independent application of the inspected course concepts above, not
a claim that either course assigned this controller.

Your reproduction task is deliberately small: predict the state after every
line of the trace, run the controller tests, then deliberately remove the epoch
comparison in a disposable copy and observe which test fails. Restore it and
explain in English why “the operation finished” does not imply “this operation
is allowed to update the current document.” No model knowledge is needed to
understand that failure, and passing the tests is not personal mastery unless
you can reproduce and explain it yourself.

### Read the validation gate, not just the green test count

Read `browser-rag/protocol.mjs` in this order: `begin` allocates identity;
`accept` checks the envelope, identity, sequence and stage; `copyPayload` validates
and detaches metadata; only then does a state assignment occur. This ordering is
the design. If sequence were advanced before payload validation, a malformed
message could prevent the valid message with the same sequence from committing.
The regression tests explicitly reject malformed sequence 7, then accept valid
sequence 7. Rejection is not an invisible partial success.

For progress, `3 pages / unknown total` means exactly that. It is not 30% or 100%.
Progress units are declared, and stage vocabulary does not impose an execution
order; adapters must implement that order. A higher sequence orders messages,
not the numeric work completed across different stages. For result metadata,
depth, value-count and UTF-8 JSON-size limits bound what may enter controller
state. PDF buffers and model tensors belong elsewhere. These are explicit local
design choices, not measured browser memory limits or performance results.

### Copying a message does not validate or freeze it

The [MDN structured-clone reference](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm),
read in the Codex in-app browser on October 11, explains that Worker messages use
structured cloning. Function objects and DOM nodes cannot be cloned, and property
descriptors, accessors and the prototype chain are not preserved. Consequently,
freezing a plain record before sending it does not establish that its received
copy is frozen. This transport behavior is not our application's schema,
provenance policy or financial review.

Apply that distinction to a proposed financial-generation reply. The receiver
must validate its complete permitted shape, token reservation, effective model
settings, source-derived prompt and cleanup records, then construct its own
detached values. A successful message delivery is not permission to display an
arbitrary object. Likewise, copying a consistent token frame cannot prove that
the real paired tokenizer encoded the displayed text, or that the decoded answer
matches those generated IDs. Actual native execution needs separate evidence.
The complete financial receipt boundary is now implemented and locally reviewed.
Its tests cover canonical shape, shared-node snapshots and mutation isolation;
they do not establish native financial execution. The new transport has its own
separate code-review gate, accepted locally after independent specification and
quality reviews on October 11. Session and visible financial generation are not
established by transport or receipt-copying tests.

There is also a subtler identity issue. The original provenance input has eight
fields, but its assembled prompt context deliberately omits some values, such as
passage token IDs and the passage embedding's cache/network receipt. Two valid
inputs can therefore produce the same displayed context. Revalidating an input
against that projection does not make the projection a byte-for-byte identity
seal. The later asynchronous generation operation must retain its exact owned
input and check its current attempt separately; a prompt copier must not claim
to replace that lifecycle check.

For your CS381 explanation, separate three responsibilities in full sentences:
the browser transports a supported object representation; the application
contract validates and owns the received values; the session decides whether
the attempt may still commit. Predict what happens if a valid-looking reply
arrives after the user selects another PDF. Then explain why both a correct
schema and a correct source snapshot are insufficient without the current
operation identity. This is a design exercise, not an assertion that financial
generation has already been enabled.

### A fresh Worker still needs one-command permission

A separate Worker isolates an attempt from an imported SDK singleton, but it does
not by itself prevent the application from invoking that attempt twice. A
source-level regression for the financial handler made an input getter call the
same handler recursively while the outer command was being copied. Before the
fix, both commands started the controlled run. Reserving validation permission
before reading the command, and consuming valid-command permission before the
first native callback, makes that exported handler admit only one run. An invalid
first command can still be corrected before any run has started.

These are adversarial JavaScript boundary tests with declared synthetic runs,
not an observed browser exploit. Structured cloning does not deliver those
getter descriptors across a real Worker message. The exercise instead checks
whether our directly exported copier and handler are consistent when called by
another JavaScript component. It is useful to keep the test's scope as precise
as the implementation claim.

Callback permission has a similar boundary. Reading a byte-detail getter or
calling a subscriber can reenter application code. A sequence-budget check made
only before that read can become stale before the byte guard changes state.
The handler therefore reserves callback execution, captures its permitted fields,
and rechecks permission and the terminal-slot budget before advancing byte
observations. A callback failure remains latched even when a caller catches its
exception during full-receipt copying. Rechecking that latch before success
prevents a superficially valid final object from erasing the earlier failure.

The eight-stage lifecycle also has an end. After `cleanup`, an undefined or
repeated ninth stage is rejected immediately, rather than added to progress and
left waiting for a timeout. Neither this ordering nor a valid output JSON object
establishes a correct financial answer. The
[Anyscale generation guide](https://docs.anyscale.com/rag/quality-improvement/generation-strategies),
read in Codex IAB on October 11, separates context omissions, hallucination,
numerical reasoning and output-format failures. Our next session integration must
likewise preserve a complete raw native result when format inspection refuses it,
while showing no accepted draft. Claim support still needs the original report.

For a CS381 explanation, predict when one attempt loses its permission to commit,
not just which function runs next. For a CS310 explanation, distinguish that
logical permission from physically stopping or disposing a Worker. Then run the
named command-reentry, receipt-getter and callback-budget regressions and explain
their outcomes in your own words. The tests are development evidence; your own
reproduction and explanation are the learning evidence.

**October 7 execution receipt:** the three controller increments were implemented
with independent specification and quality reviews. The first increment retained
6 tests; replacement/cancellation expanded it to 15. Before the final validation
implementation, the expanded suite reported 18 passing and 9 failing tests;
afterwards, all 27 passed. The site's separate Python build suite passed 14 tests.
Those counts describe deterministic controller/build tests, not 27 PDFs or
financial questions, actual worker cancellation, model accuracy, or your mastery.

Run from the staged site repository:

```text
node --test browser-rag/tests/protocol.test.mjs
python -m unittest discover -q
```

Then find the tests named `malformed progress is rejected without consuming a
higher sequence`, `document replacement advances epoch before B starts`, and
`worker replacement rejects old incarnation`. Predict their snapshots before
running them. Your English explanation can start: “Cancellation revokes the old
operation's right to commit. It does not prove that its computation stopped.”
Explain the five identity fields without reading the code. Only your own
prediction, reproduction and explanation turn this scaffold into interview evidence.

1. Explain what changes when swapping a retriever, and what should stay unchanged.
2. Predict the response for valid evidence-only input, generated refusal and an
   unavailable dependency. Distinguish HTTP status from application outcome.
3. Find the `can_answer` ambiguity in the actual mapping; propose an explicit mode
   field and explain its compatibility impact before editing code.
4. Explain why constant readiness and a single timing header are weak operational
   evidence. Design a dependency check and latency experiment on paper first.

## Scoped regression evidence

On 2026-10-04 the checkout's existing virtual environment ran:

```text
python -m pytest tests/test_api.py tests/test_api_checkout_integration.py tests/test_consumer_example.py -q
```

All 38 collected cases completed successfully (19 API, 3 checkout integration,
16 consumer cases). One `websockets.legacy` deprecation warning remains. Coverage
includes blank/oversized/extra-field rejection, bearer requirements, request IDs,
empty-evidence versus dependency-failure responses, swapped-citation withholding,
corpus attribution integrity and consumer transport restrictions.

These tests use synthetic inputs and HTTP test serialization. Checkout-launcher
checks and consumer subprocess checks are not clean-install package acceptance,
an actual network deployment, load tests, or proof of financial correctness.
The current evidence-only mapping remains covered, not corrected: the source-task
test explicitly expects an empty answer even when `can_answer` is true.

## Course originals: layers are not deployment tiers

The local CS381 lecture *A Classical Approach: Layering* was text-inspected
on October 4. Pages 11, 13 and 15 distinguish presentation, domain and data-source
responsibilities. Pages 24–25 permit presentation to depend on domain or data
source, and domain to depend on data source. Therefore the lecture does not
require every request to visit exactly three boxes or prohibit all direct
presentation-to-data-source dependencies. Pages 40–41 explicitly discuss
applicability limits and representation-conversion overhead.

Applied independently to this RAG project: displaying a score is presentation;
deciding whether evidence passes policy is domain behavior; loading a vector
artifact or source record is data access. Do not put the evidence decision into
HTML merely because the browser displays its result. Conversely, startup code
that wires dependencies together is not itself proof of a deployed service tier.
The offline ingestion pipeline should not be forced into a UI-centric pattern.

The local CS310 client/server lecture, pages 4 and 7, shows direct database
access from a client and highlights client configuration and credential costs.
Its multi-tier lecture, pages 3, 7 and 12, moves processing behind a server and
illustrates a client consuming an HTTP service's status and JSON body. This is
the relevant integration lesson: an external consumer should use a stable API
contract rather than receive database credentials or depend on internal NumPy
files. It does not establish that our current API has production authentication,
HTTPS termination, deployment or capacity acceptance.

Practice question: if the UI changes from Gradio to another client, which RAG
policies should remain unchanged? If retrieval becomes a separate network
service, what new timeout, error, authorization and serialization contracts must
be designed? Explain the difference between those two changes before drawing
more boxes.

Private source locators (not redistributed with this site): CS381
`Originals_Drive/lectures/03 - Layering/slides-software-architecture-layering-approach.pdf`
(43 pages); CS310 `Originals_Day02/pdf/02 cs310-client-server.pdf` (9 pages)
and `03 cs310-multi-tier.pdf` (13 pages). Text extraction covered all pages;
embedded diagrams were not visually inspected in this pass. This is an original
project application of their concepts, not a course assignment or endorsement.

An earlier independent Windows run passed 35 exported regressions: 17
conversation, 16 HTTP consumer, and two source-launcher preflight cases. The
subsequent suite grew to 45 cases by adding two optional-import preflight checks
and eight index-integrity contract checks. These are bounded regression results,
not independent answer-quality samples. A Starlette HTTPX deprecation warning
remains. The original checkout's 38-case result above covers a different scope.
The real-loopback sections below distinguish synthetic-service HTTP acceptance
from acceptance with the cached CUDA model and existing index. The latter
application-factory path passed; the root launcher with valid configuration,
fuller course-original coverage and production controls remain unverified.
This article remains a draft and is not a publication or enterprise-readiness claim.

## A real socket closes a different boundary than TestClient

The historical independent package declared an `api` extra containing FastAPI and
Uvicorn, separate from the Gradio demonstration extra. The candidate wheel's
metadata was inspected, installed with that extra in the acceptance environment,
and imported outside the source tree. Gradio was absent in that environment.
This proves this bounded installation path does not require the demonstration
UI; it does not prove a pristine model-backed consumer installation. HTTPX had
already been installed in that environment for earlier consumer tests. Therefore
this historical receipt did not close the API-only dependency gap identified
above. The October 7 pristine RED/GREEN receipt now closes that missing-HTTPX
defect, not a pristine model-backed installation. Preserve both scopes.

From the independent RAG repository root, reproduce the transport check:

```powershell
.\.venv-acceptance\Scripts\python.exe -I acceptance\http_loopback.py
```

The script checks that the imported package lives in `site-packages`. It injects
a deliberately synthetic retriever, reserves an operating-system-assigned
loopback port, starts Uvicorn, and sends real HTTP requests with HTTPX. Its token
is generated in memory and is neither printed nor persisted. The client disables
environment proxy inheritance and redirects, uses a five-second timeout, and
connects only to the temporary local listener.

That explicit proxy isolation belongs to this acceptance client. The exported
`examples/query_client.py` and OpenAI-compatible generator instead inherit HTTPX's
environment-proxy behavior. A private model URL alone does not prove that traffic
cannot go through a configured proxy. Their 30-/60-second HTTPX timeouts also do
not establish a total deadline for the whole retrieval-and-generation request.
An enterprise integration must make proxy policy, cancellation and resource
budget explicit rather than borrow guarantees from a different test client.

| Observed result | Boundary exercised | What it does not establish |
|---|---|---|
| Health request returns 200 | Listener, server and route are reachable | Model/index readiness |
| Missing bearer token returns 401 | Authentication crosses the real transport boundary | TLS or tenant authorization |
| Authenticated blank question returns 422 | Request validation occurs before querying | Financial question interpretation |
| Valid fixture returns 200 with synthetic evidence and an empty answer | Service injection and response serialization | NVIDIA retrieval or generation quality |
| Header request ID matches JSON request ID | Correlation survives HTTP serialization | Distributed tracing or latency SLO |
| Worker stops in the cleanup block | Temporary server lifecycle is bounded | Production recovery under faults |

This check passed on October 4. It is stronger transport evidence than an
in-process test client, but the client and server still run on one Windows host,
with the server in a thread of the same Python process. Crossing a socket does
not establish cross-host deployment, a microservice topology, concurrent-load
capacity, HTTPS, GPU model startup or factual correctness.

For the CS310 learning connection, trace the distinction yourself:
`HTTPX client → loopback socket → Uvicorn → FastAPI adapter → EvidenceService
→ synthetic Retriever`. For CS381, identify which responsibility owns each
step. The retriever fixture makes the transport experiment reproducible without
confounding it with model downloads or relevance quality; it must not be used
to represent a real financial-source acceptance test.

Before running the command, predict the 401, 422 and evidence-only responses.
After running it, explain why the last response can contain evidence while its
answer is empty. Then inspect the `finally` block: startup has a ten-second
deadline, shutdown requests exit and joins the worker, and a remaining live
worker fails acceptance. These are agent-run acceptance results until you
personally reproduce and explain them; reading this chapter is not mastery.

### Replace the fixture without changing the transport contract

The same script now accepts `--artifact-dir <reviewed-artifact-directory>`.
This opt-in path validates the annual index, loads the pinned cached BGE model
on CUDA, and injects the real evidence service into the same application factory.
It passed the health, 401, 422, authenticated-query, request-ID and cleanup checks
on October 4. The real question returned top chunk
`nvidia-fy2025-annual:p18:50cdb6ce95041a87`, matching the source-reviewed trace
in [chapter three](03-ranking-is-not-confidence.html).

This closes a bounded model-backed application-factory HTTP path, not the
source-tree launcher's complete startup path. The script does not attach source
provenance metadata, enable generation, terminate HTTPS, exercise simultaneous
requests or verify Linux deployment. Its exact top-chunk assertion intentionally
pins one exposed diagnostic example; it is not an independent answer-quality
criterion. The original classroom service and data were not modified.

The learning question is now concrete: which parts of HTTP behavior stayed the
same when the injected synthetic retriever became a real CUDA/index service?
Which new preconditions appeared before the listener could start? Trace package
installation, artifact integrity, model loading, service construction and network
request separately; one successful response is not evidence for every boundary.

## Production requirements are a separate acceptance layer

The [Anyscale production guide](https://docs.anyscale.com/rag/production-scalability)
was reread on October 7. It covers CPU/GPU ingestion stages, separation of compute
and storage, serving optimization, several cache layers, vector-store selection
and continuous quality monitoring. Its semantic-cache warning is especially
relevant here: similar questions with different years or scopes may require
different answers. These are guidance, not measured capabilities of this project.

The following are project-specific acceptance requirements derived from the source
guidance, not existing deployment claims:

| Boundary | Evidence needed before a production claim |
|---|---|
| Installation | A pristine consumer environment installs only the documented extras, imports outside the checkout, and runs the real-source path; preinstalled HTTPX must not hide a missing requirement. |
| Readiness | A check proves required index/model dependencies are usable; a constant successful health response is insufficient. |
| Resource limits | Recorded concurrency, bounded queue behavior, a total request deadline/cancellation policy, memory and failure responses under a declared workload. |
| Quality | Source-reviewed labels, a frozen acceptance set, refusal analysis and separately measured retrieval/answer quality. |
| Cache correctness | Keys bind query qualifiers, source/index revision, model and policy; updates cannot return stale or cross-scope evidence. |
| Recovery | An interrupted build or unavailable dependency has a recoverable outcome without corrupting the active artifact; launcher acceptance reaps only its own processes and waits for their listener to exit. |

For the present financial workflow, an answer cache keyed only by vector
similarity is not acceptable evidence of correctness. FY2024 and FY2025 queries
can be close in representation while requiring different source columns. An
identical-prompt cache and a reusable passage-embedding artifact are also
different concepts; neither implies a distributed prefix cache exists.

The current prompt places the question before quoted evidence. Even if a future
serving engine supports prefix caching, that ordering may reduce reuse of later
shared context. Any rearrangement must preserve the evidence/instruction boundary
and undergo quality tests before a latency claim. This is a design observation,
not a measured cache-hit or TTFT result.

No Ray cluster, autoscaling configuration, new vector database or cloud resource
was created for this source review. Database choice should follow measured scale,
filtering, recovery and operational requirements, not a diagram's appearance.
