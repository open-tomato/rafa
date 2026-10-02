/**
 * The `verify` workflow at `.github/workflows/verify.yml`: the gates that
 * run on every pull request into `main` and on every push to a
 * `stretch/**` branch. The root eslint config lints no YAML, so this test
 * is the file's only gate. Pull requests into `stretch/**` report no
 * check, which keeps `rafa pr merge <pr> --skip-checks` working there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

/** The repository root. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The workflow file, as text. */
const TEXT = readFileSync(join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');

/** One step of a job, as the workflow writes it. */
interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

/** The parts of a workflow this test reads. */
interface Workflow {
  readonly on: Readonly<Record<string, { readonly branches?: readonly string[] } | null>>;
  readonly permissions: Readonly<Record<string, string>>;
  readonly jobs: Readonly<Record<string, {
    readonly 'timeout-minutes': number;
    readonly steps: readonly Step[];
  }>>;
}

/** Parses workflow text. */
function parse(text: string): Workflow {
  return Bun.YAML.parse(text) as Workflow;
}

/** The parsed workflow. */
const WORKFLOW = parse(TEXT);

/** The branches a trigger names, or none when the trigger is absent. */
function branchesOf(workflow: Workflow, trigger: string): readonly string[] {
  return workflow.on[trigger]?.branches ?? [];
}

/** The guard every gate step carries. */
const GUARD = '${{ !cancelled() }}';

/** The three gate steps, by name, with the command each runs. */
const GATES: ReadonlyArray<readonly [string, string]> = [
  ['Test', 'bun test'],
  ['Lint', 'bunx eslint .'],
  ['Types', 'bunx tsc --noEmit'],
];

/** The steps of the one job. */
function steps(): readonly Step[] {
  return WORKFLOW.jobs['verify']?.steps ?? [];
}

describe('the verify workflow, what it must not trigger on', () => {
  it('names no stretch/** branch under pull_request', () => {
    expect(branchesOf(WORKFLOW, 'pull_request')).not.toContain('stretch/**');
  });

  it('names no main branch under push', () => {
    expect(branchesOf(WORKFLOW, 'push')).not.toContain('main');
  });

  it('would see both, the control over a file that swaps the branches', () => {
    const swapped = parse([
      'on:',
      '  pull_request:',
      '    branches:',
      '      - \'stretch/**\'',
      '  push:',
      '    branches:',
      '      - main',
    ].join('\n'));

    expect(branchesOf(swapped, 'pull_request')).toContain('stretch/**');
    expect(branchesOf(swapped, 'push')).toContain('main');
  });
});

describe('the verify workflow', () => {
  it('reads its trigger key as the string on, not a YAML 1.1 boolean', () => {
    expect(Object.keys(WORKFLOW)).toContain('on');
    expect(Object.keys(WORKFLOW)).not.toContain('true');
  });

  it('runs on pull requests into main and pushes to stretch/** only', () => {
    expect(Object.keys(WORKFLOW.on).sort()).toEqual(['pull_request', 'push']);
    expect(branchesOf(WORKFLOW, 'pull_request')).toEqual(['main']);
    expect(branchesOf(WORKFLOW, 'push')).toEqual(['stretch/**']);
  });

  it('holds one job, verify', () => {
    expect(Object.keys(WORKFLOW.jobs)).toEqual(['verify']);
  });

  it.each(GATES)('runs the %s gate as a named step, %s, under the not-cancelled guard', (name, command) => {
    const step = steps().find((each) => each.name === name);

    expect(step?.run).toBe(command);
    expect(step?.if).toBe(GUARD);
  });

  it('puts the three gates last, after the install', () => {
    const names = steps().map((step) => step.name);

    expect(names.slice(-GATES.length)).toEqual(GATES.map(([name]) => name));
  });

  it('installs from the frozen lockfile, before any gate', () => {
    const all = steps();
    const install = all.findIndex((step) => step.run === 'bun install --frozen-lockfile');
    const firstGate = all.findIndex((step) => step.name === GATES[0]?.[0]);

    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(firstGate);
  });

  it('checks out with actions/checkout@v4 and takes bun from package.json with setup-bun@v2', () => {
    const all = steps();
    const setup = all.find((step) => step.uses === 'oven-sh/setup-bun@v2');

    expect(all.some((step) => step.uses === 'actions/checkout@v4')).toBe(true);
    expect(setup?.with?.['bun-version-file']).toBe('package.json');
  });

  it('reads contents and nothing more', () => {
    expect(WORKFLOW.permissions).toEqual({ contents: 'read' });
  });

  it('times the job out after 30 minutes', () => {
    expect(WORKFLOW.jobs['verify']?.['timeout-minutes']).toBe(30);
  });
});
