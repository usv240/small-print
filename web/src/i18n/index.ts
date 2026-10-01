import { en, type StringKey, type Strings } from './en';
import { es } from './es';
import { fr } from './fr';
import { pt } from './pt';

export type Lang = 'en' | 'es' | 'fr' | 'pt';
export const LANGS: Lang[] = ['en', 'es', 'fr', 'pt'];

const tables: Record<Lang, Partial<Strings>> = { en, es, fr, pt };
let current: Lang = 'en';

export function detectLang(): Lang {
  const saved = localStorage.getItem('small-print.lang') as Lang | null;
  if (saved && LANGS.includes(saved)) return saved;
  const nav = (navigator.language || 'en').slice(0, 2) as Lang;
  return LANGS.includes(nav) ? nav : 'en';
}

export function setLang(lang: Lang): void {
  current = lang;
  localStorage.setItem('small-print.lang', lang);
  document.documentElement.lang = lang;
}

export const getLang = () => current;
export const langName = (lang: Lang) => tables[lang].lang_name ?? en.lang_name;

/** Translated string with {placeholders} filled; falls back to English for anything missing. */
export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  const s = tables[current][key] ?? en[key];
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Format a lens power the way it is printed on readers: +1.50 (with locale decimal separator). */
export function formatPower(d: number): string {
  const s = d.toFixed(2);
  return `+${current === 'en' ? s : s.replace('.', ',')}`;
}
