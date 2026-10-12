// Keep the selected project in one native frame; changing it releases that page.
const stage = document.querySelector('.demo-stage');
const frame = stage?.querySelector('#project-demo');
const fullPage = stage?.querySelector('.demo-fullscreen-link');
const choices = [...(stage?.querySelectorAll('[data-demo-src]') ?? [])];
for (const choice of choices) {
  choice.addEventListener('click', () => {
    const source = new URL(choice.dataset.demoSrc, window.location.href);
    if (source.origin !== window.location.origin || !['http:', 'https:'].includes(source.protocol)) return;
    if (frame.src === source.href) return;
    frame.src = source.href;
    frame.title = `${choice.dataset.demoTitle} browser lab`;
    fullPage.href = source.href;
    for (const item of choices) item.setAttribute('aria-pressed', String(item === choice));
  });
}
