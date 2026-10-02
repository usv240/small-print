// Dev server for the CMDP harness only (port 4196). Root is web/, so the harness imports the shipped
// src/camera/distance.ts directly and /models + /mediapipe/wasm come from web/public as in the app.
// The dataset photos stay outside the repo (CMDP_DIR, default %TEMP%/cmdp/img) and are served
// read-only at /cmdp-img/<path relative to CMDP_DIR>, to localhost only.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

export const CMDP_PORT = 4196;
export const CMDP_DIR = process.env.CMDP_DIR ?? resolve(tmpdir(), 'cmdp', 'img');
/** run.ts output / report.ts input (numbers only), next to the dataset, outside the repo. */
export const RAW_PATH = process.env.CMDP_RAW ?? resolve(CMDP_DIR, '..', process.env.CMDP_DELEGATE === 'CPU' ? 'raw-cpu.json' : 'raw.json');

export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  publicDir: resolve(import.meta.dirname, '../../public'),
  server: { port: CMDP_PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'warn',
  plugins: [
    {
      name: 'cmdp-images',
      configureServer(server) {
        server.middlewares.use('/cmdp-img/', (req, res, next) => {
          const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
          const file = resolve(CMDP_DIR, rel);
          if (!file.startsWith(CMDP_DIR + sep) || !/\.jpe?g$/i.test(file) || !existsSync(file)) return next();
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', String(statSync(file).size));
          res.setHeader('Cache-Control', 'no-store');
          createReadStream(file).pipe(res);
        });
      },
    },
  ],
});
