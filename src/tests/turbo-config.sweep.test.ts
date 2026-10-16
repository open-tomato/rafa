/**
 * The task-graph sweep: holds the root `turbo.json` to the two promises the
 * monorepo bootstrap (#807) makes of it.
 *
 * - `agentGuidance` is `false`. Under an agent environment (`CLAUDECODE`,
 *   `AI_AGENT`) turbo otherwise writes a block into the root `AGENTS.md`,
 *   which is capped at 80 lines, and a task commit's `git add -A` would
 *   carry it (the spike's probe 1, #804).
 * - The `tasks` map names `lint`, `check-types` and `test`, the three
 *   tasks the root script `verify:affected` runs with `--affected`.
 *
 * The file is read at run time and imports no project module, so the
 * `.sweep.test.ts` suffix is what has `tests.alwaysRun` run it. Each
 * finding the check can return has a planted-config control below, so a
 * clean reading of the live file is not a check that could never fail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = join(import.meta.dir, '..', '..');

/** The root turbo configuration the sweep reads. */
const TURBO_FILE = join(REPO_ROOT, 'turbo.json');

/** The tasks `verify:affected` runs, which `turbo.json` must define. */
const REQUIRED_TASKS: readonly string[] = ['lint', 'check-types', 'test'];

/**
 * Lists what a parsed `turbo.json` breaks of the two promises, one line
 * per breach; an empty list means the configuration holds.
 *
 * @param config - The parsed contents of a `turbo.json`.
 * @returns One message per breach, in a stable order.
 */
function turboFindings(config: unknown): string[] {
  if (typeof config !== 'object' || config === null) {
    return ['turbo.json is not an object'];
  }
  const record = config as Record<string, unknown>;
  const findings: string[] = [];
  if (record.agentGuidance !== false) {
    findings.push(`agentGuidance is ${JSON.stringify(record.agentGuidance)}, not false`);
  }
  const tasks = typeof record.tasks === 'object' && record.tasks !== null
    ? record.tasks as Record<string, unknown>
    : {};
  for (const name of REQUIRED_TASKS) {
    if (!(name in tasks)) {
      findings.push(`task ${name} is missing`);
    }
  }
  return findings;
}

/** A configuration that holds both promises, the base of each control. */
const GOOD_CONFIG = {
  agentGuidance: false,
  tasks: { lint: {}, 'check-types': {}, test: {} },
};

describe('turbo.json', () => {
  test('the live file sets agentGuidance false and defines the three tasks', () => {
    const config: unknown = JSON.parse(readFileSync(TURBO_FILE, 'utf8'));

    expect(turboFindings(config)).toEqual([]);
  });

  test('control: a configuration holding both promises reads clean', () => {
    expect(turboFindings(GOOD_CONFIG)).toEqual([]);
  });

  test('control: a missing agentGuidance key is a finding', () => {
    const { tasks } = GOOD_CONFIG;

    expect(turboFindings({ tasks })).toEqual(['agentGuidance is undefined, not false']);
  });

  test('control: agentGuidance true is a finding', () => {
    expect(turboFindings({ ...GOOD_CONFIG, agentGuidance: true })).toEqual(['agentGuidance is true, not false']);
  });

  test('control: each missing task is a finding of its own', () => {
    const findings = turboFindings({ agentGuidance: false, tasks: { lint: {} } });

    expect(findings).toEqual(['task check-types is missing', 'task test is missing']);
  });

  test('control: a file that is not an object is a finding', () => {
    expect(turboFindings(null)).toEqual(['turbo.json is not an object']);
  });
});
