// Open a promised notebook view without replacing the session or running work.
const targets = new Set(['computation-notebook', 'notebook-source', 'notebook-chunks',
  'notebook-vectors', 'notebook-retrieval', 'notebook-context', 'notebook-records']);

export function installNotebookNavigation(document, window) {
  function reveal(hash) {
    let identifier;
    try { identifier = decodeURIComponent(hash.slice(1)); } catch { return; }
    if (!targets.has(identifier)) return;
    const target = document.getElementById(identifier);
    const notebook = document.getElementById('computation-notebook');
    if (!target || !notebook || !notebook.contains(target)) return;
    for (let node = target; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
      if (node === notebook) break;
    }
    const destination = target === notebook ? notebook.querySelector('summary') : target;
    destination?.focus({preventScroll: true});
    target.scrollIntoView({block: 'start', behavior: 'instant'});
  }
  function click(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.hasAttribute('download') ||
        (link.target && link.target !== '_self')) return;
    let url;
    try { url = new URL(link.href, window.location.href); } catch { return; }
    const current = new URL(window.location.href);
    if (url.origin !== current.origin || url.pathname !== current.pathname ||
        url.search !== current.search) return;
    reveal(url.hash);
    // Native anchor navigation keeps URL/history and works when JavaScript is off.
  }
  function hashchange() { reveal(window.location.hash); }
  document.addEventListener('click', click);
  window.addEventListener('hashchange', hashchange);
  hashchange();
  return () => {
    document.removeEventListener('click', click);
    window.removeEventListener('hashchange', hashchange);
  };
}
