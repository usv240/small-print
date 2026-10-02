// Accessibility audit with axe-core (WCAG 2.0/2.1/2.2 level A and AA rules) on every page and on each
// screen of the test reachable in demo mode, in the light and the dark theme. Chrome (phone) only:
// axe works on the DOM and computed styles, so the engine makes little difference.
// Also checks WCAG 2.2 SC 2.4.11 Focus Not Obscured: in demo mode the slider bar is fixed to the bottom
// of the screen, so a control that keyboard focus scrolls to must not end up hidden behind it.
// With QUALITY=1 the full results are saved for public/data/quality.json.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answerArrows, answerSafety, mockApi, setDemoDistance } from './helpers';
import { saveQuality } from './quality-out';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const PAGES = ['/', '/judges.html', '/how-it-works.html', '/validation.html', '/findings.html', '/impact.html',
  '/safety.html', '/evidence.html', '/poster.html', '/lab.html'];
const THEMES = ['light', 'dark'] as const;

interface Finding { where: string; theme: string; id: string; impact: string | null; help: string; nodes: number; targets: string[] }
interface Audit { where: string; theme: string; violations: number; passes: number; incomplete: number }

test.describe.configure({ timeout: 240_000 });

// Known serious/critical violations (found by this audit on 2026-10-01). The tests fail on anything NOT in
// this list, so new problems are caught; delete an entry once its bug is fixed.
// Previously known bugs (unnamed select, unlabelled lab textarea, keyboard-unreachable scroll regions) are
// fixed; any serious or critical finding now fails the test.
const KNOWN_SEVERE = new Set<string>([]);
const newSevere = (findings: Finding[]) => findings
  .filter((f) => (f.impact === 'critical' || f.impact === 'serious') && !KNOWN_SEVERE.has(`${f.id}@${f.where}`));

async function audit(page: Page, where: string, theme: string, out: { findings: Finding[]; audits: Audit[] }): Promise<void> {
  // Let entrance transitions finish so contrast is measured on final colours.
  await page.waitForTimeout(400);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  out.audits.push({ where, theme, violations: r.violations.length, passes: r.passes.length, incomplete: r.incomplete.length });
  for (const v of r.violations) {
    out.findings.push({ where, theme, id: v.id, impact: v.impact ?? null, help: v.help, nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) });
  }
}

async function useTheme(page: Page, theme: string): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('small-print.theme', t), theme);
}

function summarise(findings: Finding[]) {
  const byImpact: Record<string, number> = {};
  for (const f of findings) byImpact[f.impact ?? 'unknown'] = (byImpact[f.impact ?? 'unknown'] ?? 0) + 1;
  return byImpact;
}

for (const theme of THEMES) {
  test(`axe: content pages (${theme})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'axe audit runs once, on Chrome');
    await mockApi(page);
    await useTheme(page, theme);
    const out = { findings: [] as Finding[], audits: [] as Audit[] };
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await audit(page, path, theme, out);
    }
    saveQuality(`axe-pages-${theme}`, { theme, tags: TAGS, byImpact: summarise(out.findings), ...out });
    const severe = newSevere(out.findings);
    expect(severe, JSON.stringify(severe, null, 1)).toEqual([]);
  });

  test(`axe: test screens in demo mode (${theme})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'axe audit runs once, on Chrome');
    await mockApi(page);
    await useTheme(page, theme);
    const out = { findings: [] as Finding[], audits: [] as Audit[] };
    const a = (where: string) => audit(page, `test: ${where}`, theme, out);

    // Welcome, then the camera path up to "Turn on your camera" (no camera needed to reach it).
    await page.goto('/test.html?dev');
    await a('welcome');
    await page.getByRole('button', { name: 'Start with camera' }).click();
    await a('safety questions');
    await answerSafety(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await a('age');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Turn on your camera' })).toBeVisible();
    await a('camera permission');

    // Stop and advise screens.
    await page.goto('/test.html?demo&dev');
    await answerSafety(page, [/changed suddenly/]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await a('stop (red flag)');
    await page.goto('/test.html?demo&dev');
    await answerSafety(page, [/diabetes/]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await a('advise (eye exam)');

    // Demo flow through to the result and a full try-on.
    await page.goto('/test.html?demo&dev');
    await answerSafety(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await setDemoDistance(page, 38);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Got it: you read at about 38 cm/)).toBeVisible({ timeout: 15_000 });
    await a('working distance');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Which way does the E point?' })).toBeVisible();
    await a('small print (arrows)');
    await answerArrows(page);
    await a('near check');
    await page.getByRole('button', { name: 'Blurry' }).click();
    await a('near point (move away)');
    await setDemoDistance(page, 60);
    await page.getByRole('button', { name: 'Now it’s sharp' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your result' })).toBeVisible();
    await page.locator('details summary').first().click();
    await a('result (details open)');
    await page.getByRole('button', { name: 'Check a pair in the shop' }).click();
    await a('try-on: pick strength');
    await page.getByRole('button', { name: 'Continue' }).click();
    await a('try-on: find sharp');
    await setDemoDistance(page, 40);
    await page.getByRole('button', { name: 'Sharp here' }).click();
    await a('try-on: bring closer');
    await setDemoDistance(page, 25);
    await page.getByRole('button', { name: 'Now it’s blurry' }).click();
    await a('try-on: move away');
    await setDemoDistance(page, 60);
    await page.getByRole('button', { name: 'Now it’s blurry' }).click();
    await a('try-on: verdict');

    // Camp summary (empty state).
    await page.goto('/test.html?dev&camp');
    await page.getByRole('button', { name: 'Camp summary' }).click();
    await a('camp summary');

    saveQuality(`axe-flow-${theme}`, { theme, tags: TAGS, byImpact: summarise(out.findings), ...out });
    const severe = newSevere(out.findings);
    expect(severe, JSON.stringify(severe, null, 1)).toEqual([]);
  });
}

// WCAG 2.2 SC 2.4.11 (AA): tab through each long demo-mode screen; no focused control may be entirely
// hidden behind the fixed demo slider bar. Partly hidden (SC 2.4.12, AAA) is recorded too.
// The demo bar used to hide focused controls; body.demo now reserves its height (src/styles/app.css).
const KNOWN_OBSCURED = new Set<string>([]);
test('focus not obscured by the fixed demo bar (WCAG 2.4.11)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'runs once, on Chrome');
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const report: { screen: string; focused: number; hidden: string[]; partlyHidden: string[] }[] = [];

  async function tabThrough(screen: string): Promise<void> {
    await page.locator('h1').focus();
    const hidden: string[] = [], partly: string[] = [];
    let focused = 0;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const bar = document.getElementById('demo-bar');
        if (!el || el === document.body || !bar || bar.hidden || bar.contains(el)) return null;
        const e = el.getBoundingClientRect(), b = bar.getBoundingClientRect();
        const nameAttr = el.getAttribute('name');
        const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${nameAttr ? `[name=${nameAttr}]` : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}"`;
        return { name, hidden: e.top >= b.top, partly: e.bottom > b.top && e.top < b.top };
      });
      if (!r) continue;
      focused++;
      if (r.hidden) hidden.push(r.name);
      else if (r.partly) partly.push(r.name);
    }
    report.push({ screen, focused, hidden: [...new Set(hidden)], partlyHidden: [...new Set(partly)] });
  }

  await page.goto('/test.html?demo&dev');
  await expect(page.getByRole('heading', { level: 1, name: 'First, a few safety questions' })).toBeVisible();
  await tabThrough('safety questions');
  await answerSafety(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await setDemoDistance(page, 38);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Got it/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await answerArrows(page);
  await page.getByRole('button', { name: 'Blurry' }).click();
  await setDemoDistance(page, 60);
  await page.getByRole('button', { name: 'Now it’s sharp' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your result' })).toBeVisible();
  await tabThrough('result');

  console.log(`[focus-not-obscured] ${JSON.stringify(report)}`);
  saveQuality('focus-not-obscured', { viewport: page.viewportSize(), report });
  const unexpected = report.filter((r) => r.hidden.length && !KNOWN_OBSCURED.has(r.screen));
  expect(unexpected, 'focused controls entirely behind the demo bar').toEqual([]);
});
