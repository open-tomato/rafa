/**
 * Spawned `bun src/rafa.ts` runs of `rafa issue list --roadmap` and
 * `rafa roadmap` (`.rafa/specs/rafa-123-rafa-issue-list-roadmap.md`), over
 * a stand-in `gh` in the scratch `bin/`, a planted plan dir, and a planted
 * branch in a scratch repository with a bare `origin` beside it.
 *
 * The stand-in answers from files planted beside the repository and prints
 * them with shell builtins only, since the PATH a spawn gets holds `bin/`
 * and git's directory and may hold no `cat`. A missing board file makes
 * its `gh issue list` fail, which is the unreachable board.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { CliEvent } from '../ports/index.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { projectConfigText } from '../project/scaffold.js';

import { eventsOf, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { completeSpecBody } from './spec-bodies.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-roadmap-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The Roadmap issue's number, named by `roadmap.issue`. */
const ROADMAP = 1;

/** The roadmap's lines, in the order the body writes them; #10 is ticked. */
const ROADMAP_BODY = [
  '- [x] #10 already done',
  '- [ ] #13 third thing',
  '- [ ] #11 first thing',
  '- [ ] #12 second thing',
  '- [ ] #14 fourth thing',
].join('\n');

/** The issues on the board. */
const BOARD = [
  { number: 10, title: 'Done thing', body: '', state: 'CLOSED', labels: [] },
  {
    number: 11,
    title: 'First thing',
    body: completeSpecBody('First'),
    state: 'OPEN',
    labels: [{ name: 'spec:ready' }, { name: 'type:bug' }],
  },
  {
    number: 12,
    title: 'Second thing',
    body: '# Second\n\nBlocked by: #11',
    state: 'OPEN',
    labels: [{ name: 'type:feature' }],
  },
  { number: 13, title: 'Third thing', body: completeSpecBody('Third'), state: 'OPEN', labels: [{ name: 'type:bug' }] },
  { number: 14, title: 'Fourth thing', body: '# Fourth', state: 'OPEN', labels: [{ name: 'type:bug' }] },
];

/** The open pull requests: one closes #14. */
const PULLS = [{ number: 40, headRefName: 'feat/other', body: 'Closes #14' }];

/** The order the four unticked lines print in. */
const ORDER = [13, 11, 12, 14];

interface Planted {
  readonly scratch: ScratchRepo;
  readonly data: string;
}

/** Prints `file` with builtins only. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/** Plants a scratch project, its plan file, branch, origin and stand-in `gh`. */
function plant(reachable: boolean): Planted {
  const scratch = plantScratchRepo(tempBase, { project: false });
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data);
  plantProjectConfig(scratch.repo, `${projectConfigText()}roadmap:\n  issue: ${String(ROADMAP)}\n`);

  const view = { number: ROADMAP, title: 'Roadmap', body: ROADMAP_BODY, state: 'OPEN', labels: [], author: { login: 'me' } };
  writeFileSync(join(data, 'view.json'), JSON.stringify(view), 'utf8');
  if (reachable) writeFileSync(join(data, 'board.json'), JSON.stringify(BOARD), 'utf8');
  writeFileSync(join(data, 'pulls.json'), JSON.stringify(PULLS), 'utf8');
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    'case "$1 $2" in',
    `  "issue view") ${printFile(join(data, 'view.json'))};;`,
    `  "pr list") ${printFile(join(data, 'pulls.json'))};;`,
    `  "issue list") [ -f '${join(data, 'board.json')}' ] || { echo 'connection refused' >&2; exit 1; }; ${printFile(join(data, 'board.json'))};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);

  mkdirSync(join(scratch.repo, '.rafa', 'plans'), { recursive: true });
  writeFileSync(join(scratch.repo, '.rafa', 'plans', 'PLAN-rafa-11-first.md'), '# plan\n', 'utf8');

  const bare = join(dirname(scratch.repo), 'origin.git');
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args: string[], cwd: string): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe', env });
  };
  git(['init', '-q', '--bare', bare], scratch.repo);
  git(['remote', 'add', 'origin', bare], scratch.repo);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'], scratch.repo);
  git(['branch', 'feat/rafa-12-second'], scratch.repo);
  return { scratch, data };
}

/** The rows of a text table, each split into its cells; the header and the `Roadmap:` line dropped. */
function cellsOf(stdout: string): string[][] {
  return stdout.split('\n').filter((line) => line.startsWith('#') && !line.startsWith('# '))
    .map((line) => line.trim().split(/ {2,}/u));
}

/** The numbers of the rows, in order. */
function numbersOf(stdout: string): number[] {
  return cellsOf(stdout).map((cells) => Number((cells[0] ?? '').slice(1)));
}

describe('rafa issue list --roadmap, spawned', () => {
  let good: Planted;
  let down: Planted;

  beforeAll(() => {
    good = plant(true);
    down = plant(false);
  });

  it('refuses --roadmap beside --state', () => {
    const run = runRafa(good.scratch, good.scratch.repo, ['issue', 'list', '--roadmap', '--state=open']);
    expect(run.exitCode).toBe(1);
    expect(run.stdout + run.stderr).toContain('--state cannot narrow --roadmap');
  });

  it('refuses --all alone, before reading anything', () => {
    const run = runRafa(good.scratch, good.scratch.repo, ['issue', 'list', '--all']);
    expect(run.exitCode).toBe(1);
    expect(run.stdout + run.stderr).toContain('--all keeps the ticked Roadmap lines, so it needs --roadmap');
  });

  it('prints the four rows in the Roadmap\'s order with spec, blocked by, has and refs as planted', () => {
    const run = runRafa(good.scratch, good.scratch.repo, ['issue', 'list', '--roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Roadmap: #1');
    expect(numbersOf(run.stdout)).toEqual(ORDER);
    const [third, first, second, fourth] = cellsOf(run.stdout);
    expect(third).toEqual(['#13', 'open', 'bug', 'label: none, gate: ready', '-', '-', '-', 'type:bug', 'Third thing']);
    expect(first).toEqual(['#11', 'open', 'bug', 'ready', '-', 'plan', '-', 'spec:ready, type:bug', 'First thing']);
    expect(second?.slice(0, 6)).toEqual(['#12', 'open', 'code', 'outline', '#11 open', 'branch']);
    expect(fourth?.slice(0, 6)).toEqual(['#14', 'open', 'bug', 'outline', '-', 'pr #40']);
  });

  it('prints the same stdout bytes under rafa roadmap', () => {
    const list = runRafa(good.scratch, good.scratch.repo, ['issue', 'list', '--roadmap']);
    const short = runRafa(good.scratch, good.scratch.repo, ['roadmap']);
    expect(short.exitCode).toBe(0);
    expect(short.stdout).toBe(list.stdout);
  });

  it('keeps only the roadmap\'s bugs, in order, under --type=bug', () => {
    const run = runRafa(good.scratch, good.scratch.repo, ['issue', 'list', '--roadmap', '--type=bug']);
    expect(run.exitCode).toBe(0);
    expect(numbersOf(run.stdout)).toEqual([13, 11, 14]);
  });

  it('gives json rows matching the text rows', () => {
    const text = runRafa(good.scratch, good.scratch.repo, ['issue', 'list', '--roadmap']);
    const json = runRafa(good.scratch, good.scratch.repo, ['issue', 'list', '--roadmap', '--output=json']);
    expect(json.exitCode).toBe(0);
    const result = eventsOf(json.stdout).find((event: CliEvent) => event.type === 'result') as unknown as {
      data: { roadmap: number; rows: { line: { issue: number }; issue: { title: string } | null }[] };
    };
    expect(result.data.roadmap).toBe(1);
    expect(result.data.rows.map((row) => row.line.issue)).toEqual(numbersOf(text.stdout));
    expect(result.data.rows.map((row) => row.issue?.title)).toEqual(cellsOf(text.stdout).map((cells) => cells.at(-1)));
  });

  it('exits 0 with the warn line and the order intact when the board is unreachable', () => {
    const run = runRafa(down.scratch, down.scratch.repo, ['issue', 'list', '--roadmap']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout + run.stderr).toContain('the board could not be listed');
    expect(numbersOf(run.stdout)).toEqual(ORDER);
    const rows = cellsOf(run.stdout);
    expect(rows[0]?.slice(1, 6)).toEqual(['-', '-', '-', '-', '-']);
    expect(rows[1]?.[5]).toBe('plan');
    expect(rows[2]?.[5]).toBe('branch');
  });
});
