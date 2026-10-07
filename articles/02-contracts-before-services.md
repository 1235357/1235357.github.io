---
title: Contracts before services
status: draft
updated: 2026-10-07
tags: [rag, software-design, api]
---

# Contracts before services

An enterprise consumer does not integrate a screenshot. It integrates behavior:
what input is accepted, what the response means, and what happens when a dependency
fails. This chapter examines the current implementation, not a promised production
deployment. Source authority: `src/nvidia_rag/service.py` and `api.py` inspected on
2026-10-04, with a read-only installation/contract audit on 2026-10-07. The dated
regressions below are historical receipts, not a new suite run, runtime benchmark
or financial-answer evaluation.

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
HTTPX unconditionally. Yet `pyproject.toml` declares HTTPX under `dev` and
`generation`, not under the core package or the `api` extra. FastAPI and Uvicorn's
installed base dependency metadata do not supply it. An environment that already
contains HTTPX can therefore hide an incomplete API-only installation recipe.

```text
consumer chooses package[api]
    → api imports GeneratedResponse
    → generation module imports HTTPX
    → HTTPX must be declared or deliberately isolated from this import path
```

This is a verified declaration/import mismatch, not a new pristine-environment
failure receipt. The correction should be tested by building a wheel, installing
only its documented extra into a fresh environment, and importing from outside
the checkout in isolated mode. Test the exact advertised consumer path; a mixed
development environment or `pip check` cannot detect an undeclared import that
happens to be installed. Dependency self-sufficiency and real-answer quality are
different acceptance gates. No package dependency or import was changed for this
read-only audit.

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

The independent package now declares an `api` extra containing FastAPI and
Uvicorn, separate from the Gradio demonstration extra. The candidate wheel's
metadata was inspected, installed with that extra in the acceptance environment,
and imported outside the source tree. Gradio was absent in that environment.
This proves this bounded installation path does not require the demonstration
UI; it does not prove a pristine model-backed consumer installation. HTTPX had
already been installed in that environment for earlier consumer tests. Therefore
this historical receipt does not close the API-only dependency gap identified
above. Preserve the receipt, but narrow the claim to its actual environment.

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
