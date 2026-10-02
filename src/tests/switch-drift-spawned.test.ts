/**
 * Spawned `bun src/rafa.ts switch` over a stand-in board carrying one
 * drifted line (`.rafa/plans/rafa-324-claim-issue-so-two`, "Drift
 * check"): board #10's checklist ticks epic #100 while #100 still
 * carries `rafa:in-development`. `checkDrift` (`src/claims/drift.ts`)
 * reports that as a `ticked-labelled` finding.
 *
 * A local branch `feat/rafa-100-x` names #100's claim, so the second
 * finding, `label-without-branch`, does not also fire: the report holds
 * exactly the one line this suite asserts on.
 *
 * The stand-in `gh` logs every call it answers, an empty title search
 * (`resolveDefaultBoard`'s rank, spent since #10 is a labelled board)
 * and the one board listing `createGhBoardListing` sends (`issue list
 * --state all ...`) included, and fails loudly, naming the call, on
 * anything else — an `issue edit` among them — so a write the drift
 * report is not meant to make would fail the run rather than pass
 * unnoticed; the case also reads the log back to confirm no `edit` was
 * sent.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { IN_DEVELOPMENT_LABEL } from '../claims/stale.js';

import { plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once the case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-switch-drift-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the spawned run may take: local `gh` and `git` reads alone. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The one board, its checklist ticking the epic that is still labelled. */
const BOARD = 10;
/** The epic ticked on `BOARD`'s checklist while it still carries `IN_DEVELOPMENT_LABEL`. */
const EPIC = 100;

/** One `gh issue list` row, labels already named. */
function issueRow(
  number: number,
  title: string,
  body: string,
  labels: readonly string[],
): object {
  return { number, title, body, state: 'OPEN', stateReason: null, labels: labels.map((name) => ({ name })) };
}

/** The fixture: `BOARD` ticking `EPIC`, `EPIC` still labelled `rafa:in-development`. */
const LISTING: readonly object[] = [
  issueRow(BOARD, 'Board Alpha', `- [x] #${String(EPIC)}\n`, ['type:roadmap']),
  issueRow(EPIC, 'Alpha work', '', ['type:epic', 'epic:alpha', 'horizon:now', IN_DEVELOPMENT_LABEL]),
];

/** The drift report's one line, as `driftSentence` renders it, `warn`-prefixed. */
const DRIFT_LINE = `warn: claim drift: #${String(EPIC)} is ticked on #${String(BOARD)} (line 1) but still labelled ${IN_DEVELOPMENT_LABEL} (open)`;

/** The place line an unticked, unlabelled switch to `BOARD` would print too: the checklist's only line is ticked, so no now epic is left open. */
const PLACE_LINE = `board #${String(BOARD)} · no epic`;

/** Every call the stand-in `gh` logged, blank lines dropped. */
function callLog(scratch: ScratchRepo): readonly string[] {
  return readFileSync(scratch.callLog, 'utf8').split('\n')
    .filter((line) => line !== '');
}

/**
 * Writes the stand-in `gh` into `scratch`'s `bin/`: every call is
 * logged, the empty title search and the board listing (`issue list
 * --state all ...`) are answered, and anything else, `issue edit`
 * included, exits 1 naming the call.
 */
function writeGhStub(scratch: ScratchRepo): void {
  const data = join(dirname(scratch.repo), 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'listing.json'), JSON.stringify(LISTING), 'utf8');

  const gh = join(scratch.bin, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    `LOG='${scratch.callLog}'`,
    'printf \'%s\\n\' "$*" >> "$LOG"',
    'case "$*" in',
    '  *"--search "*) printf \'%s\' \'[]\'; exit 0;;',
    'esac',
    'case "$1 $2" in',
    '  "issue list")',
    '    case "$*" in',
    '      *"--state all"*)',
    `        while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${join(data, 'listing.json')}'`,
    '        ;;',
    '      *) echo "unplanned issue list: $*" >&2; exit 1;;',
    '    esac',
    '    ;;',
    '  *) echo "unplanned gh call: $*" >&2; exit 1;;',
    'esac',
    '',
  ].join('\n'), 'utf8');
  chmodSync(gh, 0o755);
}

/**
 * Makes `scratch` a project with one commit on `main`, a reachable bare
 * `origin`, and a local `feat/rafa-100-x` branch naming #100's claim, so
 * the branch scan sees it and reports only the `ticked-labelled`
 * finding.
 */
function plantWorld(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  const env = { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
  const git = (args: readonly string[]): void => {
    execFileSync('git', args, { cwd: scratch.repo, stdio: 'pipe', env });
  };
  git(['checkout', '-q', '-B', 'main']);
  git(['config', 'user.name', 'rafa test']);
  git(['config', 'user.email', 'rafa@example.test']);
  writeFileSync(join(scratch.repo, 'README.md'), '# scratch\n', 'utf8');
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
  const bare = join(dirname(scratch.repo), 'origin.git');
  git(['init', '-q', '--bare', bare]);
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', '-u', 'origin', 'main']);
  git(['branch', `feat/rafa-${String(EPIC)}-x`]);
  writeGhStub(scratch);
  return scratch;
}

describe('rafa switch over a stand-in board with one drifted line, spawned', () => {
  it('prints the drift report, exits as before, and sends no gh write', RUN_TIMEOUT, () => {
    const scratch = plantWorld();

    const run = runRafa(scratch, scratch.repo, ['switch', String(BOARD)]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(DRIFT_LINE);
    expect(run.stdout).toContain(PLACE_LINE);
    expect(run.stdout.split('\n').filter((line) => line.startsWith('warn: claim drift'))).toEqual([DRIFT_LINE]);

    const log = callLog(scratch);
    expect(log.filter((line) => line.startsWith('issue list --state all'))).toHaveLength(1);
    expect(log.some((line) => line.includes('edit'))).toBe(false);
  });
});
