// Copies MediaPipe's WebAssembly runtime into public/ so it is served from our own CloudFront,
// not a third-party CDN (the app has to keep working through judging).
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const from = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const to = resolve(root, 'public/mediapipe/wasm');
mkdirSync(to, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(resolve(from, f), resolve(to, f));
}
console.log('MediaPipe wasm copied to public/mediapipe/wasm');
