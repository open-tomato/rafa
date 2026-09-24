/**
 * Tests for the pinned skill delivery.
 *
 * The constants are a record of a measurement, so the claim worth
 * testing is that the record agrees with itself. `context/inventory.md`
 * carries the probe in its "Serving" section, and this file reads that
 * section from the live page, not a fixture. A fixture would only test
 * a copy this file made. Pinning a new version or delivery without
 * rewriting the page turns these cases red, and so does the reverse.
 *
 * The section reader gets its own control. It must find the heading
 * and stop at the next one, or a version quoted anywhere else on the
 * page would satisfy the check.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { SERVE_CLI_VERSION, SKILL_DELIVERY } from './delivery.js';

const INVENTORY_PAGE = join(import.meta.dir, '..', '..', 'context', 'inventory.md');

/** The body of the `### <heading>` section of `page`, or `null` when absent. */
function sectionOf(page: string, heading: string): string | null {
  const lines = page.split('\n');
  const start = lines.indexOf(`### ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3} /.test(line));
  return (end === -1
    ? rest
    : rest.slice(0, end)).join('\n');
}

describe('the pinned skill delivery', () => {
  it('pins the Claude Code version the probe ran against', () => {
    expect(SERVE_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SERVE_CLI_VERSION).toBe('2.1.280');
  });

  it('serves skills by add-dir, the flag that kept the bare name', () => {
    expect(SKILL_DELIVERY).toBe('add-dir');
  });
});

describe('the Serving section of context/inventory.md', () => {
  const page = readFileSync(INVENTORY_PAGE, 'utf8');
  const serving = sectionOf(page, 'Serving');

  it('exists on the page', () => {
    expect(serving).not.toBeNull();
  });

  it('names the pinned CLI version and the pinned delivery', () => {
    expect(serving).toContain(`Claude Code ${SERVE_CLI_VERSION}`);
    expect(serving).toContain(`\`SKILL_DELIVERY\` is \`${SKILL_DELIVERY}\``);
  });

  it('reads one section only, stopping at the next heading', () => {
    const planted = [
      '### Serving',
      'inside',
      '### Next',
      'outside',
    ].join('\n');

    expect(sectionOf(planted, 'Serving')).toBe('inside');
    expect(sectionOf(planted, 'Absent')).toBeNull();
    // Control: the page's section is not the whole page.
    expect(serving?.length).toBeLessThan(page.length);
  });
});
