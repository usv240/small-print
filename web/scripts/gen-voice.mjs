// Pre-generates the voice guide with Amazon Polly (neural voices) so visitors never trigger a Polly call.
// Every `*_say` string in each language becomes public/audio/<lang>/<key>-<hash>.mp3, where the hash covers
// voice + text, so a changed sentence gets a new file name and caches can never serve a stale clip.
// Writes public/audio/manifest.json ({ lang: { key: file } }), which src/ui/voice.ts imports.
//
// Run from web/:  npx tsx scripts/gen-voice.mjs
// Needs the AWS CLI v2 and a profile allowed to call polly:SynthesizeSpeech (default: small-print-agent).
// Re-runs are cheap: clips that already exist are skipped, and clips no longer referenced are removed.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';
import { fr } from '../src/i18n/fr.ts';
import { pt } from '../src/i18n/pt.ts';

const PROFILE = process.env.POLLY_PROFILE ?? 'small-print-agent';
const REGION = process.env.POLLY_REGION ?? 'us-east-1';
const USD_PER_CHAR = 16 / 1_000_000; // Polly neural pricing

const LANGS = {
  en: { table: en, voice: 'Joanna', code: 'en-US' },
  es: { table: es, voice: 'Lupe', code: 'es-US' },
  fr: { table: fr, voice: 'Lea', code: 'fr-FR' },
  pt: { table: pt, voice: 'Camila', code: 'pt-BR' },
};

const audioDir = resolve(import.meta.dirname, '../public/audio');
const sayKeys = Object.keys(en).filter((k) => k.endsWith('_say'));
const manifest = {};
const rows = [];

for (const [lang, { table, voice, code }] of Object.entries(LANGS)) {
  const dir = resolve(audioDir, lang);
  mkdirSync(dir, { recursive: true });
  manifest[lang] = {};
  const row = { lang, voice, clips: 0, made: 0, chars: 0, billed: 0, bytes: 0, removed: 0, missing: [] };

  for (const key of sayKeys) {
    const text = table[key]?.trim();
    if (!text) {
      row.missing.push(key); // the browser falls back to speech synthesis of the English text
      continue;
    }
    const hash = createHash('sha256').update(`${voice}|${text}`).digest('hex').slice(0, 10);
    const file = `${key}-${hash}.mp3`;
    const out = resolve(dir, file);
    if (!existsSync(out)) {
      const tmp = `${out}.part`; // write-then-rename so a failed call never leaves a "done" file behind
      const meta = execFileSync('aws', [
        'polly', 'synthesize-speech',
        '--engine', 'neural', '--voice-id', voice, '--language-code', code,
        '--output-format', 'mp3', '--sample-rate', '24000',
        '--text', text, tmp,
        '--profile', PROFILE, '--region', REGION,
      ], { encoding: 'utf8' });
      renameSync(tmp, out);
      row.made++;
      row.billed += Number(JSON.parse(meta).RequestCharacters ?? text.length);
    }
    manifest[lang][key] = file;
    row.clips++;
    row.chars += text.length;
    row.bytes += statSync(out).size;
  }

  const keep = new Set(Object.values(manifest[lang]));
  for (const f of readdirSync(dir)) {
    if ((f.endsWith('.mp3') || f.endsWith('.part')) && !keep.has(f)) {
      rmSync(resolve(dir, f));
      row.removed++;
    }
  }
  rows.push(row);
}

writeFileSync(resolve(audioDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
for (const r of rows) {
  console.log(
    `${r.lang} (${r.voice}): ${r.clips} clips, ${r.made} new, ${r.removed} stale removed, ` +
      `${r.chars} chars, ${(r.bytes / 1024).toFixed(0)} KB` + (r.missing.length ? `, missing: ${r.missing.join(' ')}` : ''),
  );
}
const chars = sum('chars');
const billed = sum('billed');
console.log(
  `Total: ${sum('clips')} clips, ${(sum('bytes') / 1024).toFixed(0)} KB. ` +
    `Full set = ${chars} chars (~$${(chars * USD_PER_CHAR).toFixed(4)} one-time); ` +
    `this run synthesized ${sum('made')} clips, ${billed} billed chars (~$${(billed * USD_PER_CHAR).toFixed(4)}).`,
);
