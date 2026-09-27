/**
 * Tests for the epic guard (`epic-guard.ts`): the shipped workflow's
 * trigger and what its step sends, and the file it is written to.
 *
 * The workflow is read as YAML, so a case holds the keys GitHub reads —
 * `issues: [labeled]`, `issues: write`, the `epic:` condition — rather
 * than a substring of the text. What the step's script does with the
 * labels it reads was measured outside the suite, against a fake `gh` on
 * PATH; the reading is in `context/cli.md` beside the init board step.
 * Every write goes under this file's own temporary root.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { isMapping } from '../config-sections.js';

import { EPIC_GUARD_PATH, epicGuardSource, readEpicGuard, writeEpicGuard } from './epic-guard.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-guard-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The value at `path` in a parsed document, or undefined when a step is not a mapping. */
function at(document: unknown, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (!isMapping(value)) return undefined;
    value = value[key];
  }
  return value;
}

/** The shipped workflow, parsed. */
function parsedGuard(): unknown {
  return Bun.YAML.parse(readEpicGuard());
}

describe('the shipped workflow', () => {
  it('runs on an issue gaining a label, only for an epic: label, and may write issues alone', () => {
    const workflow = parsedGuard();

    expect(at(workflow, ['on', 'issues', 'types'])).toEqual(['labeled']);
    expect(at(workflow, ['permissions'])).toEqual({ issues: 'write' });
    expect(at(workflow, ['jobs', 'one-epic', 'if'])).toBe('startsWith(github.event.label.name, \'epic:\')');
  });

  it('removes the label its own event added and comments why, reading the label through env', () => {
    const steps = at(parsedGuard(), ['jobs', 'one-epic', 'steps']);
    const step: unknown = Array.isArray(steps)
      ? steps[0]
      : undefined;
    const script = at(step, ['run']);

    expect(typeof script).toBe('string');
    expect(String(script)).toContain('gh issue edit "$ISSUE" --remove-label "$ADDED"');
    expect(String(script)).toContain('gh issue comment "$ISSUE" --body "$body"');
    expect(String(script)).not.toContain('${{');
    expect(at(step, ['env', 'ADDED'])).toBe('${{ github.event.label.name }}');
  });

  it('refuses, naming the path, a directory the build dropped the workflow from', () => {
    const empty = mkdtempSync(join(tempBase, 'no-build-'));

    expect(() => readEpicGuard(empty)).toThrow(`no file at ${epicGuardSource(empty)}`);
  });
});

describe('writing the workflow', () => {
  it('writes the shipped bytes under .github/workflows, and leaves them alone the second time', () => {
    const root = mkdtempSync(join(tempBase, 'write-'));

    const first = writeEpicGuard(root);
    const again = writeEpicGuard(root);

    expect([first.kind, first.name, first.outcome]).toEqual(['template', EPIC_GUARD_PATH, 'created']);
    expect(readFileSync(join(root, EPIC_GUARD_PATH), 'utf8')).toBe(readEpicGuard());
    expect(again.outcome).toBe('present');
  });

  it('leaves an edited workflow as it is, and refuses a directory at the path', () => {
    const edited = mkdtempSync(join(tempBase, 'edited-'));
    const blocked = mkdtempSync(join(tempBase, 'blocked-'));
    mkdirSync(join(edited, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(edited, EPIC_GUARD_PATH), 'name: mine\n', 'utf8');
    mkdirSync(join(blocked, EPIC_GUARD_PATH), { recursive: true });

    const kept = writeEpicGuard(edited);
    const refused = writeEpicGuard(blocked);

    expect(kept.outcome).toBe('present');
    expect(readFileSync(join(edited, EPIC_GUARD_PATH), 'utf8')).toBe('name: mine\n');
    expect(refused.outcome).toBe('refused');
    expect(refused.detail).toBe(`${join(blocked, EPIC_GUARD_PATH)} is not a file, so the workflow was not written`);
  });
});
