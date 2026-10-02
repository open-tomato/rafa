/**
 * Spawned `bun src/rafa.ts epic close <n>` runs, over a scratch git
 * repository whose PATH holds a stand-in `gh` and a stand-in `claude`,
 * proving that the REGISTERED command (`src/commands/index.ts`) reaches
 * both a real `gh` and a real `claude` on the PATH through
 * `createGhRunner` and `spawnClaudeCaptured`, exactly as
 * `epic-lifecycle-spawn.test.ts` does for `gh` on `epic move`, `epic
 * defer` and `epic new`. `close.test.ts` dispatches over every seam
 * `EpicCloseSeams` names by hand, so it proves none of that wiring; this
 * file is what does, the one place that starts a session over a real
 * spawn for this command. Git itself is not stood in: each case that
 * reaches the verification runner plants a real commit on `main` and a
 * real bare `origin`, so `git fetch`, `git rev-parse` and the worktree
 * `add`/`remove` run for real, the same choice
 * `epic-lifecycle-spawn.test.ts`'s defer case makes for its own branch
 * scan.
 *
 * ## The stand-in `gh`
 *
 * {@link writeCloseGh} logs `issue list` verbatim to `ghLog` and answers
 * it from `data/board.json`; `issue close <n> --reason=completed
 * --comment=<...>` is logged WITHOUT its comment, `issue close <n>
 * --reason=completed`, since the trail's comment spans lines and would
 * break the one-call-per-line log every other spawned case here relies
 * on, the same reason `epic-lifecycle-spawn.test.ts`'s own stub drops a
 * checklist body off its log. The comment itself is written whole to
 * `data/close-comment-<n>.txt`, read back once a case needs to check it.
 * Any other call exits 1, naming it.
 *
 * ## The stand-in `claude`
 *
 * {@link writeCloseClaude} reads its prompt's first line, then drains and
 * discards the rest of stdin so the parent's write never blocks on an
 * unread pipe, and tells the planning session from a check session by that
 * first line, {@link VERIFY_PROMPT_PREFIX} against
 * {@link CHECK_PROMPT_PREFIX}, then answers whichever ran from
 * `data/plan.txt` or `data/check.txt`, logging which to `claudeLog`. A
 * first line it does not know exits 1, naming it. Every case here plans
 * at most one check, so the check side never has to tell two checks
 * apart the way `close.test.ts`'s own planted spawner does by the check
 * text its prompt carries.
 *
 * ## The five cases
 *
 * One board and one scratch repository each, so a case's own `gh` and
 * `claude` answers cannot leak into another's:
 *
 * - Epic #40, member #41 open: refused before any session starts or any
 *   `git` runs, `gh` read once for the listing and never for a close.
 * - Epic #50, one criterion, one check that passes: closed, the passed
 *   criterion named in the comment, and the cost — an empty store, since
 *   none of these cases writes to one — printed beside the estimate.
 * - Epic #60, one criterion, one check that fails: refused, the failure
 *   filed as one bug on the project's own `local` tracker (`tracker:
 *   default: local` in this case's own config), and no `issue close` sent.
 * - Epic #70, one criterion the plan answers uncheckable: refused before
 *   `git` runs at all, naming the criterion and its reason.
 * - Epic #80, two criteria, one checked and passing and one uncheckable,
 *   closed with `--accept-unchecked`: the uncheckable one named in the
 *   comment with its reason, beside the checked one.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { renderCloseComment } from '../board/epic-trail.js';
import { BOARD_LIST_FIELDS, BOARD_LISTING_LIMIT } from '../board/roadmap-board.js';
import { ACCEPT_UNCHECKED_FLAG, EPIC_CLOSE_REFUSAL_EXIT } from '../commands/epic/close.js';
import { MEMBERSHIP_NOTE, renderEpicCost } from '../effort/epic-cost.js';
import { VERIFY_PROMPT_PREFIX } from '../epic/verify-plan.js';
import { CHECK_PROMPT_PREFIX } from '../epic/verify-run.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-close-spawn-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run: a plan session, a check and several git steps. */
const SPAWN_TIMEOUT = 30_000;

/** The listing's own `gh issue list` call, as the stand-in logs it. */
const LIST_CALL = `issue list --state all --limit ${String(BOARD_LISTING_LIMIT)} --json ${BOARD_LIST_FIELDS}`;

/**
 * A `sh` function writing a file's lines to stdout with only builtins, since
 * `scratch.path` carries no `cat`: PATH is `scratch.bin` then `git`'s own
 * directory, and on this machine that is `/usr/bin`, which holds no `cat`
 * (`/bin` on its own). The trailing `|| [ -n "$line" ]` keeps a final line
 * with no newline of its own.
 */
const EMIT_FILE_FN = [
  'emit_file() {',
  '  while IFS= read -r line || [ -n "$line" ]; do',
  '    printf \'%s\\n\' "$line"',
  '  done < "$1"',
  '}',
].join('\n');

/** One issue as `gh issue list --json ...` writes it, closed unless `options.state` says otherwise. */
function raw(number: number, labels: readonly string[], options: { state?: 'OPEN' | 'CLOSED'; body?: string } = {}): object {
  const state = options.state ?? 'CLOSED';
  return {
    number,
    title: `issue ${String(number)}`,
    body: options.body ?? '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: labels.map((name) => ({ name })),
  };
}

/**
 * Writes the stand-in `gh` into `scratch.bin`, backed by `data/board.json`;
 * see the module note. `dataDir` also holds `close-comment-<n>.txt` once a
 * close runs.
 */
function writeCloseGh(scratch: ScratchRepo, ghLog: string, dataDir: string, board: readonly object[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'board.json'), JSON.stringify(board), 'utf8');
  const gh = join(scratch.bin, 'gh');
  const script = [
    '#!/bin/sh',
    `DATA='${dataDir}'`,
    `LOG='${ghLog}'`,
    '',
    'route() {',
    '  printf \'%s\\n\' "$1" >> "$LOG"',
    '}',
    '',
    EMIT_FILE_FN,
    '',
    'case "$1 $2" in',
    '  "issue list")',
    '    route "$*"',
    '    emit_file "$DATA/board.json"',
    '    ;;',
    '  "issue close")',
    '    route "issue close $3 --reason=completed"',
    '    val="$5"',
    '    val="${val#--comment=}"',
    '    printf \'%s\' "$val" > "$DATA/close-comment-$3.txt"',
    '    printf \'\'',
    '    ;;',
    '  *)',
    '    echo "unplanned gh call: $*" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  writeFileSync(gh, script, 'utf8');
  chmodSync(gh, 0o755);
}

/** Writes the stand-in `claude` into `scratch.bin`, backed by `data/plan.txt` and `data/check.txt`; see the module note. */
function writeCloseClaude(scratch: ScratchRepo, claudeLog: string, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const claude = join(scratch.bin, 'claude');
  const script = [
    '#!/bin/sh',
    `DATA='${dataDir}'`,
    `LOG='${claudeLog}'`,
    '',
    'IFS= read -r first_line',
    'while IFS= read -r _rest; do :; done',
    '',
    'route() {',
    '  printf \'%s\\n\' "$1" >> "$LOG"',
    '}',
    '',
    EMIT_FILE_FN,
    '',
    'case "$first_line" in',
    `  "${VERIFY_PROMPT_PREFIX}")`,
    '    route plan',
    '    emit_file "$DATA/plan.txt"',
    '    ;;',
    `  "${CHECK_PROMPT_PREFIX}")`,
    '    route check',
    '    emit_file "$DATA/check.txt"',
    '    ;;',
    '  *)',
    '    echo "unplanned claude prompt: $first_line" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  writeFileSync(claude, script, 'utf8');
  chmodSync(claude, 0o755);
}

/** The planning session's output: one `check` or `uncheckable` entry per criterion, in order. */
function planOutput(entries: readonly string[]): string {
  return `Planned.\n\n\`\`\`rafa:verify\ncriteria:\n${entries.join('\n')}\n\`\`\`\n`;
}

/** One `criteria` entry planning a check. */
function checkEntry(criterion: number, check: string): string {
  return `  - criterion: ${String(criterion)}\n    check: "${check}"`;
}

/** One `criteria` entry planning no check. */
function uncheckableEntry(criterion: number, reason: string): string {
  return `  - criterion: ${String(criterion)}\n    uncheckable: "${reason}"`;
}

/** A check session's output. */
function verdictOutput(result: 'pass' | 'fail', evidence: string): string {
  return `Checked.\n\n\`\`\`rafa:verdict\nresult: ${result}\nevidence: "${evidence}"\n\`\`\`\n`;
}

/** The environment every git run in this file uses: `scratch`'s own HOME, global and system config off. */
function gitEnv(scratch: ScratchRepo): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    HOME: scratch.home,
    GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...gitIdentityEnv(),
  };
}

/**
 * Commits once, empty, on `main`, and adds a bare `origin` beside the
 * repository holding it, pushed. Answers the commit `origin/main`
 * resolves to.
 */
function plantMainWithOrigin(scratch: ScratchRepo): string {
  const env = gitEnv(scratch);
  const run = (args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd: scratch.repo, stdio: 'pipe', env });
  };
  run(['checkout', '-q', '-B', 'main']);
  run(['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'seed']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', bare], { cwd: scratch.repo, stdio: 'pipe', env });
  run(['remote', 'add', 'origin', bare]);
  run(['push', '-q', 'origin', 'main']);
  return execFileSync('git', ['rev-parse', 'main'], { cwd: scratch.repo, env }).toString()
    .trim();
}

/** What one case plants: a fresh scratch repository, its logs and its data directory. */
interface Case {
  readonly scratch: ScratchRepo;
  readonly ghLog: string;
  readonly claudeLog: string;
  readonly dataDir: string;
}

/** Plants a fresh scratch repository with both stand-ins wired to it, and `board` for `gh issue list` to answer. */
function plantCase(board: readonly object[]): Case {
  const scratch = plantScratchRepo(tempBase);
  const dataDir = join(dirname(scratch.repo), 'data');
  const ghLog = join(dirname(scratch.repo), 'gh.log');
  const claudeLog = join(dirname(scratch.repo), 'claude.log');
  writeFileSync(ghLog, '', 'utf8');
  writeFileSync(claudeLog, '', 'utf8');
  writeCloseGh(scratch, ghLog, dataDir, board);
  writeCloseClaude(scratch, claudeLog, dataDir);
  return { scratch, ghLog, claudeLog, dataDir };
}

/** Every non-blank line of a log file. */
function linesOf(path: string): readonly string[] {
  return readFileSync(path, 'utf8').split('\n')
    .filter((line) => line !== '');
}

describe('rafa epic close, spawned', () => {
  it('refuses with exit 2 while a member is open, naming it, starting no session and running no git', () => {
    const board = [
      raw(40, ['type:epic', 'epic:widgets', 'horizon:now'], { state: 'OPEN', body: 'Estimate: soon\n\n## Acceptance criteria\n\n- Something works.\n' }),
      raw(41, ['epic:widgets'], { state: 'OPEN' }),
      raw(42, ['epic:widgets']),
    ];
    const setup = plantCase(board);

    const run = runRafa(setup.scratch, setup.scratch.repo, ['epic', 'close', '40']);

    expect(run.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(run.stderr).toContain('Epic #40 has 1 open member: #41 issue 41.');
    expect(linesOf(setup.claudeLog)).toEqual([]);
    expect(linesOf(setup.ghLog)).toEqual([LIST_CALL]);
  }, SPAWN_TIMEOUT);

  it('closes the epic when its one planted check passes, naming it in the comment, and prints the cost beside the estimate', () => {
    const board = [
      raw(50, ['type:epic', 'epic:auth2', 'horizon:now'], { state: 'OPEN', body: 'Estimate: three days\n\n## Acceptance criteria\n\n- Check one thing.\n' }),
      raw(51, ['epic:auth2']),
    ];
    const setup = plantCase(board);
    const commit = plantMainWithOrigin(setup.scratch);
    writeFileSync(join(setup.dataDir, 'plan.txt'), planOutput([checkEntry(1, 'Run the one check')]), 'utf8');
    writeFileSync(join(setup.dataDir, 'check.txt'), verdictOutput('pass', 'it did the one thing'), 'utf8');

    const run = runRafa(setup.scratch, setup.scratch.repo, ['epic', 'close', '50']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Closed epic #50 as completed: 1 criterion passed against ${commit}.`);
    const [costLine] = renderEpicCost({ runs: 0, wallSeconds: 0, runsWithoutTime: 0, tokens: 0 }, 'three days');
    expect(run.stdout).toContain(`${costLine ?? ''}\n${MEMBERSHIP_NOTE}\n`);
    expect(linesOf(setup.claudeLog)).toEqual(['plan', 'check']);
    expect(linesOf(setup.ghLog)).toEqual([LIST_CALL, 'issue close 50 --reason=completed']);
    const comment = renderCloseComment({ passed: ['- Check one thing.'], unchecked: [] });
    expect(readFileSync(join(setup.dataDir, 'close-comment-50.txt'), 'utf8')).toBe(comment);
  }, SPAWN_TIMEOUT);

  it('refuses and files one bug for a failing check, sending no issue close', () => {
    const board = [
      raw(60, ['type:epic', 'epic:draft2', 'horizon:now'], { state: 'OPEN', body: 'Estimate: one week\n\n## Acceptance criteria\n\n- Do the thing.\n' }),
      raw(61, ['epic:draft2']),
    ];
    const setup = plantCase(board);
    plantProjectConfig(setup.scratch.repo, 'tracker:\n  default: local\n');
    const commit = plantMainWithOrigin(setup.scratch);
    writeFileSync(join(setup.dataDir, 'plan.txt'), planOutput([checkEntry(1, 'Run the thing check')]), 'utf8');
    writeFileSync(join(setup.dataDir, 'check.txt'), verdictOutput('fail', 'it did not do the thing'), 'utf8');

    const run = runRafa(setup.scratch, setup.scratch.repo, ['epic', 'close', '60']);

    expect(run.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(run.stderr).toContain(`Epic #60 was not closed: against ${commit}, 1 criterion failed its check, each filed as a bug.`);
    expect(run.stdout).toContain('Criterion 1: filed on the public tracker as local issue');
    expect(linesOf(setup.claudeLog)).toEqual(['plan', 'check']);
    expect(linesOf(setup.ghLog)).toEqual([LIST_CALL]);
  }, SPAWN_TIMEOUT);

  it('refuses on an uncheckable criterion before any git runs, naming it with its reason', () => {
    const board = [
      raw(70, ['type:epic', 'epic:draft3', 'horizon:now'], { state: 'OPEN', body: 'Estimate: soon\n\n## Acceptance criteria\n\n- Feels right.\n' }),
      raw(71, ['epic:draft3']),
    ];
    const setup = plantCase(board);
    writeFileSync(join(setup.dataDir, 'plan.txt'), planOutput([uncheckableEntry(1, 'It needs a person to judge.')]), 'utf8');

    const run = runRafa(setup.scratch, setup.scratch.repo, ['epic', 'close', '70']);

    expect(run.exitCode).toBe(EPIC_CLOSE_REFUSAL_EXIT);
    expect(run.stdout).toContain('warn: Uncheckable criterion 1: - Feels right. — It needs a person to judge.');
    expect(run.stderr).toContain(`pass --${ACCEPT_UNCHECKED_FLAG} to close over them`);
    expect(linesOf(setup.claudeLog)).toEqual(['plan']);
    expect(linesOf(setup.ghLog)).toEqual([LIST_CALL]);
  }, SPAWN_TIMEOUT);

  it('closes over the uncheckable criterion with --accept-unchecked, naming it in the comment beside the checked one', () => {
    const board = [
      raw(80, ['type:epic', 'epic:draft4', 'horizon:now'], { state: 'OPEN', body: 'Estimate: soon\n\n## Acceptance criteria\n\n- Checkable thing.\n- Feels right.\n' }),
      raw(81, ['epic:draft4']),
    ];
    const setup = plantCase(board);
    const commit = plantMainWithOrigin(setup.scratch);
    writeFileSync(
      join(setup.dataDir, 'plan.txt'),
      planOutput([checkEntry(1, 'Run the checkable thing check'), uncheckableEntry(2, 'It needs a person to judge.')]),
      'utf8',
    );
    writeFileSync(join(setup.dataDir, 'check.txt'), verdictOutput('pass', 'it did the checkable thing'), 'utf8');

    const run = runRafa(setup.scratch, setup.scratch.repo, ['epic', 'close', '80', `--${ACCEPT_UNCHECKED_FLAG}`]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Closed epic #80 as completed: 1 criterion passed against ${commit}, 1 criterion closed over with --${ACCEPT_UNCHECKED_FLAG}.`);
    expect(linesOf(setup.claudeLog)).toEqual(['plan', 'check']);
    expect(linesOf(setup.ghLog)).toEqual([LIST_CALL, 'issue close 80 --reason=completed']);
    const comment = renderCloseComment({
      passed: ['- Checkable thing.'],
      unchecked: [{ criterion: '- Feels right.', reason: 'It needs a person to judge.' }],
    });
    expect(readFileSync(join(setup.dataDir, 'close-comment-80.txt'), 'utf8')).toBe(comment);
  }, SPAWN_TIMEOUT);
});
