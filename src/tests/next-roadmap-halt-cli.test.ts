/**
 * Spawned `bun src/rafa.ts` runs of `rafa next --roadmap --yes` over three
 * fixtures where the one-hop decision (`src/next/hop-chain.ts`) HALTS
 * rather than hops or comes home clean: C itself blocked by an open B
 * (the chain `#H ← #C ← #B`), H and C blocked by each other (the mutual
 * chain `#H ← #C ← #H`), and, with a hop already away, C's own spec
 * carrying no `spec:ready` (`away-ended`'s `notReadyEnded`,
 * `src/next/hop-rows.ts`).
 *
 * `next-roadmap-hop-cli.test.ts` is the spawned proof that a hop TO
 * another board's epic reads and prints right; this file is the spawned
 * proof of the other side, that a halt reads and prints right and that
 * the one action a halt ever proposes — `home` — never runs the `switch`
 * a `hop` would, so the position is never left away by one of these
 * three turns. `--yes` is bare, so `home`, which `src/next/ceiling.ts`
 * lists among the five cheap bare allows, runs with no question put; a
 * chain that read a halt as a `hop` would fail loudly here, either on
 * the stand-in `gh`'s refusal of a call this fixture did not plant, or
 * on the position file this suite asserts is never written away.
 *
 * The first two cases plant no position file at all, so `home` is where
 * the walk already stands (`hop-halt`'s own fallback,
 * `halt.from`): `runHome` writes nothing, and the position file stays
 * absent throughout, which is itself the proof that no move away ever
 * happened. The chain repeats the identical halt on its second read and
 * stops `unchanged`.
 *
 * The third plants an `away` position and hop record by hand, as an
 * earlier `hop` would have left them, so `home` has to move something
 * real: the position file is rewritten at `goHome`, and the hop record
 * closes `halted`. The home epic is left with nothing on its checklist,
 * so the second read the chain makes there answers row 13,
 * `nothing-left`, and the chain stops on its own `none` action with no
 * further line.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { hopFilePath } from '../next/hop-record.js';
import { positionFilePath } from '../project/position.js';
import { projectConfigText } from '../project/scaffold.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-roadmap-halt-cli-')));

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

/** C: H's blocker, a member of epic Beta. */
const C = 203;

/** B: C's own open blocker, in the two chain cases. */
const B = 210;

/** A filler line on epic Alpha, ready for nothing but a normal `issue-not-ready` read once home. */
const FILLER = 150;

/** One `gh issue view`/`issue list` row, labels already named. */
function issueRow(number: number, title: string, body: string, labels: readonly string[]): object {
  return { number, title, body, state: 'OPEN', stateReason: '', labels: labels.map((name) => ({ name })), author: { login: AUTHOR_LOGIN } };
}

/** Prints `file` with builtins only: the PATH a spawn gets may hold no `cat`. */
function printFile(file: string): string {
  return `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < '${file}'`;
}

/**
 * A commit on `main`, pushed to a bare `origin` beside the repository, so
 * the branch scan's remote half never fails and warns onto stdout, which
 * would break a byte-for-byte comparison, exactly as
 * `next-roadmap-hop-cli.test.ts` sets it up.
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
 * Writes the stand-in `gh` into `scratch`'s `bin/`, over `issues`: the
 * `type:roadmap` listing, one `issue view` answer per fixture issue, the
 * whole listing for `issue list --state all`, and `pr list` empty.
 * Anything unplanned fails loudly, naming the call.
 */
function writeGhStub(scratch: ScratchRepo, issues: readonly object[]): void {
  const labelled = issues.filter((issue) => (issue as { readonly labels: readonly { readonly name: string }[] }).labels
    .some((label) => label.name === 'type:roadmap'));
  const data = join(dirname(scratch.repo), 'data');
  const labelledFile = join(data, 'labelled.json');
  const allFile = join(data, 'all.json');
  mkdirSync(data, { recursive: true });
  writeFileSync(labelledFile, JSON.stringify(labelled), 'utf8');
  writeFileSync(allFile, JSON.stringify(issues), 'utf8');
  for (const issue of issues) {
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

/** The project config every fixture shares: `gh`, `main` as base, `octocat` trusted. */
function configText(): string {
  return `${projectConfigText()}pr:\n  provider: gh\n  base: main\nboard:\n  trustedAuthors:\n    - ${AUTHOR_LOGIN}\n`;
}

/** One scratch repository, planted, committed and pushed, its `gh` stand-in serving `issues`. */
function plantFixture(issues: readonly object[]): ScratchRepo {
  const scratch = plantScratchRepo(tempBase, { project: false });
  plantProjectConfig(scratch.repo, configText());
  gitSetup(scratch);
  writeGhStub(scratch, issues);
  return scratch;
}

/** The two lines every halt here opens with: the chain, then the proposal to go home. */
function haltLines(chain: string, why: string): readonly string[] {
  return [
    `📍 halt: ${chain}: ${why}.`,
    `👉 go back home to epic #${String(EPIC_A)} on board #${String(BOARD_A)}`,
  ];
}

/** The `home` action's own log line, printed off the run it made, not off `next`'s own two lines. */
const BACK_HOME_A = `back home: epic #${String(EPIC_A)} on board #${String(BOARD_A)}`;

/** The stop line a chain prints once its second read answers the identical halt. */
const UNCHANGED_STOP = '⏹ That last step left the project where it was, so the chain stops rather than repeating it.';

describe('rafa next --roadmap --yes over a halt, spawned', () => {
  describe('C blocked in turn by open B', () => {
    let scratch: ScratchRepo;

    beforeAll(() => {
      scratch = plantFixture([
        issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
        issueRow(EPIC_A, 'Alpha work', `- [ ] #${String(H)}\n`, ['type:epic', 'epic:alpha', 'horizon:now']),
        issueRow(H, 'H, blocked by C', `Blocked by: #${String(C)}\n`, [SPEC_BLOCKED_LABEL]),
        issueRow(BOARD_B, 'Board Beta', `- [ ] #${String(EPIC_B)}\n`, ['type:roadmap']),
        issueRow(EPIC_B, 'Beta work', `- [ ] #${String(C)}\n`, ['type:epic', 'epic:beta', 'horizon:now']),
        issueRow(C, 'C, blocked by B', `Blocked by: #${String(B)}\n`, ['epic:beta', SPEC_BLOCKED_LABEL]),
        issueRow(B, 'B, open', '', []),
      ]);
    });

    it('halts printing #H ← #C ← #B, the position left home, and no switch write leaves it away', RUN_TIMEOUT, () => {
      const position = positionFilePath(scratch.repo);
      expect(existsSync(position)).toBe(false);

      const run = runRafa(scratch, scratch.repo, ['next', '--roadmap', '--yes']);

      const chain = `#${String(H)} ← #${String(C)} ← #${String(B)}`;
      const halt = [...haltLines(chain, `#${String(C)} is blocked in turn`), BACK_HOME_A];
      const expected = [...halt, ...haltLines(chain, `#${String(C)} is blocked in turn`), UNCHANGED_STOP].join('\n') + '\n';

      expectExit(run, 0, scratch);
      expect(run.stdout).toBe(expected);
      // `home` found the walk already there: nothing ever moved the position away.
      expect(existsSync(position)).toBe(false);
      expect(existsSync(hopFilePath(scratch.repo))).toBe(false);
    });
  });

  describe('H and C block each other', () => {
    let scratch: ScratchRepo;

    beforeAll(() => {
      scratch = plantFixture([
        issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
        issueRow(EPIC_A, 'Alpha work', `- [ ] #${String(H)}\n`, ['type:epic', 'epic:alpha', 'horizon:now']),
        issueRow(H, 'H, blocked by C', `Blocked by: #${String(C)}\n`, [SPEC_BLOCKED_LABEL]),
        issueRow(BOARD_B, 'Board Beta', `- [ ] #${String(EPIC_B)}\n`, ['type:roadmap']),
        issueRow(EPIC_B, 'Beta work', `- [ ] #${String(C)}\n`, ['type:epic', 'epic:beta', 'horizon:now']),
        issueRow(C, 'C, blocked by H', `Blocked by: #${String(H)}\n`, ['epic:beta', SPEC_BLOCKED_LABEL]),
      ]);
    });

    it('halts the same way, naming the mutual block, the position left home', RUN_TIMEOUT, () => {
      const position = positionFilePath(scratch.repo);

      const run = runRafa(scratch, scratch.repo, ['next', '--roadmap', '--yes']);

      const chain = `#${String(H)} ← #${String(C)} ← #${String(H)}`;
      const why = `#${String(H)} and #${String(C)} block each other`;
      const halt = [...haltLines(chain, why), BACK_HOME_A];
      const expected = [...halt, ...haltLines(chain, why), UNCHANGED_STOP].join('\n') + '\n';

      expectExit(run, 0, scratch);
      expect(run.stdout).toBe(expected);
      expect(existsSync(position)).toBe(false);
      expect(existsSync(hopFilePath(scratch.repo))).toBe(false);
    });
  });

  describe('C\'s spec carries no spec:ready, a hop already away', () => {
    let scratch: ScratchRepo;

    beforeAll(() => {
      scratch = plantFixture([
        issueRow(BOARD_A, 'Board Alpha', `- [ ] #${String(EPIC_A)}\n`, ['type:roadmap']),
        issueRow(EPIC_A, 'Alpha work', `- [ ] #${String(FILLER)}\n`, ['type:epic', 'epic:alpha', 'horizon:now']),
        issueRow(FILLER, 'Alpha filler, not ready', '', []),
        issueRow(BOARD_B, 'Board Beta', `- [ ] #${String(EPIC_B)}\n`, ['type:roadmap']),
        issueRow(EPIC_B, 'Beta work', `- [ ] #${String(C)}\n`, ['type:epic', 'epic:beta', 'horizon:now']),
        issueRow(C, 'C, not ready', '', []),
      ]);

      const home = { board: BOARD_A, epic: EPIC_A };
      writeFileSync(positionFilePath(scratch.repo), `${JSON.stringify({
        current: { board: BOARD_B, epic: EPIC_B },
        previous: home,
        home,
      }, null, 2)}\n`, 'utf8');
      writeFileSync(hopFilePath(scratch.repo), `${JSON.stringify({
        kind: 'blocker',
        home,
        from: home,
        blocked: H,
        target: C,
        targetEpic: EPIC_B,
        targetBoard: BOARD_B,
        state: 'away',
        pullRequest: null,
        startedAt: '2026-01-01T00:00:00.000Z',
      }, null, 2)}\n`, 'utf8');
    });

    it('halts and goes home, the position moved there for real and the hop record closed halted', RUN_TIMEOUT, () => {
      const position = positionFilePath(scratch.repo);
      const hopFile = hopFilePath(scratch.repo);

      const run = runRafa(scratch, scratch.repo, ['next', '--roadmap', '--yes']);

      const expected = [
        `📍 #${String(C)}, the hop's target in epic #${String(EPIC_B)}, carries no \`spec:ready\`, so its spec is refused as not ready.`,
        `👉 go back home to epic #${String(EPIC_A)} on board #${String(BOARD_A)}`,
        BACK_HOME_A,
        `📍 #${String(FILLER)} not ready: it carries no spec:ready label.`,
        `👉 check the spec of #${String(FILLER)} and mark it ready — rafa issue ready ${String(FILLER)}`,
        '⏹ --yes allows sync, wait, unblock, plan, home, and this step is ready,'
          + ' so nothing ran; no --yes list allows it, so drop --yes to be asked.',
      ].join('\n') + '\n';

      expectExit(run, 0, scratch);
      expect(run.stdout).toBe(expected);

      // The write that ended the away hop left the position at home, never away.
      const written = JSON.parse(readFileSync(position, 'utf8')) as { readonly current: { readonly board: number; readonly epic: number } };
      expect(written.current).toEqual({ board: BOARD_A, epic: EPIC_A });

      const closed = JSON.parse(readFileSync(hopFile, 'utf8')) as { readonly state: string };
      expect(closed.state).toBe('halted');
    });
  });
});
