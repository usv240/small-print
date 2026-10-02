// Light/dark theme toggle. Light is the default; the choice is remembered in localStorage.
// The inline <head> script on every page applies a stored choice before first paint (no flash).

export const THEME_KEY = 'small-print.theme';
type Theme = 'light' | 'dark';

const root = document.documentElement;
const current = (): Theme => (root.dataset.theme === 'dark' ? 'dark' : 'light');

function label(theme: Theme): string {
  return theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function sync(): void {
  const theme = current();
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((b) => {
    b.setAttribute('aria-label', label(theme));
    b.title = label(theme);
  });
}

function set(theme: Theme): void {
  root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or storage disabled: the theme still applies for this page.
  }
  sync();
}

export function initTheme(): void {
  sync();
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('[data-theme-toggle]');
    if (btn) set(current() === 'dark' ? 'light' : 'dark');
  });
  // Keep other open tabs in step.
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
      root.dataset.theme = e.newValue;
      sync();
    }
  });
}
