/**
 * Spawned `bun src/rafa.ts` runs of `rafa next --roadmap --dry-run` and
 * `rafa next --dry-run`, over ONE two-board fixture built the way
 * `switch-next-plan-cli.test.ts` builds its own: board Alpha (#10, the
 * default board, `type:roadmap`) listing epic Alpha (#100, `horizon:now`),
 * whose one checklist line is H (#103), and board Beta (#20)
 * listing epic Beta (#200), a member of which is C (#203). H carries
 * `spec:blocked` and a `Blocked by: #203` line naming C, open and taken
 * by nothing, so the walk's one-hop decision is a hop to C's epic
 * (`src/next/hop-chain.ts`).
 *
 * `next-roadmap.test.ts` already proves the chain's own wiring —
 * `--roadmap` on the words a loop step runs with, `hops` on the report,
 * the stop lines — dispatched in-process over a scripted board. What
 * neither that file nor `sources-hop.test.ts` (which drives `ghNextBoard`
 * over planted fakes) proves is that the REGISTERED `rafa next` command,
 * spawned over a real `gh` stand-in and a real git repository, reads a
 * blocker sitting in another board's epic and prints the hop, and that
 * dropping `--roadmap` on the very same fixture leaves the plain,
 * pre-existing `issue-blocked` row answering exactly as it always did.
 * This file is that end-to-end proof, over the one fixture both cases
 * share, so a change that could only ever break one of them is caught
 * by the pairing rather than by a coincidence of two separate boards.
 *
 * As `switch-next-plan-cli.test.ts` does, `main` is pushed to a bare
 * `origin` beside the repository, so `git ls-remote --heads origin`
 * never warns onto stdout and breaks a byte-for-byte comparison, and the
 * stand-in `gh` fails loudly, naming the call, on anything this fixture
 * was not planted to answer.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { positionFilePath } from '../project/position.js';
import { projectConfigText } from '../project/scaffold.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-roadmap-hop-cli-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a case may take: a handful of sequential local `gh` and `git` reads, none of them network. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The login every planted issue is authored by, and the one `board.trustedAuthors` names. */
const AUTHOR_LOGIN = 'octocat';

/** Board Alpha, the default board (the lowest-numbered open `type:roadmap` one), and its `horizon:now` epic. */
const BOARD_A = 10;
const EPIC_A = 100;

/** H: epic Alpha's one checklist line, blocked by C. */
const H = 103;

/** Board Beta, holding the epic C is a member of. */
const BOARD_B = 20;
const EPIC_B = 200;

/** C: H's blocker, a member of epic Beta, open and taken by nothing. */
const C = 203;

/** One `gh issue view`/`issue list` row, labels already named. */
function issueRow(number: number, title: string, body: string, labels: readonly string[]): object {
  return { number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })), author: { login: AUTHOR_LOGIN } };
}

const ISSUES = [
  issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
  issueRow(EPIC_A, 'Alpha work', `- [ ] #${String(H)}\n`, ['type:epic', 'epic:alpha', 'horizon:now']),
  issueRow(H, 'H, blocked by C', `Blocked by: #${String(C)}\n`, [SPEC_BLOCKED_LABEL]),
  issueRow(BOARD_B, 'Board Beta', `- [ ] #${String(EPIC_B)}\n`, ['type:roadmap']),
  issueRow(EPIC_B, 'Beta work', `- [ ] #${String(C)}\n`, ['type:epic', 'epic:beta', 'horizon:now']),
  issueRow(C, 'C, in epic Beta', '', ['epic:beta']),
];

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository, so
 * the branch scan's remote half never fails and warns onto stdout, which
 * would break a byte-for-byte comparison; see the module note.
 */
function gitSetup(scratch: ScratchRepo): void {
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  git(['add', '-A']);
  git(['-c', 'user.name=rafa tests', '-c', 'user.email=tests@example.com', 'commit', '-q', '-m', 'initial']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: the `type:roadmap`
 * listing, one `issue view` answer per fixture issue, the whole listing
 * for `issue list --state all`, and `pr list` empty. Anything unplanned
 * fails loudly, naming the call.
 */
function writeGhStub(scratch: ScratchRepo): void {
  const labelled = ISSUES.filter((issue) => (issue as { readonly labels: readonly { readonly name: string }[] }).labels
    .some((label) => label.name === 'type:roadmap'));
  const data = join(dirname(scratch.repo), 'data');
  const labelledFile = join(data, 'labelled.json');
  const allFile = join(data, 'all.json');
  mkdirSync(data, { recursive: true });
  writeFileSync(labelledFile, JSON.stringify(labelled), 'utf8');
  writeFileSync(allFile, JSON.stringify(ISSUES), 'utf8');
  for (const issue of ISSUES) {
    const { number } = issue as { readonly number: number };
    writeFileSync(join(data, `view-${String(number)}.json`), JSON.stringify(issue), 'utf8');
  }
  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `case "$*" in *"--label type:roadmap"*) ${printFile(labelledFile)}; exit 0;; esac`,
    'case "$*" in *"--label spec:blocked"*) printf \'%s\' \'[]\'; exit 0;; esac',
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
    `  "issue list") ${printFile(allFile)};;`,
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

describe('rafa next --roadmap over H blocked by C in another board\'s epic, spawned', () => {
  let scratch: ScratchRepo;

  beforeAll(() => {
    scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, `${projectConfigText()}pr:\n  provider: gh\n  base: main\nboard:\n  trustedAuthors:\n    - ${AUTHOR_LOGIN}\n`);
    gitSetup(scratch);
    writeGhStub(scratch);
  });

  it('rafa next --roadmap --dry-run prints the hop line and proposes the hop to C, the position file left unwritten', RUN_TIMEOUT, () => {
    const position = positionFilePath(scratch.repo);
    expect(existsSync(position)).toBe(false);

    const run = runRafa(scratch, scratch.repo, ['next', '--roadmap', '--dry-run']);

    const expected = [
      `📍 hop from epic #${String(EPIC_A)}: #${String(H)} blocked by #${String(C)}, in epic #${String(EPIC_B)}.`,
      `👉 hop to epic #${String(EPIC_B)} on board #${String(BOARD_B)} and work #${String(C)}, keeping home`,
      '⏹ --dry-run: nothing ran.',
    ].join('\n') + '\n';

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(expected);
    // A dry run proposes the hop; it never writes the position a real hop would move.
    expect(existsSync(position)).toBe(false);
  });

  it('rafa next --dry-run, with no --roadmap, stops at H, byte for byte as it did before the flag existed', RUN_TIMEOUT, () => {
    const run = runRafa(scratch, scratch.repo, ['next', '--dry-run']);

    const expected = [
      `📍 #${String(H)} is blocked by #${String(C)} (open).`,
      `👉 re-read the blockers of #${String(H)} and take \`${SPEC_BLOCKED_LABEL}\` off once they have all closed`
        + ` — rafa issue unblock ${String(H)}`,
      '⏹ --dry-run: nothing ran.',
    ].join('\n') + '\n';

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(expected);
    expect(existsSync(positionFilePath(scratch.repo))).toBe(false);
  });
});
