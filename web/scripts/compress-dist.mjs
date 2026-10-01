// Brotli-compresses the large WebAssembly runtime in dist/ in place. CloudFront only compresses files
// up to 10 MB, and the MediaPipe runtime is ~11 MB, so without this every visitor would download it
// uncompressed. The files are uploaded with Content-Encoding: br (see infra/lib/site-stack.ts).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const dir = resolve(import.meta.dirname, '../dist/mediapipe/wasm');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.wasm'))) {
  const path = resolve(dir, f);
  const raw = readFileSync(path);
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  writeFileSync(path, br);
  console.log(`${f}: ${(raw.length / 1e6).toFixed(1)} MB → ${(br.length / 1e6).toFixed(1)} MB (brotli)`);
}
