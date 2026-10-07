/**
 * The stand-in `gh` a spawned case of the GitHub project plants on its
 * scratch PATH (`./board-sync-spawned.test.ts`, `./init-board-project-spawned.test.ts`),
 * shared so each case reads the same state file and call log.
 *
 * {@link plantStandInGh} writes the program the scratch `bin/gh` execs:
 * {@link answerStandIn} (`src/board/project/sync-stand-in.ts`) answers
 * each call from the state file at `<scratch>/board-state.json` and logs
 * its arguments to `<scratch>/gh-calls.log`. {@link callsLogged} reads that
 * log back, so a case counts what the child sent, not what the fake says
 * it did.
 *
 * This module is a test helper that is not itself a test file: bun runs
 * nothing in it until a case calls it.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { StandInState } from '../board/project/sync-stand-in.js';

import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNC_ITEM_ISSUES } from '../board/project/sync-fake.js';
import { readStandInState, writeStandInState } from '../board/project/sync-stand-in.js';

/** The stand-in's module, which answers each `gh` call. */
const STAND_IN_MODULE = fileURLToPath(new URL('../board/project/sync-stand-in.ts', import.meta.url));

/** The files a case's stand-in keeps under its scratch root. */
export interface StandInFiles {
  readonly statePath: string;
  readonly logPath: string;
}

/** `value` as one single-quoted shell word. */
function shellWord(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`;
}

/**
 * Writes the stand-in `gh` onto the scratch PATH, its state file holding
 * the open issues' items with no values, and the program it execs. Answers
 * the files it wrote.
 */
export function plantStandInGh(scratch: ScratchRepo): StandInFiles {
  const data = dirname(scratch.repo);
  const statePath = join(data, 'board-state.json');
  const logPath = join(data, 'gh-calls.log');
  const entry = join(data, 'gh-stand-in.ts');
  const initial: StandInState = { items: SYNC_ITEM_ISSUES, values: {}, labels: {} };
  writeStandInState(statePath, initial);
  writeFileSync(entry, [
    `import { answerStandIn } from ${JSON.stringify(STAND_IN_MODULE)};`,
    `const answer = await answerStandIn(${JSON.stringify(statePath)}, ${JSON.stringify(logPath)}, process.argv.slice(2));`,
    'process.stdout.write(answer.stdout);',
    'process.stderr.write(answer.stderr);',
    'process.exitCode = answer.exitCode;',
    '',
  ].join('\n'), 'utf8');
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, `#!/bin/sh\nexec ${shellWord(process.execPath)} ${shellWord(entry)} "$@"\n`, 'utf8');
  chmodSync(gh, 0o755);
  return { statePath, logPath };
}

/** Rewrites issue `number`'s labels in the state file, as an edit in the web UI would. */
export function editLabelsOutsideRafa(files: StandInFiles, number: number, labels: readonly string[]): void {
  const state = readStandInState(files.statePath);
  writeStandInState(files.statePath, { ...state, labels: { ...state.labels, [number]: labels } });
}

/** Every call the stand-in logged so far, as argument arrays, in order. */
export function callsLogged(files: StandInFiles): readonly (readonly string[])[] {
  return readFileSync(files.logPath, 'utf8').split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);
}
