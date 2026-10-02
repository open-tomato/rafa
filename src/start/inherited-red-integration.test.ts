/**
 * `rafa loop start` spawned end to end, over a real `bun test`, proving
 * the three outward effects of a run that starts on an already-red suite
 * (#486): a bug the session reports for that red files nothing, the
 * triage output names it as inherited, and the task prompt the session
 * received listed the failure as inherited before it ever ran.
 *
 * The scratch repository's seed commit holds `always-red.test.ts`,
 * failing already, beside a plan of one task. The stand-in `claude`
 * writes a passing companion test for the task (so the task commits
 * clean and the run reaches its wrap-up), and ends its report with one
 * out-of-scope bug: the red test, worded as bun prints it, a file header,
 * the `error:` line, and the `(fail)` line. The project's tracker is
 * `local`, so a filed bug would be a `.rafa/issues/<n>.md` file.
 *
 * The run-start baseline (`../suite/baseline.ts`) reads the failure's
 * message off bun's JUnit report, `expect(received).toBe(expected)`, and
 * the stand-in quotes that same first line as the bug's evidence, which
 * is what lets `../triage/inherited.ts` match the two.
 *
 * One assertion reads the local tracker's issue directory, which holds no
 * issue file at all; a second reads the run's output for the `Triage:`
 * note naming the failure as inherited (text mode prints no event line); a
 * third reads the prompt the stand-in was handed for its first call, the
 * task's, for the `## Failures this run inherited` section naming the
 * failure by file and case.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { localIssuesDir } from '../adapters/tracker/local.js';
import { plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { INHERITED_HEADING, INHERITED_SENTENCE } from './inherited-notice.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script template below. */
const FENCE = '```';

/** A shell heredoc marker, kept out of every file this file writes. */
const HEREDOC_MARKER = 'RAFA_TEST_FILE_EOF';

/** How long the one spawned `loop start` run may take: a few real `bun test` runs of a tiny project. */
const RUN_TIMEOUT_MS = 90_000;

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 120_000;

/** The plan stub this file's scratch repository runs. */
const STUB = 'inherited-red';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** The flag naming the planted plan. */
const PLAN_FLAG = `--plan=.plans/PLAN-${STUB}.md`;

/** The plan's only task. */
const TASK = 'Add a companion test beside the one already red';

/** The plan: one stage, one task. */
const PLAN = [`# Plan: ${STUB}`, '', '# Stage: only stage', '', `- [ ] ${TASK}`, ''].join('\n');

/** The test file red already at the seed commit, untouched by the task. */
const ALWAYS_RED_FILE = 'always-red.test.ts';

/** {@link ALWAYS_RED_FILE}'s one test name. */
const ALWAYS_RED_TEST_NAME = 'is always red';

/** The first line of the JUnit failure message bun writes for `expect(1).toBe(2)`. */
const FAILURE_MESSAGE = 'expect(received).toBe(expected)';

/** {@link ALWAYS_RED_FILE}'s source: one test, always failing. */
const ALWAYS_RED_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  '',
  `test('${ALWAYS_RED_TEST_NAME}', () => {`,
  '  expect(1).toBe(2);',
  '});',
  '',
].join('\n');

/** The companion test file the task writes: passes, and never touches {@link ALWAYS_RED_FILE}. */
const COMPANION_FILE = 'companion.test.ts';

/** The companion's source. */
const COMPANION_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'the companion, always green\', () => {',
  '  expect(1).toBe(1);',
  '});',
  '',
].join('\n');

/** What the stand-in reports for the red test, as bun prints it: file header, `error:` line, `(fail)` line. */
const BUG_ARTIFACT_LINES: readonly string[] = [
  `${ALWAYS_RED_FILE}:`,
  `error: ${FAILURE_MESSAGE}`,
  'Expected: 2',
  'Received: 1',
  `(fail) ${ALWAYS_RED_TEST_NAME} [0.19ms]`,
];

/** The flags every `loop start` in this file runs with. */
const RUN_FLAGS: readonly string[] = [PLAN_FLAG, '--no-ci-wait', '--inject=full'];

/** The project config: `local` issues, and `pr.provider: none` so the wrap-up's push costs no `gh`. */
const CONFIG = 'pr:\n  provider: none\ntracker:\n  default: local\n';

/** A scratch repository, and what a spawned run reads under it. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly claude: string;
  /** Where the stand-in keeps each call's count, arguments and prompt. */
  readonly calls: string;
  /** The PATH a spawned run gets: the stand-in's `bin/`, git's own directory, then bun's own. */
  readonly path: string;
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inherited-red-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
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

/** The report the task's call answers with: done, and one out-of-scope bug, the red test. */
function taskReportLines(): readonly string[] {
  return [
    'Added the companion test; always-red.test.ts was red before I started.',
    '',
    `${FENCE}rafa:report`,
    'status: done',
    'feedback: "added the companion test"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs:',
    '  - what: "always-red.test.ts fails: is always red"',
    '    artifact: |',
    ...BUG_ARTIFACT_LINES.map((line) => `      ${line}`),
    '    security: false',
    FENCE,
    '',
  ];
}

/** The report the wrap-up's call answers with: nothing to say. */
function wrapUpReportLines(): readonly string[] {
  return [
    'wrap-up: nothing left to preserve.',
    '',
    `${FENCE}rafa:report`,
    'status: done',
    'feedback: "wrap-up: nothing left to preserve"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    FENCE,
    '',
  ];
}

/**
 * The stand-in `claude`: keeps each call's count, its arguments and its
 * whole prompt outside the repository, then answers by call number. Call
 * 1 (the task) writes {@link COMPANION_FILE} and reports the red test as
 * an out-of-scope bug; call 2 (the wrap-up) reports nothing.
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
    'if [ "$n" -eq 1 ]; then',
    ...heredocWrite(COMPANION_FILE, COMPANION_SOURCE),
    ...printLines(taskReportLines()),
    'else',
    ...printLines(wrapUpReportLines()),
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * A scratch git repository on {@link BRANCH}, its own HOME and `bin/`
 * beside it, holding `.rafa/config.yaml`, {@link PLAN} at
 * `.plans/PLAN-<stub>.md`, and, in its seed commit, {@link ALWAYS_RED_FILE}
 * already failing. `.plans/`, `.rafa/` and `progress.txt` are gitignored,
 * as a real project's are.
 */
function plant(): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const gitBinary = Bun.which('git');
  if (gitBinary === null) throw new Error('git is not on the PATH this suite runs under');
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
    path: [bin, dirname(gitBinary), dirname(bunBinary)].join(delimiter),
  };

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, ALWAYS_RED_FILE), ALWAYS_RED_SOURCE, 'utf8');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed, already red');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo, CONFIG);

  return scratch;
}

/** What one `rafa loop start` run did. */
interface LoopRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `rafa loop start` over {@link RUN_FLAGS} in `scratch`'s repository, waiting for it to finish. */
function runLoopStart(scratch: Scratch): LoopRun {
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

/** The call count the stand-in has recorded so far, or `0` before any call. */
function callCount(scratch: Scratch): number {
  try {
    return Number(readFileSync(join(scratch.calls, 'count'), 'utf8').trim());
  } catch {
    return 0;
  }
}

/** The issue files the `local` tracker holds under `repo`: none when its directory was never made. */
function localIssueFiles(repo: string): string[] {
  const dir = localIssuesDir(repo);
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.md'))
    : [];
}

describe('a bug reported for a test already red before the run starts', () => {
  it('files no issue, is named as inherited in the triage output, and was listed in the task prompt', () => {
    const scratch = plant();
    const run = runLoopStart(scratch);
    const output = `${run.stdout}\n${run.stderr}`;

    expect(run.exitCode).toBe(0);
    // The task's session and the wrap-up's, neither retried.
    expect(callCount(scratch)).toBe(2);

    // Nothing was filed: not a new issue, and not a second report of the red.
    expect(localIssueFiles(scratch.repo)).toEqual([]);

    // The triage output names the failure as inherited, by file and case.
    expect(output).toContain(
      `Triage: out_of_scope_bugs[0]: inherited: the run-start failure ${ALWAYS_RED_FILE} > ${ALWAYS_RED_TEST_NAME}; nothing was filed`,
    );
    expect(output).not.toContain('filed on the local tracker');

    // The prompt the stand-in got for the task lists the failure.
    const prompt = readFileSync(join(scratch.calls, '1.prompt'), 'utf8');
    expect(prompt).toContain(INHERITED_HEADING);
    expect(prompt).toContain(INHERITED_SENTENCE);
    expect(prompt).toContain(`- \`${ALWAYS_RED_FILE}\`: ${ALWAYS_RED_TEST_NAME}`);
    expect(prompt.indexOf(INHERITED_HEADING)).toBeLessThan(prompt.indexOf('<!-- ralph:plan='));
  }, CASE_TIMEOUT_MS);
});
