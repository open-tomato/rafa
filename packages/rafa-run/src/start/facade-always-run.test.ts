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
 */
import type { GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { createGitRunner } from '@open-tomato/rafa-pr/pr/index';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { readFacadeAlwaysRun } from './facade-always-run.js';

const BOARD_TEST = 'packages/rafa-board/index.test.ts';
const PR_TEST = 'packages/rafa-pr/index.test.ts';
const TRIAGE = 'packages/rafa-run/src/start/triage.ts';
const BOARD_DEEP = 'import { createGhEditorLogin } from \'@open-tomato/rafa-board/board/trust\';\n';

let scratch = '';
let warnings: string[];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-facade-always-run-')));
  warnings = [];
  setActiveOutput(sinkOutput({ warn: (message) => warnings.push(message) }));
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
