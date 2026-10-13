"""Public personal homepage; authored copy is separate from the static builder."""
from html import escape


def render_home(profile, *, public_release=False, stylesheet_href='style.css', demo_script_href='portfolio-demo.mjs'):
    def text(value):
        return escape(value, quote=True)

    def links(items):
        return ''.join(f'<a href="{text(item["href"])}">{text(item["label"])} ↗</a>'
                       for item in items)

    def project_card(project, number):
        contributions = ''.join(f'<p>{text(item)}</p>' for item in project['details'])
        stack = ''.join(f'<span>{text(item)}</span>' for item in project['stack'])
        visible_links = project.get('featured_links', project['links'])
        resources = [item for item in project['links'] if item not in visible_links]
        return f'''<article class="portfolio-project" id="{text(project['id'])}">
<div class="project-heading"><span class="project-number">{number:02d}</span><p class="eyebrow">{text(project['category'])}</p></div>
<div class="project-copy"><h3>{text(project['title'])}</h3>
<p class="project-summary">{text(project.get('summary', project['description']))}</p>
<p class="project-phase">{text(project['phase'])}</p>
<div class="project-links">{links(visible_links)}</div>
<details class="contribution-record"><summary>Contributions &amp; current scope</summary>
<p class="project-role">{text(project['role'])}<br>{text(project['period'])}</p>
<p>{text(project['description'])}</p>{contributions}
<div class="technology-list" aria-label="Project technologies">{stack}</div>
<div class="project-resources">{links(resources)}</div></details></div></article>'''

    by_id = {project['id']: project for project in profile['projects']}
    selected_ids = profile.get('selected_projects', list(by_id)[:3])
    selected = [by_id[identifier] for identifier in selected_ids]
    more = [project for project in profile['projects'] if project['id'] not in selected_ids]
    selected_cards = ''.join(project_card(project, number) for number, project in enumerate(selected, 1))
    more_cards = ''.join(project_card(project, number) for number, project in enumerate(more, len(selected) + 1))
    more_projects = f'''<details class="more-projects"><summary>Explore {len(more)} more projects <span>Agents, product interfaces &amp; industry collaboration</span></summary>
<div class="project-list more-project-list">{more_cards}</div></details>''' if more else ''
    education = ''.join(f'''<article><p class="eyebrow">{text(item['period'])}</p>
<h3>{text(item['school'])}</h3><p>{text(item['degree'])}</p>
<details class="academic-record"><summary>Coursework &amp; academic details</summary><p class="secondary">{text(item['detail'])}</p></details></article>'''
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
<nav aria-label="Main navigation"><a href="#projects">Work</a><a href="#background">Background</a><a href="journal.html">Journal</a><a href="{text(portrait['profile'])}">LinkedIn ↗</a></nav></header>
<main class="portfolio-main" id="main-content">
<section class="personal-hero" aria-labelledby="personal-title">
<div><p class="eyebrow">NORTHWESTERN MSCS / {text(profile['location']).upper()}</p>
<h1 id="personal-title">Zhentong<br><span>(Tony) Ye.</span></h1><p class="hero-intro">{text(profile['intro'])}</p>
<p class="availability">{text(profile['availability'])}</p>
<div class="hero-actions"><a class="primary-link" href="#projects">Explore my work <span>↓</span></a><a href="#demo">Try the RAG lab ↓</a></div></div>
<figure class="portrait-card"><a href="{text(portrait['profile'])}" aria-label="Visit Zhentong Ye on LinkedIn">
<img src="{text(portrait['src'])}" width="800" height="800" alt="Zhentong Ye" referrerpolicy="no-referrer" decoding="async"></a>
<figcaption><span>Zhentong / Evanston</span><a href="{text(portrait['profile'])}">LinkedIn ↗</a></figcaption></figure></section>
<section id="projects" class="portfolio-section selected-work" aria-labelledby="projects-title"><div class="section-heading"><p class="eyebrow">SELECTED WORK</p><h2 id="projects-title">Projects &amp; research</h2><p>Three projects to start with. Open a contribution record for the details.</p></div><div class="project-list selected-project-list">{selected_cards}</div>{more_projects}</section>
<section id="background" class="portfolio-section background-section" aria-labelledby="background-title"><div class="section-heading"><p class="eyebrow">BACKGROUND</p><h2 id="background-title">Education &amp; practice</h2></div><div class="education-grid">{education}</div>
<details class="background-more"><summary>Engineering toolkit <span>Models, interfaces &amp; evaluation</span></summary><div class="skills-grid">{skills}</div>
<p class="course-bridge">My RAG journal connects this work to language-model computation, agent workflows, scalable service boundaries and software design. Course connections describe what I am studying and applying as I build.</p></details></section>
<section class="demo-stage" id="demo" aria-labelledby="demo-title"><div class="demo-stage-head"><div><p class="eyebrow">TRY THE PROJECT</p><h2 id="demo-title">Financial RAG workspace</h2></div><p>Your PDF, processed on your device. Open the notebook to inspect each step.</p></div>
<div class="demo-tabs" role="group" aria-label="Project workspace">{demo_choices}<button class="demo-expand-button" type="button" aria-controls="project-demo" aria-expanded="false" hidden>Expand workspace</button><a class="demo-fullscreen-link" href="{text(demos[0]['src'])}" target="_blank" rel="noopener">Open in a full page ↗</a><p class="demo-expand-status" role="status" aria-live="polite"></p></div>
<div class="demo-frame-shell"><iframe id="project-demo" title="{text(demos[0]['title'])} browser lab" src="{text(demos[0]['src'])}" loading="lazy" allow="webgpu; fullscreen"></iframe></div>
<p class="demo-stage-note">Start with your own PDF. Model downloads begin only when you choose a preparation action inside the lab; generated answers remain drafts to check against the source.</p></section>
</main><footer class="portfolio-footer">© 2026 Zhentong Ye · <a href="https://github.com/1235357/1235357.github.io">Website source</a> · <a href="{text(portrait['profile'])}">LinkedIn</a>{license_link}<span>Learning in public. Building with evidence.</span></footer><script type="module" src="{text(demo_script_href)}"></script></body></html>'''
