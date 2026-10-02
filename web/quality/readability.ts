// Readability of the in-app text (src/i18n/*.ts) and of the landing page (index.html <main>).
// No dependency: syllables are counted with rule-based heuristics (about ±10% per word against
// dictionaries in English; vowel-nucleus rules with diphthong/hiatus handling in es/pt; silent final -e/-es in fr).
//
// Formulas
//   English    Flesch reading ease 206.835 − 1.015·(words/sentence) − 84.6·(syllables/word)
//              Flesch–Kincaid grade 0.39·(words/sentence) + 11.8·(syllables/word) − 15.59
//   Spanish    Fernández-Huerta (1959) as corrected by Law (2011): 206.84 − 0.60·P − 1.02·F,
//              P = syllables per 100 words, F = words per sentence (the often-quoted "sentences per
//              100 words" version is the transcription error Law identified: it rates shorter sentences as harder)
//   French     Kandel & Moles (1958): 207 − 1.015·(words/sentence) − 73.6·(syllables/word)
//   Portuguese Martins et al. (1996): 248.835 − 1.015·(words/sentence) − 84.6·(syllables/word)
// All four are "ease" scores on roughly the same 0–100 scale (higher = easier; 80–90 ≈ 6th grade /
// "easy", 60–70 ≈ plain English). Only English gets a grade level.
//
// Groups: core = on-screen strings except info_* (buttons, headings, prompts, results);
//         voice = *_say strings spoken by the voice guide; explanations = info_* "What is this?" panels.
// Per-string scores are only meaningful for real sentences, so the medians use strings of ≥ 5 words;
// shorter labels ("Continue", "Blurry") are counted but not scored one by one. Group totals score the
// concatenated text (each string at least one sentence).
//
//   npx tsx quality/readability.ts      → quality/results/readability.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { fr } from '../src/i18n/fr';
import { pt } from '../src/i18n/pt';

type Lang = 'en' | 'es' | 'fr' | 'pt';
const root = resolve(import.meta.dirname, '..');

// Placeholder stand-ins, read the way the app fills them.
const FILL: Record<string, string> = { n: '2', total: '8', cm: '38', age: '57', a: '+2.00', b: '+2.25', s: '+2.00', near: '25 cm', far: '60 cm', wd: '38 cm' };

function clean(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\{(\w+)\}/g, (_, k: string) => FILL[k] ?? '2').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function words(text: string): string[] {
  return text.split(/[\s—–/]+/).map((w) => w.replace(/^[^\p{L}\p{N}+]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

function sentences(text: string): number {
  const n = text.split(/[.!?…]+(?=\s|$)|\s·\s/).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  return Math.max(1, n);
}

// ---------- syllables ----------
function sylEn(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return /\d/.test(word) ? 2 : 1; // numbers ("38", "+2.00") ≈ two syllables
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  let n = groups ? groups.length : 1;
  if (/[^aeiouy]le$/.test(word.toLowerCase())) n++; // "simple", "table"
  return Math.max(1, n);
}

const STRONG_ES = 'aeoáéóàèòâêôãõ';
const ACCENTED_WEAK = 'íúìùïü';
const VOWELS_ES = 'aeiouáéíóúàèìòùâêôãõïü';
function sylIberian(word: string): number {
  let w = word.toLowerCase().replace(/[^a-záéíóúàèìòùâêôãõïüçñ]/g, '');
  if (!w) return /\d/.test(word) ? 2 : 1;
  w = w.replace(/qu(?=[eiéí])/g, 'q').replace(/gu(?=[eiéí])/g, 'g'); // silent u
  let n = 0;
  let prev = '';
  for (const c of w) {
    if (VOWELS_ES.includes(c)) {
      if (!prev) n++;
      else {
        const hiatus = (STRONG_ES.includes(prev) && STRONG_ES.includes(c)) || ACCENTED_WEAK.includes(prev) || ACCENTED_WEAK.includes(c);
        if (hiatus) n++;
      }
      prev = c;
    } else prev = '';
  }
  return Math.max(1, n);
}

const VOWELS_FR = 'aeiouyàâäéèêëîïôöùûüœæ';
function sylFr(word: string): number {
  const w = word.toLowerCase().replace(/[^a-zàâäéèêëîïôöùûüœæç]/g, '');
  if (!w) return /\d/.test(word) ? 2 : 1;
  let n = 0;
  let inV = false;
  for (const c of w) {
    const v = VOWELS_FR.includes(c);
    if (v && !inV) n++;
    inV = v;
  }
  if (n > 1 && /[^aeiouyéè]es?$/.test(w)) n--; // silent final -e / -es
  if (n > 1 && /[^aeiouy]ent$/.test(w) && w.length > 5 && !/(ment|dent|tent|vent|cent|lent|gent)$/.test(w)) n--; // verb -ent
  return Math.max(1, n);
}

const SYL: Record<Lang, (w: string) => number> = { en: sylEn, es: sylIberian, pt: sylIberian, fr: sylFr };

// ---------- scores ----------
interface Score { words: number; sentences: number; syllables: number; ease: number; grade: number | null }
function score(text: string, lang: Lang, minSentences = 1): Score {
  const ws = words(text);
  const S = Math.max(minSentences, sentences(text));
  const syl = ws.reduce((a, w) => a + SYL[lang](w), 0);
  const W = Math.max(1, ws.length);
  const wps = W / S, spw = syl / W;
  const ease = lang === 'en' ? 206.835 - 1.015 * wps - 84.6 * spw
    : lang === 'es' ? 206.84 - 0.6 * (100 * spw) - 1.02 * wps
      : lang === 'fr' ? 207 - 1.015 * wps - 73.6 * spw
        : 248.835 - 1.015 * wps - 84.6 * spw;
  return { words: ws.length, sentences: S, syllables: syl, ease: round(ease), grade: lang === 'en' ? round(0.39 * wps + 11.8 * spw - 15.59) : null };
}
const round = (x: number) => Math.round(x * 10) / 10;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : round((s[m - 1] + s[m]) / 2); };

type Group = 'core' | 'voice' | 'explanations';
const groupOf = (k: string): Group | null => (k === 'lang_name' ? null : k.startsWith('info_') ? 'explanations' : k.endsWith('_say') ? 'voice' : 'core');

function analyse(table: Record<string, string>, lang: Lang) {
  const out: Record<Group, { strings: number; scored: number; medianEase: number | null; medianGrade: number | null; total: Score; items: { key: string; text: string; s: Score }[] }> = {} as never;
  for (const g of ['core', 'voice', 'explanations'] as Group[]) {
    const entries = Object.entries(table).filter(([k, v]) => groupOf(k) === g && typeof v === 'string' && v.trim());
    const texts = entries.map(([k, v]) => ({ key: k, text: clean(v) }));
    const items = texts.map(({ key, text }) => ({ key, text, s: score(text, lang) }));
    const scored = items.filter((i) => i.s.words >= 5);
    // Group total: concatenated, each string ending a sentence.
    const total = score(texts.map((t) => t.text.replace(/[.!?…]*$/, '.')).join(' '), lang);
    out[g] = {
      strings: items.length, scored: scored.length,
      medianEase: scored.length ? median(scored.map((i) => i.s.ease)) : null,
      medianGrade: lang === 'en' && scored.length ? median(scored.map((i) => i.s.grade!)) : null,
      total, items,
    };
  }
  return out;
}

function landingText(): string {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const main = html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? html;
  return main
    .replace(/<(script|style|svg|figure|nav|video)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<\/(p|li|h[1-6]|dt|dd|td|th|figcaption|blockquote|div)>/g, '. ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s*\.\s*(\.\s*)+/g, '. ').replace(/\s+/g, ' ').trim();
}

const tables: Record<Lang, Record<string, string>> = { en, es, fr, pt } as never;
const langs: Record<string, unknown> = {};
for (const lang of ['en', 'es', 'fr', 'pt'] as Lang[]) {
  const a = analyse(tables[lang], lang);
  langs[lang] = Object.fromEntries(Object.entries(a).map(([g, v]) => [g, { strings: v.strings, scoredStrings: v.scored, medianEase: v.medianEase, medianGrade: v.medianGrade, total: v.total }]));
}

// Suggested plainer wording for the hardest strings (NOT applied to the app; scored the same way).
const REWRITES: Record<string, string> = {
  stop_h: 'Please get your eyes checked',
  result_refer_h: 'Please get your eyes checked',
  result_why_age: 'At your age, most people need about {a} to read at this distance.',
  result_eyeage_out: 'Just for fun: your eyes focus up close like most people over 55.',
  result_refer_p: 'Shop reading glasses only go up to +3.00. You may need more, so get your eyes checked first.',
  result_inconsistent: 'Your test and your age do not agree. Try the glasses in the shop with the try-on check.',
  camp_link: 'Testing lots of people, at a clinic, shop or work? Use camp mode',
  result_note: 'This is a good first pair to try. It is not a prescription. If reading is still hard, get your eyes checked.',
  footer_privacy: 'Your video stays on your phone. We keep only results with no name on them.',
  q_glaucoma: 'Has anyone in your family had glaucoma? (It is an eye disease.)',
  q_sudden: 'Did your eyesight get worse all of a sudden?',
  working_p: 'Hold the phone where you like to read. Do not hold it far away to see better. Keep still for two seconds.',
};

const enA = analyse(tables.en, 'en');
const hardest = [...enA.core.items, ...enA.voice.items].filter((i) => i.s.words >= 5)
  .sort((x, y) => y.s.grade! - x.s.grade!).slice(0, 10)
  .map((i) => {
    const r = REWRITES[i.key];
    const rs = r ? score(clean(r), 'en') : null;
    return { key: i.key, text: i.text, grade: i.s.grade, ease: i.s.ease, words: i.s.words,
      suggested: r ? clean(r) : null, suggestedGrade: rs?.grade ?? null, suggestedEase: rs?.ease ?? null };
  });
const hardestExplanations = enA.explanations.items.sort((x, y) => y.s.grade! - x.s.grade!).slice(0, 3)
  .map((i) => ({ key: i.key, grade: i.s.grade, ease: i.s.ease, words: i.s.words }));
const landing = landingText();
const landingScore = score(landing, 'en');

const result = {
  at: new Date().toISOString(),
  method: 'Own implementation (quality/readability.ts). EN: Flesch reading ease + Flesch–Kincaid grade; ES: Fernández-Huerta; FR: Kandel–Moles; PT: Martins et al. 1996. Rule-based syllable counts. Medians over strings of ≥5 words; totals over the concatenated group.',
  languages: langs,
  landingPage: { file: 'index.html <main>', ...landingScore },
  hardestCoreStringsEn: hardest,
  hardestExplanationsEn: hardestExplanations,
};
mkdirSync(resolve(root, 'quality/results'), { recursive: true });
writeFileSync(resolve(root, 'quality/results/readability.json'), JSON.stringify(result, null, 2));

for (const [lang, g] of Object.entries(langs)) console.log(lang, JSON.stringify(g));
console.log('landing', JSON.stringify(landingScore));
console.log('hardest:');
for (const h of hardest) console.log(`  ${h.grade}\t${h.ease}\t${h.key}: ${h.text}`);
console.log('hardest explanations:', JSON.stringify(hardestExplanations));
