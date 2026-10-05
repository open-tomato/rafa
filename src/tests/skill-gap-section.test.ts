import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

const COPIES = [
  '.claude/skills/rafa-tooling/SKILL.md',
  'extras/claude-code/rafa-hookify/files/rafa-tooling-skill.md',
] as const;

const HEADING = '## Gap reports';

/** The text from the gap-report heading up to the next level-2 heading. */
export function gapSection(text: string): string | undefined {
  const start = text.indexOf(`${HEADING}\n`);
  if (start === -1) return undefined;
  const rest = text.slice(start + HEADING.length);
  const next = rest.search(/\n## /);
  return (next === -1
    ? rest
    : rest.slice(0, next)).trim();
}

describe('rafa-tooling skill gap-report section', () => {
  test('gapSection returns undefined without the heading and stops at the next heading', () => {
    expect(gapSection('# x\n## Other\nbody')).toBeUndefined();
    expect(gapSection('## Gap reports\nA\n\n## Next\nB')).toBe('A');
  });

  test('both copies carry a non-empty gap-report section', () => {
    for (const path of COPIES) {
      const section = gapSection(readFileSync(path, 'utf8'));
      expect(section, path).toBeTruthy();
    }
  });

  test('the gap-report section is identical in both copies', () => {
    const [a, b] = COPIES.map((path) => gapSection(readFileSync(path, 'utf8')));
    expect(a).toBe(b);
  });
});
