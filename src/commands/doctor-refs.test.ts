/**
 * Tests for the references row of `rafa doctor` (`./doctor-refs.ts`):
 * which saved copies under `specs.dir` are read, the suspect, dangling
 * and unknown counts per copy and in total, that an issue is read once
 * per run, that an unreadable board reads `unknown` instead of failing
 * the row, that nothing is written, and the lines the row renders; and
 * the roadmap's `refs` column over the same reading: the copies narrowed
 * to the Roadmap's issues, and folded into one cell per issue.
 *
 * Paths are read through a real git over a repository planted under the
 * temp directory; issues through a fake `gh` runner answering
 * `gh issue view` from a table each case fills and recording every call.
 * The verifier is `createRefVerifier` over those two, handed in through
 * the `refsVerifier` seam with no `ts-symbols` and the core roster.
 * The roster cases alone read through the row's default verifier, with
 * no `ts-symbols` on the `PATH` they hand it, no board, and the
 * checkout's own roster answered through the `checkoutRoster` seam.
 *
 * ## The controls
 *
 * The board case that reads `unknown` is paired with the same copy over
 * a board that answers, which reads `ok`; the memoisation case counts
 * `gh` calls, where a reader asked per reference would make two; the
 * read-nothing case holds that the same copy read by `readRefsText`
 * WOULD change, so the unchanged bytes on disk are the row's doing.
 * The roster read from the checkout is paired with a checkout that is
 * not rafa and one whose roster failed, over the same copies, which
 * read the command and flag only the checkout's roster holds as
 * dangling.
 */
import type { DoctorRefsReading, DoctorRefsSeams } from './doctor-refs.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { DescribeDocument } from '../cli/describe.js';
import type { Output } from '../ports/index.js';
import type { CheckoutRosterRead } from './plan/refs-check.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { createGitRunner } from '../pr/git.js';
import { readRefsText } from '../refs/reading.js';
import { issueFingerprint, PRESENT, UNREADABLE, writeRefsBlock } from '../refs/stamp.js';
import { createRefVerifier } from '../refs/verify.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  issueCheckCommand,
  listedIssueReader,
  memoiseIssueReader,
  NO_BOARD_DETAIL,
  readDoctorRefs,
  renderDoctorRefs,
  roadmapRefsCells,
} from './doctor-refs.js';
import { checkoutRosterWarning } from './plan/refs-check.js';

import { CORE_REGISTRY } from './index.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-refs-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const ROSTER = describeRegistry(CORE_REGISTRY, '0.0.0-test');

/** `specs.dir` as the cases configure it. */
const SPECS = join('.rafa', 'specs');

/** Runs git in `cwd`, throwing on failure: the planting's own git. */
function plantGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** Writes `text` at `path` under `root`, making its directories. */
function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A fresh repository holding `src/a.ts`, committed. */
function plantRepository(name: string): string {
  const root = join(tempBase, name);
  mkdirSync(root, { recursive: true });
  plantGit(root, ['init', '--quiet', '--initial-branch=main']);
  plantGit(root, ['config', 'user.email', 'rafa@example.test']);
  plantGit(root, ['config', 'user.name', 'rafa test']);
  plant(root, 'src/a.ts', 'export const alphaValue = 1;\n');
  plantGit(root, ['add', '--all']);
  plantGit(root, ['commit', '--quiet', '--message', 'planted']);
  return root;
}

/** Writes a saved copy named `name` under `specs.dir` of `root`. */
function plantCopy(root: string, name: string, text: string): string {
  const path = join(SPECS, name);
  plant(root, path, text);
  return path;
}

/** An issue as the fake board holds it. */
interface FakeIssue {
  readonly title: string;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
}

/** A `gh` runner answering `gh issue view <n>` from `issues`, or failing every call with `failWith`. */
function fakeGh(issues: Readonly<Record<number, FakeIssue>>, failWith: string | null = null): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const run: GhRunner = async (args) => {
    calls.push(args.join(' '));
    if (failWith !== null) return { ok: false, stdout: '', stderr: failWith } satisfies GhResult;
    const issue = issues[Number(args[2])];
    if (issue === undefined) {
      return { ok: false, stdout: '', stderr: 'GraphQL: Could not resolve to an issue or pull request with the number.' };
    }
    return { ok: true, stdout: JSON.stringify(issue), stderr: '' };
  };
  return { run, calls: () => calls };
}

/** The seams every case reads with: git in the root, no `ts-symbols`, the core roster. */
const SEAMS: DoctorRefsSeams = {
  refsVerifier: (root, issues) => createRefVerifier({ issues, git: createGitRunner(root), outline: null, roster: ROSTER }),
};

/** Issue #7 as it was when the suspect copy was stamped. */
const OLD_SEVEN: FakeIssue = { title: 'Seven', body: '## Design\n\nThe old design.\n', state: 'OPEN' };

/** Issue #7 as the board holds it now: its Design section changed. */
const NEW_SEVEN: FakeIssue = { title: 'Seven', body: '## Design\n\nA new design.\n', state: 'OPEN' };

/** A copy of issue 2 stamped with #7 as it was, naming a file stamped present and not there now. */
function suspectCopy(): string {
  const stamp = issueFingerprint({ title: OLD_SEVEN.title, body: OLD_SEVEN.body, state: 'open' });
  return writeRefsBlock('Builds on #7 and adds `src/missing.ts`.\n', [
    { kind: 'issue', text: '#7', fingerprint: stamp },
    { kind: 'path', text: 'src/missing.ts', fingerprint: PRESENT },
  ]);
}

/** The ok reading of `copies`, or a failure. */
function okReading(reading: DoctorRefsReading): Extract<DoctorRefsReading, { ok: true }> {
  if (!reading.ok) throw new Error(`expected a reading, got: ${reading.detail}`);
  return reading;
}

describe('readDoctorRefs', () => {
  it('counts suspect and dangling references per saved copy and in total, skipping the notes file and previous/', async () => {
    const root = plantRepository('counts');
    plantCopy(root, 'rafa-1-clean-copy.md', 'Reads `src/a.ts`.\n');
    plantCopy(root, 'rafa-2-suspect-copy.md', suspectCopy());
    plantCopy(root, 'rafa-2-notes.md', 'Names `src/also-missing.ts`.\n');
    plantCopy(root, join('previous', 'rafa-3-old-copy.md'), 'Names `src/gone.ts`.\n');
    plantCopy(root, 'README.md', 'Names `src/gone.ts`.\n');
    const gh = fakeGh({ 7: NEW_SEVEN });

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: gh.run }, SEAMS));

    expect(reading.copies).toEqual([
      { issue: 1, path: join(SPECS, 'rafa-1-clean-copy.md'), suspect: 0, dangling: 0, unknown: 0, error: null },
      { issue: 2, path: join(SPECS, 'rafa-2-suspect-copy.md'), suspect: 1, dangling: 1, unknown: 0, error: null },
    ]);
    expect([reading.suspect, reading.dangling, reading.unknown]).toEqual([1, 1, 0]);
  });

  it('reads each issue once per run, across copies and across its two spellings', async () => {
    const root = plantRepository('memoised');
    plantCopy(root, 'rafa-1-first-copy.md', 'Builds on #7.\n');
    plantCopy(root, 'rafa-2-second-copy.md', 'Builds on #7 and rafa-7.\n');
    const gh = fakeGh({ 7: NEW_SEVEN });

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: gh.run }, SEAMS));

    expect(gh.calls()).toEqual(['issue view 7 --json title,body,state']);
    expect(reading.copies.map((copy) => copy.error)).toEqual([null, null]);
  });

  it('counts an issue an unreadable board cannot answer as unknown, asking gh once, where a board that answers reads ok', async () => {
    const root = plantRepository('board-down');
    plantCopy(root, 'rafa-1-board-copy.md', 'Builds on #7 and #8, and reads `src/a.ts`.\n');
    const down = fakeGh({}, 'HTTP 401: Bad credentials');
    const up = fakeGh({ 7: NEW_SEVEN, 8: NEW_SEVEN });

    const unread = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: down.run }, SEAMS));
    const read = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: up.run }, SEAMS));

    expect(unread.copies).toEqual([
      { issue: 1, path: join(SPECS, 'rafa-1-board-copy.md'), suspect: 0, dangling: 0, unknown: 2, error: null },
    ]);
    expect(down.calls()).toHaveLength(1);
    expect(read.copies[0]).toMatchObject({ suspect: 0, dangling: 0, unknown: 0, error: null });
    expect(up.calls()).toHaveLength(2);
  });

  it('reads every issue as unknown with no gh runner, spawning nothing', async () => {
    const root = plantRepository('no-board');
    plantCopy(root, 'rafa-1-plain-copy.md', 'Builds on #7.\n');

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS));

    expect(reading.copies[0]).toMatchObject({ unknown: 1, error: null });
  });

  it('writes nothing to a copy it read, where readRefsText would have stamped it', async () => {
    const root = plantRepository('read-only');
    const path = plantCopy(root, 'rafa-1-unstamped-copy.md', 'Reads `src/a.ts`.\n');
    const before = readFileSync(join(root, path), 'utf8');
    const verify = createRefVerifier({ issues: async () => ({ kind: 'missing' }), git: createGitRunner(root), outline: null, roster: ROSTER });

    await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS);

    expect(readFileSync(join(root, path), 'utf8')).toBe(before);
    expect((await readRefsText({ copy: before, issue: 1, verify })).changed).toBe(true);
  });

  it('fails one copy whose refs block will not read, and still counts the others', async () => {
    const root = plantRepository('broken-block');
    plantCopy(root, 'rafa-1-broken-copy.md', '<!-- rafa:refs\n: not yaml [\n-->\nReads `src/a.ts`.\n');
    plantCopy(root, 'rafa-2-fine-copy.md', writeRefsBlock('Names `src/missing.ts`.\n', [{ kind: 'path', text: 'src/missing.ts', fingerprint: PRESENT }]));

    const reading = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS));

    expect(reading.copies[0]?.error).toEqual(expect.any(String));
    expect(reading.copies[1]).toMatchObject({ issue: 2, dangling: 1, error: null });
    expect(reading.dangling).toBe(1);
  });

  it('holds no copy for a specs.dir that does not exist, and fails the row for one that is a file', async () => {
    const root = plantRepository('no-specs');
    plant(root, 'specs-file', 'not a directory\n');

    const missing = await readDoctorRefs({ root, specsDir: SPECS, gh: null }, SEAMS);
    const file = await readDoctorRefs({ root, specsDir: 'specs-file', gh: null }, SEAMS);

    expect(missing).toEqual({ ok: true, copies: [], suspect: 0, dangling: 0, unknown: 0 });
    expect(file.ok).toBe(false);
  });
});

describe('the roadmap\'s refs column', () => {
  it('reads only the copies of the issues named, and every copy with none named', async () => {
    const root = plantRepository('narrowed');
    plantCopy(root, 'rafa-1-on-roadmap.md', 'Reads `src/missing.ts`.\n');
    plantCopy(root, 'rafa-2-off-roadmap.md', 'Reads `src/gone.ts`.\n');
    const gh = fakeGh({});

    const narrowed = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: gh.run, issues: [1, 5] }, SEAMS));
    const whole = okReading(await readDoctorRefs({ root, specsDir: SPECS, gh: gh.run }, SEAMS));

    expect(narrowed.copies.map((copy) => copy.issue)).toEqual([1]);
    expect(whole.copies.map((copy) => copy.issue)).toEqual([1, 2]);
  });

  it('folds the copies into one cell per issue, summing two copies of one issue and keeping each failure', () => {
    const cells = roadmapRefsCells({
      ok: true,
      copies: [
        { issue: 1, path: 'a.md', suspect: 1, dangling: 0, unknown: 2, error: null },
        { issue: 1, path: 'b.md', suspect: 0, dangling: 3, unknown: 0, error: 'not YAML' },
        { issue: 4, path: 'c.md', suspect: 0, dangling: 0, unknown: 0, error: null },
      ],
      suspect: 1,
      dangling: 3,
      unknown: 2,
    });

    expect([...cells]).toEqual([
      [1, { copies: 2, suspect: 1, dangling: 3, unknown: 2, errors: ['b.md: not YAML'] }],
      [4, { copies: 1, suspect: 0, dangling: 0, unknown: 0, errors: [] }],
    ]);
  });

  it('throws the detail of a specs.dir that could not be listed', () => {
    expect(() => roadmapRefsCells({ ok: false, detail: 'EACCES: permission denied' })).toThrow('EACCES: permission denied');
  });
});

describe('memoiseIssueReader', () => {
  it('asks once per repository and number, and stops asking the board after it failed while other repositories are still asked', async () => {
    const asked: string[] = [];
    const reader = memoiseIssueReader(async (number, repo) => {
      asked.push(`${repo ?? 'board'}#${String(number)}`);
      return repo === undefined
        ? { kind: 'failed', detail: 'down' }
        : { kind: 'missing' };
    });

    await reader(7);
    await reader(8);
    await reader(7, 'owner/other');
    await reader(7, 'owner/other');

    expect(asked).toEqual(['board#7', 'owner/other#7']);
  });
});

describe('renderDoctorRefs', () => {
  it('prints nothing with no saved copy or a specs.dir that could not be listed', () => {
    expect(renderDoctorRefs({ ok: true, copies: [], suspect: 0, dangling: 0, unknown: 0 })).toEqual([]);
    expect(renderDoctorRefs({ ok: false, detail: 'ENOTDIR' })).toEqual([]);
  });

  it('prints one line for copies that all read', () => {
    const copy = { issue: 1, path: '.rafa/specs/rafa-1-a.md', suspect: 0, dangling: 0, unknown: 0, error: null };

    expect(renderDoctorRefs({ ok: true, copies: [copy], suspect: 0, dangling: 0, unknown: 0 }))
      .toEqual(['References: 1 saved copy, none suspect or dangling.']);
  });

  it('names rafa issue check <n> for each copy holding a suspect or dangling reference, and why unknown ones went unchecked', () => {
    const copies = [
      { issue: 1, path: '.rafa/specs/rafa-1-a.md', suspect: 0, dangling: 0, unknown: 0, error: null },
      { issue: 2, path: '.rafa/specs/rafa-2-b.md', suspect: 1, dangling: 2, unknown: 0, error: null },
      { issue: 3, path: '.rafa/specs/rafa-3-c.md', suspect: 0, dangling: 0, unknown: 1, error: null },
      { issue: 4, path: '.rafa/specs/rafa-4-d.md', suspect: 0, dangling: 0, unknown: 0, error: 'bad block' },
    ];

    expect(renderDoctorRefs({ ok: true, copies, suspect: 1, dangling: 2, unknown: 1 })).toEqual([
      'References: 1 suspect, 2 dangling, 1 unknown across 4 saved copies, 1 not read; run rafa issue check <n> to see each:',
      `  #2 .rafa/specs/rafa-2-b.md: 1 suspect, 2 dangling — ${issueCheckCommand(2)}`,
      '  #3 .rafa/specs/rafa-3-c.md: 1 unknown, not checked — the board or their repository could not be read',
      `  #4 .rafa/specs/rafa-4-d.md: its references could not be read (bad block) — ${issueCheckCommand(4)}`,
    ]);
  });

  it('counts unknown references on the clean line', () => {
    const copy = { issue: 1, path: '.rafa/specs/rafa-1-a.md', suspect: 0, dangling: 0, unknown: 2, error: null };

    expect(renderDoctorRefs({ ok: true, copies: [copy], suspect: 0, dangling: 0, unknown: 2 })[0])
      .toBe('References: 1 saved copy, none suspect or dangling (2 unknown).');
  });
});

describe('the no-board detail', () => {
  it('is what an issue reads as with no runner: unreadable, never a failure of the row', async () => {
    const root = plantRepository('detail');
    plantCopy(root, 'rafa-1-detail-copy.md', 'Builds on #9.\n');
    const seen: unknown[] = [];
    const seams: DoctorRefsSeams = {
      refsVerifier: (at, issues) => async () => {
        seen.push([at, await issues(9)]);
        return UNREADABLE;
      },
    };

    await readDoctorRefs({ root, specsDir: SPECS, gh: null }, seams);

    expect(seen).toEqual([[root, { kind: 'failed', detail: NO_BOARD_DETAIL }]]);
  });
});

describe('listedIssueReader', () => {
  const listed = [
    Object.freeze({
      number: 7, title: 'a spec', body: '## What you get', state: 'OPEN' as const, stateReason: null,
      labels: Object.freeze([]), type: 'spec' as const, module: 'unassigned',
    }),
    Object.freeze({
      number: 8, title: 'done', body: 'body', state: 'CLOSED' as const, stateReason: 'COMPLETED',
      labels: Object.freeze([]), type: 'code' as const, module: 'unassigned',
    }),
  ];
  /** A fallback reader recording what it was asked. */
  function fallback(asked: string[]): (number: number, repo?: string) => Promise<{ kind: 'missing' }> {
    return (number, repo) => {
      asked.push(`${repo ?? ''}#${String(number)}`);
      return Promise.resolve({ kind: 'missing' });
    };
  }

  it('answers a board issue the listing holds with its title, body and state, asking nothing else', async () => {
    const asked: string[] = [];
    const read = listedIssueReader(() => Promise.resolve(listed), fallback(asked));

    expect(await read(7)).toEqual({ kind: 'found', title: 'a spec', body: '## What you get', state: 'open' });
    expect(await read(8)).toEqual({ kind: 'found', title: 'done', body: 'body', state: 'closed' });
    expect(asked).toEqual([]);
  });

  it('reads with the fallback an issue the listing does not hold, and every other repository\'s', async () => {
    const asked: string[] = [];
    const read = listedIssueReader(() => Promise.resolve(listed), fallback(asked));
    await read(9);
    await read(7, 'owner/other');

    expect(asked).toEqual(['#9', 'owner/other#7']);
  });

  it('reads every issue with the fallback when the listing fails', async () => {
    const asked: string[] = [];
    const read = listedIssueReader(() => Promise.reject(new Error('offline')), fallback(asked));
    await read(7);

    expect(asked).toEqual(['#7']);
  });
});

/** A roster holding only `rafa widget spin --spin-fast`, which no core roster holds. */
const CHECKOUT_ROSTER: DescribeDocument = {
  schemaVersion: 2,
  binary: 'rafa',
  version: '9.9.9-planted',
  subjects: [{
    name: 'widget',
    summary: 'widgets',
    actions: [{
      name: 'spin',
      summary: 'spin a widget',
      description: '',
      args: [],
      flags: [{ name: 'spin-fast', description: '', type: 'boolean', required: false, default: null, aliases: [] }],
      examples: [],
      outputs: ['text'],
      aliases: [],
      deprecated: null,
      module: null,
      spends: null,
    }],
  }],
  commands: [],
};

/** An Output keeping the warning lines it is handed. */
function warnings(): { lines: string[]; output: Output } {
  const lines: string[] = [];
  return {
    lines,
    output: sinkOutput({
      warn: (message) => {
        lines.push(message);
      },
    }),
  };
}

/** The stamps of a copy that read `rafa widget spin --spin-fast` present: dangling against a roster without them. */
const WIDGET_STAMPS = [
  { kind: 'command', text: 'rafa widget spin', fingerprint: PRESENT },
  { kind: 'flag', text: '--spin-fast', fingerprint: PRESENT },
] as const;

/** The row read by the default verifier over two copies naming `rafa widget spin --spin-fast`, the checkout's roster answering `read`. */
async function readWithCheckoutRoster(name: string, read: CheckoutRosterRead): Promise<{ reading: Extract<DoctorRefsReading, { ok: true }>; warned: string[]; asked: number }> {
  const root = plantRepository(name);
  plantCopy(root, 'rafa-1-first-copy.md', writeRefsBlock('Adds `rafa widget spin --spin-fast`.\n', WIDGET_STAMPS));
  plantCopy(root, 'rafa-2-second-copy.md', writeRefsBlock('Reads `rafa widget spin --spin-fast` again.\n', WIDGET_STAMPS));
  const { lines, output } = warnings();
  let asked = 0;

  const reading = okReading(await readDoctorRefs(
    { root, specsDir: SPECS, gh: null, env: { PATH: '' }, output },
    {
      checkoutRoster: async () => {
        asked += 1;
        return read;
      },
    },
  ));
  return { reading, warned: lines, asked };
}

describe('the roster the row reads commands and flags against', () => {
  it('is the checkout\'s own when the root is rafa, read once for every copy, with no warning', async () => {
    const { reading, warned, asked } = await readWithCheckoutRoster('roster-read', { kind: 'read', roster: CHECKOUT_ROSTER });

    expect([reading.suspect, reading.dangling, reading.unknown]).toEqual([0, 0, 0]);
    expect(reading.copies.map((copy) => copy.error)).toEqual([null, null]);
    expect(asked).toBe(1);
    expect(warned).toEqual([]);
  });

  it('is the core roster for a root that is not rafa, with no warning', async () => {
    const { reading, warned } = await readWithCheckoutRoster('roster-not-rafa', { kind: 'not-rafa' });

    expect(reading.copies.map((copy) => copy.dangling)).toEqual([2, 2]);
    expect(warned).toEqual([]);
  });

  it('falls back to the core roster with one warning line for the run when the checkout\'s cannot be read', async () => {
    const detail = 'bun src/rafa.ts describe --output=json failed: boom';
    const { reading, warned, asked } = await readWithCheckoutRoster('roster-failed', { kind: 'failed', detail });

    expect(reading.copies.map((copy) => copy.dangling)).toEqual([2, 2]);
    expect(reading.copies.map((copy) => copy.error)).toEqual([null, null]);
    expect(asked).toBe(1);
    expect(warned).toEqual([checkoutRosterWarning(detail)]);
  });
});
