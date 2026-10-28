/**
 * Integration test of `rafa bug recheck`: the command dispatched through
 * the CLI over a planted tracker, a planted `gh` and a real temporary git
 * checkout (`git init`, one commit), where a reference that is runnable
 * runs `bun test` for real through the suite runner, one spawn per run.
 *
 * The runner seam wraps the real `recheckBug` and records every call, so
 * "the runner was never called" is read off a counter that the control
 * cases prove is wired in. The expected rows and reasons are SPELLED here,
 * never read off the module.
 *
 * Every case reads `runs: 2`, so a passing reference runs 1 + 2 = 3 times.
 */
import type { RecheckBugOptions, RecheckRun } from './recheck-run.js';
import type { RecheckSeams } from './recheck.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { GhRunner } from '@open-tomato/rafa/core/git';
import type { CliEvent, EditableIssue, IssueRef, OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';
import { rerunOf } from '@open-tomato/rafa-pr/triage/bug-filing';

import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { recheckBug } from './recheck-run.js';
import { createRecheckCommand } from './recheck.js';

/** The further runs after a first pass, so a passing reference runs three times. */
const FURTHER_RUNS = 2;

/** A run's deadline in the planted config, generous for a cold `bun test`. */
const TIMEOUT_SECONDS = 60;

/** How long a case may take, spawns included. */
const CASE_TIMEOUT_MS = 60_000;

/** The kind of the planted tracker that is not `local`. */
const PROBE = 'probe';

/** The subject the command sits under. */
const SUBJECTS = [{ name: 'bug', summary: 'bugs' }];

const PASSING_FILE = 'src/passing.test.ts';
const ALTERNATING_FILE = 'src/alternating.test.ts';
const COUNTER_FILE = 'src/alternating.count';

/** A test file whose case passes. */
const PASSING_SOURCE = 'import { expect, test } from "bun:test";\ntest("passes", () => {\n  expect(1).toBe(1);\n});\n';

/** A test file whose case counts its runs in a file beside it and fails on every even count. */
const ALTERNATING_SOURCE = [
  'import { expect, test } from "bun:test";',
  'import { readFileSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  '',
  'test("alternates", () => {',
  '  const counter = join(import.meta.dir, "alternating.count");',
  '  const count = Number(readFileSync(counter, "utf8")) + 1;',
  '  writeFileSync(counter, String(count));',
  '  expect(count % 2).toBe(1);',
  '});',
  '',
].join('\n');

/** A preload file the strict reference refuses to hand to the runner. */
const PRELOAD_SOURCE = 'throw new Error("a preload must never run");\n';

const PAREN_FILE = 'src/paren.test.ts';
const PAREN_CASE = 'a (case)';

/** A test file whose one case is named `a (case)` and either passes or fails. */
function parenSource(passes: boolean): string {
  return `import { expect, test } from "bun:test";\ntest("${PAREN_CASE}", () => {\n  expect(1).toBe(${passes
    ? 1
    : 2});\n});\n`;
}

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bug-recheck-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** One bug the planted tracker holds. */
interface PlantedBug {
  readonly title: string;
  readonly body: string;
  readonly author: string;
}

/** What the planted tracker records. */
interface TrackerCalls {
  readonly preflights: string[];
  readonly reads: string[];
  readonly lists: string[];
}

/** The body of a bug record with `rerun` (a value in the `Rerun` fence, or none) and a one-line `Reproduce`. */
function bugBody(rerun: string | null): string {
  return [
    '## What', '', 'It breaks.', '',
    '## Reproduce', '', 'run the suite twice', '',
    ...rerun === null
      ? []
      : ['## Rerun', '', '```', rerun, '```', ''],
  ].join('\n');
}

/** A bug by `author` whose `Rerun` is `rerun`. */
function bug(title: string, rerun: string | null, author = 'alice'): PlantedBug {
  return { title, body: bugBody(rerun), author };
}

/** A tracker of `kind` holding `bugs` by number, recording every call. */
function plantedTracker(kind: string, bugs: Readonly<Record<string, PlantedBug>>, calls: TrackerCalls): Tracker {
  const refOf = (id: string): IssueRef => ({ opt: 0, kind, externalId: id, url: null });
  const bugAt = (ref: IssueRef): PlantedBug => {
    const found = bugs[ref.externalId];
    if (found === undefined) throw new Error(`${kind} tracker: no issue ${ref.externalId}`);
    return found;
  };
  const refuse = (): Promise<never> => Promise.reject(new Error(`${kind}: not modelled`));
  return {
    kind,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: async () => {
      calls.preflights.push(kind);
      return { ok: true };
    },
    find: refuse,
    get: async (ref) => {
      calls.reads.push(`get ${ref.externalId}`);
      const found = bugAt(ref);
      return {
        opt: 0, title: found.title, body: found.body, type: 'bug', module: 'cli', priority: null,
        project: null, blockedBy: [], ref: refOf(ref.externalId), state: 'todo',
      };
    },
    create: refuse,
    comment: async () => undefined,
    transition: refuse,
    openIssues: async (type: string): Promise<OpenIssue[]> => {
      calls.lists.push(type);
      return Object.entries(bugs).map(([id, planted]) => ({ ref: refOf(id), title: planted.title, body: planted.body, createdAt: null }));
    },
    editable: async (ref: IssueRef): Promise<EditableIssue> => {
      calls.reads.push(`editable ${ref.externalId}`);
      const found = bugAt(ref);
      return { ref: refOf(ref.externalId), title: found.title, body: found.body, open: true, labels: [], author: found.author };
    },
  };
}

/** A gh answering each login's permission from `permissions`, recording every login asked about. */
function plantedGh(permissions: Readonly<Record<string, string>>): { readonly run: GhRunner; readonly logins: string[] } {
  const logins: string[] = [];
  const run: GhRunner = (args) => {
    const login = /collaborators\/([^/]+)\/permission$/.exec(args.join(' '))?.[1];
    if (args[0] !== 'api' || login === undefined) return Promise.resolve({ ok: false, stdout: '', stderr: 'planted gh: not modelled' });
    logins.push(login);
    const permission = permissions[login] ?? 'none';
    return Promise.resolve({ ok: true, stdout: JSON.stringify({ permission, role_name: permission }), stderr: '' });
  };
  return { run, logins };
}

/** Runs git in `cwd` with an identity of its own and no host configuration. */
function git(cwd: string, home: string, args: readonly string[]): void {
  execFileSync('git', [...args], {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });
}

/** A project that is also a git checkout holding the three test files, committed once. */
function plantCheckout(tracker: string): PlantedProject {
  const project = plantProject(
    mkdtempSync(join(tempBase, 'case-')),
    `tracker:\n${tracker}bugs:\n  recheck:\n    runs: ${FURTHER_RUNS}\n    timeoutSeconds: ${TIMEOUT_SECONDS}\n`,
  );
  mkdirSync(join(project.root, 'src'), { recursive: true });
  writeFileSync(join(project.root, PASSING_FILE), PASSING_SOURCE);
  writeFileSync(join(project.root, ALTERNATING_FILE), ALTERNATING_SOURCE);
  writeFileSync(join(project.root, COUNTER_FILE), '0');
  writeFileSync(join(project.root, 'src', 'x.ts'), PRELOAD_SOURCE);
  git(project.root, project.home, ['init', '-q', '.']);
  git(project.root, project.home, ['remote', 'add', 'origin', 'git@github.com:open-tomato/rafa.git']);
  git(project.root, project.home, ['add', '-A']);
  git(project.root, project.home, ['commit', '-q', '-m', 'the checkout']);
  return project;
}

/** A planted case: the project, what its tracker and gh recorded, the runner's calls, and the command line. */
interface Case {
  readonly project: PlantedProject;
  readonly calls: TrackerCalls;
  readonly gh: ReturnType<typeof plantedGh>;
  readonly runnerCalls: RecheckBugOptions[];
  readonly run: (words: readonly string[]) => Promise<CapturedRun>;
}

/** What a case is planted with. */
interface CaseOptions {
  readonly bugs: Readonly<Record<string, PlantedBug>>;
  /** The kind of the tracker the bugs sit on, `probe` when left out. */
  readonly kind?: string;
  /** True: `tracker.default` is a broken kind and the chain falls back to `kind`. */
  readonly degraded?: boolean;
  readonly permissions?: Readonly<Record<string, string>>;
}

/** A checkout over a planted tracker and gh, and the real runner behind a counting seam. */
function plantCase(options: CaseOptions): Case {
  const kind = options.kind ?? PROBE;
  const trackerConfig = options.degraded === true
    ? `  default: broken\n  fallback: [${kind}]\n`
    : `  default: ${kind}\n`;
  const project = plantCheckout(trackerConfig);
  const calls: TrackerCalls = { preflights: [], reads: [], lists: [] };
  const registry = createAdapterRegistry([
    { port: 'tracker', kind, portVersion: PORT_VERSIONS.tracker, create: () => plantedTracker(kind, options.bugs, calls) },
    {
      port: 'tracker',
      kind: 'broken',
      portVersion: PORT_VERSIONS.tracker,
      create: () => ({
        ...plantedTracker('broken', {}, { preflights: [], reads: [], lists: [] }),
        preflight: () => Promise.resolve({ ok: false, reason: 'broken is down' }),
      }),
    },
  ]);
  const gh = plantedGh(options.permissions ?? { alice: 'write' });
  const runnerCalls: RecheckBugOptions[] = [];
  const seams: RecheckSeams = {
    registry,
    gh: gh.run,
    cwd: () => project.root,
    // The child finds `bun` on its PATH, as `bun test` is spawned by name.
    env: () => ({ PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: tmpdir(), ...scratchHomeEnv(project.home) }),
    recheck: (runOptions): Promise<RecheckRun> => {
      runnerCalls.push(runOptions);
      return recheckBug(runOptions);
    },
  };
  const run = (words: readonly string[]): Promise<CapturedRun> => dispatchInProject(['bug', 'recheck', ...words], SUBJECTS, [createRecheckCommand(seams)], project);
  return { project, calls, gh, runnerCalls, run };
}

/** The rows of a json-mode run that exited 0. */
function rowsOf(run: CapturedRun): readonly Record<string, unknown>[] {
  expect(run.exitCode).toBe(0);
  const last: CliEvent | undefined = eventsOf(run.stdout).at(-1);
  expect(last).toMatchObject({ type: 'result', ok: true });
  return ((last as { data: Record<string, unknown> }).data['rows']) as Record<string, unknown>[];
}

describe('rafa bug recheck, over a real checkout and real bun test runs', () => {
  it('judges a passing reference gone after 1 + runs runs', async () => {
    const planted = plantCase({ bugs: { 1: bug('passes', `bun test ${PASSING_FILE}`) } });

    const rows = rowsOf(await planted.run(['1', '--output=json']));

    expect(rows).toEqual([{
      issue: 1, title: 'passes', verdict: 'gone', reference: { file: PASSING_FILE, pattern: null },
      runs: 1 + FURTHER_RUNS, failedRuns: null, reason: null, reproduce: null, commented: false,
    }]);
    expect(planted.runnerCalls.map((call) => [call.path, call.pattern, call.runs])).toEqual([[PASSING_FILE, null, FURTHER_RUNS]]);
    expect(planted.gh.logins).toEqual(['alice']);
  }, CASE_TIMEOUT_MS);

  it('prints the gone line in text mode', async () => {
    const planted = plantCase({ bugs: { 1: bug('passes', `bun test ${PASSING_FILE} -t "passes"`) } });

    const run = await planted.run(['1']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`#1 gone ${PASSING_FILE} -t "passes" (3 runs passed)`);
  }, CASE_TIMEOUT_MS);

  it('judges a reference failing on alternate runs flaky, with the count of failed runs', async () => {
    const planted = plantCase({ bugs: { 2: bug('alternates', `bun test ${ALTERNATING_FILE}`) } });

    const rows = rowsOf(await planted.run(['2', '--output=json']));

    // Runs 1, 2 and 3 see counts 1, 2 and 3: pass, fail, pass.
    expect(rows).toEqual([{
      issue: 2, title: 'alternates', verdict: 'flaky', reference: { file: ALTERNATING_FILE, pattern: null },
      runs: 1 + FURTHER_RUNS, failedRuns: 1, reason: null, reproduce: null, commented: false,
    }]);
    expect(readFileSync(join(planted.project.root, COUNTER_FILE), 'utf8')).toBe('3');
  }, CASE_TIMEOUT_MS);

  it.each([
    ['a chained command', 'bun test src/passing.test.ts; echo x'],
    ['a preload flag', 'bun test --preload ./src/x.ts src/passing.test.ts'],
    ['a path leaving the checkout', 'bun test ../a.test.ts'],
    ['a two-line value', 'bun test src/passing.test.ts\nbun test src/alternating.test.ts'],
  ])('judges %s manual, never calling the runner nor reading a login', async (_name, rerun) => {
    const planted = plantCase({ bugs: { 3: bug('manual', rerun) } });

    const rows = rowsOf(await planted.run(['3', '--output=json']));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ issue: 3, verdict: 'manual', runs: 0, failedRuns: null, reproduce: 'run the suite twice', commented: false });
    expect(typeof rows[0]?.['reason']).toBe('string');
    expect([planted.runnerCalls, planted.gh.logins]).toEqual([[], []]);
    // The preload and the chained echo never ran: the counter beside the alternating test is untouched.
    expect(readFileSync(join(planted.project.root, COUNTER_FILE), 'utf8')).toBe('0');

    // The control: the same planted case runs a reference the strict reading accepts.
    const control = plantCase({ bugs: { 3: bug('control', `bun test ${PASSING_FILE}`) } });
    expect(rowsOf(await control.run(['3', '--output=json']))[0]).toMatchObject({ verdict: 'gone' });
    expect(control.runnerCalls).toHaveLength(1);
  }, CASE_TIMEOUT_MS);

  it('judges a file that is gone stale, running nothing', async () => {
    const planted = plantCase({ bugs: { 4: bug('moved', 'bun test src/moved.test.ts') } });

    const rows = rowsOf(await planted.run(['4', '--output=json']));

    expect(rows).toEqual([{
      issue: 4, title: 'moved', verdict: 'stale', reference: { file: 'src/moved.test.ts', pattern: null },
      runs: 0, failedRuns: null, reason: 'no file src/moved.test.ts in the checkout', reproduce: null, commented: false,
    }]);
    expect([planted.runnerCalls, planted.gh.logins]).toEqual([[], []]);
  }, CASE_TIMEOUT_MS);

  it('skips an untrusted author, never calling the runner', async () => {
    const planted = plantCase({
      bugs: { 5: bug('stranger', `bun test ${ALTERNATING_FILE}`, 'mallory'), 6: bug('trusted', `bun test ${PASSING_FILE}`, 'alice') },
      permissions: { alice: 'write', mallory: 'read' },
    });

    const rows = rowsOf(await planted.run(['5', '6', '--output=json']));

    expect(rows.map((row) => [row['issue'], row['verdict']])).toEqual([[5, 'skipped'], [6, 'gone']]);
    expect(rows[0]?.['reason']).toBe('opened by mallory, who has no write access to github.com/open-tomato/rafa');
    expect(rows[0]).toMatchObject({ runs: 0, failedRuns: null });
    // Only the trusted bug reached the runner, and the untrusted bug's test never ran.
    expect(planted.runnerCalls.map((call) => call.path)).toEqual([PASSING_FILE]);
    expect(readFileSync(join(planted.project.root, COUNTER_FILE), 'utf8')).toBe('0');
    expect([...planted.gh.logins].sort()).toEqual(['alice', 'mallory']);
  }, CASE_TIMEOUT_MS);

  it.each([
    ['gone', true, 'gone'],
    ['reproduces', false, 'reproduces'],
  ] as const)('judges a case named with parentheses filed through triage %s when the file is %s', async (_name, passes, verdict) => {
    const rerun = rerunOf({ what: 'red', artifact: `${PAREN_FILE} > ${PAREN_CASE}` });
    expect(rerun).not.toBeNull();
    const planted = plantCase({ bugs: { 7: bug('parens', rerun) } });
    writeFileSync(join(planted.project.root, PAREN_FILE), parenSource(passes));

    const rows = rowsOf(await planted.run(['7', '--output=json']));

    expect(rows[0]).toMatchObject({ issue: 7, verdict, reference: { file: PAREN_FILE, pattern: 'a \\(case\\)' } });
    expect(planted.runnerCalls.map((call) => [call.path, call.pattern])).toEqual([[PAREN_FILE, 'a \\(case\\)']]);
  }, CASE_TIMEOUT_MS);

  it('exits 1 on a chain that fell back to local, before any issue is read', async () => {
    const planted = plantCase({ kind: 'local', degraded: true, bugs: { 1: bug('passes', `bun test ${PASSING_FILE}`) } });

    for (const words of [['1'], ['--all']]) {
      const run = await planted.run(words);
      expect(run.exitCode).toBe(1);
      expect(run.stdout).toBe('warn: tracker chain: broken unavailable: broken is down [tracker:unavailable]\n');
      expect(run.stderr).toBe('❌ rafa bug recheck: the tracker chain fell back to local, not tracker.default broken '
        + '(broken: broken is down); a bug number there names another issue, so no bug was read\n');
    }
    // The chain did land on the planted local tracker, and nothing of it was read or run.
    expect(planted.calls.preflights).toEqual(['local', 'local']);
    expect([planted.calls.reads, planted.calls.lists, planted.runnerCalls]).toEqual([[], [], []]);
  }, CASE_TIMEOUT_MS);
});
