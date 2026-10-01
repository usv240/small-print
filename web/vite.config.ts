import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Every top-level .html file is its own page, so content pages ship as real static HTML
// (readable without JavaScript by crawlers and the AI scoring system).
const pages = Object.fromEntries(
  readdirSync(import.meta.dirname)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(import.meta.dirname, f)]),
);

export default defineConfig({
  build: {
    target: 'es2020',
    rollupOptions: { input: pages },
  },
  server: { host: true },
  test: { include: ['tests/**/*.test.ts'] },
});
