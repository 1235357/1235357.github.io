// Keep the selected project in one native frame; changing it releases that page.
const stage = document.querySelector('.demo-stage');
const frame = stage?.querySelector('#project-demo');
const fullPage = stage?.querySelector('.demo-fullscreen-link');
const choices = [...(stage?.querySelectorAll('[data-demo-src]') ?? [])];
const expand = stage?.querySelector('.demo-expand-button');
const expandStatus = stage?.querySelector('.demo-expand-status');
// Expand the existing document, so its PDF, workers and accepted records stay
// in the same session. Browser Escape and this button both exit fullscreen.
if (expand && typeof stage.requestFullscreen === 'function' && document.fullscreenEnabled) {
  expand.hidden = false;
  let pending = false;
  const updateExpansion = () => {
    const expanded = document.fullscreenElement === stage;
    expand.textContent = expanded ? 'Exit expanded workspace' : 'Expand workspace';
    expand.setAttribute('aria-expanded', String(expanded));
  };
  document.addEventListener('fullscreenchange', updateExpansion);
  expand.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    expandStatus.textContent = '';
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      expandStatus.textContent = 'This browser could not expand the workspace. Use Open in a full page.';
    } finally {
      pending = false;
      updateExpansion();
    }
  });
  updateExpansion();
}
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
