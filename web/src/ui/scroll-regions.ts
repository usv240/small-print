// Wide tables, formulas and diagrams scroll sideways on small screens. When they actually overflow,
// make them keyboard-reachable regions with a name (WCAG 2.1.1 / axe "scrollable-region-focusable").

const SELECTOR = '.table-wrap, .formula, .arch-wrap';

function label(el: HTMLElement): string {
  const caption = el.querySelector('caption')?.textContent?.trim();
  if (caption) return caption.slice(0, 80);
  const heading = el.closest('section, details, .doc-body')?.querySelector('h2, h3, summary')?.textContent?.trim();
  return heading ? `${heading.slice(0, 70)} (scrollable)` : 'Scrollable content';
}

function update(): void {
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    const overflows = el.scrollWidth > el.clientWidth + 1;
    if (overflows) {
      el.tabIndex = 0;
      el.setAttribute('role', 'region');
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label(el));
    } else if (el.getAttribute('role') === 'region') {
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    }
  });
}

export function initScrollRegions(): void {
  update();
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = window.setTimeout(update, 150); });
  // Collapsed sections only overflow once opened.
  document.addEventListener('toggle', () => update(), true);
}
