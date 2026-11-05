/**
 * One screenshot per story and theme. The theme is the toolbar global the
 * preview turns into `data-theme` on `<html>`; the test checks the
 * attribute before it shoots. Fonts are settled and animations disabled.
 * The file is named `.visual.ts`, not `.spec.ts`, so `bun test` never
 * picks it up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

const STATIC_DIR = join(import.meta.dirname, '..', 'storybook-static');

const THEMES = ['light', 'dark'] as const;

interface IndexEntry {
  readonly id: string;
  readonly type: string;
}

const index = JSON.parse(readFileSync(join(STATIC_DIR, 'index.json'), 'utf8')) as { entries: Record<string, IndexEntry> };
const storyIds = Object.values(index.entries)
  .filter((entry) => entry.type === 'story')
  .map((entry) => entry.id)
  .sort((a, b) => a.localeCompare(b));

test('the built Storybook holds stories', () => {
  expect(storyIds.length).toBeGreaterThan(0);
});

for (const id of storyIds) {
  for (const theme of THEMES) {
    test(`${id} (${theme})`, async ({ page }) => {
      await page.goto(`/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=theme:${theme}`);
      await page.locator('#storybook-root').waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page).toHaveScreenshot(`${id}--${theme}.png`);
    });
  }
}
