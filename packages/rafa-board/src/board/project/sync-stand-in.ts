/**
 * A stand-in `gh` that keeps its state between processes, for the spawned
 * test of `rafa board sync` (`src/tests/board-sync-spawned.test.ts`). A
 * spawned `rafa` reaches `gh` through a program on its PATH, so each call
 * is its own process: this module rebuilds {@link createSyncFake} from a
 * JSON state file, routes the one call through it, and writes back what
 * the project holds, so a write one process makes is what the next one
 * reads.
 *
 * The state is three things: `items`, the issues the project holds an
 * item for; `values`, each item's field values as the fake plants them;
 * and `labels`, the labels an issue carries, edited by the test between
 * runs as an edit in the web UI would. The labels are read, never written
 * back, since `rafa board sync` writes none.
 *
 * Every call is appended to the log file as one JSON array of its
 * arguments, so a case can count the writes a run sent. A call the fake
 * refuses answers exit code 1 with the fake's own stderr.
 *
 * This module is a test helper that is not itself a test file, as
 * `./sync-fake.ts` is: bun runs nothing in it until a test calls it.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { createSyncFake } from './sync-fake.js';

/** A field value a state file holds: an option by name, a number, or a text. */
type HeldValue = string | number;

/** What the stand-in keeps between calls. */
export interface StandInState {
  /** The issues the project holds an item for. */
  readonly items: readonly number[];
  /** Each item's field values by issue number, by field name. */
  readonly values: Readonly<Record<number, Readonly<Record<string, HeldValue>>>>;
  /** The labels of the issues edited outside rafa, by issue number; the fixture's own labels for the rest. */
  readonly labels: Readonly<Record<number, readonly string[]>>;
}

/** What a stand-in call answers, as a `gh` process would print and exit. */
export interface StandInAnswer {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Reads the state file at `statePath`. */
export function readStandInState(statePath: string): StandInState {
  return JSON.parse(readFileSync(statePath, 'utf8')) as StandInState;
}

/** Writes `state` to `statePath`. */
export function writeStandInState(statePath: string, state: StandInState): void {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Answers one `gh` call with `args`: logs it to `logPath`, routes it
 * through the sync fake over the state at `statePath`, and saves the
 * project's items and values back there. See the module note.
 */
export async function answerStandIn(statePath: string, logPath: string, args: readonly string[]): Promise<StandInAnswer> {
  const state = readStandInState(statePath);
  const fake = createSyncFake({ values: state.values, itemIssues: state.items });
  for (const [issue, labels] of Object.entries(state.labels)) {
    fake.setLabels(Number(issue), labels);
  }
  appendFileSync(logPath, `${JSON.stringify(args)}\n`, 'utf8');
  const answer = await fake.gh(args);
  const held = await fake.heldValues();
  writeStandInState(statePath, {
    items: Object.keys(held).map(Number),
    values: held,
    labels: state.labels,
  });
  return answer.ok
    ? { exitCode: 0, stdout: answer.stdout, stderr: answer.stderr }
    : { exitCode: 1, stdout: answer.stdout, stderr: answer.stderr };
}
