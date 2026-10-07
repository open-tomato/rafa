/**
 * Spawned proof for the project step of `rafa init --board --project`
 * (`src/commands/init-board-project.ts`): a second run over a project the
 * first run left reports every project part `present` and sends no write,
 * through `bun src/rafa.ts` with the stand-in `gh` of
 * `./project-stand-in-spawn.ts` on the PATH.
 *
 * ## The first run
 *
 * The first run's copy, link, adds and field writes are not reproduced
 * here: the stand-in answers no copy or label creation. The project it
 * leaves is the one a first init leaves, the open issues on it and every
 * value the rules give them, and the convergence that gets there is
 * `rafa board sync`, which runs the same refresh and the same adds the
 * init's items and fields parts run. So the case starts with one
 * `rafa board sync` over the stand-in, then runs `rafa init --board
 * --project` over the state that sync left.
 *
 * ## The config
 *
 * `pr.provider` is `gh`, so the board step runs; `roadmap.issue` names the
 * Roadmap issue, so the board step reads it and searches for none; and
 * `board.project.number` names project 6, so the copy part finds it.
 *
 * ## The flags
 *
 * `--yes` names the root: a spawned run has no terminal to choose one on,
 * and `init` refuses to guess without it. The root is the repository's own
 * git toplevel, the one candidate.
 *
 * ## What "no write" covers
 *
 * The run's `gh` calls must all be reads. The board step still writes
 * local files this scratch repository never had (the spec template and the
 * scaffold); those are not GitHub writes and are not asserted either way.
 *
 * No case reaches GitHub.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { StandInFiles } from './project-stand-in-spawn.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { syncAddCalls, syncWriteCalls } from '../board/project/sync-fake.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { callsLogged, plantStandInGh } from './project-stand-in-spawn.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-board-project-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run: each `gh` call is a process of its own. */
const SPAWN_TIMEOUT = 120_000;

/** The config a repository `rafa init --board --project` has set up names; see the module note. */
const INIT_CONFIG = 'tracker:\n  default: local\npr:\n  provider: gh\nroadmap:\n  issue: 1\nboard:\n  project:\n    number: 6\n';

/** The five project parts, each as a row of `rafa init`'s output, in the order the step reports them. */
const PRESENT_ROWS: readonly string[] = [
  '  present  project scope',
  '  present  project',
  '  present  project issues',
  '  present  project fields',
  '  present  board.project.number',
];

/** The `gh` subcommands that write to the repository's issues and labels. */
const BOARD_WRITES: readonly string[] = ['label create', 'label edit', 'issue create', 'issue edit', 'issue pin'];

/** The GraphQL mutations that write to the project, as their names appear in a call's query. */
const PROJECT_WRITES: readonly string[] = [
  'copyProjectV2(',
  'linkProjectV2ToRepository(',
  'addProjectV2ItemById(',
  'updateProjectV2ItemFieldValue(',
  'clearProjectV2ItemFieldValue(',
];

/** True when one `gh` call writes: a board subcommand, or a project mutation. */
function isWrite(args: readonly string[]): boolean {
  return BOARD_WRITES.includes(args.slice(0, 2).join(' '))
    || args.some((arg) => PROJECT_WRITES.some((mutation) => arg.includes(mutation)));
}

/** A scratch repository planted with {@link INIT_CONFIG} and a stand-in `gh`, after the first run's `board sync`. */
function firstRunLeftProject(): { scratch: ScratchRepo; files: StandInFiles } {
  const scratch = plantScratchRepo(tempBase);
  plantProjectConfig(scratch.repo, INIT_CONFIG);
  const files = plantStandInGh(scratch);
  const filled = runRafa(scratch, scratch.repo, ['board', 'sync']);
  expectExit(filled, 0, scratch);
  return { scratch, files };
}

describe('rafa init --board --project, a second run, spawned over a stand-in gh', () => {
  it('reports every project part present and sends no write', () => {
    const { scratch, files } = firstRunLeftProject();
    const beforeInit = callsLogged(files).length;

    const init = runRafa(scratch, scratch.repo, ['init', '--board', '--project', '--yes']);
    const initCalls = callsLogged(files).slice(beforeInit);

    expectExit(init, 0, scratch);
    expect(init.stderr).toBe('');
    for (const row of PRESENT_ROWS) {
      expect(init.stdout.split('\n')).toContain(row);
    }
    expect(initCalls.filter(isWrite)).toEqual([]);
    expect(syncWriteCalls(initCalls)).toEqual([]);
    expect(syncAddCalls(initCalls)).toEqual([]);
  }, SPAWN_TIMEOUT);
});
