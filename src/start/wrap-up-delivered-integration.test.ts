/**
 * `rafa loop start` spawned end to end over a run that never gets a pull
 * request (`.rafa/specs/rafa-579-loop-run-ends-delivered.md`, #576): the
 * stand-in `claude` answers every session without opening one, and the
 * branch cannot be pushed, so the runner's own attempt
 * (`./runner-pr.ts`) is blocked at its push step.
 *
 * The repository's `origin` is a bare repository whose `pre-receive` hook
 * refuses the run's branch and nothing else, since `git push` is the
 * only thing that pushes and `gh` never does: the stand-in `gh` answers
 * the reads (`auth status`, and `pr list` with no pull request at all)
 * and records every call, so the case can read that `gh pr create` was
 * never reached. The plan names no `rafa:plan` block, so nothing reads
 * an issue through `gh`; its stub opens `rafa-<n>`, which is the issue
 * the runner would have titled the pull request with.
 *
 * Three facts: the run exits 1; its report names the branch and the push
 * step; and the run's record reads `stopped`, never `done`.
 *
 * The second describe runs the same stand-in `claude` against an origin
 * that takes the push and a stand-in `gh` that opens a pull request only
 * when the runner's `gh pr create` reaches it: the run spends exactly one
 * retry session (the default `loop.wrapUp.retries`), the runner then
 * opens the pull request with `Closes #9` in its body, and the run's
 * record, snapshotted by `gh` at the moment of the create, still reads
 * `running` there and reads `done` only once the run has ended. Under
 * `pr.provider: none` the same `claude` is spawned once for the wrap-up,
 * `gh` is asked for no pull request at all, `preserveProgress` making no
 * lookup under that provider (`start/wrap-up.ts`), and the run ends
 * `done`.
 */
import type { CapturedRun } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessions } from '../loop/sessions.js';
import { expectExit, plantProjectConfig } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';
import { hostToolDirs } from '../tests/stand-in-gh.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fence, kept out of the shell script templates below. */
const FENCE = '```';

/** How long the spawned `loop start` run may take: two real `bun test` runs and three stand-in sessions. */
const RUN_TIMEOUT_MS = 90_000;

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 120_000;

/** The plan stub this file's scratch repository runs; `rafa-9` is the issue the pull request would close. */
const STUB = 'rafa-9-wrap-up-delivered';

/** The branch the scratch repository is checked out on, and the one `origin` refuses. */
const BRANCH = `feat/${STUB}`;

/** The one task the plan holds. */
const TASK = 'Add the companion test';

/** The plan: one stage of one task, no `rafa:plan` block. */
const PLAN = [`# Plan: ${STUB}`, '', '# Stage: only stage', '', `- [ ] ${TASK}`, ''].join('\n');

/** The project config: the `gh` provider, named rather than read off a remote that is not GitHub's. */
const CONFIG = 'pr:\n  provider: gh\n';

/** The project config of a repository with no pull request provider. */
const CONFIG_NONE = 'pr:\n  provider: none\n';

/** The number the stand-in `gh` gives the pull request it opens. */
const OPENED_NUMBER = 42;

/** The URL the stand-in `gh` prints for it. */
const OPENED_URL = `https://github.com/example/repo/pull/${String(OPENED_NUMBER)}`;

/** The flags the run takes: no CI wait, since the run must not reach it. */
const RUN_FLAGS: readonly string[] = [`--plan=.plans/PLAN-${STUB}.md`, '--no-ci-wait', '--inject=full'];

/** The test file the task session writes, always green. */
const COMPANION = [
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'companion, always green\', () => {',
  '  expect(1).toBe(1);',
  '});',
  '',
].join('\n');

/** What distinguishes one scratch repository from another. */
interface PlantOptions {
  /** The project config the run reads. */
  readonly config: string;
  /** Whether `origin` refuses the run's branch. */
  readonly refusePush: boolean;
  /** Whether the stand-in `gh` opens the pull request a `pr create` asks for. */
  readonly ghOpens: boolean;
}

/** The scratch repository of the first describe: `gh` provider, a refused push, a `gh` that opens nothing. */
const REFUSED: PlantOptions = { config: CONFIG, refusePush: true, ghOpens: false };

/** A scratch repository, its bare origin, and what a spawned run reads under it. */
interface Scratch {
  readonly repo: string;
  readonly origin: string;
  readonly home: string;
  /** Where the stand-ins keep their counts and records. */
  readonly calls: string;
  /** The PATH a spawned run gets: the stand-ins' `bin/`, git's directory, then bun's. */
  readonly path: string;
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-wrap-up-delivered-')));
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

/** The report block every stand-in session ends with. */
function reportLines(feedback: string): string {
  return [
    `${feedback}.`,
    '',
    `${FENCE}rafa:report`,
    'status: done',
    `feedback: "${feedback}"`,
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    FENCE,
  ].join('\n');
}

/**
 * The stand-in `claude`: counts its calls and keeps each prompt. Call 1,
 * the task, writes the companion test; every later call, the wrap-up
 * session and its retry, writes nothing and opens no pull request.
 */
function claudeScript(calls: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'n=$(/bin/cat "$calls/count" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$calls/count"',
    '/bin/cat > "$calls/$n.prompt"',
    'if [ "$n" -eq 1 ]; then',
    '  cat > companion.test.ts <<\'RAFA_TEST_FILE_EOF\'',
    COMPANION,
    'RAFA_TEST_FILE_EOF',
    '  cat <<\'RAFA_REPORT_EOF\'',
    reportLines('added the companion'),
    'RAFA_REPORT_EOF',
    'else',
    '  cat <<\'RAFA_REPORT_EOF\'',
    reportLines('wrap-up: nothing opened'),
    'RAFA_REPORT_EOF',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * The stand-in `gh`: records every call's arguments, answers `auth
 * status` and an empty `pr list`, and refuses anything else, `pr create`
 * included, so a run that reaches it past the push shows in the log.
 */
function refusingGhScript(calls: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    'echo "$*" >> "$calls/gh.log"',
    'case "$1 $2" in',
    '  "auth status") exit 0 ;;',
    '  "pr list") echo \'[]\'; exit 0 ;;',
    'esac',
    'echo "stand-in gh: refused $*" >&2',
    'exit 1',
    '',
  ].join('\n');
}

/** The pull request the delivering `gh` answers once it has been created, as `--json` writes a summary. */
const OPENED_PULL = JSON.stringify({
  number: OPENED_NUMBER,
  title: 'stand-in',
  url: OPENED_URL,
  state: 'OPEN',
  headRefName: BRANCH,
  baseRefName: 'main',
  author: { login: 'rafa', is_bot: false },
  isCrossRepository: false,
  updatedAt: '2026-01-01T00:00:00Z',
});

/**
 * The stand-in `gh` of a run whose pull request the runner opens: `pr
 * list` answers none until `pr create` has been called, `pr create` keeps
 * its arguments one to a line and a copy of every run record as the
 * moment of the create finds it, then prints the pull request's URL, and
 * `pr view` answers the created pull request.
 */
function openingGhScript(calls: string, runs: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
    `runs='${runs}'`,
    'echo "$*" >> "$calls/gh.log"',
    'case "$1 $2" in',
    '  "auth status") exit 0 ;;',
    '  "pr list")',
    '    if [ -f "$calls/created" ]; then',
    `      echo '[${OPENED_PULL}]'`,
    '    else',
    '      echo \'[]\'',
    '    fi',
    '    exit 0 ;;',
    '  "pr create")',
    '    printf \'%s\\n\' "$@" > "$calls/create.args"',
    '    /bin/cat "$runs"/*.json > "$calls/record-at-create.json"',
    '    : > "$calls/created"',
    `    echo '${OPENED_URL}'`,
    '    exit 0 ;;',
    '  "pr view")',
    `    echo '${OPENED_PULL}'`,
    '    exit 0 ;;',
    'esac',
    'echo "stand-in gh: refused $*" >&2',
    'exit 1',
    '',
  ].join('\n');
}

/** The hook refusing the run's branch, and only it. */
const PRE_RECEIVE = [
  '#!/bin/sh',
  'while read old new ref; do',
  `  if [ "$ref" = "refs/heads/${BRANCH}" ]; then`,
  '    echo "remote: the stand-in origin refuses a push to $ref" >&2',
  '    exit 1',
  '  fi',
  'done',
  'exit 0',
  '',
].join('\n');

/** Writes an executable `name` holding `text` under `dir`. */
function writeExecutable(dir: string, name: string, text: string): string {
  const file = join(dir, name);
  writeFileSync(file, text, 'utf8');
  chmodSync(file, 0o755);
  return file;
}

/** A scratch repository on {@link BRANCH}, a bare origin, and both stand-ins; see the module note. */
function plant(options: PlantOptions = REFUSED): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, origin, bin, home, calls]) mkdirSync(dir, { recursive: true });

  const bunBinary = Bun.which('bun');
  if (bunBinary === null) throw new Error('bun is not on the PATH this suite runs under');

  writeExecutable(bin, 'claude', claudeScript(calls));
  writeExecutable(bin, 'gh', options.ghOpens
    ? openingGhScript(calls, join(repo, '.rafa', 'runs'))
    : refusingGhScript(calls));

  git(origin, home, 'init', '-q', '--bare', '.');
  if (options.refusePush) {
    mkdirSync(join(origin, 'hooks'), { recursive: true });
    writeExecutable(join(origin, 'hooks'), 'pre-receive', PRE_RECEIVE);
  }

  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'user.email', 'loop@example.test');
  git(repo, home, 'config', 'user.name', 'Rafa Loop');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), `# ${STUB}\n`, 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed, no test file at all');
  git(repo, home, 'branch', '-M', 'main');
  git(repo, home, 'remote', 'add', 'origin', origin);
  git(repo, home, 'push', '-q', 'origin', 'main');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');
  plantProjectConfig(repo, options.config);

  return { repo, origin, home, calls, path: [bin, ...hostToolDirs(), dirname(bunBinary)].join(delimiter) };
}

/** Runs `rafa loop start` over {@link RUN_FLAGS} in `scratch`'s repository, waiting for it to finish. */
function runLoopStart(scratch: Scratch): CapturedRun {
  const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, 'loop', 'start', ...RUN_FLAGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    timeout: RUN_TIMEOUT_MS,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The lines the stand-in `gh` recorded, or none before any call. */
function ghCalls(scratch: Scratch): readonly string[] {
  try {
    return readFileSync(join(scratch.calls, 'gh.log'), 'utf8').split('\n')
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** The prompt the stand-in `claude` was given on its `n`th call. */
function promptOf(scratch: Scratch, n: number): string {
  return readFileSync(join(scratch.calls, `${String(n)}.prompt`), 'utf8');
}

/** How many times the stand-in `claude` was spawned. */
function claudeCalls(scratch: Scratch): number {
  return Number(readFileSync(join(scratch.calls, 'count'), 'utf8').trim());
}

/** The origin's heads: what a push reached it. */
function originBranches(scratch: Scratch): string {
  return execFileSync('git', ['--git-dir', scratch.origin, 'branch', '--list'], { encoding: 'utf8' });
}

describe('a run whose wrap-up never opens a pull request and whose branch cannot be pushed', () => {
  it('exits 1 naming the branch and the push step, and the record does not read done', () => {
    const scratch = plant();
    const run = runLoopStart(scratch);
    const said = `${run.stdout}\n${run.stderr}`;

    expectExit(run, 1, { ...scratch });
    expect(said).toContain(`the loop could not open the pull request for ${BRANCH} at the push step`);
    expect(said).toContain('the stand-in origin refuses a push');

    // The loop asked `gh` whether a pull request was open, and never got as far as creating one.
    const calls = ghCalls(scratch);
    expect(calls.some((call) => call.startsWith('pr list'))).toBe(true);
    expect(calls.some((call) => call.startsWith('pr create'))).toBe(false);

    const [record] = readSessions(scratch.repo);
    if (record === undefined) throw new Error('the run wrote no session record at all');
    expect(record.state).toBe('stopped');
    expect(record.state).not.toBe('done');
  }, CASE_TIMEOUT_MS);
});

describe('a run whose wrap-up never opens a pull request and whose branch can be pushed', () => {
  const OPENS: PlantOptions = { config: CONFIG, refusePush: false, ghOpens: true };

  it('spends exactly one retry, has the runner open the pull request, and records done only after the create', () => {
    const scratch = plant(OPENS);
    const run = runLoopStart(scratch);
    const said = `${run.stdout}\n${run.stderr}`;

    expectExit(run, 0, { ...scratch });

    // The task, the wrap-up and exactly one retry: a fourth session would be a second retry.
    expect(claudeCalls(scratch)).toBe(3);
    expect(promptOf(scratch, 2)).not.toContain('The pull request is MISSING');
    expect(promptOf(scratch, 3)).toContain('The pull request is MISSING');
    expect(promptOf(scratch, 3)).toContain('wrap-up: nothing opened');
    expect(said).toContain('running retry wrap-up session 1 of 1');
    expect(said).toContain('the loop opens it itself');

    // The runner pushed the branch, then created the pull request carrying the issue it closes.
    expect(originBranches(scratch)).toContain(BRANCH);
    const calls = ghCalls(scratch);
    expect(calls.filter((call) => call.startsWith('pr create'))).toHaveLength(1);
    const args = readFileSync(join(scratch.calls, 'create.args'), 'utf8');
    expect(args).toContain(`--head\n${BRANCH}\n`);
    expect(args).toContain('--base\nmain\n');
    expect(args).toContain('--title\nrafa-9: ');
    expect(args).toContain('--body\nCloses #9\n');
    expect(said).toContain(`The loop opened pull request #${String(OPENED_NUMBER)} for ${BRANCH}: ${OPENED_URL}`);

    // At the moment of the create the record had not been marked done; the end of the run did.
    const atCreate = JSON.parse(readFileSync(join(scratch.calls, 'record-at-create.json'), 'utf8')) as { state: string };
    expect(atCreate.state).toBe('running');
    const [record] = readSessions(scratch.repo);
    if (record === undefined) throw new Error('the run wrote no session record at all');
    expect(record.state).toBe('done');
  }, CASE_TIMEOUT_MS);
});

describe('the same run under pr.provider: none', () => {
  it('runs one wrap-up session, reads no pull request after it, and ends done', () => {
    const scratch = plant({ config: CONFIG_NONE, refusePush: false, ghOpens: true });
    const run = runLoopStart(scratch);
    const said = `${run.stdout}\n${run.stderr}`;

    expectExit(run, 0, { ...scratch });
    expect(claudeCalls(scratch)).toBe(2);
    expect(said).not.toContain('No open pull request');
    expect(said).not.toContain('retry wrap-up session');
    // No `pr list` at all: `preserveProgress` makes neither of its lookups under `none`, no
    // delivery reading follows, and nothing is created or viewed.
    const calls = ghCalls(scratch);
    expect(calls.filter((call) => call.startsWith('pr list'))).toEqual([]);
    expect(calls.filter((call) => call.startsWith('pr create') || call.startsWith('pr view'))).toEqual([]);

    const [record] = readSessions(scratch.repo);
    if (record === undefined) throw new Error('the run wrote no session record at all');
    expect(record.state).toBe('done');
  }, CASE_TIMEOUT_MS);

  it('writes a no-pr line saying no provider is configured to the events file of a text-mode run', () => {
    const scratch = plant({ config: CONFIG_NONE, refusePush: false, ghOpens: true });
    const run = runLoopStart(scratch);
    expectExit(run, 0, { ...scratch });

    const runsDir = join(scratch.repo, '.rafa', 'runs');
    const eventsFile = readdirSync(runsDir).find((name) => name.endsWith('.events.ndjson'));
    if (eventsFile === undefined) throw new Error('the run wrote no events file');
    const events = readFileSync(join(runsDir, eventsFile), 'utf8').split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { name?: string; data?: { reason?: string } });
    const noPr = events.filter((event) => event.name === 'no-pr');

    expect(noPr).toHaveLength(1);
    expect(noPr[0]?.data?.reason).toContain('no pull request provider is configured');
    // The wrap-up's two lookups are not made under `none` either, so `gh` is never asked.
    expect(ghCalls(scratch).filter((call) => call.startsWith('pr list'))).toEqual([]);
  }, CASE_TIMEOUT_MS);
});
