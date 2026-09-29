/**
 * Tests for the `hop` and `home` actions (`./hop-action.ts`) and for the
 * way `./actions.ts` runs them in-process off the step their row carries.
 *
 * Every case plants a project root of its own under one temporary
 * directory and reads the two files the actions write — `.rafa/hop.json`
 * and `.rafa/position.json` — back off the disk through their own
 * readers. `hop`'s move is a fake `switchTo`, or, through `runAction`, a
 * recording `switch` command in a registry built for the case; no case
 * spawns a process, reaches git or reaches GitHub.
 *
 * ## The controls
 *
 * - The record is read INSIDE the fake switch, so the case that finds it
 *   written there proves the order; the refused-switch cases are the
 *   other side, a record put back once the move did not happen.
 * - The at-home case leaves a position byte for byte as it was, and the
 *   away case beside it writes one, so a `home` that never wrote would
 *   fail the second rather than pass the first.
 * - A record already closed, a stale one and one with no position to
 *   weigh it against are each left as they were, beside the away record
 *   that is closed.
 *
 * ## What passes while wrong
 *
 * Five mutations were driven on 2026-09-28, one at a time, over
 * `env -u CLAUDECODE bun test src/next/hop-action.test.ts
 * src/next/lines.test.ts`, each module restored from a scratch copy and
 * verified with `shasum -c`, against 29 pass and 0 fail:
 *
 *  - the record written after the switch rather than before: 27 pass
 *    and 2 fail, the order case and the refused-switch case.
 *  - the record not put back after a refused switch: 26 pass and 3
 *    fail, the two refused-switch cases and the unregistered `switch`.
 *  - `goHome` written over a position already at home: 28 pass and 1
 *    fail, the at-home case.
 *  - a record closed whatever its state: 28 pass and 1 fail, the case
 *    keeping an earlier hop's `waiting`.
 *  - `hop` and `home` printed in the stop lines' lists
 *    (`./lines.ts`): 27 pass and 2 fail, both in `lines.test.ts`.
 */
import type { HopActionWorld } from './hop-action.js';
import type { HopRecord } from './hop-record.js';
import type { HopHome, HopOpening, HopOut } from './hop-rows.js';
import type { NextState } from './state.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { Place, Position } from '../project/position.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createCommandRegistry } from '../cli/registry.js';
import { hop, positionFilePath, readPositionFile, writePositionFile } from '../project/position.js';
import { resolveScope } from '../project/scope.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { runAction } from './actions.js';
import { homeLogLine, hopLogLine, NO_REHOME, runHome, runHop } from './hop-action.js';
import { hopFilePath, readHopRecord, writeHopRecord } from './hop-record.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hop-action-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let caseCount = 0;

/** A fresh project root for one case, holding the config file a scope resolves on. */
function freshRoot(): string {
  caseCount += 1;
  const root = join(tempBase, `case-${String(caseCount)}`);
  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), '');
  return root;
}

/** The home the cases start from: epic #20 on board #10. */
const HOME: Place = { board: 10, epic: 20 };

/** C's epic on the other board: epic #30 on board #11. */
const AWAY: Place = { board: 11, epic: 30 };

/** A place a person switched to by hand. */
const ELSEWHERE: Place = { board: 12, epic: 40 };

/** The time `startedAt` is stamped with. */
const NOW = new Date('2026-09-28T10:00:00.000Z');

/** The opening `hop-blocked` carries: #21 in epic #20, blocked by #31 in epic #30. */
const BLOCKER_OPENING: HopOpening = {
  kind: 'blocker',
  home: HOME,
  from: HOME,
  blocked: 21,
  target: 31,
  targetEpic: 30,
  targetBoard: 11,
};

/** The opening `hop-dry` carries: epic #20 ran dry, next `now` epic #30 on board #11. */
const DRY_OPENING: HopOpening = {
  ...BLOCKER_OPENING,
  kind: 'dry',
  blocked: null,
  target: null,
};

/** The record a blocker hop leaves while it is away. */
const AWAY_RECORD: HopRecord = {
  ...BLOCKER_OPENING,
  state: 'away',
  pullRequest: null,
  startedAt: NOW.toISOString(),
};

/** The position a hop leaves: away at C's epic, home kept. */
const AWAY_POSITION: Position = { current: AWAY, previous: HOME, home: HOME };

/** A `home` step closing as `closing`. */
function homeStep(closing: HopHome['closing'], pullRequest: number | null = null): HopHome {
  return { action: 'home', home: HOME, closing, pullRequest };
}

/** What a case's world wrote, beside the world. */
interface Harness {
  readonly world: HopActionWorld;
  readonly info: readonly string[];
  readonly warnings: readonly string[];
  /** The words each switch ran with, and the record the file held as it ran. */
  readonly switched: readonly { readonly argv: readonly string[]; readonly record: HopRecord | null }[];
}

/** A world over `root` whose switch moves the position as `--no-rehome` does, or runs `refuse` instead. */
function harness(root: string, refuse?: () => never): Harness {
  const info: string[] = [];
  const warnings: string[] = [];
  const switched: { argv: readonly string[]; record: HopRecord | null }[] = [];
  const world: HopActionWorld = {
    root,
    switchTo: (argv) => {
      switched.push({ argv, record: recordAt(root) });
      if (refuse !== undefined) refuse();
      writePositionFile(root, hop(positionAt(root) ?? { current: HOME, previous: null, home: HOME }, AWAY));
      return Promise.resolve();
    },
    info: (line) => info.push(line),
    warn: (line) => warnings.push(line),
    now: () => NOW,
  };
  return { world, info, warnings, switched };
}

/** The record under `root`, or null where none reads. */
function recordAt(root: string): HopRecord | null {
  const reading = readHopRecord(root);
  return reading.set
    ? reading.record
    : null;
}

/** The position under `root`, or null where none reads. */
function positionAt(root: string): Position | null {
  const reading = readPositionFile(root);
  return reading.set
    ? reading.position
    : null;
}

/** Plants `text` at `file`, its directory made. */
function plant(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe('the log lines', () => {
  it('words a blocker hop as the spec does, from an epic and from a board with none chosen', () => {
    expect(hopLogLine(BLOCKER_OPENING)).toBe('hop from epic #20: #21 blocked by #31, in epic #30');
    expect(hopLogLine({ ...BLOCKER_OPENING, from: { board: 10, epic: null } }))
      .toBe('hop from board #10: #21 blocked by #31, in epic #30');
  });

  it('words a dry hop in its own form, naming the epic and board it goes to', () => {
    expect(hopLogLine(DRY_OPENING)).toBe('hop from epic #20: it ran dry, next `now` epic #30 on board #11');
  });

  it('words the way back as the place home is', () => {
    expect(homeLogLine(HOME)).toBe('back home: epic #20 on board #10');
    expect(homeLogLine({ board: 10, epic: null })).toBe('back home: board #10');
  });
});

describe('hop', () => {
  it('writes the record away before it moves, moves with switch <epic> --no-rehome, then logs the hop', async () => {
    const root = freshRoot();
    const { world, info, switched } = harness(root);

    const written = await runHop(world, { action: 'hop', opening: BLOCKER_OPENING });

    expect(switched).toEqual([{ argv: ['30', NO_REHOME], record: AWAY_RECORD }]);
    expect(recordAt(root)).toEqual(AWAY_RECORD);
    expect(written).toEqual(AWAY_RECORD);
    expect(positionAt(root)).toEqual({ current: AWAY, previous: HOME, home: HOME });
    expect(info).toEqual(['hop from epic #20: #21 blocked by #31, in epic #30']);
  });

  it('writes a dry hop with no H and no C, and logs it in the dry form', async () => {
    const root = freshRoot();
    const { world, info } = harness(root);

    await runHop(world, { action: 'hop', opening: DRY_OPENING });

    expect(recordAt(root)).toEqual({ ...AWAY_RECORD, kind: 'dry', blocked: null, target: null });
    expect(info).toEqual(['hop from epic #20: it ran dry, next `now` epic #30 on board #11']);
  });

  it('removes the record it wrote when the switch refuses, throws the refusal on, and logs nothing', async () => {
    const root = freshRoot();
    const refusal = new CommandExit(2, '❌ Cannot switch to #30');
    const { world, info, switched } = harness(root, () => {
      throw refusal;
    });

    const thrown = await runHop(world, { action: 'hop', opening: BLOCKER_OPENING }).catch((error: unknown) => error);

    expect(thrown).toBe(refusal);
    expect(switched.map((call) => call.record)).toEqual([AWAY_RECORD]);
    expect(existsSync(hopFilePath(root))).toBe(false);
    expect(info).toEqual([]);
  });

  it('puts back the earlier record when the switch refuses, rather than leaving none', async () => {
    const root = freshRoot();
    const earlier: HopRecord = { ...AWAY_RECORD, state: 'waiting', pullRequest: 77 };
    writeHopRecord(root, earlier);
    const { world } = harness(root, () => {
      throw new CommandExit(2, '❌ Cannot switch to #30');
    });

    await runHop(world, { action: 'hop', opening: BLOCKER_OPENING }).catch(() => undefined);

    expect(recordAt(root)).toEqual(earlier);
  });
});

describe('home', () => {
  it('writes goHome over an away position and closes the record waiting, with the pull request', () => {
    const root = freshRoot();
    writePositionFile(root, AWAY_POSITION);
    writeHopRecord(root, AWAY_RECORD);
    const { world, info } = harness(root);

    const outcome = runHome(world, homeStep('waiting', 77));

    const closed = { ...AWAY_RECORD, state: 'waiting', pullRequest: 77 };
    expect(positionAt(root)).toEqual({ current: HOME, previous: AWAY, home: HOME });
    expect(recordAt(root)).toEqual(closed);
    expect(info).toEqual(['back home: epic #20 on board #10']);
    expect(outcome).toEqual({ position: { current: HOME, previous: AWAY, home: HOME }, record: closed, line: info[0] });
  });

  it.each(['merged', 'halted'] as const)('closes the record %s, keeping the pull request it held', (closing) => {
    const root = freshRoot();
    writePositionFile(root, AWAY_POSITION);
    writeHopRecord(root, { ...AWAY_RECORD, pullRequest: 88 });

    runHome(harness(root).world, homeStep(closing));

    expect(recordAt(root)).toEqual({ ...AWAY_RECORD, state: closing, pullRequest: 88 });
  });

  it('leaves a position already at home byte for byte as it was, the place switch - goes back to kept', () => {
    const root = freshRoot();
    writePositionFile(root, { current: HOME, previous: ELSEWHERE, home: HOME });
    const before = readFileSync(positionFilePath(root), 'utf8');
    const { world, info } = harness(root);

    const outcome = runHome(world, homeStep('halted'));

    expect(readFileSync(positionFilePath(root), 'utf8')).toBe(before);
    expect(existsSync(hopFilePath(root))).toBe(false);
    expect(outcome.position).toBeNull();
    expect(outcome.record).toBeNull();
    expect(info).toEqual(['back home: epic #20 on board #10']);
  });

  it('leaves a record an earlier hop closed as it was, so a halt at home keeps its waiting', () => {
    const root = freshRoot();
    const waiting: HopRecord = { ...AWAY_RECORD, state: 'waiting', pullRequest: 77 };
    writePositionFile(root, { current: HOME, previous: AWAY, home: HOME });
    writeHopRecord(root, waiting);

    runHome(harness(root).world, homeStep('halted'));

    expect(recordAt(root)).toEqual(waiting);
  });

  it('leaves a stale record as it was, homed elsewhere by a person switching by hand', () => {
    const root = freshRoot();
    writePositionFile(root, { current: AWAY, previous: ELSEWHERE, home: ELSEWHERE });
    writeHopRecord(root, AWAY_RECORD);
    const { world, info } = harness(root);

    runHome(world, homeStep('halted'));

    expect(recordAt(root)).toEqual(AWAY_RECORD);
    expect(positionAt(root)).toEqual({ current: ELSEWHERE, previous: AWAY, home: ELSEWHERE });
    expect(info).toEqual(['back home: epic #40 on board #12']);
  });

  it('writes no position where there is no file, leaves the record with nothing to weigh it against, and logs the row home', () => {
    const root = freshRoot();
    writeHopRecord(root, AWAY_RECORD);
    const { world, info } = harness(root);

    runHome(world, homeStep('halted'));

    expect(existsSync(positionFilePath(root))).toBe(false);
    expect(recordAt(root)).toEqual(AWAY_RECORD);
    expect(info).toEqual(['back home: epic #20 on board #10']);
  });

  it('warns about a position file that does not read and writes it afresh at home', () => {
    const root = freshRoot();
    plant(positionFilePath(root), '{ not json');
    const { world, warnings } = harness(root);

    runHome(world, homeStep('halted'));

    expect(positionAt(root)).toEqual({ current: HOME, previous: null, home: HOME });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(positionFilePath(root));
    expect(warnings[0]).toEndWith(', so it is written afresh at home');
  });

  it('warns about a hop record that does not read and closes nothing', () => {
    const root = freshRoot();
    writePositionFile(root, AWAY_POSITION);
    plant(hopFilePath(root), '[]');
    const { world, warnings } = harness(root);

    const outcome = runHome(world, homeStep('halted'));

    expect(outcome.record).toBeNull();
    expect(readFileSync(hopFilePath(root), 'utf8')).toBe('[]');
    expect(warnings).toEqual([`${hopFilePath(root)} does not hold a hop record, so no hop record is closed`]);
  });
});

/** One call the recording `switch` took. */
interface SwitchCall {
  readonly argv: readonly string[];
  readonly flags: RafaContext['flags'];
}

/** A `rafa switch` recording what it ran with and moving the position as `--no-rehome` does. */
function recordingSwitch(root: string, calls: SwitchCall[]): RafaCommand {
  return {
    name: 'switch',
    description: 'Records one switch.',
    subject: 'switch',
    action: 'switch',
    summary: 'switch',
    args: [{ name: 'target', description: 'A number.', type: 'string', required: true }],
    flags: [{ name: 'rehome', description: 'Re-home.', type: 'boolean', default: true }],
    examples: [{ cmd: 'rafa switch 30', note: 'moves' }],
    outputs: ['text', 'json'],
    run: (context: RafaContext) => {
      calls.push({ argv: context.argv, flags: context.flags });
      writePositionFile(root, hop({ current: HOME, previous: null, home: HOME }, AWAY));
      return Promise.resolve();
    },
  };
}

/** A caller of `runAction` over `root`, its registry holding the recording switch unless `withSwitch` is false. */
function callerAt(root: string, calls: SwitchCall[], lines: string[], withSwitch = true): RafaContext {
  const home = join(tempBase, 'home');
  mkdirSync(home, { recursive: true });
  const scope = resolveScope(root, { home });
  if (!scope.found) throw new Error(`the scratch project did not resolve: ${scope.hint}`);
  const commands = withSwitch
    ? [recordingSwitch(root, calls)]
    : [];
  return Object.freeze({
    args: [],
    flags: { yes: 'hop' },
    outputMode: 'text',
    verbosity: 1,
    output: sinkOutput({ info: (line: string) => lines.push(line) }),
    signal: new AbortController().signal,
    env: {},
    argv: ['--yes=hop'],
    registry: createCommandRegistry({ subjects: [], commands }),
    project: scope,
  });
}

/** A state as a hop row answers one. */
function hopState(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'hop-blocked',
    action: 'hop',
    reading: 'a reading',
    proposal: 'a proposal',
    pullRequest: null,
    issue: 31,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/** The `hop` step `hop-blocked` carries. */
const HOP_STEP: HopOut = { action: 'hop', opening: BLOCKER_OPENING };

describe('hop and home, run in-process through runAction', () => {
  it('runs hop over the registered switch with --no-rehome read as its flag, under the caller project', async () => {
    const root = freshRoot();
    const calls: SwitchCall[] = [];
    const lines: string[] = [];

    await runAction(callerAt(root, calls, lines), hopState({ hop: HOP_STEP }));

    expect(calls.map((call) => call.argv)).toEqual([['30', NO_REHOME]]);
    expect(calls[0]?.flags.rehome).toBe(false);
    expect(recordAt(root)?.state).toBe('away');
    expect(lines).toEqual(['hop from epic #20: #21 blocked by #31, in epic #30']);
  });

  it('runs home, writing goHome and closing the record through the caller project and output', async () => {
    const root = freshRoot();
    writePositionFile(root, AWAY_POSITION);
    writeHopRecord(root, AWAY_RECORD);
    const lines: string[] = [];

    await runAction(callerAt(root, [], lines), hopState({ id: 'away-ended', action: 'home', hop: homeStep('waiting', 77) }));

    expect(positionAt(root)?.current).toEqual(HOME);
    expect(recordAt(root)).toEqual({ ...AWAY_RECORD, state: 'waiting', pullRequest: 77 });
    expect(lines).toEqual(['back home: epic #20 on board #10']);
  });

  it('refuses with exit code 1 when nothing registers switch, the record put back', async () => {
    const root = freshRoot();

    const thrown = await runAction(callerAt(root, [], [], false), hopState({ hop: HOP_STEP })).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(1);
    expect((thrown as CommandExit).message).toBe('❌ rafa next: the "hop" step runs "rafa switch", which is registered by nothing');
    expect(existsSync(hopFilePath(root))).toBe(false);
  });

  it('throws over a hop or home state carrying no step of its own action, naming the state', async () => {
    const root = freshRoot();
    const caller = callerAt(root, [], []);

    const none = await runAction(caller, hopState({})).catch((error: unknown) => error);
    const crossed = await runAction(caller, hopState({ id: 'hop-halt', action: 'home', hop: HOP_STEP })).catch((error: unknown) => error);

    expect((none as Error).message).toBe('rafa next: state "hop-blocked" proposes "hop" and carries no hop step');
    expect((crossed as Error).message).toBe('rafa next: state "hop-halt" proposes "home" and carries no home step');
    expect(existsSync(hopFilePath(root))).toBe(false);
  });
});
