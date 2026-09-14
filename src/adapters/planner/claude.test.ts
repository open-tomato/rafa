/**
 * Tests for the `claude` Planner adapter (`src/adapters/planner/claude.ts`).
 *
 * No case spawns `claude`. Each planner is made with a recording spawner,
 * which keeps the argument list and the prompt it is handed, notes whether
 * `.plans/` was there when the session started, writes the files a case
 * names under the root as a session would, and answers the exit code the
 * case names. Every root is a directory of its own under one temporary
 * directory this file creates and removes, and a case reads what was left
 * behind off the disk under that root.
 *
 * Each rejection sits beside a control, a case where the same planner with
 * the one thing changed answers a plan: the failed session beside the
 * session writing the same plan and exiting 0, the session writing no plan
 * beside the one writing the prerequisites and the plan, the plan already
 * there beside a fresh root, and the missing spec beside the spec read.
 *
 * Thirteen mutations of `claude.ts` were driven on 2026-09-14 over this
 * file, `src/adapters/registry.test.ts` and `src/plan.test.ts`, one run
 * each, with 79 pass before and after, the module restored byte-identical
 * (sha256), and a PATH on which no `claude` resolves. Every one reddened
 * at least one case:
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
import type { ClaudeSpawner } from '../../utils/claude.js';

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

import { ClaudePlannerError, createClaudePlanner } from './claude.js';

/** The spec every root holds at `spec.md`. */
const SPEC = '# Spec: a planner probe\n\nNothing to build.\n';

/** The stub every request names unless a case names another. */
const STUB = 'probe';

/** The request every case makes unless it names another. */
const REQUEST = { specPath: 'spec.md', stub: STUB };

/** The plan a session writes for {@link STUB}. */
const PLAN = '.plans/PLAN-probe.md';

/** The prerequisites a session writes for {@link STUB}. */
const PREREQUISITES = '.plans/PREREQUISITES-probe.md';

/** The arguments ahead of the setting sources, as `claudeArgs` builds them. */
const BASE_ARGS = ['-p', '--dangerously-skip-permissions', '--setting-sources'];

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
  /** Whether `.plans/` was under the root when the session started. */
  readonly plansDirExisted: boolean;
}

/** What a session does: the files it writes under the root, and its exit code. */
interface SessionScript {
  readonly writes?: readonly string[];
  readonly exitCode?: number;
}

/** A spawner acting out `script` under `root`, and the calls it was handed. */
function recordingSession(
  root: string,
  { writes = [], exitCode = 0 }: SessionScript = {},
): { spawn: ClaudeSpawner; calls: SessionCall[] } {
  const calls: SessionCall[] = [];
  const spawn: ClaudeSpawner = async (args, prompt) => {
    calls.push({ args: [...args], prompt, plansDirExisted: existsSync(join(root, '.plans')) });
    for (const file of writes) writeFileSync(join(root, file), `written by the session: ${file}\n`, 'utf8');
    return exitCode;
  };
  return { spawn, calls };
}

/** A prompt holding both things the planner hands its builder. */
function buildPrompt(specContent: string, stub: string): string {
  return `prompt for ${stub}\n${specContent}`;
}

/** A planner over `root`, made with `spawn` and the default setting sources. */
function plannerOver(
  root: string,
  spawn: ClaudeSpawner,
  overrides: Partial<ClaudePlannerOptions> = {},
): ReturnType<typeof createClaudePlanner> {
  return createClaudePlanner({
    repoRoot: root,
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

describe('a claude planner generating a plan', () => {
  it('makes .plans before the session and answers the plan with no prerequisites', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PLAN] });

    expect(existsSync(join(root, '.plans'))).toBe(false);
    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(root.startsWith(tempDir)).toBe(true);
    expect(generated).toEqual({ planPath: PLAN, prerequisitesPath: null });
    expect(session.calls).toEqual([
      { args: [...BASE_ARGS, 'project,local'], prompt: `prompt for probe\n${SPEC}`, plansDirExisted: true },
    ]);
    expect(readdirSync(join(root, '.plans'))).toEqual(['PLAN-probe.md']);
  });

  it('answers the prerequisites when the session writes them beside the plan', async () => {
    const root = freshRoot();
    const session = recordingSession(root, { writes: [PREREQUISITES, PLAN] });

    const generated = await plannerOver(root, session.spawn).create(REQUEST);

    expect(generated).toEqual({ planPath: PLAN, prerequisitesPath: PREREQUISITES });
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
      message: 'The session finished but .plans/PLAN-probe.md was not created — inspect the output above.',
      exitCode: 1,
    });
  });

  it('reads no plan of another stub as the one it was asked for', async () => {
    const root = freshRoot();
    mkdirSync(join(root, '.plans'));
    writeFileSync(join(root, '.plans', 'PLAN-other.md'), 'another plan\n', 'utf8');
    const session = recordingSession(root);

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(error).toMatchObject({ exitCode: 1 });
    expect((error as Error).message).toContain('.plans/PLAN-probe.md was not created');
  });

  it('rejects before any session when the plan is already there, leaving it as it was', async () => {
    const root = freshRoot();
    mkdirSync(join(root, '.plans'));
    writeFileSync(join(root, PLAN), 'an earlier plan\n', 'utf8');
    const session = recordingSession(root, { writes: [PLAN] });

    const error = await rejectionOf(plannerOver(root, session.spawn).create(REQUEST));

    expect(error).toBeInstanceOf(ClaudePlannerError);
    expect(error).toMatchObject({ message: '.plans/PLAN-probe.md already exists', exitCode: 1 });
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
    expect(existsSync(join(root, '.plans'))).toBe(false);
  });
});
