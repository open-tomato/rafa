/**
 * `bun visual/compare-layout.ts <otherStaticDir> [storyId[=otherId]...]`:
 * compares the layout of this package's built Storybook stories with the
 * same stories in another built Storybook, position by position and
 * colour-blind. It serves both static builds, loads each story in light,
 * and reads the bounding box of every text-bearing element relative to
 * the story root. Elements are matched by their text, and the report
 * gives, per story, the root sizes, the matched count and the largest
 * offset and size difference, flagging anything past `TOLERANCE_PX`.
 * Screenshots of both go to `__compare_output__/` for a look.
 *
 * With no story ids, every id present in both builds is compared.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type Page } from 'playwright';

import { HOST, serveStatic } from '../scripts/static-server.js';
import { readStoryIds, storyPath } from '../scripts/story-index.js';

/** Past this offset, in CSS pixels, a matched element is reported as moved. */
const TOLERANCE_PX = 6;

/** The viewport both builds render at. */
const VIEWPORT = { width: 800, height: 600 };

/** How long a story may take to settle after the network goes idle. */
const SETTLE_MS = 300;

/** A text-bearing element's box, relative to the story root. */
interface Box {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A story's layout: the root size and its text boxes. */
interface Layout {
  readonly root: { readonly w: number; readonly h: number };
  readonly boxes: readonly Box[];
}

/** Reads the layout of the story the page shows. */
async function readLayout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const root = document.querySelector('#storybook-root');
    if (root === null) return { root: { w: 0, h: 0 }, boxes: [] };
    const origin = root.getBoundingClientRect();
    const boxes: Box[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const element = node as HTMLElement;
      const own = Array.from(element.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (own === '') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      boxes.push({ text: own, x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height });
    }
    return { root: { w: origin.width, h: origin.height }, boxes };
  });
}

/** Loads one story in light and reads its layout, saving a screenshot. */
async function capture(page: Page, origin: string, id: string, shot: string): Promise<Layout> {
  await page.goto(`${origin}${storyPath(id, 'light')}`, { waitUntil: 'networkidle' });
  await page.locator('#storybook-root').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: shot });
  return readLayout(page);
}

/** One story's comparison. */
interface Report {
  readonly id: string;
  readonly otherId: string;
  readonly root: { readonly ours: Layout['root']; readonly other: Layout['root'] };
  readonly matched: number;
  readonly unmatched: readonly string[];
  readonly maxOffset: number;
  readonly maxSizeDiff: number;
  readonly moved: readonly string[];
}

/** Matches the boxes by text, first unmatched same text wins, and measures the offsets. */
function compare(id: string, otherId: string, ours: Layout, other: Layout): Report {
  const pool = [...other.boxes];
  let matched = 0;
  let maxOffset = 0;
  let maxSizeDiff = 0;
  const unmatched: string[] = [];
  const moved: string[] = [];
  for (const box of ours.boxes) {
    const index = pool.findIndex((candidate) => candidate.text === box.text);
    if (index === -1) {
      unmatched.push(box.text);
      continue;
    }
    const [twin] = pool.splice(index, 1);
    if (twin === undefined) continue;
    matched += 1;
    const offset = Math.max(Math.abs(box.x - twin.x), Math.abs(box.y - twin.y));
    const sizeDiff = Math.max(Math.abs(box.w - twin.w), Math.abs(box.h - twin.h));
    maxOffset = Math.max(maxOffset, offset);
    maxSizeDiff = Math.max(maxSizeDiff, sizeDiff);
    if (offset > TOLERANCE_PX) moved.push(`${box.text}: ${Math.round(twin.x)},${Math.round(twin.y)} → ${Math.round(box.x)},${Math.round(box.y)}`);
  }
  return { id, otherId, root: { ours: ours.root, other: other.root }, matched, unmatched, maxOffset, maxSizeDiff, moved };
}

/** Formats a size as `w×h`. */
function size(box: Layout['root']): string {
  return `${Math.round(box.w)}×${Math.round(box.h)}`;
}

/** Prints one report as a block. */
function print(report: Report): void {
  const rootDiff = Math.max(Math.abs(report.root.ours.w - report.root.other.w), Math.abs(report.root.ours.h - report.root.other.h));
  const flag = report.moved.length > 0 || rootDiff > TOLERANCE_PX
    ? 'MOVED'
    : 'ok   ';
  const pair = report.id === report.otherId
    ? report.id
    : `${report.id} ← ${report.otherId}`;
  console.info(`${flag} ${pair}  root ${size(report.root.other)} → ${size(report.root.ours)}  matched ${report.matched}  offset ≤${Math.round(report.maxOffset)}px  size ≤${Math.round(report.maxSizeDiff)}px`);
  for (const line of report.moved) console.info(`      moved  ${line}`);
  if (report.unmatched.length > 0) console.info(`      only here: ${report.unmatched.join(' | ')}`);
}

/** Parses `id` or `id=otherId` pairs. */
function parsePairs(args: readonly string[]): readonly (readonly [string, string])[] {
  return args.map((arg) => {
    const [ours, other] = arg.split('=');
    return [ours ?? '', other ?? ours ?? ''] as const;
  });
}

const [otherDir, ...pairArgs] = process.argv.slice(2);
if (otherDir === undefined) throw new Error('compare-layout: the other build\'s static dir is required');

const oursDir = join(import.meta.dirname, '..', 'storybook-static');
const ourIds = await readStoryIds(oursDir);
const otherIds = new Set(await readStoryIds(otherDir));
const pairs = pairArgs.length > 0
  ? parsePairs(pairArgs)
  : ourIds.filter((id) => otherIds.has(id)).map((id) => [id, id] as const);

const outDir = join(import.meta.dirname, '__compare_output__');
mkdirSync(outDir, { recursive: true });

const ours = serveStatic(oursDir, 0);
const other = serveStatic(otherDir, 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
let flagged = 0;
try {
  for (const [id, otherId] of pairs) {
    const oursLayout = await capture(page, `http://${HOST}:${ours.port}`, id, join(outDir, `${id}--ours.png`));
    const otherLayout = await capture(page, `http://${HOST}:${other.port}`, otherId, join(outDir, `${id}--other.png`));
    const report = compare(id, otherId, oursLayout, otherLayout);
    print(report);
    if (report.moved.length > 0) flagged += 1;
  }
} finally {
  await browser.close();
  ours.stop(true);
  other.stop(true);
}
console.info(`\n${pairs.length} stories compared, ${flagged} with an element moved past ${TOLERANCE_PX}px`);
