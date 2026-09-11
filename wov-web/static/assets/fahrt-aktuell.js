/*
 * Ein geöffneter Tab kann seine bereits geladenen Svelte-Routen nicht durch
 * einen Server-Deploy vergessen. Der Fahrt-Klick muss deshalb den Browser
 * selbst navigieren lassen und erhält eine Standkennung gegen HTML-Caches.
 */
(() => {
  const STAND = '20260911-brauen';
  const SELECTOR = 'a.nav-play, a.mobil-fahrt, a.gate-play';
  const EDITOR_PATHS = new Set(['/de/erstellen', '/en/create']);

  function editorUrl(link) {
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || !EDITOR_PATHS.has(url.pathname)) return null;
    url.searchParams.set('stand', STAND);
    return url;
  }

  function aktualisieren() {
    for (const link of document.querySelectorAll(SELECTOR)) {
      const url = editorUrl(link);
      if (!url) continue;
      const href = `${url.pathname}${url.search}${url.hash}`;
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
      if (!link.hasAttribute('data-sveltekit-reload')) link.setAttribute('data-sveltekit-reload', '');
    }
  }

  window.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest(SELECTOR);
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download')) return;

      const url = editorUrl(link);
      if (!url) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(url.href);
    },
    true,
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aktualisieren, { once: true });
  } else {
    aktualisieren();
  }

  // Die Hydration eines alten, bereits ausgelieferten Seitenmoduls kann den
  // href nach DOMContentLoaded noch einmal zurücksetzen. Danach stellt der
  // Beobachter ihn sofort wieder her — wichtig auch für Strg-/Mittelklick.
  new MutationObserver(aktualisieren).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['href'],
  });
})();
