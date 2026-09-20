/**
 * Tests for the `claude` Planner adapter (`src/adapters/planner/claude.ts`).
 *
 * No case spawns `claude`. Each planner is made with a recording CAPTURING
 * spawner, which keeps the argument list and the prompt it is handed, notes
 * whether the plans directory was there when the session started, writes
 * the files a case names under the root as a session would, and answers the
 * exit code and the stdout the case names. Every root is a directory of its own under one
 * temporary directory this file creates and removes, and a case reads what
 * was left behind off the disk under that root. Every planner is made with
 * {@link PLAN_DIR} as its plans directory unless a case names another.
 *
 * Each rejection sits beside a control, a case where the same planner with
 * the one thing changed answers a plan: the failed session beside the
 * session writing the same plan and exiting 0, the session writing no plan
 * beside the one writing the prerequisites and the plan, the plan already
 * there beside a fresh root, and the missing spec beside the spec read. A
 * plan left in `.plans/`, the directory phase 0 wrote into, is neither
 * refused as already there nor read as the session's.
 *
 * ## The review
 *
 * The review cases drive one session per ANSWER the parser can give —
 * ready, not-ready, absent and malformed — and read what the planner
 * carried back. Each asserts the answer and `ready` beside it, because
 * `ready` is what the gate acts on and three of the four answers share
 * it; a planner that dropped the reading and put a fixed one in its
 * place would satisfy exactly one of the four. Each expected reading is
 * `parseSpecReview` over the same output, so these cases measure what
 * the planner CARRIES and never re-measure the parser, whose own cases
 * are in `src/board/spec-review.test.ts`.
 *
 * Two cases pin where the reading comes from. The prompt case hands the
 * planner a builder that quotes a READY block into the prompt while the
 * session answers a not-ready one, so a planner reading its own prompt
 * answers the opposite verdict. The already-there case holds `review`
 * null on the one rejection no session stands behind.
 *
 * No case asserts that the planner refuses a not-ready spec, because it
 * does not: the gate is `rafa plan`'s, which is what leaves
 * `--skip-review` somewhere to act.
 *
 * Six mutations of `claude.ts` were driven on 2026-09-19 over this file,
 * `src/adapters/registry.test.ts` and `src/ports/index.test.ts`, one at
 * a time, the module restored from a scratch copy and verified with
 * `shasum -c` after each. 108 pass and 0 fail either side, and each
 * count below is that run's own:
 *
 *   - the review dropped from the plan the planner answers: 10 fail.
 *   - the review dropped from the plan-not-written rejection: 1 fail,
 *     and dropped from the failed-session rejection: 1 fail. Each
 *     rejection carries it for its own reason, so each has its own
 *     case and neither stands in for the other.
 *   - the review read from the PROMPT rather than from the session's
 *     stdout: 7 fail. A planner that quoted its own prompt back would
 *     answer whatever the prompt illustrated.
 *   - a fixed ready reading in place of the parse, standing for a
 *     planner that judges nothing and passes everything: 12 fail.
 *   - the planner rejecting a spec its session judged not ready, the
 *     gate put here rather than in `rafa plan`: 15 fail.
 *
 * Thirteen mutations of `claude.ts` were driven on 2026-09-14 over this
 * file, `src/adapters/registry.test.ts` and `src/plan.test.ts`, one run
 * each, with 79 pass before and after, the module restored byte-identical
 * (sha256), and a PATH on which no `claude` resolves. The plans directory
 * was `.plans/` then. Every one reddened at least one case:
 *
 *   - The plan-already-there guard dropped reddened its rejection alone.
 *     The session's exit code unchecked, the failed session carrying exit
 *     1, and its rejection made a plain `Error` each reddened the
 *     failed-session case alone.
 *   - The written-plan check dropped, and `.plans/` itself read as the
 *     plan, each reddened the prerequisites-only case and the other-stub
 *     case. The prerequisites never answered reddened their case alone.
 *   - The spec resolved against the working directory reddened eight
 *     cases, and `.plans/` never made seven, the registry planner case
 *     among them both times. `.plans/` made ahead of the spec read
 *     reddened the missing-spec case alone.
 *   - The default sources in place of the ones handed over reddened the
 *     sources case and the registry planner case. A fixed stub handed to
 *     the builder reddened three cases, and the planner left unfrozen the
 *     frozen case.
 */
import type { ClaudePlannerOptions } from './claude.js';
import type { SpecReviewReading } from '../../board/spec-review.js';
import type { CapturingSpawner } from '../../utils/claude.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { MISSING_REVIEW_GAP, parseSpecReview } from '../../board/spec-review.js';

import { ClaudePlannerError, createClaudePlanner, planFilePath } from './claude.js';

/** The spec every root holds at `spec.md`. */
const SPEC = '# Spec: a planner probe\n\nNothing to build.\n';

/** The stub every request names unless a case names another. */
const STUB = 'probe';

/** The request every case makes unless it names another. */
const REQUEST = { specPath: 'spec.md', stub: STUB };

/** The plans directory every planner is made with unless a case names another: `plan.dir` by default. */
const PLAN_DIR = '.rafa/plans';

/** The plan a session writes for {@link STUB}. */
const PLAN = '.rafa/plans/PLAN-probe.md';

/** The prerequisites a session writes for {@link STUB}. */
const PREREQUISITES = '.rafa/plans/PREREQUISITES-probe.md';

/** The arguments ahead of the setting sources, as `claudeArgs` builds them. */
const BASE_ARGS = ['-p', '--dangerously-skip-permissions', '--setting-sources'];

/** A session output holding `body` as its review block, with prose either side. */
function outputWith(body: string): string {
  return `I read the spec before planning.\n\n\`\`\`rafa:spec-review\n${body}\n\`\`\`\n\n`
    + 'Then the plan follows.\n';
}

/** The output of a session that judged the spec ready. */
const READY_OUTPUT = outputWith('verdict: ready\ngaps: []');

/** The output of a session that judged the spec not ready, naming one gap. */
const NOT_READY_OUTPUT = outputWith(
  'verdict: not-ready\ngaps:\n  - heading: "Definition of done"\n    what: "no item names a command"',
);

/** The output of a session whose block is not valid YAML. */
const MALFORMED_OUTPUT = outputWith('verdict: ready\ngaps: [unclosed');

/** The reading a session that wrote nothing at all answers: `absent`. */
const ABSENT_REVIEW: SpecReviewReading = parseSpecReview('');

let tempDir = '';
let made = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-claude-planner-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A root of its own under this file's temporary directory, holding the spec. */
function freshRoot(): string {
  made += 1;
  const root = join(tempDir, `root-${made}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'spec.md'), SPEC, 'utf8');
  return root;
}

/** One session the recording spawner was asked for. */
interface SessionCall {
  readonly args: readonly string[];
  readonly prompt: string;
  /** Whether {@link PLAN_DIR} was under the root when the session started. */
  readonly plansDirExisted: boolean;
}

/** What a session does: the files it writes under the root, its stdout and its exit code. */
interface SessionScript {
  readonly writes?: readonly string[];
  readonly exitCode?: number;
  /** What the session writes to stdout; nothing at all by default. */
  readonly stdout?: string;
}

/** A spawner acting out `script` under `root`, and the calls it was handed. */
function recordingSession(
  root: string,
  { writes = [], exitCode = 0, stdout = '' }: SessionScript = {},
): { spawn: CapturingSpawner; calls: SessionCall[] } {
  const calls: SessionCall[] = [];
  const spawn: CapturingSpawner = async (args, prompt) => {
    calls.push({ args: [...args], prompt, plansDirExisted: existsSync(join(root, PLAN_DIR)) });
    for (const file of writes) writeFileSync(join(root, file), `written by the session: ${file}\n`, 'utf8');
    return { exitCode, stdout };
  };
  return { spawn, calls };
}

/** A prompt holding both things the planner hands its builder. */
function buildPrompt(specContent: string, stub: string): string {
  return `prompt for ${stub}\n${specContent}`;
}

/** A planner over `root`, made with `spawn`, {@link PLAN_DIR} and the default setting sources. */
function plannerOver(
  root: string,
  spawn: CapturingSpawner,
  overrides: Partial<ClaudePlannerOptions> = {},
): ReturnType<typeof createClaudePlanner> {
  return createClaudePlanner({
    repoRoot: root,
    planDir: PLAN_DIR,
    settingSources: ['project', 'local'],
    buildPrompt,
    spawn,
    ...overrides,
  });
}

/** What a promise rejected with, or null when it resolved. */
async function rejectionOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(() => null, (error: unknown) => error);
}

describe('planFilePath', () => {
  it('joins a file onto the plans directory with a slash', () => {
    expect(planFilePath('.rafa/plans', 'PLAN-x.md')).toBe('.rafa/plans/PLAN-x.md');
    expect(planFilePath('.plans', 'PREREQUISITES-x.md')).toBe('.plans/PREREQUISITES-x.md');
  });

  it('normalises a leading dot segment and a trailing slash, and keeps an absolute directory absolute', () => {
    expect(planFilePath('./.plans/', 'PLAN-x.md')).toBe('.plans/PLAN-x.md');
    expect(planFilePath('/abs/plans', 'PLAN-x.md')).toBe('/abs/plans/PLAN-x.md');
  });
});

describe('a claude planner generating a plan', () => {
  it('makes the plans directory before the session and answers the plan with no prerequisites', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN] });

    expect(existsSync(join(root, PLAN_DIR))).toBe(false);
    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(root.startsWith(tempDir)).toBe(true);
    expect(generated).toEqual({ planPath: PLAN, prerequisitesPath: null, review: ABSENT_REVIEW });
    expect(session.calls).toEqual([
      { args: [...BASE_ARGS, 'project,local'], prompt: `prompt for probe\n${SPEC}`, plansDirExisted: true },
    ]);
    expect(readdirSync(join(root, PLAN_DIR))).toEqual(['PLAN-probe.md']);
    expect(existsSync(join(root, '.plans'))).toBe(false);
  });

  it('answers the prerequisites when the session writes them beside the plan', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PREREQUISITES, PLAN] });

    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(generated).toEqual({ planPath: PLAN, prerequisitesPath: PREREQUISITES, review: ABSENT_REVIEW });
  });

  it('writes into the plans directory it is made with and answers the paths in it', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: ['plans-here/PLAN-probe.md'] });

    const generated = await plannerOver(root, session.spawn, { planDir: 'plans-here' }).create(REQUEST);

    expect(generated).toEqual({
      planPath: 'plans-here/PLAN-probe.md',
      prerequisitesPath: null,
      review: ABSENT_REVIEW,
    });
    expect(existsSync(join(root, PLAN_DIR))).toBe(false);
  });

  it('makes an absolute plans directory outside the root and answers the absolute paths', async () => {
    const root = freshRoot();
    const outside = join(tempDir, `plans-outside-${made}`);
    const plan = join(outside, 'PLAN-probe.md');
    const spawn: CapturingSpawner = async () => {
      writeFileSync(plan, 'the plan\n', 'utf8');
      return { exitCode: 0, stdout: '' };
    };

    const generated = await plannerOver(root, spawn, { planDir: outside }).create(REQUEST);

    expect(outside.startsWith(tempDir)).toBe(true);
    expect(generated).toEqual({ planPath: plan, prerequisitesPath: null, review: ABSENT_REVIEW });
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('hands the session the setting sources it is made with, in their order', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN] });

    await plannerOver(root, session.spawn, { settingSources: ['local', 'user'] }).create(REQUEST);

    expect(session.calls.map((call) => call.args)).toEqual([[...BASE_ARGS, 'local,user']]);
  });

  it('reads a spec path against its root, and an absolute one as it is', async () => {
    const nestedRoot = freshRoot();
    mkdirSync(join(nestedRoot, 'planner-probe-specs'));
    writeFileSync(join(nestedRoot, 'planner-probe-specs', 'nested.md'), 'the nested spec\n', 'utf8');
    const nested = recordingSession(nestedRoot, { writes: [PLAN] });
    const absoluteRoot = freshRoot();
    const outside = join(tempDir, `outside-${made}.md`);
    writeFileSync(outside, 'the outside spec\n', 'utf8');
    const absolute = recordingSession(absoluteRoot, { writes: [PLAN] });

    await plannerOver(nestedRoot, nested.spawn).create({ specPath: 'planner-probe-specs/nested.md', stub: STUB });
    await plannerOver(absoluteRoot, absolute.spawn).create({ specPath: outside, stub: STUB });

    expect(existsSync(join(process.cwd(), 'planner-probe-specs'))).toBe(false);
    expect(nested.calls.map((call) => call.prompt)).toEqual(['prompt for probe\nthe nested spec\n']);
    expect(absolute.calls.map((call) => call.prompt)).toEqual(['prompt for probe\nthe outside spec\n']);
  });

  it('is frozen', () => {
    const root = freshRoot();

    expect(Object.isFrozen(plannerOver(root, recordingSession(root).spawn))).toBe(true);
  });
});

describe('a claude planner rejecting', () => {
  it('rejects with the session exit code when the session fails, though it wrote the plan', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN], exitCode: 3 });

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(error).toBeInstanceOf(ClaudePlannerError);
    expect(error).toMatchObject({ message: 'Plan generation failed (exit 3).', exitCode: 3 });
    expect(session.calls).toHaveLength(1);
  });

  it('rejects with exit code 1 when the session exits 0 having written only the prerequisites', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PREREQUISITES] });

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(error).toBeInstanceOf(ClaudePlannerError);
    expect(error).toMatchObject({
      message: 'The session finished but .rafa/plans/PLAN-probe.md was not created — inspect the output above.',
      exitCode: 1,
    });
  });

  it('reads no plan of another stub as the one it was asked for', async () => {
    const root = freshRoot();
    mkdirSync(join(root, PLAN_DIR), { recursive: true });
    writeFileSync(join(root, PLAN_DIR, 'PLAN-other.md'), 'another plan\n', 'utf8');
    const session = recordingSession(root);

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(error).toMatchObject({ exitCode: 1 });
    expect((error as Error).message).toContain('.rafa/plans/PLAN-probe.md was not created');
  });

  it('neither refuses nor reads a plan of the same stub left in .plans when made with another directory', async () => {
    // Deliberate custom-directory fixture: plants `.plans/` to verify it is ignored when planner uses `.rafa/plans/`.
    const root = freshRoot();
    mkdirSync(join(root, '.plans'));
    writeFileSync(join(root, '.plans', 'PLAN-probe.md'), 'a phase 0 plan\n', 'utf8');
    const session = recordingSession(root);

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(session.calls).toHaveLength(1);
    expect(error).toMatchObject({ exitCode: 1 });
    expect((error as Error).message).toContain('.rafa/plans/PLAN-probe.md was not created');
  });

  it('rejects before any session when the plan is already there, leaving it as it was', async () => {
    const root = freshRoot();
    mkdirSync(join(root, PLAN_DIR), { recursive: true });
    writeFileSync(join(root, PLAN), 'an earlier plan\n', 'utf8');
    const session = recordingSession(root, { writes: [PLAN] });

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(error).toBeInstanceOf(ClaudePlannerError);
    expect(error).toMatchObject({ message: '.rafa/plans/PLAN-probe.md already exists', exitCode: 1 });
    expect(session.calls).toEqual([]);
    expect(readFileSync(join(root, PLAN), 'utf8')).toBe('an earlier plan\n');
  });

  it('rejects with the read error before any session when the spec is missing, making no directory', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN] });

    const error = await rejectionOf(
      plannerOver(root, session.spawn).create({ specPath: 'missing.md', stub: STUB }),
    );

    expect(error).not.toBeInstanceOf(ClaudePlannerError);
    expect((error as Error).message).toContain('ENOENT');
    expect(session.calls).toEqual([]);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });
});

describe('a claude planner reading its session review', () => {
  it('carries the ready reading on the plan when the session judged the spec ready', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN], stdout: READY_OUTPUT });

    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(generated.review).toEqual(parseSpecReview(READY_OUTPUT));
    expect(generated.review?.answer).toBe('ready');
    expect(generated.review?.ready).toBe(true);
    expect(generated.review?.gaps).toEqual([]);
  });

  it('carries the not-ready reading and its gaps on a plan the session wrote anyway', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN], stdout: NOT_READY_OUTPUT });

    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(generated.planPath).toBe(PLAN);
    expect(generated.review).toEqual(parseSpecReview(NOT_READY_OUTPUT));
    expect(generated.review?.answer).toBe('not-ready');
    expect(generated.review?.ready).toBe(false);
    expect(generated.review?.gaps).toEqual([
      { heading: 'Definition of done', what: 'no item names a command' },
    ]);
  });

  it('carries the absent reading when the session wrote no review block', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN], stdout: 'the plan is written.\n' });

    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(generated.review?.answer).toBe('absent');
    expect(generated.review?.ready).toBe(false);
    expect(generated.review?.gaps).toEqual([MISSING_REVIEW_GAP]);
  });

  it('carries the malformed reading when the block is no readable YAML', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN], stdout: MALFORMED_OUTPUT });

    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(generated.review?.answer).toBe('malformed');
    expect(generated.review?.ready).toBe(false);
    expect(generated.review?.gaps).toEqual([MISSING_REVIEW_GAP]);
  });

  it('reads the review out of the session stdout and never out of the prompt it was handed', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN], stdout: NOT_READY_OUTPUT });
    const quotedPrompt = (specContent: string, stub: string): string => (
      `${stub}: ${specContent}\n${READY_OUTPUT}`
    );

    const generated = await plannerOver(root, session.spawn, { buildPrompt: quotedPrompt })
      .create(REQUEST);

    expect(session.calls[0]?.prompt).toContain('verdict: ready');
    expect(generated.review?.answer).toBe('not-ready');
  });

  it('carries the not-ready reading on the rejection when the session wrote no plan', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { stdout: NOT_READY_OUTPUT });

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(error).toBeInstanceOf(ClaudePlannerError);
    expect((error as ClaudePlannerError).exitCode).toBe(1);
    expect((error as ClaudePlannerError).review).toEqual(parseSpecReview(NOT_READY_OUTPUT));
  });

  it('carries the reading on the rejection when the session failed', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN], exitCode: 3, stdout: NOT_READY_OUTPUT });

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect((error as ClaudePlannerError).exitCode).toBe(3);
    expect((error as ClaudePlannerError).review).toEqual(parseSpecReview(NOT_READY_OUTPUT));
  });

  it('carries no reading on a rejection raised before any session ran', async () => {
    const root = freshRoot();
    mkdirSync(join(root, PLAN_DIR), { recursive: true });
    writeFileSync(join(root, PLAN), 'an earlier plan\n', 'utf8');
    const session = recordingSession(root, { writes: [PLAN], stdout: READY_OUTPUT });

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(session.calls).toEqual([]);
    expect((error as ClaudePlannerError).review).toBeNull();
  });
});
