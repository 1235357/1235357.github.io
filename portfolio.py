"""Public personal homepage; authored copy is separate from the static builder."""
from html import escape


def render_home(profile, *, public_release=False, stylesheet_href='style.css'):
    def text(value):
        return escape(value, quote=True)

    def links(items):
        return ''.join(f'<a href="{text(item["href"])}">{text(item["label"])} ↗</a>'
                       for item in items)

    projects = []
    for number, project in enumerate(profile['projects'], 1):
        contributions = ''.join(f'<p>{text(item)}</p>' for item in project['details'])
        stack = ''.join(f'<span>{text(item)}</span>' for item in project['stack'])
        projects.append(f'''<article class="portfolio-project" id="{text(project['id'])}">
<div class="project-number">{number:02d}</div><div class="project-copy">
<p class="eyebrow">{text(project['category'])}</p><h3>{text(project['title'])}</h3>
<p class="project-role">{text(project['role'])}<br>{text(project['period'])}</p>
<p>{text(project['description'])}</p><p class="project-phase">{text(project['phase'])}</p>
<div class="technology-list" aria-label="Project technologies">{stack}</div>
<details><summary>Contributions &amp; current scope</summary>{contributions}</details>
<div class="project-links">{links(project['links'])}</div></div></article>''')
    education = ''.join(f'''<article><p class="eyebrow">{text(item['period'])}</p>
<h3>{text(item['school'])}</h3><p>{text(item['degree'])}</p><p class="secondary">{text(item['detail'])}</p></article>'''
                        for item in profile['education'])
    skills = ''.join(f'<article><h3>{text(item["title"])}</h3><p>{text(item["text"])}</p></article>'
                     for item in profile['skills'])
    label = 'PERSONAL PORTFOLIO' if public_release else 'LOCAL REVIEW'
    license_link = ' · <a href="SITE-LICENSE.txt">Site license</a>' if public_release else ''
    portrait = profile['portrait']
    demos = profile['demos']
    demo_choices = ''.join(f'<button type="button" data-demo-src="{text(item["src"])}" '
        f'data-demo-title="{text(item["title"])}" aria-pressed="{"true" if number == 0 else "false"}" '
        f'aria-controls="project-demo">{text(item["title"])}</button>'
        for number, item in enumerate(demos))
    if len(demos) == 1:
        demo_choices = f'<span class="demo-product-label">{text(demos[0]["title"])}</span>'
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light"><meta name="theme-color" content="#f7f8fa">
<title>{text(profile['name'])} — AI projects &amp; engineering</title>
<meta name="description" content="Northwestern MSCS student. AI engineering, multimodal research, interactive financial RAG and a continuing project journal.">
<link rel="stylesheet" href="{text(stylesheet_href)}"></head><body class="portfolio-page">
<a class="skip-link" href="#main-content">Skip to content</a>
<header class="portfolio-header"><a class="wordmark" href="index.html">ZHENTONG YE <span>/ {label}</span></a>
<nav aria-label="Main navigation"><a href="#projects">Projects</a><a href="#background">Background</a><a href="journal.html">Journal</a><a href="#demo">Live demo</a><a href="{text(portrait['profile'])}">LinkedIn ↗</a></nav></header>
<main class="portfolio-main" id="main-content">
<section class="personal-hero" aria-labelledby="personal-title">
<div><p class="eyebrow">NORTHWESTERN MSCS / {text(profile['location']).upper()}</p>
<h1 id="personal-title">Zhentong<br><span>(Tony) Ye.</span></h1><p class="hero-intro">{text(profile['intro'])}</p>
<p class="availability">{text(profile['availability'])}</p>
<div class="hero-actions"><a class="primary-link" href="#projects">Explore my work <span>↓</span></a><a href="#demo">Try the live project ↓</a></div></div>
<figure class="portrait-card"><a href="{text(portrait['profile'])}" aria-label="Visit Zhentong Ye on LinkedIn">
<img src="{text(portrait['src'])}" width="800" height="800" alt="Zhentong Ye" referrerpolicy="no-referrer" decoding="async"></a>
<figcaption><span>Zhentong / Evanston</span><a href="{text(portrait['profile'])}">LinkedIn ↗</a></figcaption></figure></section>
<section class="lab-feature" aria-labelledby="lab-title"><div><p class="eyebrow">EXPERIENCE THE PROJECT</p><h2 id="lab-title">A document.<br>A question.<br>The evidence in between.</h2>
<p>Bring a local PDF to the financial RAG browser lab. Follow the computation from extracted pages to an answer draft, with intermediate results you can open and inspect.</p>
<div class="hero-actions"><a class="primary-link" href="#demo">Try it below ↓</a><a href="01-two-lifecycles.html">Start with the walkthrough ↗</a></div></div>
<div class="pipeline-preview" aria-label="Browser lab computation stages"><ol><li>PDF pages <small>text &amp; coordinates</small></li><li>Chunks <small>tokens &amp; source spans</small></li><li>Vectors <small>query &amp; document similarity</small></li><li>Context <small>selected evidence</small></li><li>Draft answer <small>model output &amp; citation checks</small></li></ol><p>Runs on your device. Native model drafts still need financial evaluation.</p></div></section>
<section id="projects" class="portfolio-section" aria-labelledby="projects-title"><div class="section-heading"><p class="eyebrow">SELECTED WORK</p><h2 id="projects-title">Projects &amp; research</h2><p>Implementation, experiments and ongoing designs. Open each contribution record for the scope of my work.</p></div><div class="project-list">{''.join(projects)}</div></section>
<section class="portfolio-section" aria-labelledby="skills-title"><div class="section-heading"><p class="eyebrow">TOOLS IN MY PROJECTS</p><h2 id="skills-title">Engineering toolkit</h2></div><div class="skills-grid">{skills}</div></section>
<section id="background" class="portfolio-section" aria-labelledby="background-title"><div class="section-heading"><p class="eyebrow">BACKGROUND / CONTINUING STUDY</p><h2 id="background-title">Education into practice</h2></div><div class="education-grid">{education}</div>
<p class="course-bridge">My RAG journal connects this work to language-model computation, agent workflows, scalable service boundaries and software design. Course connections describe what I am studying and applying as I build.</p></section>
<section class="journal-feature" aria-labelledby="journal-title"><p class="eyebrow">THE CONTINUING RECORD</p><h2 id="journal-title">Engineering notes,<br>one decision at a time.</h2><p>Walk through the project from first principles, then follow the debugging, architecture changes and evaluation questions. Figures, examples and expandable computation records keep the details available as you read.</p><div class="hero-actions"><a class="primary-link" href="journal.html">Read the RAG series ↗</a><a href="07-operational-receipts.html">Latest chapter: execution contracts ↗</a></div></section>
<section class="demo-stage" id="demo" aria-labelledby="demo-title"><div class="demo-stage-head"><div><p class="eyebrow">THE LIVE WORKBENCH</p><h2 id="demo-title">The project,<br>in your hands.</h2></div><p>Choose a PDF and follow the evidence from source pages to an answer draft. The complete project runs here, on your device.</p></div>
<div class="demo-tabs" role="group" aria-label="Project workspace">{demo_choices}<button class="demo-expand-button" type="button" aria-controls="project-demo" aria-expanded="false" hidden>Expand workspace</button><a class="demo-fullscreen-link" href="{text(demos[0]['src'])}" target="_blank" rel="noopener">Open in a full page ↗</a><p class="demo-expand-status" role="status" aria-live="polite"></p></div>
<div class="demo-frame-shell"><iframe id="project-demo" title="{text(demos[0]['title'])} browser lab" src="{text(demos[0]['src'])}" loading="lazy" allow="webgpu; fullscreen"></iframe></div>
<p class="demo-stage-note">Start with your own PDF. Model downloads begin only when you choose a preparation action inside the lab; generated answers remain drafts to check against the source.</p></section>
</main><footer class="portfolio-footer">© 2026 Zhentong Ye · <a href="https://github.com/1235357/1235357.github.io">Website source</a> · <a href="{text(portrait['profile'])}">LinkedIn</a>{license_link}<span>Learning in public. Building with evidence.</span></footer><script type="module" src="portfolio-demo.mjs"></script></body></html>'''
