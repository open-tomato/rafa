/**
 * Black-box acceptance tests for the CLI surface: `src/rafa.ts`, spawned
 * as `bun src/rafa.ts <words>` in a scratch git repository of its own,
 * proving what `.specs/cli-surface.md` and `context/cli.md` promise a
 * caller who reads only the command line.
 *
 * ## What is covered
 *
 *   - **`--output=json` over `describe`, `usage`, `plan validate`,
 *     `effort report` and a refused command** (`plan show` of a stub no
 *     plan carries): each run's stdout is NDJSON, every line parsing as
 *     JSON, with exactly one terminal `result` event among them, as
 *     `src/cli/dispatch.ts` promises for one invocation.
 *   - **`rafa start` and `rafa plan --spec=`**, the two aliases kept from
 *     phase 0, each print their one deprecation line to stderr exactly
 *     once, whatever the command they alias goes on to do.
 *   - **An unknown subject** exits nonzero.
 *   - **A command outside a project** exits 1 with the `rafa init` hint,
 *     where the same command runs in a scratch repository holding
 *     `.rafa/config.yaml`: the control for the file every other case's
 *     repository holds.
 *   - **The root `plan create`, `loop start`, `effort collect` and
 *     `effort report` act on** is the project root, where each took the
 *     git root before. Each runs below a project nested in a git
 *     repository whose root holds no config, and its refusal names a path
 *     under the project root.
 *
 * Every run goes through `./cli-capture.js`'s `plantScratchRepo` and
 * `runRafa`: a scratch HOME and a PATH holding only a `bin/` of the
 * case's own and git's directory, so `claude` resolves to nothing and no
 * case reaches a real session. Each case plants its own scratch
 * repository, a project holding the `.rafa/config.yaml` `rafa init`
 * writes unless the case says otherwise, so no run reads another's plan
 * or config.
 *
 * Driven on 2026-09-15, each restored sha256-identical: `plan create`,
 * `loop start`, `effort collect` and `effort report` taking the git root
 * again, one at a time, each reddened its own root case alone, and the
 * scratch repository planting no config reddened nine cases over this
 * file and the spawned cases of the plan readers.
 */
import type { CliEvent } from '../ports/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { initHint } from '../project/scope.js';

import { eventsOf, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own, holding one scratch repository per case. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cli-surface-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one spawned case may run. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** A plan `parsePlan` reads with no issue: one open task, no stage. */
const CLEAN_PLAN = ['# Plan: cli-surface-probe', '', '- [ ] a task', ''].join('\n');

/** How many non-overlapping times `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** One `--output=json` case: the words run, the exit code expected, and what the repo needs planted first. */
interface JsonCase {
  readonly words: readonly string[];
  readonly exitCode: number;
  readonly plant?: (repo: string) => void;
}

/**
 * `describe`, `usage`, `plan validate` and `effort report`, each
 * exiting 0, and a refused command (`plan show` of a stub no plan
 * carries), exiting 1: every one run over `--output=json`.
 */
const JSON_CASES: readonly (readonly [string, JsonCase])[] = [
  ['describe', { words: ['describe', '--output=json'], exitCode: 0 }],
  ['usage', { words: ['usage', '--output=json'], exitCode: 0 }],
  ['plan validate', {
    words: ['plan', 'validate', 'plan.md', '--output=json'],
    exitCode: 0,
    plant: (repo) => writeFileSync(join(repo, 'plan.md'), CLEAN_PLAN, 'utf8'),
  }],
  ['effort report', { words: ['effort', 'report', '--output=json'], exitCode: 0 }],
  ['a refused command', { words: ['plan', 'show', 'no-such-plan', '--output=json'], exitCode: 1 }],
];

describe('rafa --output=json, spawned', () => {
  it.each(JSON_CASES)('over %s: NDJSON whose every line parses, with exactly one terminal event', (_label, jsonCase) => {
    const scratch = plantScratchRepo(tempBase);
    jsonCase.plant?.(scratch.repo);

    const run = runRafa(scratch, scratch.repo, jsonCase.words);

    expect(run.exitCode).toBe(jsonCase.exitCode);
    expect(run.stderr).toBe('');

    let events: CliEvent[] = [];
    expect(() => {
      events = eventsOf(run.stdout);
    }).not.toThrow();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('start');
    expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
  }, RUN_TIMEOUT);
});

describe('the aliases kept from phase 0', () => {
  it('prints "rafa start" is deprecated exactly once, on stderr, whatever loop start goes on to do', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['start']);

    expect(occurrences(run.stderr, 'rafa: "rafa start" is deprecated; use "rafa loop start"')).toBe(1);
  }, RUN_TIMEOUT);

  it('prints "rafa plan" is deprecated exactly once, on stderr, whatever plan create goes on to do', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['plan', '--spec=missing-spec.md']);

    expect(occurrences(run.stderr, 'rafa: "rafa plan" is deprecated; use "rafa plan create"')).toBe(1);
  }, RUN_TIMEOUT);
});

describe('an unknown subject', () => {
  it('exits nonzero', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['not-a-real-subject']);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('rafa: unknown subject or command "not-a-real-subject"');
  }, RUN_TIMEOUT);
});

describe('a command outside a project', () => {
  it('exits 1 with the init hint, where the same command runs in a scratch repository holding the config', () => {
    const outside = plantScratchRepo(tempBase, { project: false });
    const inside = plantScratchRepo(tempBase);

    const refused = runRafa(outside, outside.repo, ['usage']);
    const ran = runRafa(inside, inside.repo, ['usage']);

    expect([refused.exitCode, refused.stdout]).toEqual([1, '']);
    expect(refused.stderr).toBe(`rafa: ${initHint(outside.repo)}\n`);
    expect([ran.exitCode, ran.stderr]).toEqual([0, '']);
  }, RUN_TIMEOUT);
});

/** One command run below a nested project: its words, the config the project holds, and the path its refusal names under the root. */
interface RootCase {
  readonly words: readonly string[];
  readonly config?: string;
  readonly named: string;
}

/**
 * The four commands that took the git root before, each refused in a way
 * naming a path under the root it acts on: a spec or a plan that does not
 * exist, or `store: postgres`, which the effort commands refuse by the
 * config file's path.
 */
const ROOT_CASES: readonly (readonly [string, RootCase])[] = [
  ['plan create', { words: ['plan', 'create', '--spec=missing-spec.md'], named: 'missing-spec.md' }],
  ['loop start', { words: ['loop', 'start', '--plan=missing-plan.md'], named: 'missing-plan.md' }],
  ['effort collect', { words: ['effort', 'collect'], config: 'store: postgres\n', named: join('.rafa', 'config.yaml') }],
  ['effort report', { words: ['effort', 'report'], config: 'store: postgres\n', named: join('.rafa', 'config.yaml') }],
];

describe('the root a command acts on', () => {
  it.each(ROOT_CASES)('is the project root for %s, run below a project nested in a git repository', (_label, rootCase) => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    const project = join(scratch.repo, 'app');
    const below = join(project, 'sub');
    plantProjectConfig(project, rootCase.config);
    mkdirSync(below);

    const run = runRafa(scratch, below, rootCase.words);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(join(project, rootCase.named));
    expect(run.stderr).not.toContain(join(scratch.repo, rootCase.named));
  }, RUN_TIMEOUT);
});
