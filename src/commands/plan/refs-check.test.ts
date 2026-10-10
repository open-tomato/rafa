/**
 * Tests for check 4 in its place on `rafa plan create`
 * (`src/commands/plan/refs-check.ts`): which runs the start-of-run pass
 * line is printed on, which specs the check covers, the acceptance read
 * off the line and the config, and the verifier the command builds.
 *
 * What each reference state does to a run is `src/board/refs-gate.ts`'s
 * and held in `src/board/refs-gate.test.ts`; the cases here drive one
 * dangling reference through it, as the thing that tells a check that
 * ran from one that did not. The targets are read through a fake
 * verifier and the copies are files under the temp directory, so what
 * an acceptance writes is read off disk.
 *
 * The roster commands and flags are read against is read over
 * repositories planted under the temp directory, each a git repository
 * whose `package.json` and tracked `src/rafa.ts` make it a rafa
 * checkout or not; the planted entry writes a roster of its own, holding
 * a `widget spin` command and a `--spin-fast` flag no core roster
 * holds, or fails, or writes the wrong shape, and records the words it
 * was run with. One case reads this repository's own roster.
 *
 * The copy's path is handed as the resolution answers it, relative to
 * the project root, and the suite runs with another working directory,
 * so a refusal naming the dangling path is also the reading that the
 * path was resolved against the root and not the working directory.
 *
 * ## The controls
 *
 * Every line the pass line is NOT printed on is paired with the setting
 * on and a board route, where it is; the `--spec` spec that answers null
 * is paired with the issue spec over the same copy that refuses, and
 * counts the verifiers made, so a check that ran and found nothing
 * cannot pass for one that never ran.
 *
 * A checkout's roster read is told from the core roster by a pair, read
 * by the same verifier: `rafa widget spin` present and `rafa plan
 * create` absent is the checkout's; the reverse is the core's. Each root
 * that is not rafa is paired with the rafa checkout holding the same
 * entry, and the entry's record of being run is read absent, so a root
 * read as not rafa is one whose `describe` never ran.
 *
 * The core roster is handed in, as the module takes it:
 * `registryRoster` over `CORE_REGISTRY`, which this file imports and
 * the module does not. What a mounted module adds to a roster built
 * that way is read by a pair too, the same flag through a verifier
 * over the registry with the module mounted and one over it without.
 */
import type { ResolvedSpec } from '../../board/spec-source.js';
import type { RafaCommand } from '../../cli/command.js';
import type { DescribeDocument, DescribedAction } from '../../cli/describe.js';
import type { Output } from '../../ports/index.js';
import type { RefVerifier } from '../../refs/verify.js';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { version } from '../../../package.json';
import { BOARD_REFUSAL_EXIT } from '../../board/exit-codes.js';
import { acceptStaleRefsPassLine } from '../../board/refs-gate.js';
import { CommandExit } from '../../cli/command.js';
import { describeRegistry } from '../../cli/describe.js';
import { ABSENT, PRESENT, readRefsBlock, writeRefsBlock } from '../../refs/stamp.js';
import { sinkOutput } from '../../tests/output-sinks.js';
import { CORE_REGISTRY } from '../index.js';

import {
  announceCreateRefs,
  checkCreateRefs,
  checkoutRosterWarning,
  createPlanRefsVerifier,
  planRoster,
  RAFA_PACKAGE_NAME,
  readCheckoutRoster,
  registryRoster,
} from './refs-check.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-check-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The core roster every case hands in: the one a line routed through `CORE_REGISTRY` builds. */
const CORE_ROSTER = registryRoster(CORE_REGISTRY);

/** A saved copy naming one file on line 5, stamped present, which the fake verifier reads as gone. */
const COPY = writeRefsBlock(
  ['# Spec', '', '## Scope', '', 'Touches `src/gone.ts`.', ''].join('\n'),
  [{ kind: 'path', text: 'src/gone.ts', fingerprint: PRESENT }],
);

/** The lines a run wrote, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** An Output keeping the lines it is handed. */
function capture(): { lines: Lines; output: Output } {
  const lines: Lines = { info: [], warn: [] };
  return {
    lines,
    output: sinkOutput({
      info: (message) => {
        lines.info.push(message);
      },
      warn: (message) => {
        lines.warn.push(message);
      },
    }),
  };
}

let planted = 0;

/** A project root holding {@link COPY} at `.rafa/specs/rafa-20-spec.md`, and the spec a board route answers for it. */
function plantIssueSpec(): { root: string; spec: ResolvedSpec; copyPath: string } {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  mkdirSync(join(root, '.rafa', 'specs'), { recursive: true });
  const relative = join('.rafa', 'specs', 'rafa-20-spec.md');
  writeFileSync(join(root, relative), COPY);
  const spec: ResolvedSpec = { path: relative, kind: 'issue', source: 'issue #20', issue: 20, read: null, snapshot: null };
  return { root, spec, copyPath: join(root, relative) };
}

/** A verifier factory reading `src/gone.ts` as absent and anything else present, counting the verifiers made. */
function fakeVerifiers(): { make: (root: string) => RefVerifier; made: string[] } {
  const made: string[] = [];
  const make = (root: string): RefVerifier => {
    made.push(root);
    return (ref) => Promise.resolve(ref.text === 'src/gone.ts'
      ? ABSENT
      : PRESENT);
  };
  return { make, made };
}

/** The refusal `run` ends with, or a failure when it ends with none. */
async function refusal(run: Promise<unknown>): Promise<CommandExit> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected check 4 to refuse');
}

describe('the dangerous.acceptStaleRefs pass line at the start of a plan create run', () => {
  it('is printed once, at warn, on --issue and on --next with the setting on', () => {
    for (const args of [['--issue=20'], ['--next'], ['--next=31', '--no-progress']]) {
      const { lines, output } = capture();

      announceCreateRefs(args, true, output);

      expect(lines).toEqual({ info: [], warn: [acceptStaleRefsPassLine()] });
    }
  });

  it('is not printed with the setting off', () => {
    const { lines, output } = capture();

    announceCreateRefs(['--issue=20'], false, output);

    expect(lines).toEqual({ info: [], warn: [] });
  });

  it('is not printed on --spec or under --dry-run, which check 4 does not cover', () => {
    for (const args of [['--spec=spec.md'], ['--issue=20', '--dry-run'], ['--next', '--dry-run']]) {
      const { lines, output } = capture();

      announceCreateRefs(args, true, output);

      expect(lines).toEqual({ info: [], warn: [] });
    }
  });

  it('refuses a line naming two sources as the resolution would, before printing anything', () => {
    const { lines, output } = capture();

    let thrown: unknown = null;
    try {
      announceCreateRefs(['--spec=spec.md', '--issue=20'], true, output);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(1);
    expect(lines.warn).toEqual([]);
  });
});

describe('check 4 over the spec a plan create run resolved', () => {
  it('answers null for a --spec spec and makes no verifier', async () => {
    const { root, copyPath } = plantIssueSpec();
    const verifiers = fakeVerifiers();
    const spec: ResolvedSpec = { path: copyPath, kind: 'spec', source: copyPath, issue: null, read: null, snapshot: null };

    const answer = await checkCreateRefs({ spec, repoRoot: root, args: ['--spec=x.md'], acceptStaleRefs: false, roster: CORE_ROSTER }, { verifier: verifiers.make });

    expect(answer).toBeNull();
    expect(verifiers.made).toEqual([]);
    expect(readFileSync(copyPath, 'utf8')).toBe(COPY);
  });

  it('refuses the same copy on an issue spec, exit 2, naming the dangling path and its line, and writes nothing', async () => {
    const { root, spec, copyPath } = plantIssueSpec();
    const verifiers = fakeVerifiers();
    const { output } = capture();

    const thrown = await refusal(checkCreateRefs(
      { spec, repoRoot: root, args: ['--issue=20'], acceptStaleRefs: false, roster: CORE_ROSTER, output },
      { verifier: verifiers.make },
    ));

    expect(thrown.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(thrown.message).toContain('issue #20 names references');
    expect(thrown.message).toContain('• dangling src/gone.ts (line 5)');
    expect(thrown.message).toContain('--accept-refs');
    expect(verifiers.made).toEqual([root]);
    expect(readFileSync(copyPath, 'utf8')).toBe(COPY);
  });

  it('re-stamps the copy under --accept-refs and goes on, naming the flag', async () => {
    const { root, spec, copyPath } = plantIssueSpec();
    const { lines, output } = capture();

    const answer = await checkCreateRefs(
      { spec, repoRoot: root, args: ['--issue=20', '--accept-refs'], acceptStaleRefs: false, roster: CORE_ROSTER, output },
      { verifier: fakeVerifiers().make },
    );

    expect(answer?.restamped).toBe(true);
    expect(answer?.accepted.map((row) => row.text)).toEqual(['src/gone.ts']);
    expect(readRefsBlock(readFileSync(copyPath, 'utf8')).stamps).toEqual([
      { kind: 'path', text: 'src/gone.ts', fingerprint: ABSENT },
    ]);
    expect(lines.info[0]).toBe('🔖 --accept-refs: re-stamped 1 reference of issue #20 as reviewed.');
  });

  it('re-stamps the copy with dangerous.acceptStaleRefs on and no flag, naming the setting', async () => {
    const { root, spec, copyPath } = plantIssueSpec();
    const { lines, output } = capture();

    const answer = await checkCreateRefs(
      { spec, repoRoot: root, args: ['--issue=20'], acceptStaleRefs: true, roster: CORE_ROSTER, output },
      { verifier: fakeVerifiers().make },
    );

    expect(answer?.restamped).toBe(true);
    expect(readRefsBlock(readFileSync(copyPath, 'utf8')).stamps).toHaveLength(1);
    expect(lines.info[0]).toBe('🔖 dangerous.acceptStaleRefs: re-stamped 1 reference of issue #20 as reviewed.');
  });
});

describe('the roster handed in is what a spec\'s command reference is read against', () => {
  /** A saved copy naming `rafa plan create` on line 5, stamped present: unstale against {@link CORE_ROSTER}. */
  const COMMAND_COPY = writeRefsBlock(
    ['# Spec', '', '## Scope', '', 'Runs `rafa plan create`.', ''].join('\n'),
    [{ kind: 'command', text: 'rafa plan create', fingerprint: PRESENT }],
  );

  /** The core roster with every `plan` subject dropped, so `rafa plan create` reads absent against it. */
  const NO_PLAN_ROSTER: DescribeDocument = {
    ...CORE_ROSTER,
    subjects: CORE_ROSTER.subjects.filter((subject) => subject.name !== 'plan'),
  };

  /** A project root holding {@link COMMAND_COPY}, and the spec a board route answers for it. */
  function plantCommandSpec(): { root: string; spec: ResolvedSpec; copyPath: string } {
    planted += 1;
    const root = join(tempBase, `project-${String(planted)}`);
    mkdirSync(join(root, '.rafa', 'specs'), { recursive: true });
    const relative = join('.rafa', 'specs', 'rafa-21-spec.md');
    writeFileSync(join(root, relative), COMMAND_COPY);
    const spec: ResolvedSpec = { path: relative, kind: 'issue', source: 'issue #21', issue: 21, read: null, snapshot: null };
    return { root, spec, copyPath: join(root, relative) };
  }

  it('passes a command reference the roster handed in still holds, with no verifier seam given', async () => {
    const { root, spec, copyPath } = plantCommandSpec();

    const answer = await checkCreateRefs({ spec, repoRoot: root, args: ['--issue=21'], acceptStaleRefs: false, roster: CORE_ROSTER });

    expect(answer).toEqual({ rows: expect.any(Array), accepted: [], restamped: false });
    expect(readFileSync(copyPath, 'utf8')).toBe(COMMAND_COPY);
  });

  it('refuses the same reference as dangling when the roster handed in no longer names the command', async () => {
    const { root, spec, copyPath } = plantCommandSpec();

    const thrown = await refusal(checkCreateRefs({
      spec,
      repoRoot: root,
      args: ['--issue=21'],
      acceptStaleRefs: false,
      roster: NO_PLAN_ROSTER,
    }));

    expect(thrown.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(thrown.message).toContain('issue #21 names references');
    expect(thrown.message).toContain('• dangling rafa plan create (line 5)');
    expect(readFileSync(copyPath, 'utf8')).toBe(COMMAND_COPY);
  });
});

describe('planRoster answers the roster a spec\'s references are read against', () => {
  it('answers the roster handed in, unchanged, for a root that is not rafa', async () => {
    const root = plantCheckout({ name: 'some-other-project' });

    expect(await planRoster(root, CORE_ROSTER)).toEqual(CORE_ROSTER);
    expect(calledWith(root)).toBeNull();
  });

  it('answers the checkout\'s own roster, not the one handed in, when the root is rafa', async () => {
    const root = plantCheckout();

    expect(await planRoster(root, CORE_ROSTER)).toEqual(CHECKOUT_ROSTER);
  });

  it('falls back to the roster handed in, with one warning line, when the checkout\'s own could not be read', async () => {
    const root = plantCheckout({ entry: 'console.error(\'boom: the entry is broken\');\nprocess.exit(3);\n' });
    const { lines, output } = capture();

    expect(await planRoster(root, CORE_ROSTER, { output })).toEqual(CORE_ROSTER);
    expect(lines.warn).toEqual([
      checkoutRosterWarning('bun src/rafa.ts describe --output=json failed: boom: the entry is broken'),
    ]);
  });
});

describe('the verifier plan create reads references with', () => {
  it('reads commands against the core roster, and keys against the settings', async () => {
    const verify = createPlanRefsVerifier(tempBase, CORE_ROSTER);

    expect(await verify({ kind: 'command', text: 'rafa plan create' })).toEqual(PRESENT);
    expect(await verify({ kind: 'command', text: 'rafa plan nonesuch' })).toEqual(ABSENT);
    expect(await verify({ kind: 'flag', text: '--accept-refs' })).toEqual(PRESENT);
    expect(await verify({ kind: 'key', text: 'dangerous.acceptStaleRefs' })).toEqual(PRESENT);
    expect(await verify({ kind: 'key', text: 'dangerous.nonesuch' })).toEqual(ABSENT);
  });
});

/** This repository's root: a rafa checkout. */
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** A command described with no argument and `flags` as boolean flags. */
function rosterAction(name: string, flags: readonly string[]): DescribedAction {
  return {
    name,
    summary: `${name} things`,
    description: '',
    args: [],
    flags: flags.map((flag) => ({ name: flag, description: '', type: 'boolean', required: false, default: null, aliases: [] })),
    examples: [],
    outputs: ['text'],
    aliases: [],
    deprecated: null,
    module: null,
    spends: null,
  };
}

/** The roster the planted checkouts' `describe` writes: one subject no core roster holds. */
const CHECKOUT_ROSTER: DescribeDocument = {
  schemaVersion: 2,
  binary: 'rafa',
  version: '9.9.9-planted',
  subjects: [{ name: 'widget', summary: 'widgets', actions: [rosterAction('spin', ['spin-fast'])] }],
  commands: [],
};

/** Where a planted entry records the words it was run with, relative to its root. */
const CALLED = 'called.txt';

/** An entry recording its words, then writing `events` as json lines to stdout and exiting 0. */
function writingEntry(events: readonly unknown[]): string {
  return [
    `await Bun.write('${CALLED}', process.argv.slice(2).join(' '));`,
    ...events.map((event) => `console.log(${JSON.stringify(JSON.stringify(event))});`),
    '',
  ].join('\n');
}

/** The entry of a checkout whose `describe` answers {@link CHECKOUT_ROSTER} as rafa does in json mode. */
const ROSTER_ENTRY = writingEntry([
  { type: 'start', command: 'describe', ts: '2026-10-05T00:00:00.000Z' },
  { type: 'result', ok: true, data: CHECKOUT_ROSTER },
]);

/** Runs git in `cwd`, throwing on failure: the planting's own git. */
function plantGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

/** Writes `text` at `file` under `root`, making its directories. */
function plantFile(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** What {@link plantCheckout} plants. */
interface CheckoutPlanting {
  /** The `name` of its `package.json`. */
  readonly name?: string;
  /** Its `src/rafa.ts`. */
  readonly entry?: string;
  /** False to leave `src/rafa.ts` untracked. */
  readonly tracked?: boolean;
}

/** A fresh repository holding a `package.json` and a `src/rafa.ts`, committed as the planting asks. */
function plantCheckout(planting: CheckoutPlanting = {}): string {
  planted += 1;
  const root = join(tempBase, `checkout-${String(planted)}`);
  mkdirSync(root, { recursive: true });
  plantGit(root, ['init', '--quiet', '--initial-branch=main']);
  plantGit(root, ['config', 'user.email', 'rafa@example.test']);
  plantGit(root, ['config', 'user.name', 'rafa test']);
  plantFile(root, 'package.json', `${JSON.stringify({ name: planting.name ?? RAFA_PACKAGE_NAME, version: '9.9.9' })}\n`);
  plantFile(root, 'src/rafa.ts', planting.entry ?? ROSTER_ENTRY);
  plantGit(root, ['add', 'package.json']);
  if (planting.tracked !== false) plantGit(root, ['add', 'src/rafa.ts']);
  plantGit(root, ['commit', '--quiet', '--no-verify', '--message', 'planted']);
  return root;
}

/** The words the planted entry under `root` was run with, or null when it never ran. */
function calledWith(root: string): string | null {
  const file = join(root, CALLED);
  return existsSync(file)
    ? readFileSync(file, 'utf8')
    : null;
}

/** Which of the pair `rafa widget spin` (the checkout's) and `rafa plan create` (the core's) `verify` reads present. */
async function rosterPair(verify: RefVerifier): Promise<{ checkout: boolean; core: boolean }> {
  const checkout = await verify({ kind: 'command', text: 'rafa widget spin' });
  const core = await verify({ kind: 'command', text: 'rafa plan create' });
  return { checkout: checkout === PRESENT, core: core === PRESENT };
}

describe('readCheckoutRoster', () => {
  it('runs the checkout\'s own describe in json mode and answers the result event\'s roster', async () => {
    const root = plantCheckout();

    const read = await readCheckoutRoster(root);

    expect(read).toEqual({ kind: 'read', roster: CHECKOUT_ROSTER });
    expect(calledWith(root)).toBe('describe --output=json');
  });

  it('answers not-rafa for a package named otherwise, running nothing', async () => {
    const root = plantCheckout({ name: 'some-other-project' });

    expect(await readCheckoutRoster(root)).toEqual({ kind: 'not-rafa' });
    expect(calledWith(root)).toBeNull();
  });

  it('answers not-rafa when src/rafa.ts is there but untracked, and for a root with no package.json', async () => {
    const untracked = plantCheckout({ tracked: false });

    expect(await readCheckoutRoster(untracked)).toEqual({ kind: 'not-rafa' });
    expect(calledWith(untracked)).toBeNull();
    expect(await readCheckoutRoster(tempBase)).toEqual({ kind: 'not-rafa' });
  });

  it('fails with the first line the entry wrote to stderr when describe exits non-zero', async () => {
    const root = plantCheckout({ entry: 'console.error(\'boom: the entry is broken\\nsecond line\');\nprocess.exit(3);\n' });

    expect(await readCheckoutRoster(root)).toEqual({
      kind: 'failed',
      detail: 'bun src/rafa.ts describe --output=json failed: boom: the entry is broken',
    });
  });

  it('fails when the result is no schema 2 roster the verifier can read, or there is no result at all', async () => {
    const noAliases = Object.fromEntries(Object.entries(rosterAction('spin', [])).filter(([key]) => key !== 'aliases'));
    const shapes = [
      [{ type: 'result', ok: true, data: { ...CHECKOUT_ROSTER, schemaVersion: 1 } }],
      [{ type: 'result', ok: true, data: { ...CHECKOUT_ROSTER, subjects: [{ name: 'widget', summary: '', actions: [noAliases] }] } }],
      [{ type: 'result', ok: false, error: { message: 'no' } }],
      [{ type: 'start', command: 'describe' }],
    ];
    for (const events of shapes) {
      const root = plantCheckout({ entry: writingEntry(events) });

      expect(await readCheckoutRoster(root)).toEqual({
        kind: 'failed',
        detail: 'bun src/rafa.ts describe --output=json wrote no schema 2 roster',
      });
      expect(calledWith(root)).toBe('describe --output=json');
    }
  });

  it('reads this repository\'s own roster, holding every subject the core roster does', async () => {
    const read = await readCheckoutRoster(REPO_ROOT);

    if (read.kind !== 'read') throw new Error(`expected this checkout's roster, got ${JSON.stringify(read)}`);
    expect(read.roster.subjects.map((subject) => subject.name)).toEqual(CORE_ROSTER.subjects.map((subject) => subject.name));
    expect(read.roster.version).toBe(CORE_ROSTER.version);
  });
});

describe('the roster plan create reads commands and flags against', () => {
  it('is the checkout\'s own when the root is rafa, with no warning', async () => {
    const root = plantCheckout();
    const { lines, output } = capture();
    const verify = createPlanRefsVerifier(root, CORE_ROSTER, { output });

    expect(await rosterPair(verify)).toEqual({ checkout: true, core: false });
    expect(await verify({ kind: 'flag', text: '--spin-fast' })).toEqual(PRESENT);
    expect(await verify({ kind: 'flag', text: '--accept-refs' })).toEqual(ABSENT);
    expect(lines).toEqual({ info: [], warn: [] });
  });

  it('is the core roster for a root that is not rafa, with no warning and no describe run', async () => {
    const root = plantCheckout({ name: 'some-other-project' });
    const { lines, output } = capture();
    const verify = createPlanRefsVerifier(root, CORE_ROSTER, { output });

    expect(await rosterPair(verify)).toEqual({ checkout: false, core: true });
    expect(await verify({ kind: 'flag', text: '--accept-refs' })).toEqual(PRESENT);
    expect(calledWith(root)).toBeNull();
    expect(lines).toEqual({ info: [], warn: [] });
  });

  it('falls back to the core roster with one warning line naming why, however many references are read', async () => {
    const root = plantCheckout({ entry: 'console.error(\'boom: the entry is broken\');\nprocess.exit(3);\n' });
    const { lines, output } = capture();
    const verify = createPlanRefsVerifier(root, CORE_ROSTER, { output });

    expect(await rosterPair(verify)).toEqual({ checkout: false, core: true });
    expect(await verify({ kind: 'flag', text: '--accept-refs' })).toEqual(PRESENT);
    expect(lines).toEqual({
      info: [],
      warn: [checkoutRosterWarning('bun src/rafa.ts describe --output=json failed: boom: the entry is broken')],
    });
  });

  it('reads through the checkoutRoster seam, a rejection falling back as a failure does', async () => {
    const read = capture();
    const fromSeam = createPlanRefsVerifier(tempBase, CORE_ROSTER, {
      checkoutRoster: async () => ({ kind: 'read', roster: CHECKOUT_ROSTER }),
      output: read.output,
    });
    const rejected = capture();
    const fromRejection = createPlanRefsVerifier(tempBase, CORE_ROSTER, {
      checkoutRoster: () => Promise.reject(new Error('the seam broke')),
      output: rejected.output,
    });

    expect(await rosterPair(fromSeam)).toEqual({ checkout: true, core: false });
    expect(read.lines.warn).toEqual([]);
    expect(await rosterPair(fromRejection)).toEqual({ checkout: false, core: true });
    expect(rejected.lines.warn).toEqual([checkoutRosterWarning('the seam broke')]);
  });
});

/** A module's action declaring `--hub-only`, a flag no core command declares. */
const HUB_PUSH: RafaCommand = {
  name: 'hub push',
  subject: 'hub',
  action: 'push',
  summary: 'push to the hub',
  description: 'Pushes.',
  args: [],
  flags: [{ name: 'hub-only', description: 'only the hub has it', type: 'boolean' }],
  examples: [],
  outputs: ['text'],
  run: () => Promise.resolve(),
};

describe('registryRoster', () => {
  it('is describeRegistry over the registry handed in, stamped with this package\'s version', () => {
    expect(registryRoster(CORE_REGISTRY)).toEqual(describeRegistry(CORE_REGISTRY, version));
    expect(CORE_ROSTER.version).toBe(version);
  });

  it('holds a mounted module\'s actions, so a flag only the module declares reads present where the core registry\'s reads it absent', async () => {
    const mounted = registryRoster(CORE_REGISTRY.mount({ name: 'hub', entry: '/modules/hub/commands.ts', commands: [HUB_PUSH] }));
    const moduleActions = (roster: DescribeDocument): string[] => roster.subjects
      .filter((subject) => subject.name === 'module')
      .flatMap((subject) => subject.actions.map((action) => action.name));
    const overMounted = createPlanRefsVerifier(tempBase, mounted);
    const overCore = createPlanRefsVerifier(tempBase, CORE_ROSTER);

    expect(moduleActions(CORE_ROSTER)).toEqual(['list', 'exec']);
    expect(moduleActions(mounted)).toEqual(['list', 'exec', 'exec hub push']);
    expect(await overMounted({ kind: 'flag', text: '--hub-only' })).toEqual(PRESENT);
    expect(await overCore({ kind: 'flag', text: '--hub-only' })).toEqual(ABSENT);
    expect(await overMounted({ kind: 'command', text: 'rafa module exec' })).toEqual(PRESENT);
    expect(await overCore({ kind: 'command', text: 'rafa module exec' })).toEqual(PRESENT);
  });
});
