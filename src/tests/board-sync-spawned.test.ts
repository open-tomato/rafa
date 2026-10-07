/**
 * Spawned proof for `rafa board sync` (`src/commands/board/sync.ts`): the
 * spec's definition of done, "a label edited outside rafa makes
 * `--dry-run` print that one change, a sync make it, and a second
 * `--dry-run` print none" (`.rafa/specs/rafa-791-github-project-each-repository.md`,
 * "`rafa board sync`"), run through `bun src/rafa.ts` with a stand-in
 * `gh` on the PATH.
 *
 * ## The stand-in `gh`
 *
 * A spawned child reaches `gh` only through its own process, so the
 * in-process router of `src/board/project/sync-fake.ts` cannot serve it
 * alone. `gh` on the scratch PATH is a shell script that execs bun on
 * `<scratch>/gh-stand-in.ts`, which calls {@link answerStandIn}
 * (`src/board/project/sync-stand-in.ts`): the router rebuilt from
 * `<scratch>/board-state.json` for each call, its project items and
 * values written back there after it. Every call is logged as a JSON
 * array to `<scratch>/gh-calls.log`, so the case counts writes and adds
 * from what the child sent, not from what the fake says it did.
 *
 * The state holds the open issues' project items, with no values to
 * start. The first `rafa board sync` fills them, the convergence the
 * in-process case of `src/commands/board/sync.test.ts` also starts from,
 * so the drift that follows is the only change a dry run can show. The
 * label edit is a rewrite of the state file's `labels`, as a web UI edit
 * would leave the issue.
 *
 * No case reaches GitHub.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { StandInState } from '../board/project/sync-stand-in.js';

import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { SYNC_ITEM_ISSUES, syncAddCalls, syncWriteCalls } from '../board/project/sync-fake.js';
import { readStandInState, writeStandInState } from '../board/project/sync-stand-in.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** The stand-in's module, which answers each `gh` call. */
const STAND_IN_MODULE = fileURLToPath(new URL('../board/project/sync-stand-in.ts', import.meta.url));

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-sync-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run: each `gh` call is a process of its own. */
const SPAWN_TIMEOUT = 120_000;

/** The config of a project mirrored to project 6. */
const PROJECT_CONFIG = 'tracker:\n  default: local\nboard:\n  project:\n    number: 6\n';

/** The issue whose label the case edits outside rafa. */
const EDITED_ISSUE = 21;

/** Its labels after the edit: `rafa:claimed` makes its Stage Claimed, not Ready. */
const EDITED_LABELS = ['type:spec', 'epic:alpha', 'rafa:claimed'];

/** The files a case's stand-in keeps under its scratch root. */
interface StandInFiles {
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
function plantStandIn(scratch: ScratchRepo): StandInFiles {
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
function editLabelsOutsideRafa(files: StandInFiles, number: number, labels: readonly string[]): void {
  const state = readStandInState(files.statePath);
  writeStandInState(files.statePath, { ...state, labels: { ...state.labels, [number]: labels } });
}

/** Every call the stand-in logged so far, as argument arrays, in order. */
function callsLogged(files: StandInFiles): readonly (readonly string[])[] {
  return readFileSync(files.logPath, 'utf8').split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);
}

describe('rafa board sync, spawned over a stand-in gh', () => {
  it('prints the one change a label edited outside rafa makes, makes it, and then prints none', () => {
    const scratch = plantScratchRepo(tempBase);
    plantProjectConfig(scratch.repo, PROJECT_CONFIG);
    const files = plantStandIn(scratch);

    const converged = runRafa(scratch, scratch.repo, ['board', 'sync']);
    expect(converged.exitCode).toBe(0);
    expect(converged.stderr).toBe('');
    expect(converged.stdout).toEndWith('Synced project #6: 14 changes written and 2 issues added.\n');

    editLabelsOutsideRafa(files, EDITED_ISSUE, EDITED_LABELS);
    const beforeDrift = callsLogged(files).length;

    const dry = runRafa(scratch, scratch.repo, ['board', 'sync', '--dry-run']);
    const dryCalls = callsLogged(files).slice(beforeDrift);
    const synced = runRafa(scratch, scratch.repo, ['board', 'sync']);
    const syncCalls = callsLogged(files).slice(beforeDrift + dryCalls.length);
    const again = runRafa(scratch, scratch.repo, ['board', 'sync', '--dry-run']);
    const againCalls = callsLogged(files).slice(beforeDrift + dryCalls.length + syncCalls.length);

    expect(dry.exitCode).toBe(0);
    expect(dry.stderr).toBe('');
    expect(dry.stdout).toBe('#21 Stage: Ready → Claimed\nDry run on project #6: 1 change and 0 issues to add; nothing written.\n');
    expect(synced.exitCode).toBe(0);
    expect(synced.stderr).toBe('');
    expect(synced.stdout).toBe('#21 Stage: Ready → Claimed\nSynced project #6: 1 change written and 0 issues added.\n');
    expect(again.exitCode).toBe(0);
    expect(again.stderr).toBe('');
    expect(again.stdout).toBe('Dry run on project #6: in step, nothing to change.\n');

    expect(syncWriteCalls(dryCalls)).toEqual([]);
    expect(syncWriteCalls(syncCalls)).toHaveLength(1);
    expect(syncWriteCalls(againCalls)).toEqual([]);
    expect(syncAddCalls(callsLogged(files).slice(beforeDrift))).toEqual([]);
  }, SPAWN_TIMEOUT);
});
