---
title: Generation is not verification
tags: [rag, generation, evidence]
category: technical-blog
status: local-draft
created: 2026-10-04
updated: 2026-10-14
source_type: implementation-and-course-review
---

# Generation is not verification

The classroom Python baseline is evidence-only: generation is disabled. The
default browser development entry also omits the generator. The explicit public
browser build now enables reader-initiated Qwen generation; its later
[public native run](07-operational-receipts.html#a-public-model-run-with-its-evidence-preserved)
returned a source-linked draft labelled **UNVERIFIED**. That observation does not
establish financial answer accuracy. The earlier Python Qwen run remains a
rejected-output diagnostic, and the private browser runs described below use a
fixed greeting rather than a financial question. Running a generator does not
itself verify a retrieved passage.
The Python sections follow the prompt, validator and local model adapter in
`src/nvidia_rag/generation.py`; the browser sections keep each later integration
checkpoint separate from that baseline.

## The official guidance is not an acceptance certificate

The [Anyscale generation guide](https://docs.anyscale.com/rag/quality-improvement/generation-strategies)
was read on October 4. It discusses context ordering and compression, source
metadata, citations, verification, numerical tools and output-format constraints.
For our project these are possible interventions, not existing capabilities.
In particular, tool execution still requires correct source data, intent, units,
code and permissions. Structured output constrains form, not factual support.
We should not adopt absolute reliability language as a project guarantee.

## Read the prompt as a contract proposal

`build_grounded_prompt` requires gated evidence. It includes the question,
quoted context and a list of authorized document/page references. Instructions
ask the model to use only evidence, ignore instructions inside quoted data,
cite factual claims and abstain when information is insufficient.

These instructions express desired behavior; they do not enforce it by themselves.
A source passage can contain malicious or irrelevant instructions, and a model
can ignore the requested citation format. Keeping source data distinct from
instructions is necessary, but no complete prompt-injection defense is proved.

### Course connection: token prediction and evidence enforcement are separate

The current CS461 Canvas download of *Bengio Language Model*, physical PDF
pages 5, 9 and 15, develops logits, softmax/cross-entropy and numerical stability.
Its cover and footer retain Spring 2026, David Demeter; a Fall directory does not
make it a newly authored Fall deck. The model's training objective predicts a
target token, not whether a financial claim is supported by an external report.

A synthetic calculation makes the distinction tangible:

```text
logits                 = [2, 0, -1]
subtract maximum       = [0, -2, -3]
stable softmax         = [0.843795, 0.114195, 0.042010]
first-token loss (nats) = -ln(0.843795) = 0.169846
```

These are teaching values, not our model's observed outputs. A low token loss
does not check the financial row, date column or unit. Separately, the CS496
course-posted `class2` slides credited to Hung-yi Lee distinguish model-level
instructions from external execution control (physical page 23), and illustrate
summarization/context trimming (pages 29 and 47). Our project-specific lesson is
to keep prompt requests, external vetoes and human source review separate.
If a summary removes a fiscal date or unit, fluent generation can become less
supportable. This explanation does not claim a new context-compression feature.

The service retrieves before generation and returns an evidence-stage refusal
when the context gate fails. An evidence gate based on similarity is still not
a fact checker. Inspecting one request should reuse its exact gated context,
not perform a second retrieval that silently changes the evidence displayed.

## Understand what the validator actually rejects

The inspected validator checks an empty response, incomplete brackets, missing
citations, unauthorized citation IDs, substantive text after the final citation,
and lack of a substantive answer. Additional bounded checks examine explicit
currency, certain canonical table-period/metric requests, numeric support and
limited metric or relationship patterns. Multiple inline citation groups are
checked against their local cited pages rather than pooling all pages together.

These are vetoes: detecting one violation can reject an answer. Not detecting a
violation is not proof of full entailment. Paraphrases, negation, forecasts,
cross-sentence relationships and unsupported nonnumeric assertions remain
important limitations. A complete citation can point to a page without actually
supporting the claim. Passing the validator must therefore be followed by a
separate answer-quality review, not renamed "financial truth verified."

The diagnostic `raw_answer` field is explicitly distinct from the released
`answer`. If the latter is empty because validation rejected the output, displaying
raw text as a successful answer would undo that boundary. Demonstration and API
consumers must preserve the same distinction.

## Token budgets have two boundaries

The local Transformers adapter builds the full chat template, including system
instructions, before counting input tokens. It uses `truncation=False`; an input
over the configured budget fails instead of silently dropping evidence.
It separately checks input tokens plus reserved output against the model's
context-window configuration. A long context can be valid in size yet poor in
relevance, so fitting the budget does not establish quality.

Generation uses `do_sample=False` and checks final token IDs for normal EOS
termination before decoding. A syntactically complete citation at the output
budget is not enough to establish normal completion. Greedy decoding does not
prove repeatability across model revisions, hardware or software versions, and
it certainly does not prove correctness.

## Browser lesson: a context record is not yet a prompt

The browser-native implementation is independent of the Python service above.
Its context boundary is `assembleProvenanceContext` in
`browser-rag/context-contract.mjs`: a pure source module independently reviewed
on October 10. At that checkpoint the generator was not enabled or packaged in
the browser preview; the public build subsequently integrated it. The context
function itself still runs no generator. Its result is explicitly named
`context-not-generated`. It retains the question exactly as typed and associates
ranked candidates with complete source-linked evidence units. There is no model
download, prompt rendering or inference in this function.

Consider the synthetic fixture used by its regression tests. The best-ranked
passage has source ordinal 1, so its citation is `E2`; the next passage has
ordinal 0 and citation `E1`. Rank answers “which candidate comes first for this
query?” while citation identity answers “which chunk in this accepted document
does this refer to?” Giving the first-ranked passage a new identity on every
query would conflate those responsibilities. A citation remains stable within
the accepted source and chunking configuration, not across a changed index.
These fixture ranks are not results from an NVIDIA financial report.

The full chunk record is necessary here. The encoder's smaller `{id, text}`
projection is useful for inference, but it omits the physical page, nullable PDF
page label, exact text range and source-item segments required for inspection.
The new boundary checks the entire declared sequence of chunk windows, not just
the windows that happened to be returned. Removing a middle window and updating
the aggregate counts must still fail. An inserted presentation newline also
remains distinguishable from a quotation taken from a PDF text item. This is an
application of the CS381 responsibility-boundary lesson: transport validation,
retrieval ranking and source attribution have separate contracts even when they
run in the same application.

To study this boundary, run the context contract tests and read the fixture's
source, chunk, retrieval candidate and evidence unit together. Change one page
identity or remove one window, then explain why the operation must refuse it.
After that, explain what it cannot detect: structurally consistent source data
can still be misleading, a correct citation can support the wrong financial
metric, and this pure module does not bind a typed question semantically to its
embedding. Session ownership and financial evaluation remain separate checks.
Passing a programming test is not evidence that the learner has completed this
exercise or mastered it.

### From evidence units to an exact prompt

`prepareGenerationPrompt` makes the next boundary explicit. Its initial
independent specification and code-quality reviews covered local prompt
preparation, before browser-demo packaging. The current public entry composes
the generation worker, whose runtime calls this same prompt boundary. The
default development entry still omits that generator.
It revalidates the original provenance input, then creates a model-facing JSON
record containing the unchanged question and every selected whole quote, with
its citation, rank, document, page and text-window identity. The full inspection
record separately retains the scores, vectors, receipts and source-item mapping.
Removing those trace-only fields from the model payload is not shortening the
quotes or silently dropping evidence to fit a token budget.

The two messages have fixed roles: system instructions, followed by the JSON
data. Angle characters in the JSON are escaped losslessly before the SDK renders
the pinned Qwen chat template. For example, a source string containing a literal
`<|im_start|>` becomes JSON data containing `\u003c|im_start|\u003e`; parsing
that JSON recovers the original string. This prevents that literal spelling from
becoming a role delimiter in this template. It does **not** establish resistance
to ordinary-language prompt injection, nor does asking for JSON guarantee that
the model will return the required structure.

The adapter requires the SDK's exact full rendered template and tokenizes that
whole string with truncation disabled. System text, JSON metadata, quotation
text, role markers and the assistant prefix all count. It accepts the copied
token IDs only if input length plus reserved output fits the configured window.
UTF-16 offsets locate JavaScript text; they are not token counts. An over-budget
prompt fails instead of hiding a shorter quotation behind a successful status.

A local Node diagnostic used the actual downloaded, SHA-256-checked Qwen
tokenizer pair and the installed SDK with two **synthetic** source paragraphs
and synthetic retrieval vectors. Its 1,745-UTF-16 prompt encoded to **489 input
tokens**. Reserving **128 output tokens** accepted a **617-token** window and
refused a **616-token** window. The two quotes and raw question survived exactly,
including Unicode, whitespace and marker spellings; the tokenizer saw only the
intended three role starts and two role ends. This is a concrete tokenizer and
budget observation, not an NVIDIA evaluation or a generated answer. The result
is still named `prompt-prepared-not-generated`, with `generationMode: not-run`.

For your own learning check, first explain why source ordinal and retrieval rank
are different, then follow one complete quote into the JSON and back. Predict
which extra text contributes tokens before running the tokenizer. Finally,
explain why a correct budget receipt cannot prove that the future model's answer
is financially supported. Reading these results is not evidence that you have
performed that exercise. This tokenizer diagnostic did not execute a financial
prompt. Later browser integration executed a provenance-bearing prompt and
inspected its output structure and citation identities, as recorded in the
[execution-contract chapter](07-operational-receipts.html#a-public-model-run-with-its-evidence-preserved).
Independent financial evaluation and claim-level source support remain open;
the small greeting runs below do not satisfy those gates.

### Verifying a model file is not loading a model

A browser generator first needs an exact model revision and its matching
tokenizer, configuration and runtime. A completed download establishes that
bytes arrived; it does not establish that those bytes match the pinned model,
that the runtime can load them, or that a generated answer is supported.

The local static builder now hashes binary files in 1-MiB reads and verifies the
same blocks it writes into a private stage. Its manifest retains byte counts
and digests instead of full file bodies. This matters when preparing a
786,156,820-byte Q4 weight: reading the whole weight merely to compare two
builds would make build memory scale with asset size. A local fingerprint-only
diagnostic took 0.551 seconds and recorded 2,106,388 bytes of peak Python-traced
allocations. Those measurements describe that operation on this machine, not
the browser's RAM or GPU allocation and not model-initialization acceptance.

Verification and copying must operate on the same bytes. Checking one file
read and then copying a second read leaves room for the source to change
between them. Here each written block contributes to the digest and byte
count; an overlong stream is rejected before its extra block is written, and
short input, a failed write or a wrong digest rejects the stage. A permanent
test fails a read after one complete block and verifies that both handles
close, the failed stage is removed without rereading its payloads, and the
previous working preview stays intact.

This connects CS310's resource-management concerns with CS381's separation of
responsibilities. The copier establishes asset identity, the stage owner
performs guarded cleanup, and the promotion code preserves the last working
output. None of these components should rename an asset check as successful
inference. In particular, the selected SDK still reads model bytes into a
full buffer for initialization. Bounded build reads do not remove that separate
browser/runtime memory cost.

### Record the effective policy, not only the requested setting

Setting `do_sample: false` does not describe the complete policy that reaches
the model. The pinned Qwen configuration requests sampling, temperature 0.7,
top-k 20, top-p 0.8 and a repetition penalty of 1.1. Transformers.js 3.8.1 merges
model defaults before caller settings. Some defaults are irrelevant to greedy
selection, but repetition penalties can still change the logits independently
of sampling. A trace that records only “greedy” would conceal that difference.

The local preflight now owns every one of the pinned SDK's 46 generation fields.
It specifies neutral repetition penalties, one beam, no sampling and the exact
input-plus-reserved-output limit. Its Qwen-specific BOS, padding and two EOS IDs
are not portable defaults for an arbitrary model. Each receipt owns frozen
copies of its EOS array and empty extra-arguments record; when a receipt crosses
the contract boundary, validation reconstructs those values instead of trusting
the caller's object identity. The policy identity is
`qwen2.5-0.5b-q4-webgpu-v2`.

An integration test calls the actual installed SDK configuration-merge method
without loading weights or invoking generation. Its legacy eight-setting control
retains the model's 1.1 repetition penalty. The complete caller policy overrides
all 46 known fields and preserves the configured token limits. The SDK's own
merged object remains writable because generation subsequently adjusts its
length limit; freezing the public receipt is not a reason to freeze SDK-owned
state. A dependency upgrade must rerun this field-set and merge test.

This is a CS381 contract and ownership example: the preflight owns the intended
policy, the adapter must pass it to the runtime, and the test observes the real
merge boundary. For your learning exercise, predict the legacy control's penalty
before reading its output, then explain why recording a setting is weaker than
checking the effective configuration. This test establishes policy composition,
not GPU inference, reproducible output across devices or financial correctness.

### Byte progress is not asset acceptance

The new browser-side `verifyAssetResponse` is a pull-driven transport boundary.
It reads one upstream chunk, hands the consumer owned copies of at most 64 KiB,
and feeds those same copies into pinned incremental SHA-256. It does not collect
all chunks into a second whole-weight buffer merely to hash them. A completed
byte counter means those bytes were read; `verified: true` is emitted only when
EOF has the exact pinned length and matching digest. A short body, extra bytes,
wrong digest or failed read errors the response before it can close successfully.
The caller must finish consuming the body or cancel it, and await its completion
receipt before treating the asset as accepted.

For a concrete learning exercise, change the final byte of an otherwise
same-length test asset. Predict why its progress can reach the expected count
but its completion still rejects. Then cancel a read while the source is pending
and explain who releases the reader lock. These tests use an independent digest
oracle, not a stub that always reports success. A separate regression rejects
an object that only inherits `Response.prototype` but lacks the native Response
brand. It also rejects own shadows of Response metadata, captures the actual
native status, URL, redirect flag, headers and body once, and reads that captured
body. Real local HTTP tests cover URL matching and redirect refusal. These are
transport and ownership observations, not financial answers.

The memory claim has a narrow scope. Our verifier retains one native upstream
chunk, one bounded outgoing copy and fixed hash state. The browser determines
upstream chunk sizes; the SDK still constructs a complete model buffer. The
[Cache.put documentation](https://developer.mozilla.org/en-US/docs/Web/API/Cache/put)
also says writing consumes the response body. The
[Service Worker specification](https://w3c.github.io/ServiceWorker/#cache-put)
describes buffering and permits an implementation to optimize by streaming to
disk. Therefore, a bounded verifier does not prove bounded browser RAM, storage
availability, GPU allocation or a successful model session. Those costs need
actual measurement at the later runtime boundary.

This connects CS310 resource lifetimes with CS381 interface responsibilities.
The cache adapter now owns and awaits writes, then verifies cached bytes again
when the SDK reads them. Source inspection and an actual SDK probe found that
Transformers.js swallows a rejected custom-cache match and can then fetch the
local URL. Its closed adapter must deny unexpected files without allowing that
fallback. The adapter's independent Node/SDK reviews did not establish native
Qwen inference. The small browser runs at the next checkpoint are recorded below.
The public financial UI later enabled explicit generation; the default
development entry continues to omit it.

### A cache write and an SDK read are separate obligations

`prepareVerifiedAssetCache` returns an accepted store only after the streamed
body has the pinned length and SHA-256 **and** the native storage write resolves.
A valid digest does not make a quota failure successful. On a warm entry, it
drains and verifies cached bytes without silently downloading a replacement.
Preparation receipts count these accepted asset-body reads; they do not count
SDK consumption, HTTP overhead or every request made by the browser.

SDK consumption then rereads the primary entry through a fresh verified stream.
An unexpected filename, missing entry, corrupt body or closed store returns a
native Response whose body errors. Returning an ordinary empty response or
rejecting the cache lookup would mean something different to this dependency:
its cache helper catches lookup rejection and can try transport afterward.
The regression uses the actual installed file loader, with a legacy control
that attempts a fetch and sealed cases that do not. Both progress modes also
read one store three times, checking fresh consumed responses and cumulative
receipts. Small synthetic files exercise that boundary; no model executes in
these tests.

Closing the store revokes new reads and errors active or unconsumed SDK bodies.
The caller still owns finishing or cancelling each body. This is the same
ownership question discussed in CS381: which component decides that work is
accepted, and which component releases a resource when the work cannot finish?
For your exercise, predict what happens if the digest succeeds but `Cache.put`
rejects, and why the SDK's swallowed lookup exception requires a deliberately
errored body. Then explain why a completed cache receipt is not model inference.

The private actual-runtime experiment uses a native browser Worker and a separate
32-input-token, eight-output-token Qwen fixture before the financial prompt.
The [pinned SDK's WebGPU guide](https://huggingface.co/docs/transformers.js/v3.8.1/guides/webgpu)
shows the explicit device selection. Selecting a device is only configuration;
the accepted runs below record loading, generation, output bounds and cleanup.
It does not increase the financial context limit or establish answer accuracy.

### Two real browser runs before the financial prompt

On October 11, the private diagnostic actually loaded the pinned Qwen model
and called generation in a fresh native Worker through the reviewed WebGPU
adapter. It used the real tokenizer's fixed 32 input IDs and an eight-new-token
limit. Both accepted runs produced `Hello! It's nice to meet you`, with generated
IDs `[9707, 0, 1084, 594, 6419, 311, 3367, 498]`. The sequence stopped at its
length limit, not EOS. It did not reach the requested mention of a small test,
so this observation demonstrates local runtime integration, not complete
instruction fulfillment, a financial answer or a quality score.

The cold preparation read and verified 815,725,938 asset-body bytes. The next
accepted run read that same amount from native CacheStorage and recorded zero
asset-preparation network bytes. Each SDK then separately consumed five verified
model files totaling 793,197,262 bytes. Runtime JavaScript and WebAssembly were
also requested by the page; their transport is outside those preparation and
SDK-body receipts. Calling the warm run "zero network traffic" would be wrong.

The observed whole diagnostic durations were about 30.77 seconds cold and
25.71 seconds warm. Those durations include asset checking, SDK/tokenizer/model
initialization, generation and cleanup. They are two runs on this computer,
not a p95 latency, time-to-first-token measurement, throughput benchmark or
cross-device reproducibility result. Inspect the stage entries before deciding
which operation to optimize; cache reuse does not keep a model resident when
every explicit Run deliberately owns a new Worker.

After each accepted run, the receipt confirmed two input tensors and one result
tensor disposed, awaited model disposal, cache closure and one owned device
destroyed. A separate Cancel action instead showed `ABORTED` and
`worker-terminated; native disposal unconfirmed`, with no accepted output.
Returning to the page allowed a new explicit run. The mounted-module regression
also covers BFCache restoration, but the actual navigation returned a Ready
page, so that navigation is not proof that BFCache was used.

This is a useful CS381 contract exercise. An independent review found that a
valid but different 80/16 preflight could previously cross the result boundary
and be silently replaced with 40/8 in the displayed receipt. The adapter now
compares the entire incoming preflight with its fixed canonical policy before
accepting the output inspection. Explain why an internally consistent result
is still wrong when it belongs to a different approved operation.

For your CS310 learning check, explain why verifying a cache entry differs from
loading the model, and why a cached model file differs from a resident model
session. For the LLM connection, decode the eight returned IDs and explain what
the length stop leaves unfinished. At this greeting checkpoint, integration with
the exact selected-PDF context, a larger token budget and output inspection was
still pending, and the financial inspector's Generate button was disabled. The
later public native financial run is a separate observation; this greeting does
not supply financial workflow or answer-quality evidence. Independently reviewed
financial predictions remain a separate evaluation gate.

## Explain the observed failure without exaggeration

A prior local Qwen2.5-0.5B-Instruct run reached generation but omitted the required
document/page citation; the interface reported a citation-format refusal. That
historical observation supports one concrete failure case. It does not establish
current uptime, general answer quality, a throughput benchmark or the best model.

To reproduce the learning, record one question, exact evidence, full prompt,
model/runtime revision, raw response, rejection reason and a human source verdict.
Review the answer independently of whether the validator accepted it. Include
both valid answers wrongly refused and unsupported answers wrongly accepted;
otherwise a stricter refusal policy can look artificially better.

## A safe next experiment, not a new feature promise

At the greeting checkpoint, the next proposed experiment was to compare prompt
variants using the same evidence and model settings. The later
[financial diagnostics](07-operational-receipts.html#the-next-experiment-follows-the-failure)
preserve those bounded comparisons, including rejected outputs and wrong
six-month values. Future comparisons still need frozen review criteria before
outputs are inspected. Record format compliance separately
from factual support and answer completeness. Do not repair a missing citation
by attaching the top-ranked page automatically: that manufactures attribution.
Numerical aggregation should remain out of scope until inputs and calculations
have an explicit verifiable contract.

For interviews, be ready to explain one rejected output and one validator gap.
That is stronger engineering evidence than saying "RAG eliminates hallucinations."
Continue with [evaluation labels](06-evaluation-labels-before-scores.html).
