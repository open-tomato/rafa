/**
 * The `verify` workflow at `.github/workflows/verify.yml`: the gates that
 * run on every pull request into `main` or `integration` and on every
 * push to a `stretch/**` branch. The root eslint config lints no YAML, so this test
 * is the file's only gate. Pull requests into `stretch/**` report no
 * check, which keeps `rafa pr merge <pr> --skip-checks` working there.
 *
 * The workflow holds two jobs under the same triggers, permissions and
 * timeout: `verify` (ring 0) runs the whole suite, lint and types, and
 * `affected` (ring 1) runs `turbo` over the packages a change reaches,
 * the type references and the workspace graph check, against the base
 * `TURBO_SCM_BASE` names.
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

/** One job of the workflow, as the workflow writes it. */
interface Job {
  readonly 'runs-on': string;
  readonly 'timeout-minutes': number;
  readonly env?: Readonly<Record<string, unknown>>;
  readonly steps: readonly Step[];
}

/** The parts of a workflow this test reads. */
interface Workflow {
  readonly on: Readonly<Record<string, { readonly branches?: readonly string[] } | null>>;
  readonly permissions: Readonly<Record<string, string>>;
  readonly jobs: Readonly<Record<string, Job>>;
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

/** The install step's command, which every job runs before its first gate. */
const INSTALL = 'bun install --frozen-lockfile';

/** The three gate steps of ring 0's job `verify`, by name, with the command each runs. */
const VERIFY_GATES: ReadonlyArray<readonly [string, string]> = [
  ['Test', 'bun test'],
  ['Lint', 'bunx eslint .'],
  ['Types', 'bun run check-types'],
];

/** The three gate steps of ring 1's job `affected`, by name, with the command each runs. */
const AFFECTED_GATES: ReadonlyArray<readonly [string, string]> = [
  ['Affected', 'bun run verify:affected'],
  ['References', 'bunx tsc --build tsconfig.references.json'],
  ['Graph', 'bun scripts/workspace/graph-check.ts'],
];

/**
 * The base `affected` hands `turbo run --affected`: the pull request's
 * base branch on a pull request, and the trunk on the only other
 * trigger, a push to `stretch/**`.
 */
const SCM_BASE = '${{ github.event_name == \'pull_request\' && format(\'origin/{0}\', github.base_ref) || \'origin/integration\' }}';

/** The steps of the job `job`, none when the workflow lacks it. */
function stepsOf(job: string): readonly Step[] {
  return WORKFLOW.jobs[job]?.steps ?? [];
}

/** The two jobs, each with its gates, for the cases both must hold. */
const JOBS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ['verify', VERIFY_GATES],
  ['affected', AFFECTED_GATES],
];

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

  it('runs on pull requests into main and integration, and pushes to stretch/** only', () => {
    expect(Object.keys(WORKFLOW.on).sort()).toEqual(['pull_request', 'push']);
    expect(branchesOf(WORKFLOW, 'pull_request')).toEqual(['main', 'integration']);
    expect(branchesOf(WORKFLOW, 'push')).toEqual(['stretch/**']);
  });

  it('holds two jobs, verify and affected', () => {
    expect(Object.keys(WORKFLOW.jobs)).toEqual(['verify', 'affected']);
  });

  it('reads contents and nothing more', () => {
    expect(WORKFLOW.permissions).toEqual({ contents: 'read' });
  });
});

describe.each(JOBS)('the job %s', (job, gates) => {
  it.each(gates)('runs the %s gate as a named step, %s, under the not-cancelled guard', (name, command) => {
    const step = stepsOf(job).find((each) => each.name === name);

    expect(step?.run).toBe(command);
    expect(step?.if).toBe(GUARD);
  });

  it('puts its three gates last, after the install', () => {
    const names = stepsOf(job).map((step) => step.name);

    expect(names.slice(-gates.length)).toEqual(gates.map(([name]) => name));
  });

  it('installs from the frozen lockfile, before any gate', () => {
    const all = stepsOf(job);
    const install = all.findIndex((step) => step.run === INSTALL);
    const firstGate = all.findIndex((step) => step.name === gates[0]?.[0]);

    expect(install).toBeGreaterThan(-1);
    expect(firstGate).toBeGreaterThan(-1);
    expect(install).toBeLessThan(firstGate);
  });

  it('checks out with actions/checkout@v7 and takes bun from package.json with setup-bun@v2', () => {
    const all = stepsOf(job);
    const setup = all.find((step) => step.uses === 'oven-sh/setup-bun@v2');

    expect(all.some((step) => step.uses === 'actions/checkout@v7')).toBe(true);
    expect(setup?.with?.['bun-version-file']).toBe('package.json');
  });

  it('runs on ubuntu-latest and times out after 30 minutes', () => {
    expect(WORKFLOW.jobs[job]?.['runs-on']).toBe('ubuntu-latest');
    expect(WORKFLOW.jobs[job]?.['timeout-minutes']).toBe(30);
  });
});

describe('the job verify, ring 0', () => {
  it('runs the checkout, the setup, the install and its three gates, and nothing more', () => {
    expect(stepsOf('verify').map((step) => step.name)).toEqual([
      'Checkout',
      'Set up bun',
      'Install',
      ...VERIFY_GATES.map(([name]) => name),
    ]);
  });

  it('checks out the default shallow history and sets no env', () => {
    const checkout = stepsOf('verify').find((step) => step.uses === 'actions/checkout@v7');

    expect(checkout?.with).toBeUndefined();
    expect(WORKFLOW.jobs['verify']?.env).toBeUndefined();
  });
});

describe('the job affected, ring 1', () => {
  it('checks out the whole history, so the base turbo compares against is reachable', () => {
    const checkout = stepsOf('affected').find((step) => step.uses === 'actions/checkout@v7');

    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  it('names its base in TURBO_SCM_BASE, one expression over github.event_name', () => {
    expect(WORKFLOW.jobs['affected']?.env?.['TURBO_SCM_BASE']).toBe(SCM_BASE);
  });

  it('takes the pull request\'s base on pull_request, and the trunk on push, the one other trigger', () => {
    const expression = String(WORKFLOW.jobs['affected']?.env?.['TURBO_SCM_BASE']);

    expect(expression).toContain('github.event_name == \'pull_request\'');
    expect(expression).toContain('format(\'origin/{0}\', github.base_ref)');
    expect(expression).toContain('|| \'origin/integration\'');
    expect(Object.keys(WORKFLOW.on).filter((trigger) => trigger !== 'pull_request')).toEqual(['push']);
  });

  it('turns turbo\'s telemetry off', () => {
    expect(WORKFLOW.jobs['affected']?.env?.['TURBO_TELEMETRY_DISABLED']).toBe('1');
  });

  it('would see a shallow checkout, the control over a job with fetch-depth 1', () => {
    const shallow = parse(TEXT.replace('fetch-depth: 0', 'fetch-depth: 1'));
    const checkout = shallow.jobs['affected']?.steps.find((step) => step.uses === 'actions/checkout@v7');

    expect(checkout?.with?.['fetch-depth']).toBe(1);
  });
});
