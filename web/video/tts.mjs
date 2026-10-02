// Narration for the demo video: one Amazon Polly (neural) clip per segment, plus word/sentence speech
// marks for the burned-in captions. Cached by text hash so re-runs don't re-bill Polly.
// Usage: node video/tts.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const out = resolve(here, 'tmp/tts');
mkdirSync(out, { recursive: true });
const cfg = JSON.parse(readFileSync(resolve(here, 'narration.json'), 'utf8'));
const manifestPath = resolve(out, 'manifest.json');
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const aws = ['--profile', 'small-print-agent', '--region', 'us-east-1'];

const manifest = { voice: cfg.voice, segments: {} };
let billed = 0;
let total = 0;
for (const seg of cfg.segments) {
  const ssml = cfg.rate === '100%' ? `<speak>${seg.text}</speak>` : `<speak><prosody rate="${cfg.rate}">${seg.text}</prosody></speak>`;
  const plain = seg.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const hash = createHash('sha1').update(cfg.voice + ssml).digest('hex').slice(0, 12);
  const mp3 = resolve(out, `${seg.id}.mp3`);
  const marksFile = resolve(out, `${seg.id}.marks.json`);
  total += plain.length;
  if (old.segments?.[seg.id]?.hash !== hash || !existsSync(mp3) || !existsSync(marksFile)) {
    const base = ['polly', 'synthesize-speech', '--engine', 'neural', '--voice-id', cfg.voice, '--text-type', 'ssml', '--text', ssml, ...aws];
    execFileSync('aws', [...base, '--output-format', 'mp3', '--sample-rate', '24000', mp3], { stdio: 'pipe' });
    execFileSync('aws', [...base, '--speech-mark-types', 'sentence', 'word', '--output-format', 'json', marksFile], { stdio: 'pipe' });
    billed += plain.length * 2;
    console.log(`synthesized ${seg.id} (${plain.length} chars)`);
  }
  const marks = readFileSync(marksFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString().trim());
  // Caption tokens (the plain text, so <sub> shows digits) timed by the speech mark whose SSML offset
  // is at or before the token's own offset in the SSML.
  const words = marks.filter((m) => m.type === 'word');
  const tokens = [];
  {
    let plainIdx = [], inTag = false, buf = '';
    for (let i = 0; i < ssml.length; i++) {
      const ch = ssml[i];
      if (ch === '<') inTag = true;
      if (!inTag) { buf += ch; plainIdx.push(i); }
      if (ch === '>') inTag = false;
    }
    const re = /\S+/g;
    let m;
    while ((m = re.exec(buf))) {
      const at = plainIdx[m.index];
      let t = words.length ? words[0].time / 1000 : 0;
      for (const w of words) if (w.start <= at) t = w.time / 1000;
      tokens.push({ tok: m[0], t });
    }
  }
  manifest.segments[seg.id] = {
    hash, mp3, duration, text: plain, tokens,
    words: marks.filter((m) => m.type === 'word').map((m) => ({ t: m.time / 1000, w: m.value })),
    sentences: marks.filter((m) => m.type === 'sentence').map((m) => ({ t: m.time / 1000, s: m.value })),
  };
  console.log(`${seg.id.padEnd(8)} ${duration.toFixed(2)} s`);
}
manifest.chars = total;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const sum = Object.values(manifest.segments).reduce((a, s) => a + s.duration, 0);
console.log(`narration total ${sum.toFixed(1)} s; ${total} chars of text; billed this run ≈ ${billed} chars (audio + speech marks)`);
