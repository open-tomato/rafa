/**
 * Spawned `bun src/rafa.ts` runs of `rafa board list`, `rafa roadmap`,
 * `rafa switch` and `rafa status` over a fixture carrying two
 * `type:roadmap` boards, each naming one `horizon:now` epic
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`, "Switching and
 * reading the current place").
 *
 * `BOARD_A` (#10) is the lower-numbered labelled board, so it is the
 * DEFAULT board (`resolveDefaultBoard`'s label rank), and its checklist
 * names `EPIC_A` (#100, one open member, #101). `BOARD_B` (#20) names
 * `EPIC_B` (#200, one open member, #201). Neither board carries an
 * `Owner:` line, so no `gh api` lookup is ever sent.
 *
 * The cases run in order over ONE scratch project, each `runRafa` a
 * fresh process reading and writing the same `.rafa/position.json`, so
 * the position a case leaves is the one the next reads — the same way a
 * person's shell carries `cd -` across commands:
 *
 * 1. With no position file yet, `rafa board list` marks `#10` `current`
 *    and `home`, `#20` neither.
 * 2. `rafa switch 20` (rehoming) moves to board `#20`'s epic, and `rafa
 *    roadmap` then shows `EPIC_B`'s row, not `EPIC_A`'s.
 * 3. `rafa switch 100` moves to `EPIC_A`, on `BOARD_A` (its own board's
 *    checklist lists it, `BOARD_B`'s does not), and `rafa status` prints
 *    its place line.
 * 4. `rafa switch -` goes back to the place left before that move —
 *    `BOARD_B` at `EPIC_B` — and `rafa status` prints that place line.
 * 5. `rafa switch 10 --no-rehome` moves the current place alone; `rafa
 *    status` prints the away line, and the position file's `home` is
 *    read back unchanged.
 *
 * The stand-in `gh` tells its callers apart by their own flags — the
 * labelled-board listing (`--label type:roadmap`), the title search
 * (`--search `), the blocked-issue listing (`--label spec:blocked`), the
 * board's issue-number listing (`--limit 500`), `issue view <n>`, `pr
 * list` and the one general board listing (`--state all --limit 1000`)
 * left over — and fails loudly, naming the call, on anything else.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { positionFilePath } from '../project/position.js';
import { projectConfigText } from '../project/scaffold.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-switch-status-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a case may take: several sequential local `gh` and `git` reads, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The lower-numbered, default board. */
const BOARD_A = 10;
/** The second board. */
const BOARD_B = 20;
/** `BOARD_A`'s one `now` epic. */
const EPIC_A = 100;
/** `EPIC_A`'s one open member. */
const MEMBER_A = 101;
/** `BOARD_B`'s one `now` epic. */
const EPIC_B = 200;
/** `EPIC_B`'s one open member. */
const MEMBER_B = 201;

/** One `gh issue list` or `gh issue view` row, labels already named. */
function issueRow(
  number: number,
  title: string,
  body: string,
  labels: readonly string[],
): { readonly number: number; readonly title: string; readonly body: string; readonly state: 'OPEN'; readonly stateReason: string; readonly labels: readonly { readonly name: string }[] } {
  return { number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })) };
}

/** Every issue of the fixture: the two boards, their epics and their epics' members. */
const ALL_ISSUES = [
  issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
  issueRow(EPIC_A, 'Alpha work', `- [ ] #${String(MEMBER_A)}\n`, ['type:epic', 'epic:alpha', 'horizon:now']),
  issueRow(MEMBER_A, 'Alpha task', '', ['epic:alpha']),
  issueRow(BOARD_B, 'Board Beta', `- [ ] #${String(EPIC_B)}\n`, ['type:roadmap']),
  issueRow(EPIC_B, 'Beta work', `- [ ] #${String(MEMBER_B)}\n`, ['type:epic', 'epic:beta', 'horizon:now']),
  issueRow(MEMBER_B, 'Beta task', '', ['epic:beta']),
];

/** The two open `type:roadmap` boards, as the labelled-board listing answers them. */
const LABELLED_BOARDS = ALL_ISSUES.filter((issue) => issue.labels.some((label) => label.name === 'type:roadmap'));

/** `issue view <n>`'s own fields: the general listing's row, with an author added. */
function viewOf(issue: (typeof ALL_ISSUES)[number]): object {
  return { number: issue.number, title: issue.title, body: issue.body, state: issue.state, labels: issue.labels, author: { login: 'me' } };
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: every route the
 * module note lists, told apart by flags ahead of the plain `issue list`
 * fallback (the general board listing), with one `issue view` answer per
 * fixture issue, and anything unplanned failed loudly.
 */
function writeGhStub(scratch: ScratchRepo): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'labelled.json'), JSON.stringify(LABELLED_BOARDS), 'utf8');
  writeFileSync(join(data, 'all.json'), JSON.stringify(ALL_ISSUES), 'utf8');
  for (const issue of ALL_ISSUES) {
    writeFileSync(join(data, `view-${String(issue.number)}.json`), JSON.stringify(viewOf(issue)), 'utf8');
  }

  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `case "$*" in *"--label type:roadmap"*) ${printFile(join(data, 'labelled.json'))}; exit 0;; esac`,
    'case "$*" in *"--label spec:blocked"*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$*" in *"--search "*) printf \'%s\' \'[]\'; exit 0;; esac',
    'case "$1 $2" in',
    '  "issue view")',
    `    f='${data}'"/view-$3.json"`,
    '    if [ -f "$f" ]; then',
    '      while IFS= read -r l || [ -n "$l" ]; do printf \'%s\\n\' "$l"; done < "$f"',
    '    else',
    '      echo "unplanned issue view: $3" >&2; exit 1',
    '    fi',
    '    ;;',
    '  "pr list") printf \'%s\' \'[]\';;',
    '  "issue list")',
    '    case "$*" in',
    '      *"--limit 500"*) printf \'%s\' \'[]\';;',
    `      *) ${printFile(join(data, 'all.json'))};;`,
    '    esac',
    '    ;;',
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/**
 * Makes `scratch` a project with one commit on `main` and a reachable,
 * empty bare `origin`, so `rafa status`'s branch scan and its remote
 * half (`git ls-remote --heads origin`) both answer without a warning,
 * and `pr.provider` is `gh` — the config's own word, asked for nothing
 * the fixture did not plant.
 */
function plantWorld(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n`);
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
  writeGhStub(scratch);
  return scratch;
}

/** The position file's `home` place, read directly off disk. */
function readHome(scratch: ScratchRepo): { readonly board: number; readonly epic: number | null } {
  const text = readFileSync(positionFilePath(scratch.repo), 'utf8');
  return (JSON.parse(text) as { readonly home: { readonly board: number; readonly epic: number | null } }).home;
}

describe('rafa board list, rafa roadmap, rafa switch and rafa status over two type:roadmap boards, spawned', () => {
  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantWorld();
  });

  it('rafa board list marks the default board current and home, with no position file yet', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['board', 'list']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`#${String(BOARD_A)} Board Alpha · no owner · 1 epic · current · home`);
    expect(run.stdout).toContain(`#${String(BOARD_B)} Board Beta · no owner · 1 epic`);
    expect(run.stdout).not.toContain(`#${String(BOARD_B)} Board Beta · no owner · 1 epic · current`);
  });

  it('rafa switch 20, then rafa roadmap shows board #20\'s epic, not board #10\'s', RUN_TIMEOUT, () => {
    const moved = runRafa(scratch, scratch.repo, ['switch', String(BOARD_B)]);
    expectExit(moved, 0, scratch);

    const run = runRafa(scratch, scratch.repo, ['roadmap']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`Roadmap #${String(BOARD_B)} · now`);
    expect(run.stdout).toContain('Beta work');
    expect(run.stdout).not.toContain('Alpha work');
  });

  it('rafa switch <epic> moves to it, and rafa status prints its place line', RUN_TIMEOUT, () => {
    const moved = runRafa(scratch, scratch.repo, ['switch', String(EPIC_A)]);
    expectExit(moved, 0, scratch);

    const run = runRafa(scratch, scratch.repo, ['status']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`board #${String(BOARD_A)} · epic #${String(EPIC_A)} Alpha work (now) · 0/1 done`);
  });

  it('rafa switch - returns to the earlier position, and rafa status prints its place line', RUN_TIMEOUT, () => {
    const back = runRafa(scratch, scratch.repo, ['switch', '-']);
    expectExit(back, 0, scratch);

    const run = runRafa(scratch, scratch.repo, ['status']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`board #${String(BOARD_B)} · epic #${String(EPIC_B)} Beta work (now) · 0/1 done`);
  });

  it('rafa switch <n> --no-rehome leaves home unchanged, and rafa status prints the away line', RUN_TIMEOUT, () => {
    const homeBefore = readHome(scratch);

    const moved = runRafa(scratch, scratch.repo, ['switch', String(BOARD_A), '--no-rehome']);
    expectExit(moved, 0, scratch);

    const run = runRafa(scratch, scratch.repo, ['status']);

    expectExit(run, 0, scratch);
    expect(run.stdout).toContain(`away from home: working #${String(EPIC_A)} for #${String(EPIC_B)}`);
    expect(readHome(scratch)).toEqual(homeBefore);
  });
});
