// Mobile disclosure menu for the site header: one button, aria-expanded, closes on Escape,
// on an outside click and after following a link. Without JavaScript the links simply wrap.

export function initNav(): void {
  const header = document.querySelector<HTMLElement>('.site-header');
  const btn = header?.querySelector<HTMLButtonElement>('.menu-btn');
  if (!header || !btn) return;

  const setOpen = (open: boolean) => {
    header.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
  };

  btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('menu-open')) {
      setOpen(false);
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (header.classList.contains('menu-open') && !header.contains(e.target as Node)) setOpen(false);
  });
  header.querySelectorAll('.site-nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  window.matchMedia('(min-width: 62.0625rem)').addEventListener('change', (m) => {
    if (m.matches) setOpen(false);
  });
}
