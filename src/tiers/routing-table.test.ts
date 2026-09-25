/**
 * `routing-table.ts` renders the routing defaults as the table in
 * `context/workflow.md`, and this file checks the live page against that
 * output, reading the page itself rather than a fixture.
 *
 * The equality case is a zero-diff claim. It would also pass if
 * {@link withRoutingTable} had stopped touching the page, so each
 * control plants a drift into the live page in memory (a row dropped, an
 * agent re-pointed, a hand edit inside the region) and asserts the same
 * comparison now differs. The splice's refusals (a marker missing,
 * doubled or reversed) each get a case too, because those refusals are
 * what stop the comparison from silently agreeing with a page that has
 * lost its table.
 */
import type { Route } from './routing.js';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import {
  BUNDLED_AGENTS_PATH,
  formatRoutingTable,
  ROUTING_TABLE_END,
  ROUTING_TABLE_HEADER,
  ROUTING_TABLE_START,
  SHAPE_GLOSSES,
  withRoutingTable,
} from './routing-table.js';
import { DEFAULT_ROUTES } from './routing.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE_PATH = 'context/workflow.md';
const PAGE = readFileSync(join(REPO_ROOT, PAGE_PATH), 'utf8');

/** Replaces a substring that must appear exactly once. */
function plantOnce(text: string, from: string, to: string): string {
  const parts = text.split(from);
  if (parts.length !== 2) {
    throw new Error(`plant target ${JSON.stringify(from)} appears ${String(parts.length - 1)} times, not once`);
  }
  return parts.join(to);
}

/** The lines strictly between the two markers of `page`. */
function region(page: string): string[] {
  const lines = page.split('\n');
  return lines.slice(lines.indexOf(ROUTING_TABLE_START) + 1, lines.indexOf(ROUTING_TABLE_END));
}

describe('formatRoutingTable', () => {
  it('opens with the page header and an alignment row', () => {
    const [header, delimiter] = formatRoutingTable().split('\n');
    expect(header).toBe(`| ${ROUTING_TABLE_HEADER.join(' | ')} |`);
    expect(delimiter).toBe('|---|---|---|');
  });

  it('renders one row per default route, in the list order', () => {
    const rows = formatRoutingTable()
      .split('\n')
      .slice(2);
    expect(rows).toHaveLength(DEFAULT_ROUTES.length);
    for (const [index, [shape, agent]] of DEFAULT_ROUTES.entries()) {
      expect(rows[index]).toBe(
        `| \`${shape}\` — ${SHAPE_GLOSSES[shape] ?? ''} | \`${agent}\` | \`${BUNDLED_AGENTS_PATH}/${agent}.md\` |`,
      );
    }
  });

  it('names a rafa-tier file that is on disk for every default agent', () => {
    const missing = DEFAULT_ROUTES
      .map(([, agent]) => `${BUNDLED_AGENTS_PATH}/${agent}.md`)
      .filter((path) => !existsSync(join(REPO_ROOT, path)));
    expect(missing).toEqual([]);
    expect(existsSync(join(REPO_ROOT, BUNDLED_AGENTS_PATH, 'zz-not-a-real-agent.md'))).toBe(false);
  });

  it('glosses every default shape and nothing else', () => {
    expect(Object.keys(SHAPE_GLOSSES).sort()).toEqual(DEFAULT_ROUTES.map(([shape]) => shape).sort());
  });

  it('throws for a shape with no gloss rather than rendering a bare row', () => {
    const routes: readonly Route[] = [['cleanup', 'refactor-cleaner']];
    expect(() => formatRoutingTable(routes)).toThrow('routing shape cleanup has no gloss in SHAPE_GLOSSES');
    expect(formatRoutingTable(routes, { cleanup: 'dead code' })).toContain(
      '| `cleanup` — dead code | `refactor-cleaner` | `src/bundled/agents/refactor-cleaner.md` |',
    );
  });
});

describe('withRoutingTable', () => {
  const page = ['# Page', 'before', ROUTING_TABLE_START, 'stale', 'rows', ROUTING_TABLE_END, 'after', ''].join('\n');

  it('replaces the lines between the markers and keeps every other byte', () => {
    expect(withRoutingTable(page, 'T1\nT2')).toBe(
      ['# Page', 'before', ROUTING_TABLE_START, 'T1', 'T2', ROUTING_TABLE_END, 'after', ''].join('\n'),
    );
  });

  it('is a fixed point on its own output', () => {
    const once = withRoutingTable(page);
    expect(withRoutingTable(once)).toBe(once);
  });

  it('refuses a page with no start marker', () => {
    expect(() => withRoutingTable(page.replace(ROUTING_TABLE_START, 'gone'))).toThrow('found 0');
  });

  it('refuses a page with a doubled end marker', () => {
    expect(() => withRoutingTable(`${page}${ROUTING_TABLE_END}\n`)).toThrow('found 2');
  });

  it('refuses markers in reverse order', () => {
    const reversed = ['x', ROUTING_TABLE_END, 'y', ROUTING_TABLE_START, 'z'].join('\n');
    expect(() => withRoutingTable(reversed)).toThrow('end marker comes before its start marker');
  });
});

describe('the Task shape to agent table in context/workflow.md', () => {
  it('equals the generator output', () => {
    expect(PAGE).toBe(withRoutingTable(PAGE));
  });

  it('sits under the Task shape to agent heading, with rows in its region', () => {
    const lines = PAGE.split('\n');
    const heading = lines.indexOf('### Task shape to agent');
    const start = lines.indexOf(ROUTING_TABLE_START);
    const nextHeading = lines.findIndex((line, index) => index > heading && line.startsWith('### '));
    expect(heading).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(heading);
    expect(start).toBeLessThan(nextHeading);
    expect(region(PAGE)).toEqual(formatRoutingTable().split('\n'));
    expect(region(PAGE).length).toBe(DEFAULT_ROUTES.length + 2);
  });

  it('differs from the generator once a row is dropped, the control', () => {
    const [, agent] = DEFAULT_ROUTES[0] ?? ['', ''];
    const row = region(PAGE).find((line) => line.includes(`| \`${agent}\` |`)) ?? 'no row';
    const planted = plantOnce(PAGE, `${row}\n`, '');
    expect(planted).not.toBe(PAGE);
    expect(planted).not.toBe(withRoutingTable(planted));
  });

  it('differs from the generator once an agent is re-pointed, the control', () => {
    const planted = plantOnce(PAGE, '| `code-reviewer` |', '| `typescript-reviewer` |');
    expect(planted).not.toBe(withRoutingTable(planted));
  });

  it('differs from the generator once a gloss is edited by hand, the control', () => {
    const planted = plantOnce(PAGE, '— a change as a whole |', '— a change as a whole, by hand |');
    expect(planted).not.toBe(withRoutingTable(planted));
    expect(withRoutingTable(planted)).toBe(PAGE);
  });
});
