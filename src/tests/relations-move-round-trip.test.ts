/**
 * `rafa init --board` moving one fixture board from `labels` to `native`
 * and back, dispatched through the REGISTERED command
 * (`../commands/init.js`, `createInitCommand`) over a mutating in-process
 * `gh`: the board it answers `issue list` with reflects every `issue
 * edit` and `gh api ... issues/<n>` call the move sent, so a second
 * dispatch reads the board the first one left behind, and
 * `readDoctorBoard`/`renderDoctorBoard` (`../commands/doctor-board.js`)
 * then read the SAME board for the marks a kept move leaves.
 *
 * ## Why this dispatches rather than spawns `bun src/rafa.ts`
 *
 * Every other `*-spawned-cli.test.ts` file spawns the real binary
 * (`runRafa`, `./cli-capture.js`) and proves the wiring between the
 * registered command and a real `gh` on `PATH`; none of them puts a
 * `[y/N]` question to it, because `DEFAULT_INIT_SEAMS.isTerminal`
 * (`../commands/init.ts`) reads the real `process.stdin.isTTY`, which a
 * spawned child's piped stdin never answers `true` — measured empty
 * (`{}`, `isTTY` undefined) spawning a probe script the way `runRafa`
 * spawns `rafa` here. The relationships move's own module note is
 * explicit that no flag answers its questions for a script (`../commands
 * /init-board.ts`, "The relationships move, asked last"), so a case
 * proving "sent on yes" and "none on no" needs a terminal a real spawn
 * cannot be given without a pseudo-terminal this codebase does not carry
 * for any other command's own `[y/N]` question either. This file instead
 * dispatches the registered `createInitCommand` in-process
 * (`dispatchInProject`, `./cli-capture.js`) with `isTerminal: () => true`
 * and a scripted {@link Prompter}, the same technique
 * `../commands/init-board-move.test.ts`'s own command-level cases use,
 * over a `gh` that actually mutates a fixture board rather than a
 * fixed one, so the board a second dispatch reads is the board the first
 * one left. The `rafa doctor` naming at the end reads the same mutated
 * board twice: once through the exact functions `../commands/doctor.ts`
 * calls (`readDoctorBoard`, `renderDoctorBoard`), whose lines this file
 * checks against `renderDoctorMarks`' own wording, and once more through
 * the REGISTERED `rafa doctor` dispatched the same in-process way, whose
 * json result is asserted to carry the identical marks. Neither
 * `../commands/doctor-board-native.test.ts` nor `../commands/doctor-marks
 * .test.ts` moves a board first; what is untested anywhere else, and
 * what this file is for, is that the marks `rafa doctor` prints and
 * answers are exactly the marks a real move over a real listing left
 * kept.
 *
 * ## The fixture board
 *
 * Recorded in `labels`: epic #1 (`epic:alpha`), whose checklist names
 * #11 before #10; #10 and #11, its members; #30, waiting on #31 through
 * `spec:blocked` and a `Blocked by: #31` line. The same board `../board/
 * relations/move.test.ts` and `../commands/init-board-move.test.ts` open
 * their own labels-to-native cases with.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { DoctorSeams } from '../commands/doctor.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readDoctorBoard, renderDoctorBoard } from '../commands/doctor-board.js';
import { markMessage, MARKS_HEADING } from '../commands/doctor-marks.js';
import { createDoctorCommand } from '../commands/doctor.js';
import { MOVE_FIX } from '../commands/init-board.js';
import { createInitCommand, DEFAULT_INIT_SEAMS } from '../commands/init.js';
import { plural } from '../plan/plan-files.js';

import { dispatchInProject, eventsOf, plantProject } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-relations-move-round-trip-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The mutable fixture board a dispatch's `gh` answers and edits. */
interface Row {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  labels: string[];
  parent: number | null;
  blockedBy: number[];
  subIssues: number[];
}

/** One row, everything left out empty. */
function row(number: number, fields: Partial<Row> = {}): Row {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    labels: [...fields.labels ?? []],
    parent: fields.parent ?? null,
    blockedBy: [...fields.blockedBy ?? []],
    subIssues: [...fields.subIssues ?? []],
  };
}

/**
 * The board recorded in `labels`: epic #1 (`epic:alpha`) naming #11
 * before #10 on its checklist, #10 and #11 its members, #30 waiting on
 * #31.
 */
function freshBoard(): Map<number, Row> {
  const rows = [
    row(1, { labels: ['type:epic', 'epic:alpha'], body: '- [ ] #11 second\n- [ ] #10 first\n' }),
    row(10, { labels: ['epic:alpha'] }),
    row(11, { labels: ['epic:alpha'] }),
    row(30, { labels: ['spec:blocked'], body: 'Blocked by: #31\n' }),
    row(31),
  ];
  return new Map(rows.map((one) => [one.number, one]));
}

/** A link node naming `number` on the board's own repository. */
function node(rows: Map<number, Row>, number: number): object {
  const found = rows.get(number);
  return { number, title: found?.title ?? `Issue ${String(number)}`, state: found?.state ?? 'OPEN', url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
}

/** A relationship list of `numbers`, none of it truncated. */
function links(rows: Map<number, Row>, numbers: readonly number[]): object {
  return { nodes: numbers.map((number) => node(rows, number)), totalCount: numbers.length };
}

/** `row` as `gh issue list --json <native fields>` writes it. */
function rawRow(rows: Map<number, Row>, current: Row): object {
  return {
    number: current.number,
    title: current.title,
    body: current.body,
    state: current.state,
    stateReason: current.state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: current.labels.map((name) => ({ name })),
    parent: current.parent === null
      ? null
      : node(rows, current.parent),
    blockedBy: links(rows, current.blockedBy),
    blocking: links(rows, []),
    subIssuesSummary: { total: current.subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: links(rows, current.subIssues),
  };
}

/** Applies one `gh issue edit <n> ...flags` call's flags to `rows`, as GitHub would. Unknown issues are left alone. */
function applyEditFlags(rows: Map<number, Row>, issue: number, flags: readonly string[]): void {
  const current = rows.get(issue);
  if (current === undefined) return;
  let index = 0;
  while (index < flags.length) {
    const flag = flags[index] ?? '';
    if (flag.startsWith('--body=')) {
      current.body = flag.slice('--body='.length);
      index += 1;
      continue;
    }
    if (flag === '--remove-parent') {
      if (current.parent !== null) {
        const parent = rows.get(current.parent);
        if (parent !== undefined) parent.subIssues = parent.subIssues.filter((number) => number !== issue);
      }
      current.parent = null;
      index += 1;
      continue;
    }
    const value = flags[index + 1] ?? '';
    index += 2;
    const items = value.split(',').map(Number);
    if (flag === '--add-sub-issue') {
      for (const child of items) {
        if (!current.subIssues.includes(child)) current.subIssues.push(child);
        const childRow = rows.get(child);
        if (childRow !== undefined) childRow.parent = issue;
      }
    } else if (flag === '--add-blocked-by') {
      for (const blocker of items) if (!current.blockedBy.includes(blocker)) current.blockedBy.push(blocker);
    } else if (flag === '--remove-blocked-by') {
      current.blockedBy = current.blockedBy.filter((number) => !items.includes(number));
    } else if (flag === '--add-label') {
      if (!current.labels.includes(value)) current.labels.push(value);
    } else if (flag === '--remove-label') {
      current.labels = current.labels.filter((label) => label !== value);
    }
  }
}

/** The path `gh api` reads and writes a body at, and the issue number it names. */
const BODY_PATH = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/u;

/** The roadmap issue `issue create` answers, well outside the fixture's own numbers. */
const ROADMAP_NUMBER = 900;

/**
 * A `gh` behind `rows`, mutated the way GitHub would by every
 * `issue edit` and body-writing `gh api` call the writer sends: a second
 * `issue list` reads the board the first dispatch left. `label list`,
 * `label create`, `issue create` and `issue pin` are answered plainly so
 * the board step that runs ahead of the move finishes without a
 * refusal; none of them touches the fixture's own rows.
 */
function boardGh(rows: Map<number, Row>): { readonly run: GhRunner; readonly calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
  const run: GhRunner = (args) => {
    calls.push([...args]);
    const route = args.slice(0, 2).join(' ');
    if (route === 'repo view') return ok(JSON.stringify({ nameWithOwner: REPOSITORY }));
    if (route === 'issue list') return ok(JSON.stringify([...rows.values()].map((current) => rawRow(rows, current))));
    if (route === 'label list') return ok('[]');
    if (route === 'label create') return ok('');
    if (route === 'issue create') return ok(`https://github.com/${REPOSITORY}/issues/${String(ROADMAP_NUMBER)}\n`);
    if (route === 'issue pin') return ok('');
    if (args[0] === 'api') {
      const match = BODY_PATH.exec(args[1] ?? '');
      if (match !== null) {
        const number = Number(match[1]);
        const current = rows.get(number);
        if (args[2] === '-X') {
          const at = args.indexOf('-f');
          const arg = at === -1
            ? undefined
            : args[at + 1];
          const body = arg?.startsWith('body=') === true
            ? arg.slice('body='.length)
            : '';
          if (current !== undefined) current.body = body;
          return ok(JSON.stringify({ body }));
        }
        return ok(JSON.stringify({ body: current?.body ?? '' }));
      }
    }
    if (args[0] === 'issue' && args[1] === 'edit') {
      applyEditFlags(rows, Number(args[2]), args.slice(3));
      return ok('');
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `relations-move-round-trip: unplanned gh call: ${args.join(' ')}` });
  };
  return { run, calls: () => calls };
}

/** The `issue edit` calls among `calls` that touch the fixture's own issues, each joined by spaces. */
function fixtureEdits(calls: readonly (readonly string[])[]): readonly string[] {
  const fixtureIssues = new Set([1, 10, 11, 30, 31]);
  return calls
    .filter((call) => call[0] === 'issue' && call[1] === 'edit' && fixtureIssues.has(Number(call[2])))
    .map((call) => call.join(' '));
}

/** A prompter answering from `answers` in order, recording what it said and asked. */
function scriptedPrompter(answers: readonly string[]): { readonly prompter: Prompter; readonly said: string[]; readonly asked: string[] } {
  const said: string[] = [];
  const asked: string[] = [];
  const prompter: Prompter = {
    say: (text) => {
      said.push(text);
    },
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(answers[asked.length - 1] ?? null);
    },
    close: () => undefined,
  };
  return { prompter, said, asked };
}

/** A prompter no case here expects to be opened. */
function noPrompter(): Prompter {
  throw new Error('relations-move-round-trip: a prompter was opened where none was expected');
}

/** A fresh project root and home under this file's own temporary directory. */
function freshProject(label: string): { readonly root: string; readonly home: string } {
  return plantProject(mkdtempSync(join(tempBase, `${label}-`)));
}

/**
 * Dispatches `rafa init --no-release --board --no-epic-guard
 * --no-project` in text mode over `project`, `gh` and the prompter
 * named. Every case here answers the release, board, epic guard and
 * project steps on the line, so none of the four asks anything: only
 * the relationships move can open the prompter it is handed.
 */
async function initBoard(
  project: { readonly root: string; readonly home: string },
  relationships: 'native' | 'labels',
  gh: GhRunner,
  prompter: () => Prompter,
): Promise<void> {
  const seams = {
    ...DEFAULT_INIT_SEAMS,
    cwd: () => project.root,
    home: () => project.home,
    entry: () => join(project.home, 'dist', 'cli.js'),
    isTerminal: () => true,
    openPrompter: prompter,
    gitToplevel: (dir: string) => (dir === project.root
      ? project.root
      : null),
    readRemote: () => `https://github.com/${REPOSITORY}.git`,
    gh: () => gh,
  };
  const words = [
    'init', `--root=${project.root}`, '--no-release', '--board', '--no-epic-guard', '--no-project',
  ];
  const result = await dispatchInProject(words, [], [createInitCommand(seams)], project, { PATH: '/rafa-test-no-such-path' });
  if (result.exitCode !== 0) {
    throw new Error(`rafa init --board (${relationships}) exited ${String(result.exitCode)}: ${result.stderr}`);
  }
}

/** A probe run that passed, for `checks.runProbe`: nothing here spawns a real `gh`, `git` or shell probe. */
const PASSED = { exitCode: 0, stderr: '', timedOut: false };

/**
 * The seams a real `rafa doctor` dispatch runs `../commands/doctor.ts`
 * with: every probe passes without a real shell, `git` and `gh` for the
 * plan's risk total answer nothing (no plan is named on the line, so
 * neither is read), no real `claude` is spawned for the skill tiers, and
 * every board reading goes through `gh`.
 */
function doctorSeams(home: string, gh: GhRunner): DoctorSeams {
  return {
    checks: { now: () => 0, runProbe: () => Promise.resolve(PASSED) },
    riskRunners: () => ({
      git: () => ({ ok: false, stdout: '', stderr: 'error: No such remote \'origin\'\n' }),
      gh: () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: not planted' }),
    }),
    readClaudeVersion: () => Promise.resolve(null),
    inventory: { entry: () => join(home, 'runtime', 'cli.js') },
    openGh: () => gh,
  };
}

/** The two `epic:alpha` members' labels marks, and #30's `spec:blocked` mark: what the first move's second question offers. */
const LABELS_MARKS_QUESTION = 'Remove the 3 old labels marks from the board? [y/N] ';

/** The three native marks the second move's second question offers. */
const NATIVE_MARKS_QUESTION = 'Remove the 3 old native marks from the board? [y/N] ';

describe('rafa init --board moving a fixture board from labels to native, and back', () => {
  it('prints every write and sends nothing when the first question is answered no', async () => {
    const project = freshProject('no');
    await Bun.write(join(project.root, '.rafa', 'config.yaml'), 'board:\n  relationships: native\npr:\n  provider: gh\n');
    const rows = freshBoard();
    const gh = boardGh(rows);
    const { prompter, said, asked } = scriptedPrompter(['n']);

    await initBoard(project, 'native', gh.run, () => prompter);

    expect(said).toEqual([
      'Moving the board\'s relationships from labels to native:',
      '  write    make #11, #10 sub-issues of epic #1',
      '  write    link #30 as blocked by #31',
    ]);
    expect(asked).toEqual(['Send the 2 writes above, moving the board from labels to native? [y/N] ']);
    expect(fixtureEdits(gh.calls())).toEqual([]);
    expect(rows.get(1)?.subIssues).toEqual([]);
    expect(rows.get(30)?.blockedBy).toEqual([]);
  });

  it('sends the writes on yes, plans nothing on an immediate second run, moves back with the old marks kept, and rafa doctor names them', async () => {
    const project = freshProject('round-trip');
    await Bun.write(join(project.root, '.rafa', 'config.yaml'), 'board:\n  relationships: native\npr:\n  provider: gh\n');
    const rows = freshBoard();
    const gh = boardGh(rows);

    // Labels to native: sent on yes, the old labels marks removed on the
    // second question's own yes, so a rerun over the SAME mode plans
    // nothing at all.
    const first = scriptedPrompter(['y', 'y']);
    await initBoard(project, 'native', gh.run, () => first.prompter);

    expect(fixtureEdits(gh.calls())).toEqual([
      'issue edit 1 --add-sub-issue 11,10',
      'issue edit 30 --add-blocked-by 31',
      'issue edit 11 --remove-label epic:alpha',
      'issue edit 10 --remove-label epic:alpha',
      'issue edit 30 --remove-label spec:blocked --body=',
    ]);
    expect(first.asked).toEqual([
      'Send the 2 writes above, moving the board from labels to native? [y/N] ',
      LABELS_MARKS_QUESTION,
    ]);
    expect(rows.get(1)?.subIssues).toEqual([11, 10]);
    expect(rows.get(10)?.parent).toBe(1);
    expect(rows.get(11)?.parent).toBe(1);
    expect(rows.get(30)?.blockedBy).toEqual([31]);
    expect(rows.get(10)?.labels).toEqual([]);
    expect(rows.get(11)?.labels).toEqual([]);
    expect(rows.get(30)?.labels).toEqual([]);

    // A second run over the still-native board: every relationship is
    // already there and every old mark is already gone, so nothing is
    // planned and the prompter is never even opened.
    const before = gh.calls().length;
    await initBoard(project, 'native', gh.run, noPrompter);
    expect(fixtureEdits(gh.calls().slice(before))).toEqual([]);

    // Native to labels, "and back": board.relationships flips, sent on
    // yes, and this time the second question's no keeps the native
    // marks.
    await Bun.write(join(project.root, '.rafa', 'config.yaml'), 'board:\n  relationships: labels\npr:\n  provider: gh\n');
    const second = scriptedPrompter(['y', 'n']);
    await initBoard(project, 'labels', gh.run, () => second.prompter);

    const backEdits = fixtureEdits(gh.calls());
    expect(backEdits).toContain('issue edit 11 --add-label epic:alpha');
    expect(backEdits).toContain('issue edit 10 --add-label epic:alpha');
    expect(backEdits.some((call) => call.startsWith('issue edit 30 --add-label spec:blocked --body='))).toBe(true);
    expect(second.asked[1]).toBe(NATIVE_MARKS_QUESTION);
    expect(rows.get(10)?.labels).toEqual(['epic:alpha']);
    expect(rows.get(11)?.labels).toEqual(['epic:alpha']);
    expect(rows.get(30)?.labels).toEqual(['spec:blocked']);
    // The native marks are KEPT: the second question was answered no.
    expect(rows.get(10)?.parent).toBe(1);
    expect(rows.get(11)?.parent).toBe(1);
    expect(rows.get(30)?.blockedBy).toEqual([31]);

    // rafa doctor, over the very same board, names exactly those kept
    // native marks and points at rafa init --board.
    const readings = await readDoctorBoard(gh.run, project.root, null, 'labels', true);
    const marks = readings.marks;
    expect(marks?.other).toBe('native');
    expect(marks?.marks.map(markMessage)).toEqual([
      '#10 is a sub-issue of #1',
      '#11 is a sub-issue of #1',
      '#30 is linked as blocked by #31',
    ]);
    const lines = renderDoctorBoard(readings);
    expect(lines).toContain(MARKS_HEADING);
    expect(lines).toContain(`  board.relationships is labels, and the board holds ${plural(3, 'native mark')} it does not read:`);
    expect(lines).toContain(`  run ${MOVE_FIX} to move them into labels mode; its second question takes them off`);

    // The real, REGISTERED `rafa doctor` command, over the very same
    // board: its own json result carries the same marks.
    const doctored = await dispatchInProject(
      ['doctor', '--output=json'],
      [],
      [createDoctorCommand(doctorSeams(project.home, gh.run))],
      project,
    );
    expect(doctored.exitCode).toBe(0);
    const result = eventsOf(doctored.stdout).find((event) => event.type === 'result');
    const data = result?.type === 'result'
      ? result.data as { readonly marks?: { readonly other: string; readonly marks: readonly unknown[] } }
      : undefined;
    expect(data?.marks?.other).toBe('native');
    expect((data?.marks?.marks ?? []).map((mark) => markMessage(mark as Parameters<typeof markMessage>[0]))).toEqual([
      '#10 is a sub-issue of #1',
      '#11 is a sub-issue of #1',
      '#30 is linked as blocked by #31',
    ]);
  });
});
