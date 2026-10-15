// Every embedded lab uses the compact workspace; a full-page visit keeps its
// introduction. This changes presentation only, before the stylesheet paints.
(() => {
  'use strict';
  if (window.self !== window.top) {
    document.documentElement.classList.add('embedded-lab');
  }
})();
