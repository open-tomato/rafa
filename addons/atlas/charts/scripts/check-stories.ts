/**
 * `bun scripts/check-stories.ts [staticDir]`: loads every story of a built
 * Storybook in headless Chromium, in light and in dark, and exits 1 when
 * any of them logs a console error, throws a page error, or shows
 * Storybook's error overlay. It runs after `build:storybook`.
 */
import { chromium, type ConsoleMessage } from 'playwright';

import { HOST, serveStatic } from './static-server.js';
import { readStoryIds, storyPath, THEMES } from './story-index.js';

/** How long a story may take to settle after the network goes idle. */
const SETTLE_MS = 200;

/** The longest first line kept from an error, so the report stays readable. */
const MAX_LINE = 200;

const staticDir = process.argv[2] ?? 'storybook-static';
const storyIds = await readStoryIds(staticDir);
if (storyIds.length === 0) throw new Error(`check-stories: no story in ${staticDir}/index.json`);

const server = serveStatic(staticDir, 0);
const origin = `http://${HOST}:${server.port}`;
const browser = await chromium.launch();
const page = await browser.newPage();

/** The first line of a message, cut to {@link MAX_LINE}. */
function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, MAX_LINE);
}

let failed = 0;
try {
  for (const id of storyIds) {
    for (const theme of THEMES) {
      const errors: string[] = [];
      const onConsole = (message: ConsoleMessage): void => {
        if (message.type() === 'error') errors.push(firstLine(message.text()));
      };
      const onPageError = (error: Error): void => {
        errors.push(`pageerror: ${firstLine(String(error))}`);
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      await page.goto(`${origin}${storyPath(id, theme)}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(SETTLE_MS);
      const overlay = await page.locator('.sb-show-errordisplay').count();
      if (overlay > 0) errors.push('the Storybook error overlay is showing');
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      if (errors.length > 0) {
        failed += 1;
        console.error(`FAIL ${id} (${theme})\n    ${errors.join('\n    ')}`);
      } else {
        console.info(`ok   ${id} (${theme})`);
      }
    }
  }
} finally {
  await browser.close();
  await server.stop(true);
}

const total = storyIds.length * THEMES.length;
console.info(`\n${total - failed}/${total} story renders clean (${storyIds.length} stories x ${THEMES.length} themes)`);
if (failed > 0) process.exit(1);
