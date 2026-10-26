/**
 * `rafa loop start` spawned end to end over a plan of two code tasks and
 * a closing task declared `docs=repair`: what the doc task is handed, and
 * where its work lands.
 *
 * The scratch repository's seed commit sits on `main`; the run is on
 * `feat/<stub>`, cut from it. The stand-in `claude` answers by call
 * number. Calls 1 and 2 (the code tasks) each write one test file and
 * report one `stale_docs` entry; call 3 (the doc task) writes one page and
 * reports none; call 4 is the wrap-up. The stand-in keeps every call's
 * whole prompt outside the repository, so the assertions read what each
 * session was handed.
 *
 * Three things are shown:
 *
 *  - the two entries are stored as `sighting` rows under the plan stub,
 *    one per code task, none for the doc task;
 *  - the doc task's prompt, and no other task's, holds the
 *    `## Documentation to repair` section with both rows and both files
 *    the code tasks touched, and the section sits ahead of `PROMPT.md`;
 *  - the doc task's commit is on the run's branch, ahead of `main`, after
 *    the two code tasks' commits, and holds the page the doc task wrote.
 *
 * The project's tracker is `local` and `pr.provider` is `none`, so the
 * wrap-up needs no `gh` and no origin.
 */
import type { CapturedRun } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { readStaleDocsForPlan } from '@open-tomato/rafa/store/stale-docs';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';

import { DOC_TASK_HEADING } from '../docs/task-reading.js';
import { expectExit, plantProjectConfig } from '../tests/cli-capture.js';
import { hostToolDirs } from '../tests/stand-in-gh.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

/** A shell heredoc marker, kept out of every file this file writes. */
const HEREDOC_MARKER = 'RAFA_TEST_FILE_EOF';

/** How long the one spawned `loop start` run may take: four sessions and a few real `bun test` runs of a tiny project. */
const RUN_TIMEOUT_MS = 150_000;

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 180_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'doc-task-run';

/** The base branch the run's branch is cut from. */
const BASE = 'main';

/** The run's branch. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The flags the `loop start` runs with. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** The project config: `local` issues, and `pr.provider: none` so the wrap-up costs no `gh`. */
const CONFIG = 'pr:\n  provider: none\ntracker:\n  default: local\n';

/** The two code tasks and the doc task, as the plan's lines name them. */
const ALPHA_TASK = 'Add the alpha module test';
const BETA_TASK = 'Add the beta module test';
const DOC_TASK = 'Repair the docs of what this plan changed';

/** The plan: one stage, two code tasks, then the closing doc task. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '# Stage: only stage',
  '',
  `- [ ] ${ALPHA_TASK}  {agent=loop-implementer effort=low}`,
  `- [ ] ${BETA_TASK}  {agent=loop-implementer effort=low}`,
  `- [ ] ${DOC_TASK}  {agent=doc-updater docs=repair effort=low}`,
  '',
].join('\n');

/** The file each code task writes, and the page the doc task writes. */
const ALPHA_FILE = 'alpha.test.ts';
const BETA_FILE = 'beta.test.ts';
const DOC_PAGE = 'docs/modules.md';

/** The page the doc task writes. */
const DOC_PAGE_SOURCE = '# Modules\n\nalpha and beta, as they are now.\n';

/** The two entries the code tasks report. */
const ALPHA_ENTRY = { where: 'docs/alpha.md:7', what: 'still says alpha has two arguments' } as const;
const BETA_ENTRY = { where: 'context/beta.md:21', what: 'names a flag beta no longer reads' } as const;

/** A green test file's source, named by `name`. */
function testSource(name: string): string {
  return [
    'import { expect, test } from \'bun:test\';',
    '',
    `test('${name}, always green', () => {`,
    '  expect(1).toBe(1);',
    '});',
    '',
  ].join('\n');
}

/** The report of a task: done, with `staleDocs` entries when given. */
function reportLines(summary: string, entry: { readonly where: string; readonly what: string } | null): readonly string[] {
  return [
    `${summary}.`,
    '',
    `${FENCE}rafa:report`,
    'status: done',
    `feedback: "${summary}"`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    ...(entry === null
      ? ['stale_docs: []']
      : ['stale_docs:', `  - where: "${entry.where}"`, `    what: "${entry.what}"`]),
    FENCE,
    '',
  ];
}

/** A scratch repository, and what a spawned run reads under it. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly claude: string;
  /** Where the stand-in keeps each call's count, arguments and prompt. */
  readonly calls: string;
  /** The PATH a spawned run gets: the stand-in's `bin/`, git's directory and the system tools', then bun's own. */
  readonly path: string;
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doc-task-run-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` under `home`'s isolated identity, answering trimmed stdout. */
function git(cwd: string, home: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

/** `line` as a single-quoted POSIX shell word, any embedded `'` escaped. */
function shQuote(line: string): string {
  return `'${line.replace(/'/g, '\'\\\'\'')}'`;
}

/** `printf '%s\n' <line>` for each of `lines`, one per shell statement. */
function printLines(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `printf '%s\\n' ${shQuote(line)}`);
}

/** `cat > <path> <<'RAFA_TEST_FILE_EOF' ... RAFA_TEST_FILE_EOF`, writing `content` whole. */
function heredocWrite(path: string, content: string): readonly string[] {
  return [`cat > ${path} <<'${HEREDOC_MARKER}'`, content, HEREDOC_MARKER];
}

/** One branch of the stand-in: the files it writes, then the report it prints. */
function answer(call: number, writes: readonly (readonly [string, string])[], report: readonly string[]): readonly string[] {
  return [
    `if [ "$n" -eq ${call} ]; then`,
    ...writes.flatMap(([path, content]) => [`mkdir -p ${shQuote(dirname(path))}`, ...heredocWrite(shQuote(path), content)]),
    ...printLines(report),
    'exit 0',
    'fi',
  ];
}

/**
 * The stand-in `claude`: keeps each call's count, its arguments and its
 * whole prompt outside the repository, then answers by call number. Calls
 * 1 and 2 are the code tasks, call 3 the doc task, and any later call the
 * wrap-up.
 */
function standInScript(calls: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    'for arg in "$@"; do printf \'%s\\n\' "$arg"; done > "$calls/$n.args"',
    '/bin/cat > "$calls/$n.prompt"',
    ...answer(1, [[ALPHA_FILE, testSource('alpha')]], reportLines('added the alpha test', ALPHA_ENTRY)),
    ...answer(2, [[BETA_FILE, testSource('beta')]], reportLines('added the beta test', BETA_ENTRY)),
    ...answer(3, [[DOC_PAGE, DOC_PAGE_SOURCE]], reportLines('repaired the module pages', null)),
    ...printLines(reportLines('wrap-up: nothing left to preserve', null)),
    'exit 0',
    '',
  ].join('\n');
}

/**
 * A scratch git repository on {@link BRANCH}, cut from {@link BASE}, its own
 * HOME and `bin/` beside it, holding `.rafa/config.yaml` and {@link PLAN} at
 * `.plans/PLAN-<stub>.md`. `.plans/`, `.rafa/` and `progress.txt` are
 * gitignored, as a real project's are.
 */
function plant(): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const bunBinary = Bun.which('bun');
  if (bunBinary === null) throw new Error('bun is not on the PATH this suite runs under');

  const claude = join(bin, 'claude');
  writeFileSync(claude, standInScript(calls), 'utf8');
  chmodSync(claude, 0o755);

  const scratch: Scratch = {
    repo,
    home,
    claude,
    calls,
    path: [bin, ...hostToolDirs(), dirname(bunBinary)].join(delimiter),
  };

  git(repo, home, 'init', '-q', '-b', BASE, '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), '# scratch\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo, CONFIG);

  return scratch;
}

/** Runs `rafa loop start` over {@link RUN_FLAGS} in `scratch`'s repository, waiting for it to finish. */
function runLoopStart(scratch: Scratch): CapturedRun {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== scratch.claude) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'loop', 'start', ...RUN_FLAGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    timeout: RUN_TIMEOUT_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The call count the stand-in has recorded, or `0` before any call. */
function callCount(scratch: Scratch): number {
  try {
    return Number(readFileSync(join(scratch.calls, 'count'), 'utf8').trim());
  } catch {
    return 0;
  }
}

/** The prompt the stand-in was handed for call `n`. */
function promptOf(scratch: Scratch, n: number): string {
  return readFileSync(join(scratch.calls, `${n}.prompt`), 'utf8');
}

/** The commits on the run's branch ahead of {@link BASE}, oldest first, each with its subject and files. */
function commitsAheadOfBase(scratch: Scratch): readonly { readonly subject: string; readonly files: readonly string[] }[] {
  const shas = git(scratch.repo, scratch.home, 'rev-list', '--reverse', `${BASE}..${BRANCH}`)
    .split('\n')
    .filter((sha) => sha !== '');
  return shas.map((sha) => ({
    subject: git(scratch.repo, scratch.home, 'log', '-1', '--format=%s', sha),
    files: git(scratch.repo, scratch.home, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha)
      .split('\n')
      .filter((file) => file !== ''),
  }));
}

describe('a plan of two code tasks and a closing docs=repair task', () => {
  let scratch: Scratch;
  let run: CapturedRun;

  beforeAll(() => {
    scratch = plant();
    run = runLoopStart(scratch);
  }, CASE_TIMEOUT_MS);

  it('runs every task and the wrap-up, each once', () => {
    expectExit(run, 0, { ...scratch });
    expect(callCount(scratch)).toBe(4);
  }, CASE_TIMEOUT_MS);

  it('stores the two stale_docs entries as sightings of the plan, one per code task', () => {
    const rows = readStaleDocsForPlan(scratch.repo, STUB);

    expect(rows.map((row) => ({ kind: row.kind, where: row.where, what: row.what }))).toEqual([
      { kind: 'sighting', ...ALPHA_ENTRY },
      { kind: 'sighting', ...BETA_ENTRY },
    ]);
    expect(rows.map((row) => row.taskLine)).toEqual([
      expect.stringContaining(ALPHA_TASK),
      expect.stringContaining(BETA_TASK),
    ]);
  }, CASE_TIMEOUT_MS);

  it('hands the doc task both rows and both touched files, ahead of PROMPT.md', () => {
    const prompt = promptOf(scratch, 3);

    expect(prompt).toContain(DOC_TASK_HEADING);
    expect(prompt).toContain(`- ${ALPHA_ENTRY.where}: ${ALPHA_ENTRY.what}`);
    expect(prompt).toContain(`- ${BETA_ENTRY.where}: ${BETA_ENTRY.what}`);
    expect(prompt).toContain(`- \`${ALPHA_FILE}\``);
    expect(prompt).toContain(`- \`${BETA_FILE}\``);
    expect(prompt).toContain(`since it left \`${BASE}\``);
    expect(prompt.indexOf(DOC_TASK_HEADING)).toBeLessThan(prompt.indexOf('<!-- ralph:plan='));
    // The task's own page is no file it was handed: it had not written it yet.
    expect(prompt).not.toContain(`- \`${DOC_PAGE}\``);
  }, CASE_TIMEOUT_MS);

  it('hands neither code task the doc task section', () => {
    expect(promptOf(scratch, 1)).not.toContain(DOC_TASK_HEADING);
    expect(promptOf(scratch, 2)).not.toContain(DOC_TASK_HEADING);
  }, CASE_TIMEOUT_MS);

  it('lands the doc task\'s commit on the run\'s branch, ahead of the base and after the code tasks\'', () => {
    const commits = commitsAheadOfBase(scratch);

    expect(commits.map((commit) => commit.files)).toEqual([[ALPHA_FILE], [BETA_FILE], [DOC_PAGE]]);
    expect(git(scratch.repo, scratch.home, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
    expect(git(scratch.repo, scratch.home, 'ls-tree', '-r', '--name-only', BRANCH, DOC_PAGE)).toBe(DOC_PAGE);
    expect(git(scratch.repo, scratch.home, 'ls-tree', '-r', '--name-only', BASE, DOC_PAGE)).toBe('');
  }, CASE_TIMEOUT_MS);
});
