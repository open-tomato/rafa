/**
 * Spawned `bun src/rafa.ts` runs proving `rafa epics` kept its output
 * when it moved under the `epic` subject as `rafa epic show`
 * (`src/commands/epic/show.ts`), reached through the subject's plural
 * and its lasting subject-alone alias `epic`.
 *
 * ## The pre-move capture
 *
 * `fixtures/epics-pre-move.json` holds what the top-level `epics`
 * command printed for `rafa epics` and `rafa epics 60` over the fixture
 * below: exit code, stdout and stderr, each byte as written. It was
 * recorded by spawning this suite's own fixture at `b32ebb4`, before the
 * move, and is never written by a test: the command it records no longer
 * exists, so a capture taken now would only compare the new command with
 * itself.
 *
 * The fixture is one Roadmap, #1, listing two `horizon:now` epics:
 * `epic:alpha` (#50) is in progress, so a bare `rafa epics` shows it,
 * and `epic:beta` (#60) is done by its members while its issue is still
 * open, so `rafa epics 60` prints its disagreement line under the head.
 *
 * ## What is compared
 *
 * The move changed no byte, and the captures proved it until the table
 * itself changed: the labels column left the table for `--labels`, and
 * the spec and blocked by columns became symbols (`../commands/issue/roadmap-table.ts`).
 * So a capture is compared as the move promised it: the exit code and
 * stderr byte for byte, every line above the table byte for byte — the
 * epic's head and its disagreement line — and the table's rows by issue
 * number and title, in order ({@link sameView}). The table's own spelling
 * is the table's tests' to pin, not this suite's.
 *
 * ## The control
 *
 * `rafa epics 50` must NOT equal the capture of `rafa epics 60`: a
 * comparison that could not tell two epics apart would pass whatever the
 * move did.
 *
 * Every stand-in `gh` here fails loudly, naming the call, on anything it
 * was not planted to answer.
 */
import type { CapturedRun, ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** The file holding the pre-move captures; see the module note. */
const PRE_MOVE_FILE = join(import.meta.dir, 'fixtures', 'epics-pre-move.json');

/** The Roadmap issue's number, named by `roadmap.issue`. */
const ROADMAP = 1;
const EPIC_ALPHA = 50;
const EPIC_BETA = 60;

/** One capture as the fixture file holds it. */
type Capture = Pick<CapturedRun, 'exitCode' | 'stdout' | 'stderr'>;

/** The fixture file: the commit it was recorded at, and a capture per line typed. */
interface PreMove {
  readonly recordedAt: string;
  readonly captures: Readonly<Record<string, Capture>>;
}

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-show-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** One `gh issue list` row, labels already named. */
function boardIssue(
  number: number,
  title: string,
  body: string,
  state: 'OPEN' | 'CLOSED',
  labels: readonly string[],
): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : '';
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** The board listing: alpha in progress, beta done by its members with its issue open. */
const BOARD = [
  boardIssue(EPIC_ALPHA, 'Alpha epic', '- [ ] #51\n- [ ] #52\n', 'OPEN', ['type:epic', 'epic:alpha', 'horizon:now']),
  boardIssue(51, 'Alpha open member', '', 'OPEN', ['epic:alpha']),
  boardIssue(52, 'Alpha closed member', '', 'CLOSED', ['epic:alpha']),
  boardIssue(EPIC_BETA, 'Beta epic', '- [ ] #61\n- [ ] #62\n', 'OPEN', ['type:epic', 'epic:beta', 'horizon:now']),
  boardIssue(61, 'Beta member one', '', 'CLOSED', ['epic:beta']),
  boardIssue(62, 'Beta member two', '', 'CLOSED', ['epic:beta']),
];

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * Plants the scratch project: `roadmap.issue` set, a reachable empty
 * `origin` so the branch scan never warns, and the stand-in `gh`.
 */
function plant(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, `${projectConfigText()}roadmap:\n  issue: ${String(ROADMAP)}\n`);
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const bare = join(dirname(scratch.repo), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', bare], { cwd: scratch.repo, stdio: 'pipe', env });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: scratch.repo, stdio: 'pipe', env });

  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data);
  const roadmap = { number: ROADMAP, title: 'Roadmap', body: `- [ ] #${String(EPIC_ALPHA)}\n- [ ] #${String(EPIC_BETA)}\n`, state: 'OPEN', labels: [], author: { login: 'me' } };
  writeFileSync(join(data, 'view.json'), JSON.stringify(roadmap), 'utf8');
  writeFileSync(join(data, 'board.json'), JSON.stringify(BOARD), 'utf8');
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    // No issue carries type:roadmap: that listing is told apart from the
    // board listing by its label flag, and answers empty.
    'case "$*" in *"--label type:roadmap"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$1 $2" in',
    `  "issue view") ${printFile(join(data, 'view.json'))};;`,
    '  "pr list") printf \'%s\' \'[]\';;',
    `  "issue list") ${printFile(join(data, 'board.json'))};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
  return scratch;
}

/** A capture as the move promised to keep it; see the module note. */
interface View {
  readonly exitCode: number;
  readonly stderr: string;
  /** Every stdout line above the table's header. */
  readonly head: readonly string[];
  /** Each table row's issue number and title, in order. */
  readonly rows: readonly (readonly [string, string])[];
}

/** `captured` reduced to what the move promised to keep. */
function sameView(captured: Capture): View {
  const lines = captured.stdout.split('\n');
  const header = lines.findIndex((line) => line.trimStart().startsWith('#  state'));
  const rows = lines.slice(header + 1)
    .filter((line) => line.startsWith('#'))
    .map((line): readonly [string, string] => [line.split(' ')[0] ?? '', line.split(/\s{2,}/).at(-1) ?? '']);
  return { exitCode: captured.exitCode, stderr: captured.stderr, head: lines.slice(0, header), rows };
}

/** The capture of one spawned line, reduced to what the fixture file holds. */
function capture(scratch: ScratchRepo, words: readonly string[]): Capture {
  const { exitCode, stdout, stderr } = runRafa(scratch, scratch.repo, words);
  return { exitCode, stdout, stderr };
}

describe('rafa epics after the move under the epic subject, spawned over one fixture', () => {
  let scratch: ScratchRepo;
  let preMove: PreMove;

  beforeAll(() => {
    scratch = plant();
    preMove = JSON.parse(readFileSync(PRE_MOVE_FILE, 'utf8')) as PreMove;
  });

  it('holds pre-move captures that show an epic table, so an identical capture means something', () => {
    const bare = preMove.captures.epics;
    const beta = preMove.captures['epics 60'];
    expect(bare?.exitCode).toBe(0);
    expect(bare?.stdout).toContain(`Epic #${String(EPIC_ALPHA)} · Alpha epic · in-progress, 1/2 done`);
    expect(beta?.exitCode).toBe(0);
    expect(beta?.stdout).toContain(`Epic #${String(EPIC_BETA)} · Beta epic · done, 2/2 done`);
  });

  it('rafa epics prints the pre-move command\'s head, and its rows by issue and title', () => {
    expect(sameView(capture(scratch, ['epics']))).toEqual(sameView(preMove.captures.epics as Capture));
  });

  it('rafa epics <n> prints the pre-move command\'s head, and its rows by issue and title', () => {
    expect(sameView(capture(scratch, ['epics', String(EPIC_BETA)]))).toEqual(sameView(preMove.captures['epics 60'] as Capture));
  });

  it('rafa epic <n> and rafa epic show <n> print the same capture as rafa epics <n>', () => {
    const expected = capture(scratch, ['epics', String(EPIC_BETA)]);
    expect(capture(scratch, ['epic', String(EPIC_BETA)])).toEqual(expected);
    expect(capture(scratch, ['epic', 'show', String(EPIC_BETA)])).toEqual(expected);
  });

  it('control: another epic\'s capture differs from the pre-move capture of rafa epics 60', () => {
    const other = capture(scratch, ['epics', String(EPIC_ALPHA)]);
    expect(other.exitCode).toBe(0);
    expect(sameView(other)).not.toEqual(sameView(preMove.captures['epics 60'] as Capture));
  });
});
