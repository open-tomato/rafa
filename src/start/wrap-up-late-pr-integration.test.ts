/**
 * `runWrapUp` driven in events mode over a run whose first wrap-up
 * session opens no pull request and whose runner opens #42
 * (`.rafa/specs/rafa-821-bug-sweep-14.md`, #782, #591, #592).
 *
 * The wrap-up runs over a scratch repository on the run's branch with a
 * bare `origin`; the seams are the PATH's: a stand-in `claude` that
 * answers every session without opening a pull request, and a stand-in
 * `gh` that lists none until the runner's `gh pr create` and records
 * every `gh pr edit --body` it is handed. The output is a sink in
 * `events` mode (the real events output prints no info line, so the
 * preserved line could not be read off it), and the run's events file is
 * bound as `loop start` binds it. Both run in a `bun -e` child, see
 * {@link DRIVER}.
 *
 * Three facts: the events file holds exactly one `pr` event, number 42,
 * and no `no-pr`; the line `preserveProgress` printed says no pull
 * request is open yet; and the body written to #42 carries the release
 * forecast block, which the release step could not write when it ran.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { RELEASE_BLOCK_OPEN } from '../release/branch-forecast.js';
import { expectExit } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';
import { hostToolDirs } from '../tests/stand-in-gh.js';

import { eventsFilePath } from './loop-events.js';

/** This file's own test timeout. */
const CASE_TIMEOUT_MS = 60_000;

/** The plan stub, whose `rafa-9` is the issue the pull request would close. */
const STUB = 'rafa-9-late-pull-request';

/** The branch the scratch repository is checked out on. */
const BRANCH = `feat/${STUB}`;

/** A session id the events file is bound under. */
const RUN_ID = 'c3a1e0d2-7b4f-4e8a-9d61-5f2b8c0e7a14';

/** The plan: one stage of one ticked task, no `rafa:plan` block. */
const PLAN = [
  `# Plan: ${STUB}`,
  '',
  '```rafa:plan',
  `stub: ${STUB}`,
  'release: patch',
  '```',
  '',
  '# Stage: only stage',
  '',
  '- [x] Add the companion test',
  '',
].join('\n');

/** The number the stand-in `gh` gives the pull request it opens. */
const OPENED_NUMBER = 42;

/** The URL the stand-in `gh` prints for it. */
const OPENED_URL = `https://github.com/example/repo/pull/${String(OPENED_NUMBER)}`;

/** The preserved line of a session that left no pull request. */
const NONE_YET = 'Progress preserved; no pull request is open on this branch yet';

/** The pull request the stand-in `gh` answers once it has been created. */
const OPENED_PULL = JSON.stringify({
  number: OPENED_NUMBER,
  title: 'stand-in',
  body: 'Closes #9',
  url: OPENED_URL,
  state: 'OPEN',
  headRefName: BRANCH,
  headRefOid: '0'.repeat(40),
  baseRefName: 'main',
  author: { login: 'rafa', is_bot: false },
  isCrossRepository: false,
  updatedAt: '2026-01-01T00:00:00Z',
  labels: [],
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  closingIssuesReferences: [],
});

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-wrap-up-late-pr-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The stand-in `claude`: answers every session with a report that opens nothing. */
const CLAUDE = [
  '#!/bin/sh',
  '/bin/cat > /dev/null',
  'cat <<\'RAFA_REPORT_EOF\'',
  'wrap-up: nothing opened.',
  '',
  '```rafa:report',
  'status: done',
  'feedback: "wrap-up: nothing opened"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  '```',
  'RAFA_REPORT_EOF',
  'exit 0',
  '',
].join('\n');

/**
 * The stand-in `gh`: `pr list` answers none until `pr create` has been
 * called, `pr create` prints the URL, `pr view` answers the created pull
 * request and `pr edit` keeps its arguments one to a line.
 */
function ghScript(calls: string): string {
  return [
    '#!/bin/sh',
    `calls='${calls}'`,
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
    '    : > "$calls/created"',
    `    echo '${OPENED_URL}'`,
    '    exit 0 ;;',
    '  "pr edit")',
    '    printf \'%s\\n\' "$@" >> "$calls/edits.log"',
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

/** Writes an executable `name` holding `text` under `dir`. */
function writeExecutable(dir: string, name: string, text: string): void {
  const file = join(dir, name);
  writeFileSync(file, text, 'utf8');
  chmodSync(file, 0o755);
}

/** Runs git in `cwd` under `home`'s isolated identity, no gpg signing. */
function git(cwd: string, home: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, HOME: home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** A scratch repository on {@link BRANCH}, its bare origin, and the stand-ins' directories. */
interface Scratch {
  readonly repo: string;
  readonly home: string;
  readonly calls: string;
  readonly path: string;
}

/** Plants the scratch repository, the plan and a `gh` provider config. */
function plant(): Scratch {
  const root = mkdtempSync(join(tempRoot, 'run-'));
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const calls = join(root, 'calls');
  for (const dir of [repo, origin, bin, home, calls]) mkdirSync(dir, { recursive: true });
  const bunBinary = Bun.which('bun');
  if (bunBinary === null) throw new Error('bun is not on the PATH this suite runs under');

  writeExecutable(bin, 'claude', CLAUDE);
  writeExecutable(bin, 'gh', ghScript(calls));

  git(origin, home, 'init', '-q', '--bare', '.');
  git(repo, home, 'init', '-q', '.');
  git(repo, home, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  writeFileSync(join(repo, 'package.json'), '{"name":"scratch","version":"1.0.0"}\n', 'utf8');
  writeFileSync(join(repo, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 — 2026-01-01, the first\n\n- loop: it began\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), `# ${STUB}\n`, 'utf8');
  git(repo, home, 'add', '-A');
  git(repo, home, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(repo, home, 'branch', '-M', 'main');
  git(repo, home, 'remote', 'add', 'origin', origin);
  git(repo, home, 'push', '-q', 'origin', 'main');
  git(repo, home, 'checkout', '-q', '-B', BRANCH);

  mkdirSync(join(repo, '.rafa'), { recursive: true });
  writeFileSync(join(repo, '.rafa', 'config.yaml'), 'pr:\n  provider: gh\n', 'utf8');
  return { repo, home, calls, path: [bin, ...hostToolDirs(), dirname(bunBinary)].join(delimiter) };
}

/** The `name` and `data.number` of each line of the events file at `file`. */
function eventLines(file: string): readonly { name?: string; data?: { number?: number } }[] {
  return readFileSync(file, 'utf8').split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { name?: string; data?: { number?: number } });
}

/** A module of this repository, as the absolute path the driver imports it by. */
function moduleUrl(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

/**
 * The driver `bun -e` runs in the scratch repository: `runWrapUp` over a
 * sink output in `events` mode with the run's events file bound. It is a
 * child because `Bun.spawn` finds `claude` and `gh` on the PATH the
 * process STARTED with, so stand-ins on the PATH reach `runWrapUp` only
 * through a process started under it. The info lines it was handed are
 * written to the file named by `argv[1]`.
 */
const DRIVER = `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setActiveOutput } from ${JSON.stringify(moduleUrl('../adapters/output/active.ts'))};
import { sinkOutput } from ${JSON.stringify(moduleUrl('../tests/output-sinks.ts'))};
import { openCheckoutExpectation } from ${JSON.stringify(moduleUrl('./checkout-watch.ts'))};
import { bindEventsFile } from ${JSON.stringify(moduleUrl('./loop-events.ts'))};
import { loadRunConfig } from ${JSON.stringify(moduleUrl('./run-config.ts'))};
import { runWrapUp } from ${JSON.stringify(moduleUrl('./wrap-up-run.ts'))};

const [repo, home, runId, branch, stub, infosFile, plan] = process.argv.slice(1);
const settings = loadRunConfig({ root: repo, home }, []).config;
setActiveOutput(sinkOutput({ info: (line) => appendFileSync(infosFile, line + '\\n') }), 'events');
bindEventsFile(repo, runId);
const none = () => undefined;
await runWrapUp({
  session: { wrapUpStarted: none, pullRequestStarted: none, ciStarted: none, repairStarted: none, finished: none },
  repoRoot: repo,
  checkout: repo,
  settings,
  planStub: stub,
  planContent: plan,
  settingSources: settings.settingSources,
  serving: { root: repo, run: runId, home, settings },
  wrapUpLearning: {
    kind: settings.learningAdapter,
    home,
    blessMinConfidence: settings.learningBlessMinConfidence,
    repoRoot: repo,
    promoteAfter: settings.learningPromoteAfter,
    promoteMinConfidence: settings.learningPromoteMinConfidence,
  },
  expected: openCheckoutExpectation({ projectRoot: repo, checkout: repo, branch }),
  ciWait: false,
  ciTimeoutMin: 1,
  ciAttempts: 0,
  isInterrupted: () => false,
});
`;

describe('runWrapUp over a first session that opens no pull request and a runner that opens #42', () => {
  it('emits one pr event with number 42, says none was open yet, and writes the forecast into #42', () => {
    const scratch = plant();
    const infosFile = join(scratch.calls, 'infos.log');
    writeFileSync(infosFile, '', 'utf8');
    const run = Bun.spawnSync(
      [process.execPath, '-e', DRIVER, scratch.repo, scratch.home, RUN_ID, BRANCH, STUB, infosFile, PLAN],
      { cwd: scratch.repo, env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) }, timeout: CASE_TIMEOUT_MS },
    );
    expectExit({ exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() }, 0, { ...scratch });

    const events = eventLines(eventsFilePath(scratch.repo, RUN_ID));
    const pr = events.filter((event) => event.name === 'pr');
    expect(pr).toHaveLength(1);
    expect(pr[0]?.data?.number).toBe(OPENED_NUMBER);
    expect(events.filter((event) => event.name === 'no-pr')).toEqual([]);

    expect(readFileSync(infosFile, 'utf8')).toContain(NONE_YET);

    const edits = readFileSync(join(scratch.calls, 'edits.log'), 'utf8');
    expect(edits).toContain(`edit\n${String(OPENED_NUMBER)}\n--body\n`);
    expect(edits).toContain(RELEASE_BLOCK_OPEN);
  }, CASE_TIMEOUT_MS + 10_000);
});
