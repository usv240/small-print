// A looping WebM of MediaPipe's test portrait (same 640×480 crop as e2e/fake-camera.ts), for engines
// whose Playwright builds have no fake-webcam flags and, on Windows WebKit, no MediaStream at all.
// Encoded with the ffmpeg that Playwright ships for video recording (mjpeg in → VP8 out), written to
// the OS temp folder so nothing derived from the portrait lands in the repo.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PORTRAIT_JPG } from './fake-camera';

export const PORTRAIT_WEBM = join(tmpdir(), 'small-print-portrait-640x480.webm');

function playwrightFfmpeg(): string | null {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? (platform() === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
      : platform() === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright') : join(homedir(), '.cache/ms-playwright'));
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse()) {
    for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) {
      if (existsSync(join(root, dir, exe))) return join(root, dir, exe);
    }
  }
  return null;
}

/** Returns the path of the WebM (building it on first use), or null if Playwright's ffmpeg isn't installed. */
export async function portraitWebm(): Promise<string | null> {
  if (existsSync(PORTRAIT_WEBM)) return PORTRAIT_WEBM;
  const ffmpeg = playwrightFfmpeg();
  if (!ffmpeg) return null;
  const jpg = readFileSync(PORTRAIT_JPG);
  await new Promise<void>((done, fail) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-vf', 'crop=640:480:80:0', '-c:v', 'vp8', '-b:v', '2M', '-y', PORTRAIT_WEBM]);
    p.on('error', fail);
    p.on('exit', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
    for (let i = 0; i < 60; i++) p.stdin.write(jpg); // 2 s at 30 fps; the page loops it
    p.stdin.end();
  });
  return PORTRAIT_WEBM;
}
