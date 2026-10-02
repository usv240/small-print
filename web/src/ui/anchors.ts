// Deep links into collapsed content: if the URL hash points at (or inside) a closed <details>,
// open it and scroll to the target. Runs on load, on hashchange, and when a link to the current
// hash is clicked again. Also opens every <details> before printing.

function reveal(hash: string): void {
  if (hash.length < 2) return;
  let target: HTMLElement | null = null;
  try {
    target = document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return;
  }
  if (!target) return;
  let opened = false;
  if (target instanceof HTMLDetailsElement && !target.open) {
    target.open = true;
    opened = true;
  }
  for (let d = target.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
    if (!d.open) {
      d.open = true;
      opened = true;
    }
  }
  if (opened) requestAnimationFrame(() => target!.scrollIntoView({ block: 'start', behavior: 'instant' }));
}

export function initAnchors(): void {
  reveal(location.hash);
  window.addEventListener('hashchange', () => reveal(location.hash));
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    if (a && a.getAttribute('href') === location.hash) reveal(location.hash);
  });
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll<HTMLDetailsElement>('details.more').forEach((d) => (d.open = true));
  });
}
