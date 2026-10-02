// "On this page" table of contents: open as a side rail on wide screens, highlight the section
// being read, and offer "Show all details" / "Hide all details" for the page's collapsed sections.

const WIDE = '(min-width: 68.75rem)';

export function initToc(): void {
  const box = document.querySelector<HTMLDetailsElement>('.toc-box');
  if (!box) return;

  // Wide screens: the rail is always open (CSS ::details-content does this too; this is the fallback).
  const wide = window.matchMedia(WIDE);
  if (wide.matches) box.open = true;
  wide.addEventListener('change', (m) => {
    if (m.matches) box.open = true;
  });

  // Expand / collapse all details.more on the page.
  const all = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.more'));
  if (all.length) {
    const tools = document.createElement('div');
    tools.className = 'toc-tools';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    const sync = () => {
      const anyClosed = all.some((d) => !d.open);
      toggle.textContent = anyClosed ? 'Show all details' : 'Hide all details';
    };
    toggle.addEventListener('click', () => {
      const open = all.some((d) => !d.open);
      all.forEach((d) => (d.open = open));
      sync();
    });
    all.forEach((d) => d.addEventListener('toggle', sync));
    const top = document.createElement('a');
    top.href = '#top';
    top.textContent = 'Back to top';
    top.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0 });
      history.replaceState(null, '', location.pathname + location.search);
    });
    sync();
    tools.append(toggle, top);
    box.append(tools);
  }

  // Scroll-spy: mark the link for the section currently under the header.
  const links = Array.from(box.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
  const targets = links
    .map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
    .filter((t): t is HTMLElement => !!t);
  if (!targets.length || !('IntersectionObserver' in window)) return;
  const visible = new Set<HTMLElement>();
  const mark = () => {
    const first = targets.find((t) => visible.has(t)) ?? null;
    let current = first;
    if (!current) {
      // Between headings: the last heading above the viewport top.
      const above = targets.filter((t) => t.getBoundingClientRect().top < 120);
      current = above[above.length - 1] ?? null;
    }
    links.forEach((a) => {
      const on = !!current && a.hash.slice(1) === current.id;
      a.classList.toggle('is-current', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  };
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target as HTMLElement) : visible.delete(e.target as HTMLElement)));
      mark();
    },
    { rootMargin: '-72px 0px -55% 0px' },
  );
  targets.forEach((t) => io.observe(t));
}
