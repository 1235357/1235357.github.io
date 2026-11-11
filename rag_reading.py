"""Additive reading aids for the existing RAG notes. No runtime or model work."""
from html import escape

# Order is pedagogical, not the original publication numbering.
BEGINNER_PATH = (
    '01-two-lifecycles', '04-preserve-evidence-before-embedding',
    '03-ranking-is-not-confidence', '05-generation-is-not-verification',
    '06-evaluation-labels-before-scores',
)
CHAPTERS = {
    '01-two-lifecycles': ('Prepare once. Ask again.', 'Architecture',
        'Separate reusable document preparation from the work each new question needs.',
        (('offline-work-creates-a-reusable-representation', 'Document preparation'),
         ('the-actual-request-contract', 'One new question'))),
    '04-preserve-evidence-before-embedding': ('Keep the source attached.', 'Source evidence',
        'Follow a passage back to its page, then check the date, row, and unit around it.',
        (('trace-one-document-through-the-actual-code', 'Follow the source'),
         ('walk-one-chunk-back-to-the-source', 'Inspect a chunk'))),
    '03-ranking-is-not-confidence': ('Read a ranking carefully.', 'Retrieval',
        'Work through a similarity score and identify what it cannot tell you about an answer.',
        (('first-understand-the-exact-calculation', 'Calculate a score'),
         ('top-k-is-a-ranking-budget-not-a-quality-guarantee', 'Understand Top K'))),
    '05-generation-is-not-verification': ('Inspect the answer draft.', 'Generation',
        'Trace evidence into a prompt and distinguish output checks from factual support.',
        (('read-the-prompt-as-a-contract-proposal', 'Read the prompt'),
         ('understand-what-the-validator-actually-rejects', 'Check the output'))),
    '06-evaluation-labels-before-scores': ('Decide what counts as correct.', 'Evaluation',
        'Choose what to judge before computing a metric, then check the financial claim against its source.',
        (('work-a-retrieval-metric-by-hand', 'Work a small example'),
         ('a-financial-rubric-that-a-reviewer-can-actually-use', 'Check the claim'))),
    '07-operational-receipts': ('Follow a browser operation.', 'Browser lab',
        'Inspect what each operation produced, who owns it, and what happens when the question changes.',
        (('the-readers-browser-owns-the-work', 'Find the responsibilities'),
         ('a-public-model-run-with-its-evidence-preserved', 'Read a dated run'))),
    '02-contracts-before-services': ('Read the service contract.', 'Python integration',
        'Follow a request through validation, retrieval, and the response a caller can interpret.',
        (('follow-one-http-request', 'Trace a request'),
         ('failure-is-part-of-the-interface', 'Interpret failures'))),
    '08-source-bound-startup': ('Start with explicit sources.', 'Python integration',
        'Follow the prepared inputs and checks that determine what a running service can serve.',
        (('decide-what-the-service-will-serve', 'Choose the inputs'),
         ('leaving-a-feature-off-differs-from-configuring-it-incorrectly', 'Check the configuration'))),
}

EXAMPLE_THREADS = {
    '01-two-lifecycles': ('Prepare the report once; a question about the other year needs its own query computation.', 'Reusable passages do not supply a permanently correct answer.'),
    '04-preserve-evidence-before-embedding': ('Extract the table and keep the 240 value connected to its row, date, unit, and source page.', 'A retained number alone does not preserve the table relationship.'),
    '03-ranking-is-not-confidence': ('Compare a question with prepared passage representations to obtain ranked candidates.', 'A high similarity score is not a probability that the period and amount are correct.'),
    '05-generation-is-not-verification': ('Assemble the question and selected evidence into a prompt for an answer draft.', 'A valid citation can identify evidence without proving that the draft uses the right year.'),
    '06-evaluation-labels-before-scores': ('Compare the draft with the source row, period, and unit, then record the judgment.', 'This exposed teaching example cannot establish accuracy on unseen financial questions.'),
}


def chapter_aids(slug):
    """Return an orientation panel and end navigation without changing authored text."""
    if slug not in CHAPTERS:
        return '', ''
    title, category, goal, stops = CHAPTERS[slug]
    if slug in BEGINNER_PATH:
        position = BEGINNER_PATH.index(slug)
        label = f'Foundations · Step {position + 1} of {len(BEGINNER_PATH)}'
        next_slug = BEGINNER_PATH[position + 1] if position + 1 < len(BEGINNER_PATH) else '07-operational-receipts'
        previous = BEGINNER_PATH[position - 1] if position else None
    else:
        label = category
        next_slug = '08-source-bound-startup' if slug == '02-contracts-before-services' else '01-two-lifecycles'
        previous = '02-contracts-before-services' if slug == '08-source-bound-startup' else None
    jumps = ''.join(f'<a href="#{escape(anchor)}">{escape(text)}</a>' for anchor, text in stops)
    opening = (f'<section class="chapter-guide" aria-label="Reading guide">'
               f'<p class="reading-kicker">{escape(label)}</p><p>{escape(goal)}</p>'
               f'<nav aria-label="First reading stops"><span>First pass</span>{jumps}</nav></section>')
    previous_link = (f'<a href="{previous}.html"><span>Previous</span>{escape(CHAPTERS[previous][0])}</a>'
                     if previous else '<a href="browser-rag/index.html"><span>Start here</span>RAG reading guide</a>')
    ending = (f'<nav class="chapter-pagination" aria-label="Continue reading">{previous_link}'
              f'<a href="{next_slug}.html"><span>Continue</span>{escape(CHAPTERS[next_slug][0])}</a></nav>'
              '<p class="reading-return"><a href="browser-rag/index.html">All paths and key terms</a> · '
              '<a href="browser-rag/inspector.html">Open the browser lab</a></p>')
    return opening, ending


def guide_teaser():
    return ('<section class="guide-teaser" aria-label="Beginner RAG guide">'
            '<p class="reading-kicker">NEW TO RAG?</p><h2>Start with the whole picture.</h2>'
            '<p>Five connected lessons, a small glossary, and a first source check in the browser lab.</p>'
            '<a class="reading-button" href="browser-rag/index.html">Explore the reading guide</a></section>')


def render_guide(*, public_release=False):
    browser_scope = (
        'MiniLM retrieval + optional Qwen answer drafts in this public build.'
        if public_release else
        'MiniLM retrieval; Qwen generation is disabled in this local build.'
    )
    model_scope = (
        'Embedding and generation are optional, explicit actions. They require compatible browser hardware and can involve large downloads. The uncached generator assets total about 816 MB. Treat any generated answer as an unverified draft.'
        if public_release else
        'Embedding is an optional, explicit action that downloads model assets and requires compatible browser hardware. Qwen generation is disabled in this local build. The public profile enables a separate generation stage; it is not part of this source-check exercise.'
    )
    cards = []
    for ordinal, slug in enumerate(BEGINNER_PATH, 1):
        title, category, goal, _ = CHAPTERS[slug]
        example, limit = EXAMPLE_THREADS[slug]
        cards.append(f'''<li><a class="path-card" href="../{slug}.html">
<span class="path-number" aria-hidden="true">0{ordinal}</span><div>
<p class="reading-kicker">{escape(category)} · Chapter {slug[:2]}</p>
<h3>{escape(title)}</h3><p>{escape(goal)}</p><span class="path-action">Read the lesson</span>
<p class="path-example"><strong>Follow the example:</strong> {escape(example)}</p><p class="path-limit"><strong>Keep in mind:</strong> {escape(limit)}</p>
</div></a></li>''')
    return '''<section class="rag-guide-hero" aria-labelledby="guide-title">
<div class="rag-hero-copy"><p class="reading-kicker">THE RAG FIELD GUIDE / ZHENTONG YE</p>
<h1 id="guide-title">From a document<br>to an answer<br><em>you can inspect.</em></h1>
<p class="rag-intro">Learn retrieval-augmented generation (RAG) by following a PDF through source preparation, retrieval, and an answer draft. Begin with the ideas, then inspect the work in the browser lab.</p>
<div class="reading-actions"><a class="reading-button" href="../01-two-lifecycles.html">Start the first lesson</a><a href="#reading-path">See the five-step path</a></div>
<p class="rag-meta">5 foundation lessons · 3 deeper dives · No setup to read</p><p class="runtime-summary"><strong>Browser lab:</strong> ''' + browser_scope + '''<br><strong>Separate Python paths:</strong> BGE evidence-only baseline; installed TF-IDF retrieval and optional source-cell selection, not generated answers.</p></div>
<figure class="evidence-map" aria-labelledby="evidence-map-title">
<figcaption id="evidence-map-title">THE IDEA IN THREE STAGES</figcaption>
<ol><li><span class="map-number">01</span><div><strong>Your document</strong><p>Keep the text connected to its page.</p><div class="map-paper" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div></li>
<li><span class="map-number">02</span><div><strong>Retrieved passages</strong><p>Find candidates for one question.</p><span class="map-tag">Source page + exact quote</span></div></li>
<li><span class="map-number">03</span><div><strong>An answer draft</strong><p>Check the claim against its source.</p><span class="map-tag map-warning">Still needs verification</span></div></li></ol>
<p class="map-caption">Concept map only. No model runs on this page.</p></figure></section>

<section class="source-exercise" aria-labelledby="source-exercise-title"><div><p class="reading-kicker">TRY THE IDEA BEFORE THE CODE</p><h2 id="source-exercise-title">The right row.<br>The right year.</h2><p>A question asks for Net income for the year ended January 31, 2025. Which value answers it, and what unit must you keep?</p><p class="example-label">Fictional teaching example from Chapter 04. These are not NVIDIA figures or model output.</p></div><div><div class="reading-table" role="region" aria-label="Fictional Net income table" tabindex="0"><p class="table-hint">Dollars in millions · scroll horizontally if needed</p><table><thead><tr><th scope="col">Metric</th><th scope="col">Jan 31, 2025</th><th scope="col">Jan 31, 2024</th></tr></thead><tbody><tr><th scope="row">Net income</th><td>240</td><td>180</td></tr></tbody></table></div><details><summary>Check your reasoning</summary><p>The candidate is <strong>240 million dollars (currency code unspecified)</strong>. The value 180 belongs to the previous year. A passage can mention the right metric while carrying the wrong period. Keep the row, date, and unit together when you inspect the source.</p><a href="../04-preserve-evidence-before-embedding.html">Follow this example through chunking</a></details></div></section>
<section class="rag-guide-section" id="reading-path" aria-labelledby="path-title">
<div class="guide-section-heading"><p class="reading-kicker">01 / BUILD THE MENTAL MODEL</p><h2 id="path-title">One question. Five useful distinctions.</h2>
<p>Read in this order on your first visit. The chapter numbers preserve the original series; the steps follow the path from source to evaluation. These are reading steps, not the lab's operation stages.</p></div>
<ol class="reading-path">''' + ''.join(cards) + '''</ol></section>
<section class="rag-guide-section rag-practice" aria-labelledby="practice-title">
<div><p class="reading-kicker">02 / TRY ONE SOURCE CHECK</p><h2 id="practice-title">Start small.<br>Follow one sentence.</h2>
<p>You can inspect a PDF and build chunks before downloading a model. Choose a short, selectable-text PDF you have permission to use.</p>
<a class="reading-button" href="inspector.html">Open the browser lab</a></div>
<ol class="practice-steps"><li><strong>Predict.</strong> Find one answer-bearing sentence in the PDF. Write down its physical page and the question it answers.</li>
<li><strong>Inspect.</strong> Select the PDF in the lab and build chunks. Compare one chunk with the original sentence and page.</li>
<li><strong>Explain.</strong> What survived the extraction? What would you still need to check before accepting an answer?</li></ol>
<p class="practice-boundary">''' + model_scope + '''</p></section>
<section class="rag-guide-section" aria-labelledby="terms-title"><div class="guide-section-heading"><p class="reading-kicker">03 / A FEW WORDS TO KEEP NEARBY</p><h2 id="terms-title">The terms, in plain language.</h2></div>
<dl class="rag-glossary"><div><dt>Chunk</dt><dd>A passage prepared from a document. Its source mapping lets you trace it back to the original text.</dd></div>
<div><dt>Embedding</dt><dd>A numerical representation used to compare a question with passages. Similarity does not establish truth.</dd></div>
<div><dt>Retrieval</dt><dd>Selecting and ranking candidate passages for a question.</dd></div>
<div><dt>Context</dt><dd>The selected evidence assembled for the model. Missing or unsuitable evidence can limit the answer.</dd></div>
<div><dt>Citation</dt><dd>A reference to retained evidence. Check whether that evidence supports the particular claim.</dd></div>
<div><dt>Receipt</dt><dd>A record of an operation's inputs, settings, and outcome. Read its stated scope before drawing conclusions.</dd></div></dl></section>
<section class="rag-guide-section" aria-labelledby="deeper-title"><div class="guide-section-heading"><p class="reading-kicker">04 / GO DEEPER WHEN YOU NEED TO</p><h2 id="deeper-title">Choose your next question.</h2></div>
<div class="deeper-paths"><div><p class="reading-kicker">BROWSER OPERATIONS / CHAPTER 07</p><h3>What actually ran?</h3><p>Follow ownership, cancellation, and dated execution records in the reader-device lab.</p><a href="../07-operational-receipts.html">Read the operation walkthrough</a></div>
<div><p class="reading-kicker">PYTHON INTEGRATION / CHAPTERS 02 + 08</p><h3>What can a caller rely on?</h3><p>Follow the service contract, then the startup checks that bind a service to its sources.</p><a href="../02-contracts-before-services.html">Read service contracts</a><a href="../08-source-bound-startup.html">Continue to source-bound startup</a></div></div></section>
<section class="guide-evidence-note" aria-label="How to read the evidence"><h2>Keep the evidence in view.</h2>
<p>The notes distinguish fictional teaching examples, controlled tests, and dated model runs. These support different claims. The Python service and browser lab use different runtimes; neither a test count nor a generated citation establishes financial accuracy.</p>
<p>All eight original chapters, technical details, and historical observations remain available. <a href="../journal.html">Browse the complete journal</a>.</p></section>'''
