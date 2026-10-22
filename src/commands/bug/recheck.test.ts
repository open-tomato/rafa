/**
 * Tests for `rafa bug recheck` (`recheck.ts`), each dispatched in-process
 * from a planted project over a planted tracker (resolved through the
 * registry seam), a planted `gh`, a planted `git` and a planted runner
 * (the `recheck` seam), so nothing is spawned. Every line, refusal and
 * reason is SPELLED here, never read off the module.
 *
 * A refusal that must leave the tracker unread is held beside the same
 * tracker answering a line the command accepts, which reads it, so an
 * empty record of calls cannot pass for a tracker never wired in.
 */
import type { RecheckBugOptions, RecheckRun } from './recheck-run.js';
import type { RecheckSeams } from './recheck.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';
import type { GhRunner, GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { CliEvent, EditableIssue, IssueRef, OpenIssue, Tracker } from '@open-tomato/rafa/ports';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '@open-tomato/rafa/core/adapters';
import { RAFA_VERSION } from '@open-tomato/rafa/core/command';

import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createRecheckCommand, RECHECK_USAGE } from './recheck.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bug-recheck-test-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command sits under. */
const SUBJECTS = [{ name: 'bug', summary: 'bugs' }];

/** The kind of the planted tracker that is not `local`. */
const PROBE = 'probe';

/** The commit the planted git answers. */
const COMMIT = 'abc1234';

/** The repository label the planted remote normalises to. */
const REPO = 'github.com/open-tomato/rafa';

/** A secret the planted environment holds. */
const SECRET = 'ghp_planted0secret0value';

/** The test file every runnable reference names, written under the project root. */
const TEST_FILE = 'src/a.test.ts';

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
  readonly comments: { readonly id: string; readonly body: string }[];
}

/** How the planted tracker is shaped. */
interface TrackerShape {
  readonly kind?: string;
  readonly openIssues?: boolean | 'throws';
  readonly editable?: boolean;
  readonly commentThrows?: readonly string[];
}

/** A tracker of `kind` holding `bugs` by number, recording every call. */
function plantedTracker(bugs: Readonly<Record<string, PlantedBug>>, shape: TrackerShape, calls: TrackerCalls): Tracker {
  const kind = shape.kind ?? PROBE;
  const refOf = (id: string): IssueRef => ({ opt: 0, kind, externalId: id, url: null });
  const bugAt = (ref: IssueRef): PlantedBug => {
    const bug = bugs[ref.externalId];
    if (bug === undefined) throw new Error(`${kind} tracker: no issue ${ref.externalId}`);
    return bug;
  };
  const refuse = (): Promise<never> => Promise.reject(new Error(`${kind}: not modelled`));
  const editable = async (ref: IssueRef): Promise<EditableIssue> => {
    calls.reads.push(`editable ${ref.externalId}`);
    const bug = bugAt(ref);
    return { ref: refOf(ref.externalId), title: bug.title, body: bug.body, open: true, labels: [], author: bug.author };
  };
  const openIssues = async (type: string): Promise<OpenIssue[]> => {
    calls.lists.push(type);
    if (shape.openIssues === 'throws') throw new Error('the listing broke');
    return Object.entries(bugs).map(([id, bug]) => ({ ref: refOf(id), title: bug.title, body: bug.body, createdAt: null }));
  };
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
      const bug = bugAt(ref);
      return {
        opt: 0, title: bug.title, body: bug.body, type: 'bug', module: 'cli', priority: null,
        project: null, blockedBy: [], ref: refOf(ref.externalId), state: 'todo',
      };
    },
    create: refuse,
    comment: async (ref, body) => {
      if (shape.commentThrows?.includes(ref.externalId) === true) throw new Error('the comment bounced');
      calls.comments.push({ id: ref.externalId, body });
    },
    transition: refuse,
    ...shape.openIssues === false
      ? {}
      : { openIssues },
    ...shape.editable === false
      ? {}
      : { editable },
  };
}

/** A fresh record of tracker calls. */
function trackerCalls(): TrackerCalls {
  return { preflights: [], reads: [], lists: [], comments: [] };
}

/** The bug body of a record with `rerun` and `reproduce`, as the record's sections. */
function bugBody(rerun: string | null, reproduce = 'run the suite twice'): string {
  return [
    '## What', '', 'It breaks.', '',
    '## Reproduce', '', reproduce, '',
    ...rerun === null
      ? []
      : ['## Rerun', '', '```', rerun, '```', ''],
  ].join('\n');
}

/** A bug by `author` whose `Rerun` is `rerun`. */
function bug(title: string, rerun: string | null, author = 'alice', reproduce?: string): PlantedBug {
  return { title, body: bugBody(rerun, reproduce), author };
}

/** A git answering the four questions the command asks, as a clean checkout at `root` would. */
function plantedGit(root: string): GitRunner {
  const answers: Readonly<Record<string, string>> = {
    'rev-parse --show-toplevel': root,
    'rev-parse --short HEAD': COMMIT,
    'status --porcelain --untracked-files=no': '',
    'remote get-url origin': 'git@github.com:open-tomato/rafa.git',
  };
  return (args): GitResult => {
    const stdout = answers[args.join(' ')];
    return stdout === undefined
      ? { ok: false, stdout: '', stderr: `planted git: ${args.join(' ')}` }
      : { ok: true, stdout: `${stdout}\n`, stderr: '' };
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

/** A runner answering `runs` by the reference's path, the pass sequence when it names none, recording each call. */
function plantedRecheck(runs: Readonly<Record<string, RecheckRun>> = {}): {
  readonly recheck: (options: RecheckBugOptions) => Promise<RecheckRun>;
  readonly calls: RecheckBugOptions[];
} {
  const calls: RecheckBugOptions[] = [];
  const recheck = (options: RecheckBugOptions): Promise<RecheckRun> => {
    calls.push(options);
    const key = options.pattern === null
      ? options.path
      : `${options.path} ${options.pattern}`;
    return Promise.resolve(runs[key] ?? { verdict: 'gone', runs: 1 + options.runs, failedRuns: null, timedOutRuns: 0 });
  };
  return { recheck, calls };
}

/** The environment the command reads instead of `process.env`. */
const PLANTED_ENV = { PATH: '/usr/bin:/bin', GITHUB_TOKEN: SECRET, FORCE_COLOR: '1', LANG: 'C' };

/** A planted case: the project, its tracker's record of calls, and the gh and the runner it was made with. */
interface Case {
  readonly project: PlantedProject;
  readonly calls: TrackerCalls;
  readonly gh: ReturnType<typeof plantedGh>;
  readonly runner: ReturnType<typeof plantedRecheck>;
  readonly run: (words: readonly string[]) => Promise<CapturedRun>;
}

/** What a case is planted with. */
interface CaseOptions {
  /** The bugs by number, or what makes them from the project root. */
  readonly bugs?: Readonly<Record<string, PlantedBug>> | ((root: string) => Readonly<Record<string, PlantedBug>>);
  readonly shape?: TrackerShape;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly runs?: Readonly<Record<string, RecheckRun>>;
  /** The config's lines after `tracker:`, the planted kind as default when left out. */
  readonly tracker?: string;
  /** More config lines. */
  readonly extra?: string;
  /** A broken kind the chain tries first, so it lands on the planted one degraded. */
  readonly degraded?: boolean;
}

/** A project holding `src/a.test.ts`, over the planted tracker, gh, git and runner. */
function plantCase(options: CaseOptions = {}): Case {
  const shape = options.shape ?? {};
  const kind = shape.kind ?? PROBE;
  const trackerConfig = options.degraded === true
    ? `  default: broken\n  fallback: [${kind}]\n`
    : options.tracker ?? `  default: ${kind}\n`;
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), `tracker:\n${trackerConfig}bugs:\n  recheck:\n    runs: 3\n    timeoutSeconds: 7\n${options.extra ?? ''}`);
  mkdirSync(join(project.root, 'src'), { recursive: true });
  writeFileSync(join(project.root, TEST_FILE), 'import { test } from "bun:test";\ntest("a case", () => {});\n');
  const calls = trackerCalls();
  const bugs = typeof options.bugs === 'function'
    ? options.bugs(project.root)
    : options.bugs ?? {};
  const registry = createAdapterRegistry([
    {
      port: 'tracker',
      kind,
      portVersion: PORT_VERSIONS.tracker,
      create: () => plantedTracker(bugs, shape, calls),
    },
    {
      port: 'tracker',
      kind: 'broken',
      portVersion: PORT_VERSIONS.tracker,
      create: () => ({
        ...plantedTracker({}, { kind: 'broken' }, trackerCalls()),
        preflight: () => Promise.resolve({ ok: false, reason: 'broken is down' }),
      }),
    },
  ]);
  const gh = plantedGh(options.permissions ?? { alice: 'write' });
  const runner = plantedRecheck(options.runs);
  const seams: RecheckSeams = {
    registry,
    gh: gh.run,
    git: plantedGit(project.root),
    cwd: () => project.root,
    env: () => PLANTED_ENV,
    recheck: runner.recheck,
  };
  const run = (words: readonly string[]): Promise<CapturedRun> => dispatchInProject(['bug', 'recheck', ...words], SUBJECTS, [createRecheckCommand(seams)], project);
  return { project, calls, gh, runner, run };
}

/** The data of the terminal result event of a json-mode run. */
function resultData(run: CapturedRun): Record<string, unknown> {
  const last: CliEvent | undefined = eventsOf(run.stdout).at(-1);
  expect(last).toMatchObject({ type: 'result', ok: true });
  return (last as { data: Record<string, unknown> }).data;
}

/** The rows of a json-mode run. */
function rowsOf(run: CapturedRun): readonly Record<string, unknown>[] {
  return resultData(run)['rows'] as Record<string, unknown>[];
}

describe('rafa bug recheck, the line', () => {
  it.each([
    [[], 'Name a bug by its number, or give --all'],
    [['1', '--all'], '--all rechecks every open bug: give it or bug numbers, not both'],
    [['0'], '"0" is no issue number: a whole number from 1'],
    [['12', 'x'], '"x" is no issue number: a whole number from 1'],
    [['03'], '"03" is no issue number: a whole number from 1'],
    [['1.5'], '"1.5" is no issue number: a whole number from 1'],
  ])('refuses %j with exit code 1, resolving no tracker', async (words, problem) => {
    const planted = plantCase({ bugs: { 1: bug('one', `bun test ${TEST_FILE}`) } });

    const refused = await planted.run(words);
    expect(refused).toEqual({ exitCode: 1, stdout: '', stderr: `❌ ${problem}\nUsage: ${RECHECK_USAGE}\n` });
    expect(planted.calls.preflights).toEqual([]);

    // The control: the same tracker answering a line the command accepts is resolved and read.
    expect((await planted.run(['1'])).exitCode).toBe(0);
    expect(planted.calls.preflights).toEqual([PROBE]);
  });

  it.each([
    [['--all=yes'], `❌ --all takes no value, and read "yes" as one. Usage: ${RECHECK_USAGE}\n`],
    [['1', '--comment=now'], `❌ --comment takes no value, and read "now" as one. Usage: ${RECHECK_USAGE}\n`],
  ])('refuses a value given to a switch, %j, resolving no tracker', async (words, stderr) => {
    const planted = plantCase({ bugs: { 1: bug('one', `bun test ${TEST_FILE}`) } });

    expect(await planted.run(words)).toEqual({ exitCode: 1, stdout: '', stderr });
    expect(planted.calls.preflights).toEqual([]);
  });
});

describe('rafa bug recheck, the tracker', () => {
  it('exits 1 on a degraded chain before any issue is read, naming the tracker landed on and tracker.default', async () => {
    const planted = plantCase({ bugs: { 1: bug('one', `bun test ${TEST_FILE}`) }, degraded: true });

    for (const words of [['1'], ['--all']]) {
      const run = await planted.run(words);
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toBe('❌ rafa bug recheck: the tracker chain fell back to probe, not tracker.default broken '
        + '(broken: broken is down); a bug number there names another issue, so no bug was read\n');
    }
    // The chain did land on the planted tracker, and it read nothing of it.
    expect(planted.calls.preflights).toEqual([PROBE, PROBE]);
    expect([planted.calls.reads, planted.calls.lists, planted.runner.calls]).toEqual([[], [], []]);
  });

  it('rechecks every open bug with --all, listing the bug type once', async () => {
    const planted = plantCase({
      bugs: { 3: bug('three', `bun test ${TEST_FILE}`), 5: bug('five', 'bun test src/gone.test.ts') },
    });

    const run = await planted.run(['--all', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(planted.calls.lists).toEqual(['bug']);
    expect(rowsOf(run).map((row) => [row['issue'], row['title'], row['verdict']])).toEqual([[3, 'three', 'gone'], [5, 'five', 'stale']]);
  });

  it('exits 1 with --all on a tracker with no listing, and on one whose listing throws', async () => {
    const none = plantCase({ shape: { openIssues: false } });
    const throws = plantCase({ shape: { openIssues: 'throws' } });

    expect(await none.run(['--all'])).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ rafa bug recheck --all: the probe tracker lists no open issues; name the bugs by number\n',
    });
    expect(await throws.run(['--all'])).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ Could not list the open bugs on the probe tracker: the listing broke\n',
    });
    expect(throws.calls.lists).toEqual(['bug']);
  });

  it('reads a numbered bug through get on a tracker without editable, and skips one it cannot read', async () => {
    const planted = plantCase({ shape: { kind: 'local', editable: false }, bugs: { 1: bug('one', `bun test ${TEST_FILE}`) } });

    const run = await planted.run(['1', '9', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect(planted.calls.reads.sort()).toEqual(['get 1', 'get 9']);
    expect(rowsOf(run).map((row) => [row['issue'], row['verdict'], row['reason']])).toEqual([
      [1, 'gone', null],
      [9, 'skipped', 'could not read local issue 9: local tracker: no issue 9'],
    ]);
  });
});

describe('rafa bug recheck, one bug', () => {
  it('carries the reproduce text on a manual row, and runs nothing for it', async () => {
    const planted = plantCase({
      bugs: {
        1: bug('chained', `bun test ${TEST_FILE}; echo x`, 'alice', 'open the board\nclick twice'),
        2: bug('none', null, 'alice', 'just look'),
      },
    });

    const run = await planted.run(['1', '2', '--output=json']);

    expect(rowsOf(run)).toEqual([
      {
        issue: 1, title: 'chained', verdict: 'manual', reference: null, runs: 0, failedRuns: null,
        reason: `a shell character ; in ${TEST_FILE};`, reproduce: 'open the board\nclick twice', commented: false,
      },
      {
        issue: 2, title: 'none', verdict: 'manual', reference: null, runs: 0, failedRuns: null,
        reason: 'no Rerun section', reproduce: 'just look', commented: false,
      },
    ]);
    expect([planted.runner.calls, planted.gh.logins]).toEqual([[], []]);
  });

  it('prints the reproduce text indented under a manual row in text mode', async () => {
    const planted = plantCase({ bugs: { 1: bug('chained', 'bun test ../a.test.ts', 'alice', 'open the board\nclick twice') } });

    const run = await planted.run(['1']);

    expect(run).toEqual({
      exitCode: 0,
      stdout: [
        `rafa bug recheck at rafa ${RAFA_VERSION}, code ${COMMIT}, checkout ${planted.project.root}`,
        'left out of the environment: GITHUB_TOKEN',
        '#1 manual a path that leaves the checkout: ../a.test.ts',
        '    open the board',
        '    click twice',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  it('is manual for a file a symlink takes outside the checkout, and stale for a file not there', async () => {
    const planted = plantCase({
      bugs: { 1: bug('outside', 'bun test src/out.test.ts'), 2: bug('gone file', 'bun test src/gone.test.ts -t "a case"') },
    });
    const elsewhere = mkdtempSync(join(tempBase, 'elsewhere-'));
    writeFileSync(join(elsewhere, 'out.test.ts'), '');
    symlinkSync(join(elsewhere, 'out.test.ts'), join(planted.project.root, 'src', 'out.test.ts'));

    const rows = rowsOf(await planted.run(['1', '2', '--output=json']));

    expect(rows.map((row) => [row['verdict'], row['reference'], row['reason'], row['reproduce']])).toEqual([
      ['manual', { file: 'src/out.test.ts', pattern: null }, 'src/out.test.ts lies outside the checkout', 'run the suite twice'],
      ['stale', { file: 'src/gone.test.ts', pattern: 'a case' }, 'no file src/gone.test.ts in the checkout', null],
    ]);
    expect([planted.runner.calls, planted.gh.logins]).toEqual([[], []]);
  });

  it('runs a runnable reference with the config\'s runs and deadline, the secrets left out, a JUnit folder per bug', async () => {
    const planted = plantCase({ bugs: { 1: bug('one', `bun test ${TEST_FILE} -t "a case"`), 2: bug('two', `bun test ./${TEST_FILE}`) } });

    const run = await planted.run(['1', '2', '--output=json']);
    const [first, second] = planted.runner.calls;

    expect(run.exitCode).toBe(0);
    expect(first).toMatchObject({ path: TEST_FILE, pattern: 'a case', checkout: planted.project.root, runs: 3, timeoutMs: 7000 });
    expect(second).toMatchObject({ path: TEST_FILE, pattern: null });
    expect(first?.env).toEqual({ PATH: '/usr/bin:/bin', LANG: 'C' });
    expect(first?.junitDir).toEndWith('/issue-1');
    expect(second?.junitDir).toEndWith('/issue-2');
    expect(first?.junitDir.slice(0, -'/issue-1'.length)).toBe(second?.junitDir.slice(0, -'/issue-2'.length) ?? '');
    // The JUnit directory is removed once the command ends.
    expect(existsSync(join(first?.junitDir ?? '', '..'))).toBe(false);
    expect(resultData(run)['secretsLeftOut']).toEqual(['GITHUB_TOKEN']);
  });

  it('warns how many runs of a bug timed out', async () => {
    const planted = plantCase({
      bugs: { 1: bug('slow', `bun test ${TEST_FILE}`) },
      runs: { [TEST_FILE]: { verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 1 } },
    });

    const run = await planted.run(['1']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('warn: probe issue 1: 1 of 1 runs timed out after 7s\n');
    expect(run.stdout).toContain(`#1 reproduces ${TEST_FILE}\n`);
  });
});

describe('rafa bug recheck, trust', () => {
  it('skips an untrusted author with nothing spawned, looking each login up once', async () => {
    const planted = plantCase({
      bugs: {
        1: bug('by alice', `bun test ${TEST_FILE}`, 'alice'),
        2: bug('by mallory', `bun test ${TEST_FILE}`, 'mallory'),
        3: bug('by mallory again', `bun test ${TEST_FILE}`, 'Mallory'),
        4: bug('by alice again', `bun test ${TEST_FILE}`, 'alice'),
      },
      permissions: { alice: 'write', mallory: 'read' },
    });

    const rows = rowsOf(await planted.run(['--all', '--output=json']));

    expect(rows.map((row) => [row['issue'], row['verdict'], row['reason']])).toEqual([
      [1, 'gone', null],
      [2, 'skipped', `opened by mallory, who has no write access to ${REPO}`],
      [3, 'skipped', `opened by Mallory, who has no write access to ${REPO}`],
      [4, 'gone', null],
    ]);
    expect(planted.gh.logins).toEqual(['alice', 'mallory']);
    expect(planted.runner.calls.map((call) => call.junitDir.split('/').at(-1))).toEqual(['issue-1', 'issue-4']);
    // --all lists no author, so each runnable bug's author is read once through editable.
    expect(planted.calls.reads).toEqual(['editable 1', 'editable 2', 'editable 3', 'editable 4']);
  });

  it('trusts board.trustedAuthors without a lookup, and skips a bug whose tracker names no author', async () => {
    const planted = plantCase({
      bugs: { 1: bug('by the bot', `bun test ${TEST_FILE}`, 'rafa-bot'), 2: bug('by nobody', `bun test ${TEST_FILE}`, '') },
      extra: 'board:\n  trustedAuthors: [rafa-bot]\n',
    });

    const rows = rowsOf(await planted.run(['1', '2', '--output=json']));

    expect(rows.map((row) => [row['verdict'], row['reason']])).toEqual([
      ['gone', null],
      ['skipped', 'the probe tracker names nobody who opened it, so no trust was read'],
    ]);
    expect(planted.gh.logins).toEqual([]);
    expect(planted.runner.calls).toHaveLength(1);
  });

  it('reads no trust on the local tracker, which holds no accounts', async () => {
    const planted = plantCase({ shape: { kind: 'local' }, bugs: { 1: bug('local', `bun test ${TEST_FILE}`, '') } });

    const rows = rowsOf(await planted.run(['1', '--output=json']));

    expect(rows.map((row) => row['verdict'])).toEqual(['gone']);
    expect(planted.gh.logins).toEqual([]);
    expect(planted.runner.calls).toHaveLength(1);
  });
});

describe('rafa bug recheck, --comment', () => {
  /** Four runnable bugs, one per verdict a run answers, and a manual one; the gone one's pattern holds the root and a secret. */
  function verdictCase(commentThrows: readonly string[] = []): Case {
    return plantCase({
      shape: { commentThrows },
      bugs: (root) => ({
        1: bug('gone', `bun test ${TEST_FILE} -t "${root}/case ${SECRET}"`),
        2: bug('flaky', `bun test ${TEST_FILE} -t "flaky"`),
        3: bug('reproduces', `bun test ${TEST_FILE} -t "reproduces"`),
        4: bug('stale', `bun test ${TEST_FILE} -t "stale"`),
        5: bug('manual', null),
      }),
      runs: {
        [`${TEST_FILE} flaky`]: { verdict: 'flaky', runs: 4, failedRuns: 2, timedOutRuns: 0 },
        [`${TEST_FILE} reproduces`]: { verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 },
        [`${TEST_FILE} stale`]: { verdict: 'stale', runs: 1, failedRuns: null, timedOutRuns: 0 },
      },
    });
  }

  /** `verdictCase` run over all five bugs with --comment in json mode. */
  async function commented(): Promise<{ planted: Case; run: CapturedRun }> {
    const planted = verdictCase();
    return { planted, run: await planted.run(['1', '2', '3', '4', '5', '--comment', '--output=json']) };
  }

  it('posts on gone and flaky bugs only, the text redacted, and marks those rows commented', async () => {
    const { planted, run } = await commented();
    const rows = rowsOf(run);

    expect(run.exitCode).toBe(0);
    expect(planted.calls.comments.map((comment) => comment.id)).toEqual(['1', '2']);
    expect(planted.calls.comments[1]?.body).toBe(`flaky at rafa ${RAFA_VERSION}, \`${COMMIT}\`: \`${TEST_FILE} -t "flaky"\` failed 2 of 4 runs`);
    expect(rows.map((row) => [row['verdict'], row['commented']])).toEqual([
      ['gone', true], ['flaky', true], ['reproduces', false], ['stale', false], ['manual', false],
    ]);
  });

  it('takes the checkout and every named secret out of the comment, which the row keeps whole', async () => {
    const { planted, run } = await commented();
    const gone = planted.calls.comments[0]?.body ?? '';

    expect(gone).toBe(`gone at rafa ${RAFA_VERSION}, \`${COMMIT}\`: \`${TEST_FILE} -t "case [redacted: GITHUB_TOKEN]"\` passed 4 runs`);
    // The control: the text before redaction held both, so the check could have failed.
    expect((rowsOf(run)[0]?.['reference'] as { pattern: string }).pattern).toBe(`${planted.project.root}/case ${SECRET}`);
  });

  it('writes no comment without --comment, and a comment that throws is a warning, not an exit', async () => {
    const quiet = verdictCase();
    const bounced = verdictCase(['2']);

    const quietRun = await quiet.run(['1', '2', '--output=json']);
    const bouncedRun = await bounced.run(['1', '2', '--comment']);

    expect(quietRun.exitCode).toBe(0);
    expect(quiet.calls.comments).toEqual([]);
    expect(bouncedRun.exitCode).toBe(0);
    expect(bouncedRun.stdout).toContain('warn: could not comment on probe issue 2: the comment bounced\n');
    expect(bounced.calls.comments.map((comment) => comment.id)).toEqual(['1']);
  });
});

describe('rafa bug recheck, the result', () => {
  it('gives the report as the json result\'s data with exit code 0, whatever the verdicts', async () => {
    const planted = plantCase({
      bugs: { 7: bug('fails', `bun test ${TEST_FILE}`) },
      runs: { [TEST_FILE]: { verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 } },
    });

    const run = await planted.run(['7', '--output=json']);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(eventsOf(run.stdout).map((event) => event.type)).toEqual(['start', 'result']);
    expect(resultData(run)).toEqual({
      rafa: RAFA_VERSION,
      code: COMMIT,
      checkout: planted.project.root,
      secretsLeftOut: ['GITHUB_TOKEN'],
      tracker: { kind: PROBE, degraded: false, fallbackReason: null },
      rows: [{
        issue: 7, title: 'fails', verdict: 'reproduces', reference: { file: TEST_FILE, pattern: null },
        runs: 1, failedRuns: null, reason: null, reproduce: null, commented: false,
      }],
    });
  });

  it('declares text and json, the n argument, the two switches, three examples and no spends', () => {
    const command = createRecheckCommand();

    expect([command.name, command.subject, command.action]).toEqual(['bug recheck', 'bug', 'recheck']);
    expect(command.outputs).toEqual(['text', 'json']);
    expect(command.args.map((arg) => [arg.name, arg.required ?? false])).toEqual([['n', false]]);
    expect(command.flags.map((flag) => [flag.name, flag.type])).toEqual([['all', 'boolean'], ['comment', 'boolean']]);
    expect(command.examples.map((example) => example.cmd)).toEqual([
      'rafa bug recheck --all', 'rafa bug recheck 412', 'rafa bug recheck 412 415 --comment',
    ]);
    expect(command.spends).toBeUndefined();
  });
});
