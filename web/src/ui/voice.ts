// Voice guide. Clips are generated ahead of time with Amazon Polly (scripts/gen-voice.mjs) and served
// from /audio/<lang>/<key>.mp3, so there is no per-visit cost and it works on slow connections.
// If a clip is missing, the browser's own speech synthesis reads the text instead.

import type { StringKey } from '../i18n/en';
import { getLang, t } from '../i18n';
import manifest from '../../public/audio/manifest.json';

let enabled = localStorage.getItem('small-print.voice') !== 'off';
let player: HTMLAudioElement | null = null;

export const voiceEnabled = () => enabled;

export function setVoice(on: boolean): void {
  enabled = on;
  localStorage.setItem('small-print.voice', on ? 'on' : 'off');
  if (!on) stopVoice();
}

export function stopVoice(): void {
  player?.pause();
  player = null;
  window.speechSynthesis?.cancel();
}

export function say(key: StringKey): void {
  if (!enabled) return;
  stopVoice();
  const lang = getLang();
  const file = (manifest as Record<string, Record<string, string>>)[lang]?.[key];
  if (file) {
    player = new Audio(`/audio/${lang}/${file}`);
    player.play().catch(() => speakFallback(key));
    return;
  }
  speakFallback(key);
}

function speakFallback(key: StringKey): void {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(t(key));
  u.lang = { en: 'en-US', es: 'es-US', fr: 'fr-FR', pt: 'pt-BR' }[getLang()];
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}
