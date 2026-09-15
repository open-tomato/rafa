/**
 * Tests for the `.gitignore` writer: the entry each set of tracking
 * flags gives, the block rewritten in place, and the `tracking.all`
 * notice printed once per change of the flags.
 *
 * Ignore state is read the way git reads it. Each such case runs
 * `git check-ignore --no-index -q` on one planted file at a time and
 * reads its exit code, 0 for ignored and 1 for not, and every case
 * carries a control each way: `zz-control.txt`, which nothing ignores,
 * and `node_modules/m.js`, which a line the operator wrote ignores. A
 * probe answering anything else throws, and one case holds it to that
 * outside a repository. Files are planted before the probe because git
 * answers nothing for a trailing-slash pattern over a directory that is
 * not there.
 *
 * Every git runs with its global and system config switched off, its
 * home in the temporary root and every inherited `GIT_` variable
 * dropped, so no case reads the operator's ignores or their repository.
 *
 * A relative root a case expects refused is the relative spelling of a
 * directory under the temporary root, never `.` or a made-up path. A
 * module that stopped refusing it then writes there and not into the
 * working directory: a first spelling, `.`, left a digest file at the
 * checkout's root when the grid below dropped the notice's refusal.
 *
 * Idempotency is read off the file rather than the answer: before a
 * rerun each file's modification time is set into the past, and a case
 * holds it there beside a run with other flags that moves it.
 *
 * Each rule is paired with the case that makes it a reading: every flag
 * shape beside the others in one matrix; the re-include beside the same
 * file with that line taken out; the anchored re-include beside a
 * nested store it must not reach; an operator's global exclude beside
 * the same exclude with no entry; the notice not printed beside the
 * change that prints it. Pattern lines, marker lines and planted paths
 * are written LITERALLY, never through the module's constants, which
 * one case pins to literals.
 *
 * Thirty-five module mutations were driven against this file one at a
 * time, each an exact string found once, with `gitignore.ts` restored
 * sha256-identical after each, and every one reddened at least one
 * case: the re-include dropped from either unignoring shape, or left
 * unanchored; the private triage line or the digest line dropped under
 * `tracking.all`, or `tracking.all` yielding to `tracking.specs`;
 * `.rafa/*` spelled `.rafa/`; plans ordered before specs, or their
 * negation losing its trailing slash; a marker matched with its
 * carriage return kept, or as a prefix; the line break fixed at LF; the
 * blank line before an appended block dropped; duplicate markers, or an
 * end above its begin, accepted; lines before the block losing their
 * breaks, or lines after it dropped; an unchanged file written anyway;
 * `created` and `updated` swapped; a relative root accepted by the
 * writer or by the notice; a refusal losing its cause, or numbering
 * lines from 0; an unreadable `.gitignore` read as absent; the digest
 * blind to `tracking.all`; the notice printed on every change; the
 * digest written only under `tracking.all`, before the print, or never
 * checked against the flags; `printed` always true; the default print
 * through `info`; the notice before the `.gitignore` in
 * `applyTracking`; a notice line dropped; the digest directory not
 * created; and the scope directory spelled `.ralph`. The prefix match
 * first survived, and the whole-line case was written for it.
 */
import type { TrackingFlags } from './gitignore.js';
import type { Output } from '../ports/index.js';

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createTextOutput } from '../adapters/output/text.js';

import {
  applyTracking,
  BLOCK_BEGIN,
  BLOCK_END,
  exposureNotice,
  GITIGNORE_FILE,
  GitignoreError,
  noticeTrackingChange,
  TRACKING_DIGEST_FILE,
  trackingDigest,
  trackingEntry,
  withTrackingBlock,
  writeTrackingGitignore,
} from './gitignore.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-gitignore-'));
/** The home and XDG config directory every git here runs with. */
const gitHome = join(tempRoot, 'git-home');
mkdirSync(gitHome);
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A fresh directory under the temporary root, as a real path. */
function freshDir(): string {
  planted += 1;
  const dir = join(tempRoot, `case-${planted}`);
  mkdirSync(dir);
  return realpathSync(dir);
}

/**
 * A fresh directory under the temporary root, spelled relative to the
 * working directory: see the file note on relative roots.
 */
function relativeScratch(): string {
  const path = relative(process.cwd(), freshDir());
  if (isAbsolute(path)) throw new Error(`no relative spelling of the temporary root: ${path}`);
  return path;
}

/** Writes `text` to `file`, creating its parents. */
function plantFile(file: string, text = ''): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** The flags, each false unless named. */
function flagsOf(named: Partial<TrackingFlags> = {}): TrackingFlags {
  return { trackingSpecs: false, trackingPlans: false, trackingAll: false, ...named };
}

const BEGIN = '# >>> rafa tracking: rafa rewrites the lines up to the end marker';
const END = '# <<< rafa tracking';

/** The block for `lines`, LF-terminated, spelled from the literal markers. */
function blockOf(...lines: string[]): string {
  return [BEGIN, ...lines, END].map((line) => `${line}\n`).join('');
}

/** The environment every git here runs with; see the file note. */
function gitEnv(): Record<string, string | undefined> {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'));
  return {
    ...Object.fromEntries(inherited),
    HOME: gitHome,
    XDG_CONFIG_HOME: gitHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    LC_ALL: 'C',
  };
}

/** Runs git in `cwd` and answers its exit code and stderr. */
function runGit(cwd: string, args: readonly string[]): { status: number | null; stderr: string; stdout: string } {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() });
  if (run.error !== undefined) throw run.error;
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

/** A fresh git repository with the files every ignore case probes planted in it. */
function freshRepo(): string {
  const repo = freshDir();
  const init = runGit(repo, ['init', '-q']);
  if (init.status !== 0) throw new Error(`git init: ${init.stderr}`);
  for (const path of [...RAFA_PATHS, ...CONTROL_PATHS]) plantFile(join(repo, path));
  return repo;
}

/**
 * Whether git ignores `path` in `repo`, read by the exit code of
 * `git check-ignore`. Throws for any exit but 0 and 1.
 */
function isIgnored(repo: string, path: string, config: readonly string[] = []): boolean {
  const run = runGit(repo, [...config, 'check-ignore', '--no-index', '-q', path]);
  if (run.status === 0) return true;
  if (run.status === 1) return false;
  throw new Error(`git check-ignore ${path}: exit ${String(run.status)}: ${run.stderr}`);
}

/** The untracked files `git add -A` would stage in `repo`, sorted. */
function stageable(repo: string): readonly string[] {
  const run = runGit(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (run.status !== 0) throw new Error(`git ls-files: ${run.stderr}`);
  return run.stdout.split('\0').filter((path) => path !== '')
    .sort((a, b) => a.localeCompare(b));
}

/** Every path under `.rafa/` an ignore case probes. */
const RAFA_PATHS = [
  '.rafa/config.yaml',
  '.rafa/specs/s.md',
  '.rafa/plans/p.md',
  '.rafa/effort/effort.sqlite',
  '.rafa/runs/r.log',
  '.rafa/triage/private/i.md',
  '.rafa/instincts/x.md',
  '.rafa/tracking.digest',
] as const;

/** The controls: one path nothing ignores, one the operator's own line ignores. */
const CONTROL_PATHS = ['zz-control.txt', 'node_modules/m.js'] as const;

/** The operator's lines every ignore case writes above the entry. */
const OPERATOR_LINES = 'node_modules\n';

/** The `.rafa/` paths git ignores in `repo`. */
function ignoredRafaPaths(repo: string): readonly string[] {
  return RAFA_PATHS.filter((path) => isIgnored(repo, path));
}

/** Holds both controls to their answers in `repo`, so a probe that cannot answer both fails. */
function expectControls(repo: string): void {
  expect(isIgnored(repo, 'zz-control.txt')).toBe(false);
  expect(isIgnored(repo, 'node_modules/m.js')).toBe(true);
}

/** Sets `file`'s modification time a day into the past and answers it. */
function ageFile(file: string): number {
  const past = new Date(Date.now() - 86_400_000);
  utimesSync(file, past, past);
  return statSync(file).mtimeMs;
}

/** A print seam recording each message. */
function recorder(): { readonly messages: string[]; readonly print: (message: string) => void } {
  const messages: string[] = [];
  return { messages, print: (message) => messages.push(message) };
}

describe('constants', () => {
  it('spells the markers, the file and the digest path literally', () => {
    expect(BLOCK_BEGIN).toBe(BEGIN);
    expect(BLOCK_END).toBe(END);
    expect(GITIGNORE_FILE).toBe('.gitignore');
    expect(TRACKING_DIGEST_FILE).toBe(join('.rafa', 'tracking.digest'));
  });
});

describe('trackingEntry', () => {
  it('ignores the whole directory when no flag is set', () => {
    expect(trackingEntry(flagsOf())).toEqual(['.rafa/']);
  });

  it('re-includes each individual flag sub-path after ignoring every entry, specs before plans', () => {
    expect(trackingEntry(flagsOf({ trackingSpecs: true }))).toEqual(['!/.rafa/', '.rafa/*', '!.rafa/specs/']);
    expect(trackingEntry(flagsOf({ trackingPlans: true }))).toEqual(['!/.rafa/', '.rafa/*', '!.rafa/plans/']);
    expect(trackingEntry(flagsOf({ trackingSpecs: true, trackingPlans: true }))).toEqual([
      '!/.rafa/',
      '.rafa/*',
      '!.rafa/specs/',
      '!.rafa/plans/',
    ]);
  });

  it('keeps the private triage directory and the digest ignored under all, whatever the other flags say', () => {
    const all = ['!/.rafa/', '.rafa/triage/private/', '.rafa/tracking.digest'];
    expect(trackingEntry(flagsOf({ trackingAll: true }))).toEqual(all);
    expect(trackingEntry({ trackingSpecs: true, trackingPlans: true, trackingAll: true })).toEqual(all);
  });
});

describe('withTrackingBlock', () => {
  it('answers the block alone for no file and for an empty one', () => {
    expect(withTrackingBlock(null, flagsOf())).toBe(blockOf('.rafa/'));
    expect(withTrackingBlock('', flagsOf())).toBe(blockOf('.rafa/'));
  });

  it('appends the block after a blank line, the text before it kept byte for byte', () => {
    expect(withTrackingBlock('node_modules\n', flagsOf())).toBe(`node_modules\n\n${blockOf('.rafa/')}`);
    expect(withTrackingBlock('node_modules', flagsOf())).toBe(`node_modules\n\n${blockOf('.rafa/')}`);
  });

  it('replaces the lines between the markers and keeps every line around them', () => {
    const text = `dist\n\n${blockOf('.rafa/')}# after\n*.log`;
    const next = withTrackingBlock(text, flagsOf({ trackingPlans: true }));
    expect(next).toBe(`dist\n\n${blockOf('!/.rafa/', '.rafa/*', '!.rafa/plans/')}# after\n*.log`);
    expect(withTrackingBlock(next, flagsOf())).toBe(text);
  });

  it('matches a marker only as a whole line', () => {
    const text = `${BEGIN} (edited)\n${END} of an old block\n`;
    expect(withTrackingBlock(text, flagsOf())).toBe(`${text}\n${blockOf('.rafa/')}`);
  });

  it('answers the text unchanged when the block already holds the entry', () => {
    const text = `dist\n${blockOf('!/.rafa/', '.rafa/*', '!.rafa/specs/')}`;
    expect(withTrackingBlock(text, flagsOf({ trackingSpecs: true }))).toBe(text);
  });

  it('finds CRLF markers and writes the block with CRLF', () => {
    const text = `dist\r\n${BEGIN}\r\n.rafa/\r\n${END}\r\nout\r\n`;
    const next = withTrackingBlock(text, flagsOf({ trackingAll: true }));
    const lines = [BEGIN, '!/.rafa/', '.rafa/triage/private/', '.rafa/tracking.digest', END];
    expect(next).toBe(`dist\r\n${lines.join('\r\n')}\r\nout\r\n`);
  });

  it('appends with CRLF to a CRLF file holding no block', () => {
    expect(withTrackingBlock('dist\r\n', flagsOf())).toBe(`dist\r\n\r\n${BEGIN}\r\n.rafa/\r\n${END}\r\n`);
  });

  it('refuses markers it cannot place the entry between, naming the file and the lines', () => {
    const refusal = (text: string): string => {
      try {
        withTrackingBlock(text, flagsOf(), '/p/.gitignore');
      } catch (error) {
        expect(error).toBeInstanceOf(GitignoreError);
        return (error as Error).message;
      }
      throw new Error('withTrackingBlock did not refuse');
    };
    const expected = (where: string): string => 'rafa gitignore: /p/.gitignore: cannot place the tracking entry: '
      + `${where}, expected each once with the end below the begin`;

    expect(refusal(`${BEGIN}\n.rafa/\n`)).toBe(expected('the begin marker is on line 1 and the end marker on no line'));
    expect(refusal(`x\n.rafa/\n${END}\n`)).toBe(expected('the begin marker is on no line and the end marker on line 3'));
    expect(refusal(`${END}\n${BEGIN}\n`)).toBe(expected('the begin marker is on line 2 and the end marker on line 1'));
    expect(refusal(`${blockOf('.rafa/')}${blockOf('.rafa/')}`)).toBe(
      expected('the begin marker is on lines 1, 4 and the end marker on lines 3, 6'),
    );
  });
});

describe('writeTrackingGitignore', () => {
  it('creates the file, writes nothing on a rerun, and updates it for other flags', () => {
    const root = freshDir();
    const file = join(root, '.gitignore');

    expect(writeTrackingGitignore(root, flagsOf())).toEqual({ file, change: 'created' });
    expect(readFileSync(file, 'utf8')).toBe(blockOf('.rafa/'));

    const aged = ageFile(file);
    expect(writeTrackingGitignore(root, flagsOf())).toEqual({ file, change: 'unchanged' });
    expect(statSync(file).mtimeMs).toBe(aged);
    expect(readFileSync(file, 'utf8')).toBe(blockOf('.rafa/'));

    expect(writeTrackingGitignore(root, flagsOf({ trackingSpecs: true }))).toEqual({ file, change: 'updated' });
    expect(statSync(file).mtimeMs).not.toBe(aged);
    expect(readFileSync(file, 'utf8')).toBe(blockOf('!/.rafa/', '.rafa/*', '!.rafa/specs/'));
  });

  it('keeps the operator lines of an existing file', () => {
    const root = freshDir();
    plantFile(join(root, '.gitignore'), 'node_modules\n');
    expect(writeTrackingGitignore(root, flagsOf()).change).toBe('updated');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(`node_modules\n\n${blockOf('.rafa/')}`);
  });

  it('refuses a relative root, a root that is not there and a .gitignore it cannot read', () => {
    const relativeRoot = relativeScratch();
    expect(() => writeTrackingGitignore(relativeRoot, flagsOf())).toThrow(
      new GitignoreError(`project root is ${JSON.stringify(relativeRoot)}, expected an absolute path`),
    );

    const missing = join(freshDir(), 'missing');
    expect(() => writeTrackingGitignore(missing, flagsOf())).toThrow(
      `rafa gitignore: ${join(missing, '.gitignore')} cannot be written (ENOENT`,
    );

    const root = freshDir();
    mkdirSync(join(root, '.gitignore'));
    let caught: unknown;
    try {
      writeTrackingGitignore(root, flagsOf());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitignoreError);
    expect((caught as Error).message).toStartWith(`rafa gitignore: ${join(root, '.gitignore')} cannot be read (EISDIR`);
    expect((caught as Error).cause).toBeInstanceOf(Error);
  });
});

describe('ignore state read through git check-ignore', () => {
  it('answers exit codes other than 0 and 1 by throwing, outside a repository', () => {
    expect(() => isIgnored(freshDir(), 'x')).toThrow('exit 128');
  });

  /** Each expected list is in `RAFA_PATHS` order, the order `ignoredRafaPaths` answers in. */
  const ALL_TRACKED_BUT = ['.rafa/triage/private/i.md', '.rafa/tracking.digest'];
  const EVERY_RAFA_PATH: readonly string[] = RAFA_PATHS;
  const shapes: readonly [string, TrackingFlags, readonly string[]][] = [
    ['no flag', flagsOf(), EVERY_RAFA_PATH],
    ['tracking.specs', flagsOf({ trackingSpecs: true }), EVERY_RAFA_PATH.filter((path) => path !== '.rafa/specs/s.md')],
    ['tracking.plans', flagsOf({ trackingPlans: true }), EVERY_RAFA_PATH.filter((path) => path !== '.rafa/plans/p.md')],
    [
      'tracking.specs and tracking.plans',
      flagsOf({ trackingSpecs: true, trackingPlans: true }),
      EVERY_RAFA_PATH.filter((path) => path !== '.rafa/specs/s.md' && path !== '.rafa/plans/p.md'),
    ],
    ['tracking.all', flagsOf({ trackingAll: true }), ALL_TRACKED_BUT],
    ['every flag', { trackingSpecs: true, trackingPlans: true, trackingAll: true }, ALL_TRACKED_BUT],
  ];

  it.each(shapes)('under %s ignores exactly the expected .rafa paths', (_name, flags, ignored) => {
    const repo = freshRepo();
    plantFile(join(repo, '.gitignore'), OPERATOR_LINES);
    writeTrackingGitignore(repo, flags);

    expectControls(repo);
    expect(ignoredRafaPaths(repo)).toEqual(ignored);
    const unignored = RAFA_PATHS.filter((path) => !ignored.includes(path));
    expect(stageable(repo)).toEqual(['.gitignore', ...unignored, 'zz-control.txt'].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps the store, runs and the private triage directory ignored under every individual flag', () => {
    const kept = ['.rafa/effort/effort.sqlite', '.rafa/runs/r.log', '.rafa/triage/private/i.md'];
    for (const flags of [
      flagsOf({ trackingSpecs: true }),
      flagsOf({ trackingPlans: true }),
      flagsOf({ trackingSpecs: true, trackingPlans: true }),
    ]) {
      const repo = freshRepo();
      writeTrackingGitignore(repo, flags);
      expect(kept.filter((path) => isIgnored(repo, path))).toEqual(kept);
      expect(isIgnored(repo, 'zz-control.txt')).toBe(false);
    }
  });

  it('re-includes the directory over an earlier .rafa/ line, and fails to without that line', () => {
    const repo = freshRepo();
    plantFile(join(repo, '.gitignore'), `${OPERATOR_LINES}.rafa/\n`);
    writeTrackingGitignore(repo, flagsOf({ trackingSpecs: true }));
    expectControls(repo);
    expect(isIgnored(repo, '.rafa/specs/s.md')).toBe(false);
    expect(isIgnored(repo, '.rafa/effort/effort.sqlite')).toBe(true);

    const file = join(repo, '.gitignore');
    writeFileSync(file, readFileSync(file, 'utf8').replace('!/.rafa/\n', ''));
    expect(isIgnored(repo, '.rafa/specs/s.md')).toBe(true);
  });

  it('anchors the re-include, so a nested store an earlier line ignores stays ignored', () => {
    const repo = freshRepo();
    plantFile(join(repo, 'sub/.rafa/effort/e.sqlite'));
    plantFile(join(repo, '.gitignore'), `${OPERATOR_LINES}.rafa/\n`);
    writeTrackingGitignore(repo, flagsOf({ trackingSpecs: true }));
    expect(isIgnored(repo, 'sub/.rafa/effort/e.sqlite')).toBe(true);

    const file = join(repo, '.gitignore');
    writeFileSync(file, readFileSync(file, 'utf8').replace('!/.rafa/\n', '!.rafa/\n'));
    expect(isIgnored(repo, 'sub/.rafa/effort/e.sqlite')).toBe(false);
  });

  it('overrides a .rafa/ in the operator core.excludesFile under tracking.all', () => {
    const repo = freshRepo();
    const excludes = join(repo, '..', `excludes-${String(planted)}`);
    writeFileSync(excludes, '.rafa/\n');
    const config = ['-c', `core.excludesFile=${excludes}`];

    expect(isIgnored(repo, '.rafa/specs/s.md', config)).toBe(true);
    writeTrackingGitignore(repo, flagsOf({ trackingAll: true }));
    expect(isIgnored(repo, '.rafa/specs/s.md', config)).toBe(false);
    expect(isIgnored(repo, '.rafa/triage/private/i.md', config)).toBe(true);
    expect(isIgnored(repo, 'zz-control.txt', config)).toBe(false);
  });

  it('writes a CRLF block git reads as it reads LF', () => {
    const repo = freshRepo();
    plantFile(join(repo, '.gitignore'), 'node_modules\r\n');
    writeTrackingGitignore(repo, flagsOf({ trackingSpecs: true }));
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('\r\n.rafa/*\r\n!.rafa/specs/\r\n');
    expectControls(repo);
    expect(isIgnored(repo, '.rafa/specs/s.md')).toBe(false);
    expect(isIgnored(repo, '.rafa/effort/effort.sqlite')).toBe(true);
  });
});

describe('trackingDigest', () => {
  it('answers one 64-digit hex digest per set of flags, equal for equal flags', () => {
    const sets = [false, true].flatMap((trackingSpecs) => [false, true].flatMap((trackingPlans) => [false, true]
      .map((trackingAll) => ({ trackingSpecs, trackingPlans, trackingAll }))));
    const digests = sets.map((flags) => trackingDigest(flags));
    expect(new Set(digests).size).toBe(8);
    for (const digest of digests) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(trackingDigest({ trackingAll: true, trackingPlans: false, trackingSpecs: false })).toBe(
      trackingDigest(flagsOf({ trackingAll: true })),
    );
  });
});

describe('noticeTrackingChange', () => {
  it('names the exposed data, the .gitignore and what stays ignored', () => {
    expect(exposureNotice('/p')).toBe([
      'tracking.all is true, so /p/.gitignore no longer ignores .rafa/ and a commit can carry what it holds, including:',
      '  - unpatched issues described in specs and plans',
      '  - effort rows with model names and token counts',
      '  - instincts that may quote error output',
      '.rafa/triage/private/ stays ignored. Set tracking.all to false to ignore .rafa/ again.',
    ].join('\n'));
  });

  it('prints once under tracking.all and not on a rerun, leaving the digest untouched', () => {
    const root = freshDir();
    const digestFile = join(root, '.rafa', 'tracking.digest');
    const { messages, print } = recorder();
    const all = flagsOf({ trackingAll: true });

    expect(noticeTrackingChange(root, all, print)).toEqual({ digestFile, changed: true, printed: true });
    expect(messages).toEqual([exposureNotice(root)]);
    expect(readFileSync(digestFile, 'utf8')).toBe(`${trackingDigest(all)}\n`);

    const aged = ageFile(digestFile);
    expect(noticeTrackingChange(root, all, print)).toEqual({ digestFile, changed: false, printed: false });
    expect(messages).toHaveLength(1);
    expect(statSync(digestFile).mtimeMs).toBe(aged);
  });

  it('records the flags without printing when tracking.all is off, and prints each time it comes back on', () => {
    const root = freshDir();
    const digestFile = join(root, '.rafa', 'tracking.digest');
    const { messages, print } = recorder();

    expect(noticeTrackingChange(root, flagsOf(), print)).toEqual({ digestFile, changed: true, printed: false });
    expect(readFileSync(digestFile, 'utf8')).toBe(`${trackingDigest(flagsOf())}\n`);
    expect(noticeTrackingChange(root, flagsOf({ trackingAll: true }), print).printed).toBe(true);
    expect(noticeTrackingChange(root, flagsOf(), print)).toEqual({ digestFile, changed: true, printed: false });
    expect(noticeTrackingChange(root, flagsOf({ trackingAll: true }), print).printed).toBe(true);
    expect(messages).toHaveLength(2);
  });

  it('prints again when another flag changes while tracking.all stays on', () => {
    const root = freshDir();
    const { messages, print } = recorder();
    noticeTrackingChange(root, flagsOf({ trackingAll: true }), print);
    noticeTrackingChange(root, flagsOf({ trackingAll: true, trackingSpecs: true }), print);
    expect(messages).toHaveLength(2);
  });

  it('prints again on the next call when the print threw, the old digest kept', () => {
    const root = freshDir();
    const digestFile = join(root, '.rafa', 'tracking.digest');
    noticeTrackingChange(root, flagsOf(), () => undefined);
    const before = readFileSync(digestFile, 'utf8');

    const failing = (): void => {
      throw new Error('stream closed');
    };
    expect(() => noticeTrackingChange(root, flagsOf({ trackingAll: true }), failing)).toThrow('stream closed');
    expect(readFileSync(digestFile, 'utf8')).toBe(before);

    const { messages, print } = recorder();
    expect(noticeTrackingChange(root, flagsOf({ trackingAll: true }), print).printed).toBe(true);
    expect(messages).toHaveLength(1);
  });

  it('refuses a digest it cannot write and a relative root', () => {
    const root = freshDir();
    plantFile(join(root, '.rafa'));
    expect(() => noticeTrackingChange(root, flagsOf(), () => undefined)).toThrow(
      `rafa gitignore: ${join(root, '.rafa', 'tracking.digest')} cannot be written (`,
    );
    const relativeRoot = relativeScratch();
    expect(() => noticeTrackingChange(relativeRoot, flagsOf(), () => undefined)).toThrow(
      new GitignoreError(`project root is ${JSON.stringify(relativeRoot)}, expected an absolute path`),
    );
  });

  it('prints through the active output warn when no print is given', () => {
    const root = freshDir();
    const lines: string[] = [];
    const output: Output = createTextOutput({ verbosity: 0, stream: { write: (chunk: string) => lines.push(chunk) } });
    setActiveOutput(output);
    try {
      noticeTrackingChange(root, flagsOf({ trackingAll: true }));
    } finally {
      setActiveOutput(null);
    }
    expect(lines.join('')).toBe(`warn: ${exposureNotice(root)}\n`);
  });
});

describe('applyTracking', () => {
  it('writes the entry and prints the notice once, a rerun changing no byte of either file', () => {
    const repo = freshRepo();
    const { messages, print } = recorder();
    const all = flagsOf({ trackingAll: true });

    const first = applyTracking(repo, all, print);
    expect(first.gitignore.change).toBe('created');
    expect(first.notice.printed).toBe(true);
    expect(isIgnored(repo, '.rafa/specs/s.md')).toBe(false);
    expect(isIgnored(repo, '.rafa/tracking.digest')).toBe(true);
    expect(isIgnored(repo, 'node_modules/m.js')).toBe(false);

    const gitignore = join(repo, '.gitignore');
    const digest = join(repo, '.rafa', 'tracking.digest');
    const texts = [readFileSync(gitignore, 'utf8'), readFileSync(digest, 'utf8')];
    const times = [ageFile(gitignore), ageFile(digest)];

    const second = applyTracking(repo, all, print);
    expect(second.gitignore.change).toBe('unchanged');
    expect(second.notice).toEqual({ digestFile: digest, changed: false, printed: false });
    expect(messages).toHaveLength(1);
    expect([readFileSync(gitignore, 'utf8'), readFileSync(digest, 'utf8')]).toEqual(texts);
    expect([statSync(gitignore).mtimeMs, statSync(digest).mtimeMs]).toEqual(times);
  });

  it('prints nothing and records no digest when the .gitignore is refused', () => {
    const root = freshDir();
    plantFile(join(root, '.gitignore'), `${BEGIN}\n`);
    const { messages, print } = recorder();
    expect(() => applyTracking(root, flagsOf({ trackingAll: true }), print)).toThrow(GitignoreError);
    expect(messages).toEqual([]);
    expect(existsSync(join(root, '.rafa', 'tracking.digest'))).toBe(false);
  });
});
