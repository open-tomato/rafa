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
 */
import type { ResolvedSpec } from '../../board/spec-source.js';
import type { Output } from '../../ports/index.js';
import type { RefVerifier } from '../../refs/verify.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_REFUSAL_EXIT } from '../../board/plan-spec.js';
import { acceptStaleRefsPassLine } from '../../board/refs-gate.js';
import { CommandExit } from '../../cli/command.js';
import { ABSENT, PRESENT, readRefsBlock } from '../../refs/stamp.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import { announceCreateRefs, checkCreateRefs, createPlanRefsVerifier } from './refs-check.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-check-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A saved copy naming one file on line 5, which the fake verifier reads as gone. */
const COPY = ['# Spec', '', '## Scope', '', 'Touches `src/gone.ts`.', ''].join('\n');

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

    const answer = await checkCreateRefs({ spec, repoRoot: root, args: ['--spec=x.md'], acceptStaleRefs: false }, { verifier: verifiers.make });

    expect(answer).toBeNull();
    expect(verifiers.made).toEqual([]);
    expect(readFileSync(copyPath, 'utf8')).toBe(COPY);
  });

  it('refuses the same copy on an issue spec, exit 2, naming the dangling path and its line, and writes nothing', async () => {
    const { root, spec, copyPath } = plantIssueSpec();
    const verifiers = fakeVerifiers();
    const { output } = capture();

    const thrown = await refusal(checkCreateRefs(
      { spec, repoRoot: root, args: ['--issue=20'], acceptStaleRefs: false, output },
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
      { spec, repoRoot: root, args: ['--issue=20', '--accept-refs'], acceptStaleRefs: false, output },
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
      { spec, repoRoot: root, args: ['--issue=20'], acceptStaleRefs: true, output },
      { verifier: fakeVerifiers().make },
    );

    expect(answer?.restamped).toBe(true);
    expect(readRefsBlock(readFileSync(copyPath, 'utf8')).stamps).toHaveLength(1);
    expect(lines.info[0]).toBe('🔖 dangerous.acceptStaleRefs: re-stamped 1 reference of issue #20 as reviewed.');
  });
});

describe('the verifier plan create reads references with', () => {
  it('reads commands against the core roster, and keys against the settings', async () => {
    const verify = createPlanRefsVerifier(tempBase);

    expect(await verify({ kind: 'command', text: 'rafa plan create' })).toEqual(PRESENT);
    expect(await verify({ kind: 'command', text: 'rafa plan nonesuch' })).toEqual(ABSENT);
    expect(await verify({ kind: 'flag', text: '--accept-refs' })).toEqual(PRESENT);
    expect(await verify({ kind: 'key', text: 'dangerous.acceptStaleRefs' })).toEqual(PRESENT);
    expect(await verify({ kind: 'key', text: 'dangerous.nonesuch' })).toEqual(ABSENT);
  });
});
