/**
 * Spawned proof for `rafa epic cancel` and the cancelled-epic notice on
 * `rafa epics` (`.rafa/specs/rafa-246-epic-lifecycle.md`, "Cancelling a
 * fixture epic whose member blocks an issue in another epic asks about
 * that issue, and prints the list without a terminal").
 *
 * ## The fixture epic cancel runs over
 *
 * Epic #40 (`epic:auth`, OPEN) has one open member, #12. Outside it wait
 * two issues #12 blocks: #57, a member of ANOTHER open epic, #50
 * (`epic:billing`), and #58, which carries no epic at all — one dependent
 * in another epic, one with none, so the fixture is not a coincidence of
 * a single shape. Both carry `Blocked by: #12`.
 *
 * ## Two ways to reach a real `gh`
 *
 * `rafa epic cancel 40, spawned` runs the REGISTERED command exactly as
 * `epic-lifecycle-spawn.test.ts` does, through `bun src/rafa.ts` and a
 * stand-in `gh` on the `PATH`: with no controlling terminal — a spawned
 * child's own condition, the same one `epic-lifecycle-spawn.test.ts`'s
 * `epic defer` case measures — it prints the list and
 * {@link unaskedCancelMessage} and sends nothing.
 *
 * Asking and applying needs a terminal a spawned test cannot give a
 * child honestly, so that case runs a small PROBE of its own, the
 * technique `next-chain-integration.test.ts` uses for the same reason:
 * a program written to `<scratch>/probe.ts` that builds the real
 * `createEpicCancelCommand` with `isTerminal: () => true` and a scripted
 * prompter — the one seam an honest terminal cannot be handed — and
 * dispatches it for real. Its `gh` is still the stand-in resolved off the
 * spawned child's own `PATH`, so the write path is exercised exactly as
 * the registered command sends it: `editChecklist`'s read, write and
 * re-read for the unblock note, the label removal, both comments and the
 * epic's own close. The prompter logs every question it is asked to a
 * file the parent reads back, so the case can assert the exact two
 * questions asked, not just that the writes landed.
 *
 * ## The `rafa epics` half
 *
 * A second fixture — epic #70, closed NOT PLANNED, one open member #71,
 * one dependent #72 outside it — is run through `rafa epics 70` twice:
 * once with #72 still open, printing {@link renderCancelledEpicNotice}'s
 * line naming #70 and #72, and once with #72 closed, the shape a
 * `cancel` answer of `cancel` leaves it in, printing no such line at all
 * — the notice names a dependent only until it is answered
 * (`src/board/epic-cancel-notice.ts`).
 */
import type { ScratchRepo } from './cli-capture.js';
import type { EpicDependent } from '../board/epic-dependents.js';
import type { BoardIssue } from '../board/roadmap-board.js';

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { renderCancelledEpicNotice } from '../board/epic-cancel-notice.js';
import { renderCancelComment, renderDependentComment, renderUnblockNote } from '../board/epic-trail.js';
import { parseBoardListing } from '../board/roadmap-board.js';
import { readEpicToCancel, dependentLines, dependentQuestion, unaskedCancelMessage } from '../commands/epic/cancel.js';

import { expectExit, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { scratchHomeEnv } from './scratch-home-env.js';

/** This module's own directory, `src/tests/`. */
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** `src/`, where every module the probe imports lives. */
const SRC_DIR = join(TESTS_DIR, '..');

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-cancel-spawn-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** One `gh issue list` row, labels named plainly. */
function row(
  number: number,
  title: string,
  body: string,
  state: 'OPEN' | 'CLOSED',
  labels: readonly string[],
  stateReason = '',
): object {
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** Epic #40's open member. */
const AUTH_MEMBER = 12;

/** #57's body: a member of epic #50, blocked by {@link AUTH_MEMBER} alone. */
const BODY_57 = 'Waits on the API.\n\nBlocked by: #12\n';

/** #58's body: no epic, blocked by {@link AUTH_MEMBER} alone. */
const BODY_58 = 'Needs sign-in first.\n\nBlocked by: #12\n';

/** The board `rafa epic cancel 40` runs over: the module note's fixture. */
const CANCEL_BOARD: readonly object[] = [
  row(40, 'Auth epic', '- [ ] #12\n', 'OPEN', ['type:epic', 'epic:auth', 'horizon:now']),
  row(AUTH_MEMBER, 'Sign-in', '', 'OPEN', ['epic:auth']),
  row(50, 'Billing epic', '- [ ] #57\n', 'OPEN', ['type:epic', 'epic:billing', 'horizon:next']),
  row(57, 'Payment step', BODY_57, 'OPEN', ['epic:billing', 'spec:blocked']),
  row(58, 'Support ticket', BODY_58, 'OPEN', []),
];

/** The board as `readEpicToCancel` reads it, for building the exact questions asked. */
const CANCEL_ISSUES: readonly BoardIssue[] = parseBoardListing(JSON.stringify(CANCEL_BOARD), 'the planted listing');

/** Epic #40's dependent numbered `number`, as the questions and lines name it. */
function dependentOf(number: number): EpicDependent {
  const found = readEpicToCancel(CANCEL_ISSUES, 40).dependents.find((dependent) => dependent.issue.number === number);
  if (found === undefined) throw new Error(`#${String(number)} is no dependent of epic #40`);
  return found;
}

/** Every call the stand-in `gh` logged, blank lines dropped. */
function callLog(scratch: ScratchRepo): readonly string[] {
  return readFileSync(scratch.callLog, 'utf8').split('\n')
    .filter((line) => line !== '');
}

/**
 * Writes the stand-in `gh` for `rafa epic cancel`: the board listing, an
 * empty `pr list`, a label removal (`issue edit`), a close (`issue
 * close`, its comment written whole to `data/close-comment-<n>.txt` since
 * it spans lines, the same reason `epic-close-spawn.test.ts`'s own stub
 * drops it off the one-call-per-line log) and the `gh api
 * repos/{owner}/{repo}/issues/<n>` pair a checklist edit reads and
 * writes, kept in `data/body-<n>.txt` across the read, write and re-read
 * `editChecklist` makes. A call this file did not plan for exits 1,
 * naming it.
 */
function writeCancelGhStub(scratch: ScratchRepo, board: readonly object[], bodies: Readonly<Record<number, string>> = {}): string {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'board.json'), JSON.stringify(board), 'utf8');
  for (const [issue, body] of Object.entries(bodies)) {
    writeFileSync(join(data, `body-${issue}.txt`), body, 'utf8');
  }

  const gh = join(scratch.bin, 'gh');
  const script = [
    '#!/bin/sh',
    `DATA='${data}'`,
    `LOG='${scratch.callLog}'`,
    '',
    'read_file() {',
    '  IFS= read -r line < "$1" || true',
    '  printf \'%s\' "$line"',
    '}',
    '',
    'json_escape() {',
    '  first=1',
    '  trailing=0',
    '  line=""',
    '  while IFS= read -r line; do',
    '    if [ "$first" -eq 1 ]; then first=0; else printf \'\\\\n\'; fi',
    '    printf \'%s\' "$line"',
    '    trailing=1',
    '  done',
    '  if [ -n "$line" ]; then',
    '    if [ "$first" -eq 1 ]; then first=0; else printf \'\\\\n\'; fi',
    '    printf \'%s\' "$line"',
    '    trailing=0',
    '  fi',
    '  if [ "$trailing" -eq 1 ]; then printf \'\\\\n\'; fi',
    '}',
    '',
    'route() {',
    '  printf \'%s\\n\' "$1" >> "$LOG"',
    '}',
    '',
    'case "$1 $2" in',
    '  "issue list")',
    '    route "$*"',
    '    read_file "$DATA/board.json"',
    '    ;;',
    '  "pr list")',
    '    route "$*"',
    '    printf \'[]\'',
    '    ;;',
    '  "issue edit")',
    '    route "$*"',
    '    printf \'\'',
    '    ;;',
    '  "issue close")',
    '    route "issue close $3 --reason=not planned"',
    '    val="$5"',
    '    val="${val#--comment=}"',
    '    printf \'%s\' "$val" > "$DATA/close-comment-$3.txt"',
    '    printf \'\'',
    '    ;;',
    '  "api "*)',
    '    case "$4" in',
    '      PATCH)',
    '        val="$6"',
    '        val="${val#body=}"',
    '        num="${2##*/}"',
    '        printf \'%s\' "$val" > "$DATA/body-$num.txt"',
    '        route "api $2 -X PATCH"',
    '        json=$(printf \'%s\' "$val" | json_escape)',
    '        printf \'{"body": "%s"}\' "$json"',
    '        ;;',
    '      POST)',
    '        val="$6"',
    '        val="${val#body=}"',
    '        stripped="${2%/comments}"',
    '        num="${stripped##*/}"',
    '        printf \'%s\\n---\\n\' "$val" >> "$DATA/comments-$num.log"',
    '        route "api $2 -X POST"',
    '        printf \'{"id": 1, "body": "posted", "user": {"login": "octocat"}}\'',
    '        ;;',
    '      *)',
    '        num="${2##*/}"',
    '        route "api $2"',
    '        json=$(json_escape < "$DATA/body-$num.txt")',
    '        printf \'{"body": "%s"}\' "$json"',
    '        ;;',
    '    esac',
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
  return data;
}

/** What a fixture file under `data` holds. */
function dataFile(data: string, name: string): string {
  return readFileSync(join(data, name), 'utf8');
}

describe('rafa epic cancel 40, spawned, with no terminal', () => {
  it('prints the list naming the dependent in the other epic, and sends no write', () => {
    const scratch = plantScratchRepo(tempBase);
    writeCancelGhStub(scratch, CANCEL_BOARD);

    const run = runRafa(scratch, scratch.repo, ['epic', 'cancel', '40']);

    expect(run.stderr).toBe('');
    expectExit(run, 0, scratch);
    expect(run.stdout).toBe([
      ...dependentLines(40, [dependentOf(57), dependentOf(58)]),
      unaskedCancelMessage(40),
      '',
    ].join('\n'));

    const log = callLog(scratch);
    expect(log).toHaveLength(1);
    expect(log[0]).toStartWith('issue list --state all');
  }, SPAWN_TIMEOUT);
});

/**
 * Builds the probe script asking about epic #40's dependents through a
 * scripted prompter, run in place of an honest terminal a spawned test
 * cannot give a child; see the module note. Every question it is asked
 * is appended to the file its first argument names, so the parent can
 * confirm the exact questions before it reads back what was written.
 */
function buildCancelProbe(): string {
  return [
    `import { dispatch } from ${JSON.stringify(join(SRC_DIR, 'cli', 'dispatch.ts'))};`,
    `import { createCommandRegistry } from ${JSON.stringify(join(SRC_DIR, 'cli', 'registry.ts'))};`,
    `import { createEpicCancelCommand } from ${JSON.stringify(join(SRC_DIR, 'commands', 'epic', 'cancel.ts'))};`,
    'import { appendFileSync } from "node:fs";',
    '',
    'const [logPath, ...words] = process.argv.slice(2);',
    'const answers = ["u", "c"];',
    'let asked = 0;',
    '',
    'const prompter = {',
    '  say: () => {},',
    '  ask: async (question) => {',
    '    appendFileSync(logPath, question + "\\n", "utf8");',
    '    const answer = answers[asked] ?? null;',
    '    asked += 1;',
    '    return answer;',
    '  },',
    '  close: () => {},',
    '};',
    '',
    'const command = createEpicCancelCommand({',
    '  isTerminal: () => true,',
    '  openPrompter: () => prompter,',
    '  now: () => new Date(2026, 8, 28, 12),',
    '});',
    'const registry = createCommandRegistry({',
    '  subjects: [{ name: "epic", summary: "the epics" }],',
    '  commands: [command],',
    '});',
    '',
    'const { exitCode } = await dispatch(words, { registry });',
    'process.exitCode = exitCode;',
    '',
  ].join('\n');
}

/** Spawns {@link buildCancelProbe} over `scratch`, answers logged to `logPath`. */
function runCancelProbe(scratch: ScratchRepo, logPath: string): { readonly stdout: string; readonly stderr: string; readonly exitCode: number | null } {
  const probe = join(dirname(scratch.repo), 'probe.ts');
  writeFileSync(probe, buildCancelProbe(), 'utf8');
  const run = Bun.spawnSync([process.execPath, probe, logPath, 'epic', 'cancel', '40'], {
    cwd: scratch.repo,
    env: { TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    timeout: SPAWN_TIMEOUT,
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

describe('rafa epic cancel 40, spawned, with a terminal', () => {
  it('asks about #57 and #58 in turn and applies each answer, over a real spawned gh', () => {
    const scratch = plantScratchRepo(tempBase);
    const data = writeCancelGhStub(scratch, CANCEL_BOARD, { 57: BODY_57 });
    const logPath = join(dirname(scratch.repo), 'questions.log');

    const run = runCancelProbe(scratch, logPath);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);

    const questions = readFileSync(logPath, 'utf8').split('\n')
      .filter((line) => line !== '');
    expect(questions).toEqual([
      dependentQuestion(40, dependentOf(57)),
      dependentQuestion(40, dependentOf(58)),
    ]);

    const note57 = renderUnblockNote('2026-09-28', 40, [AUTH_MEMBER], []);
    expect(run.stdout).toBe([
      ...dependentLines(40, [dependentOf(57), dependentOf(58)]),
      'Unblocked #57: noted below its body that #12 no longer blocks it.',
      'Took spec:blocked off #57.',
      'Closed #58 as not planned.',
      'Closed epic #40 as not planned.',
      '',
    ].join('\n'));

    const log = callLog(scratch);
    expect(log).toContain('issue edit 57 --remove-label spec:blocked');
    expect(log).toContain('issue close 58 --reason=not planned');
    expect(log).toContain('issue close 40 --reason=not planned');
    expect(log.some((line) => line.includes('issue close 57'))).toBe(false);
    expect(log.some((line) => line.includes('issue edit 58'))).toBe(false);

    expect(dataFile(data, 'body-57.txt')).toBe(`${BODY_57}\n${note57}\n`);
    expect(dataFile(data, 'close-comment-58.txt')).toBe(renderDependentComment('cancelled', 40, [AUTH_MEMBER]));
    expect(dataFile(data, 'close-comment-40.txt')).toBe(renderCancelComment(null, [
      { issue: 57, answer: { kind: 'unblocked' } },
      { issue: 58, answer: { kind: 'cancelled' } },
    ]));
  }, SPAWN_TIMEOUT);
});

/** Epic #70's open member. */
const GONE_MEMBER = 71;

/** The board `rafa epics 70` runs over, `open` deciding whether #72 still waits. */
function epicsBoard(open: boolean): readonly object[] {
  return [
    row(70, 'Gone epic', `- [ ] #${String(GONE_MEMBER)}\n`, 'CLOSED', ['type:epic', 'epic:gone', 'horizon:later'], 'NOT_PLANNED'),
    row(GONE_MEMBER, 'Gone member', '', 'OPEN', ['epic:gone']),
    row(72, 'Needs the gone feature', 'Blocked by: #71\n', open
      ? 'OPEN'
      : 'CLOSED', [], open
      ? ''
      : 'NOT_PLANNED'),
  ];
}

/**
 * Writes the stand-in `gh` for `rafa epics`: the board listing and an
 * empty `pr list`. Prints the board with builtins only: the `PATH` a
 * spawn gets may hold no `cat`.
 */
function writeEpicsGhStub(scratch: ScratchRepo, board: readonly object[]): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'board.json'), JSON.stringify(board), 'utf8');
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `DATA='${data}'`,
    'case "$1 $2" in',
    '  "issue list") while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$DATA/board.json";;',
    '  "pr list") printf \'[]\';;',
    '  *) echo "unplanted gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/** A reachable, empty bare `origin` remote beside `scratch`, so the branch scan's remote half never warns. */
function addOrigin(scratch: ScratchRepo): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const bare = join(dirname(scratch.repo), 'origin.git');
  Bun.spawnSync(['git', 'init', '-q', '--bare', bare], { cwd: scratch.repo, env });
  Bun.spawnSync(['git', 'remote', 'add', 'origin', bare], { cwd: scratch.repo, env });
}

describe('rafa epics 70, spawned, over an epic closed as not planned', () => {
  it('names #72 as still waiting while it is open, and no longer once it is closed', () => {
    const notice = renderCancelledEpicNotice({ epic: 70, dependents: [72] });

    const waiting = plantScratchRepo(tempBase);
    addOrigin(waiting);
    writeEpicsGhStub(waiting, epicsBoard(true));
    const waitingRun = runRafa(waiting, waiting.repo, ['epics', '70']);
    expectExit(waitingRun, 0, waiting);
    expect(waitingRun.stdout).toContain(notice);

    const answered = plantScratchRepo(tempBase);
    addOrigin(answered);
    writeEpicsGhStub(answered, epicsBoard(false));
    const answeredRun = runRafa(answered, answered.repo, ['epics', '70']);
    expectExit(answeredRun, 0, answered);
    expect(answeredRun.stdout).not.toContain('was closed as not planned');
  }, SPAWN_TIMEOUT);
});
