/**
 * `rafa effort collect` over a fixture HOME that holds the folders of a
 * project's main checkout and its worktrees.
 *
 * `collect.test.ts` drives `collectEffort` in process with a `home`
 * option. This file runs the real command as a subprocess whose `HOME`
 * is the fixture, so the derivation of the project folders from the
 * repository root, the config's `loop.worktreeDir` and the HOME it runs
 * under is held end to end.
 *
 * The HOME holds, under `.claude/projects/`: the main checkout's folder
 * (`s-main` and `shared`), the folders of two worktrees under the
 * default worktree directory (`s-a` and `shared` again, and `s-b`), and
 * the folder of another project whose root merely extends this one's
 * name (`<root>-other`, holding `s-other`). Held: three folders
 * collected, `shared` stored once, and `s-other` absent.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { sessionLogDir } from '../effort/session-log-dirs.js';
import { openNdjsonStore } from '../effort/store/index.js';

import { scratchHomeEnv } from './scratch-home-env.js';

/** The command every run executes. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** The worktree directory the config defaults to, spelled here and not imported. */
const WORKTREE_DIR = join('.rafa', 'worktrees');

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-collect-worktrees-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** One session log: a prompt-less turn on a branch is enough to be a row. */
function plantLog(dir: string, sessionId: string): void {
  mkdirSync(dir, { recursive: true });
  const turn = {
    type: 'assistant',
    timestamp: '2026-09-08T10:00:00.000Z',
    gitBranch: 'main',
    entrypoint: 'sdk-cli',
    isSidechain: false,
    message: {
      model: 'claude-opus-5',
      usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(turn)}\n`, 'utf8');
}

/** The scratch repository, its worktrees' paths and the HOME planted for it. */
interface Fixture {
  readonly root: string;
  readonly home: string;
}

function plantFixture(): Fixture {
  const scope = realpathSync(mkdtempSync(join(tempRoot, 'case-')));
  const root = join(scope, 'repo');
  const home = join(scope, 'home');
  mkdirSync(join(root, '.rafa'), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(root, '.rafa', 'config.yaml'), 'store: ndjson\n', 'utf8');
  const init = Bun.spawnSync(['git', 'init', '-q', '.'], { cwd: root });
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`);

  plantLog(sessionLogDir(root, home), 's-main');
  plantLog(sessionLogDir(root, home), 'shared');
  plantLog(sessionLogDir(join(root, WORKTREE_DIR, 'a'), home), 's-a');
  plantLog(sessionLogDir(join(root, WORKTREE_DIR, 'a'), home), 'shared');
  plantLog(sessionLogDir(join(root, WORKTREE_DIR, 'b'), home), 's-b');
  plantLog(sessionLogDir(`${root}-other`, home), 's-other');
  plantLog(sessionLogDir(`${root}-other`, home), 's-other-2');
  return { root, home };
}

describe('rafa effort collect over a HOME holding worktree folders', () => {
  it('collects three folders, stores the shared log once and leaves the other project out', () => {
    const { root, home } = plantFixture();

    const spawned = Bun.spawnSync(
      [process.execPath, RAFA_ENTRY, 'effort', 'collect', '--no-git'],
      { cwd: root, env: { TMPDIR: tmpdir(), PATH: process.env.PATH ?? '', ...scratchHomeEnv(home) }, timeout: 60_000 },
    );
    const output = `${spawned.stdout.toString()}${spawned.stderr.toString()}`;

    expect(spawned.exitCode, output).toBe(0);
    expect(output).toContain('sessions  3 folders, 2 worktrees, 1 log held twice');
    const rows = openNdjsonStore(root).read('sessions')
      .map((row): [string, string | null] => [row.sessionId, row.worktree])
      .sort(([a], [b]) => (a < b
        ? -1
        : 1));
    expect(rows).toEqual([
      ['s-a', join(root, WORKTREE_DIR, 'a')],
      ['s-b', join(root, WORKTREE_DIR, 'b')],
      ['s-main', null],
      ['shared', null],
    ]);
  });
});
