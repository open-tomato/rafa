/**
 * The reader of `start/facade-always-run.ts`, over temporary git
 * repositories built here, never the checkout's own history. Each
 * repository opens with one commit, the base, holding a stub
 * `packages/<pkg>/index.test.ts` for each package the case names; the
 * case then commits its diff and reads it from that base. Each case that
 * reads nothing sits beside a control that reads one, from the same
 * repository, so a reader answering nothing for every diff reddens too.
 * The specifiers are the shapes the #1480 diff added, as the plan's
 * "Measure" notes list them.
 *
 * The last block drives `runTaskStep` over such a repository with nothing
 * scripted but the record append: git, the file listing and `bun test`
 * itself are the real ones, so the red it reads is the red of the
 * fixture's own `packages/demo/index.test.ts`.
 */
import type { SuiteStepContext } from './suite-step.js';
import type { SessionStep } from '@open-tomato/rafa/core/loop';
import type { GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { createGitRunner } from '@open-tomato/rafa-pr/pr/index';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { readFacadeAlwaysRun } from './facade-always-run.js';
import { runTaskStep } from './suite-step.js';

const BOARD_TEST = 'packages/rafa-board/index.test.ts';
const PR_TEST = 'packages/rafa-pr/index.test.ts';
const TRIAGE = 'packages/rafa-run/src/start/triage.ts';
const BOARD_DEEP = 'import { createGhEditorLogin } from \'@open-tomato/rafa-board/board/trust\';\n';

let scratch = '';
let warnings: string[];
let printed: string[];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-facade-always-run-')));
  warnings = [];
  printed = [];
  setActiveOutput(sinkOutput({
    info: (message) => printed.push(message),
    warn: (message) => {
      warnings.push(message);
      printed.push(message);
    },
    error: (message) => printed.push(message),
  }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs git in `root` with a fixed identity, under `LC_ALL=C`, and answers its trimmed stdout. */
function run(root: string, args: readonly string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } },
  ).trim();
}

/** Writes each file under `root`, making its folders. */
function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** Writes `files` and commits every change in `root`, answering the new commit. */
function commit(root: string, files: Readonly<Record<string, string>>, remove: readonly string[] = []): string {
  write(root, files);
  for (const path of remove) rmSync(join(root, path));
  run(root, ['add', '-A']);
  run(root, ['commit', '-q', '--allow-empty', '-m', 'change']);
  return run(root, ['rev-parse', 'HEAD']);
}

/** A repository whose base commit holds a stub facade test at each of `tests`, and the base's sha. */
function repository(tests: readonly string[] = [BOARD_TEST, PR_TEST], files: Readonly<Record<string, string>> = {}): { root: string; base: string; git: GitRunner } {
  const root = join(scratch, 'project');
  mkdirSync(root);
  run(root, ['init', '-q', '-b', 'main']);
  const stubs = Object.fromEntries(tests.map((test) => [test, '// stub facade test\n']));
  const base = commit(root, { ...stubs, ...files });
  return { root, base, git: createGitRunner(root) };
}

describe('readFacadeAlwaysRun: what adds nothing', () => {
  it('adds nothing for a root import of @open-tomato/rafa-board', () => {
    const { root, base, git } = repository();
    commit(root, { [TRIAGE]: 'import { readBoard } from \'@open-tomato/rafa-board\';\n' });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([]);
    // Control: a deep import of the same package, from the same file, adds its facade test.
    commit(root, { [TRIAGE]: `import { readBoard } from '@open-tomato/rafa-board';\n${BOARD_DEEP}` });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: BOARD_TEST, file: TRIAGE }]);
  });

  it('adds nothing for a deep import in a file under the same package, for that package only', () => {
    const { root, base, git } = repository();
    const own = 'packages/rafa-board/src/commands/issue/edit-run.ts';
    commit(root, {
      [own]: `${BOARD_DEEP}import type { AppendUpdate } from '@open-tomato/rafa-pr/triage/triage';\n`,
    });
    // Control: the same file's deep import of another package adds that package's test.
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: PR_TEST, file: own }]);
  });

  it('adds nothing for a deep import of a package with no index.test.ts', () => {
    const { root, base, git } = repository();
    commit(root, { [TRIAGE]: 'import { CommandExit } from \'@open-tomato/rafa/core/command\';\n' });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([]);
    // Control: the same diff, once the checkout holds that package's facade test, adds it.
    write(root, { 'packages/rafa/index.test.ts': '// stub facade test\n' });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: 'packages/rafa/index.test.ts', file: TRIAGE }]);
  });

  it('adds nothing for a removed - line', () => {
    const { root, base, git } = repository();
    const added = commit(root, { [TRIAGE]: BOARD_DEEP });
    // Control: read from the base, the commit adding the import adds its test.
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: BOARD_TEST, file: TRIAGE }]);
    commit(root, { [TRIAGE]: 'export const kept = 1;\n' });
    expect(run(root, ['diff', '--unified=0', added, 'HEAD'])).toContain(`-${BOARD_DEEP.trim()}`);
    expect(readFacadeAlwaysRun(git, added, root)).toEqual([]);
  });

  it('warns and adds nothing when git does not answer', () => {
    const asked: string[] = [];
    const git: GitRunner = (args) => {
      asked.push(args.join(' '));
      return { ok: false, stdout: '', stderr: 'fatal: bad revision \'abc123\'' };
    };
    expect(readFacadeAlwaysRun(git, 'abc123', scratch)).toEqual([]);
    expect(asked).toEqual(['diff --unified=0 --no-renames --no-color abc123 HEAD']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('git diff from abc123 did not answer (fatal: bad revision \'abc123\')');
    expect(warnings[0]).toContain('the task step adds no facade test');
  });
});

describe('readFacadeAlwaysRun: what adds a facade test', () => {
  it('adds the facade test of an added single-line deep import', () => {
    const { root, base, git } = repository();
    commit(root, { [TRIAGE]: BOARD_DEEP });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: BOARD_TEST, file: TRIAGE }]);
    expect(warnings).toEqual([]);
  });

  it('adds the facade test of an added import type deep import', () => {
    const { root, base, git } = repository();
    commit(root, { [TRIAGE]: 'import type { AppendUpdate, RecurrenceAppend } from \'@open-tomato/rafa-pr/triage/triage\';\n' });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: PR_TEST, file: TRIAGE }]);
  });

  it('reads the } from line of a multi-line import, which alone carries the specifier', () => {
    const test = 'src/tests/run-coupled/start/triage.test.ts';
    const opening = 'import type {\n  EditReport,\n  EditRunOptions,\n';
    const { root, base, git } = repository([BOARD_TEST], { [test]: opening });
    // Only the closing line is added: the opening lines are in the base already.
    commit(root, { [test]: `${opening}} from '@open-tomato/rafa-board/commands/issue/edit-run';\n` });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: BOARD_TEST, file: test }]);
  });

  it('reads a bare import, a dynamic import and an export from, in either quote', () => {
    const { root, base, git } = repository();
    commit(root, {
      'src/bare.ts': 'import \'@open-tomato/rafa-board/board/trust\';\n',
      'src/dynamic.ts': 'const triage = await import("@open-tomato/rafa-pr/triage/triage");\n',
      'src/again.ts': 'export { createGhEditorLogin } from "@open-tomato/rafa-board/board/trust";\n',
    });
    // git names files in path order, so src/again.ts reaches rafa-board first.
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([
      { test: BOARD_TEST, file: 'src/again.ts' },
      { test: PR_TEST, file: 'src/dynamic.ts' },
    ]);
  });

  it('reads the path of a file whose name holds a space, which git writes with a tab after it', () => {
    const { root, base, git } = repository();
    commit(root, { 'src/a b.ts': BOARD_DEEP });
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: BOARD_TEST, file: 'src/a b.ts' }]);
  });

  it('reads no specifier quoted in a Markdown page', () => {
    const { root, base, git } = repository();
    commit(root, { 'context/page.md': BOARD_DEEP, [TRIAGE]: BOARD_DEEP });
    // Control: the same line in a script file of the same diff is read.
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([{ test: BOARD_TEST, file: TRIAGE }]);
  });

  it('answers one sorted path per package when two files import the same package', () => {
    const { root, base, git } = repository();
    commit(root, {
      'src/a.ts': 'import type { AppendUpdate } from \'@open-tomato/rafa-pr/triage/triage\';\n',
      'src/b.ts': BOARD_DEEP,
      'src/c.ts': 'import { EditRefusal } from \'@open-tomato/rafa-board/commands/issue/edit-run\';\n',
    });
    // Diff order reaches rafa-pr first; the answer is sorted by test path, each test beside its first file.
    expect(readFacadeAlwaysRun(git, base, root)).toEqual([
      { test: BOARD_TEST, file: 'src/b.ts' },
      { test: PR_TEST, file: 'src/a.ts' },
    ]);
  });
});

const DEMO_TEST = 'packages/demo/index.test.ts';
const OUTSIDE = 'src/outside.ts';

/** The demo package's facade: it lacks `inner`, the name the deep path holds. */
const DEMO_FACADE = 'export const outer = 1;\n';

/** A facade test red on the stub facade, as a real one is on a name the tree takes and the facade lacks. */
const DEMO_RED_TEST = [
  'import { expect, it } from \'bun:test\';',
  '',
  'import * as facade from \'./index.ts\';',
  '',
  'it(\'exports each name the tree takes from the package\', () => {',
  '  expect(Object.keys(facade).sort()).toEqual([\'inner\', \'outer\']);',
  '});',
  '',
].join('\n');

const SCRATCH_TASK = 'take inner from the demo package';

/** A one-task tracker, the task ticked as the loop leaves it before the step. */
const SCRATCH_TRACKER = `# Plan: scratch\n\n# Stage: One\n\n- [x] ${SCRATCH_TASK}\n- [ ] next task\n`;

/**
 * The scratch task: a repository holding the demo package with its red
 * facade test, one commit on top adding `source` at {@link OUTSIDE}, and
 * the context of a task step over it, its record and tracker kept outside
 * the checkout.
 */
function scratchTask(source: string): { context: SuiteStepContext; base: string; steps: SessionStep[] } {
  const { root, base } = repository([], {
    'packages/demo/index.ts': DEMO_FACADE,
    'packages/demo/src/inner.ts': 'export const inner = 2;\n',
    [DEMO_TEST]: DEMO_RED_TEST,
  });
  commit(root, { [OUTSIDE]: source });
  const record = join(scratch, 'record');
  mkdirSync(record);
  const trackerPath = join(record, 'PLAN_TRACKER-scratch.md');
  writeFileSync(trackerPath, SCRATCH_TRACKER);
  const steps: SessionStep[] = [];
  const context: SuiteStepContext = {
    repoRoot: record,
    checkout: root,
    trackerPath,
    sessionId: 'scratch-session',
    settings: {
      testsFullSuiteTriggers: ['bunfig.toml', 'tsconfig*.json', 'package.json'],
      testsIntegration: ['**/*-integration.test.ts'],
      testsAlwaysRun: ['src/**/*.sweep.test.ts'],
      testsRetakeRedAlone: false,
      testsContract: [],
      checksTask: ['affected'],
      checksStage: ['related', 'integration'],
      checksLoop: ['full'],
    },
    owns: () => Promise.resolve(null),
    seams: { appendStep: (step) => steps.push(step) },
  };
  return { context, base, steps };
}

describe('runTaskStep over a scratch repository whose facade test is red', () => {
  const STEP_TIMEOUT_MS = 60_000;

  it('settles red, naming packages/demo/index.test.ts, for a commit adding a deep import from outside the package', async () => {
    const { context, base, steps } = scratchTask('import { inner } from \'@open-tomato/demo/inner\';\n\nexport const taken = inner;\n');
    const outcome = await runTaskStep(context, { baseline: null, base, declared: null, task: SCRATCH_TASK });

    expect(printed).toContain(`🧩 Facade check added: ${DEMO_TEST} (a new deep import in ${OUTSIDE})`);
    expect(outcome).toMatchObject({ kind: 'task', red: true, interrupted: false, repairInserted: true });
    expect(outcome.blocker).toContain(DEMO_TEST);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.newFailures.map((failure) => failure.file)).toEqual([DEMO_TEST]);
    expect(readFileSync(context.trackerPath, 'utf8')).toContain(`bun test ./${DEMO_TEST}`);
  }, STEP_TIMEOUT_MS);

  // Control: the same repository and red facade test, reached by no deep import.
  it('settles green, never running that test, for a commit adding a root import', async () => {
    const { context, base, steps } = scratchTask('import { outer } from \'@open-tomato/demo\';\n\nexport const taken = outer;\n');
    const outcome = await runTaskStep(context, { baseline: null, base, declared: null, task: SCRATCH_TASK });

    expect(printed.filter((line) => line.includes(DEMO_TEST))).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'task', red: false, blocker: null, repairInserted: false });
    expect(steps[0]?.failures).toEqual([]);
    expect(readFileSync(context.trackerPath, 'utf8')).toBe(SCRATCH_TRACKER);
  }, STEP_TIMEOUT_MS);
});
