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
 *
 * Every run goes through `./cli-capture.js`'s `plantScratchRepo` and
 * `runRafa`: a scratch HOME and a PATH holding only a `bin/` of the
 * case's own and git's directory, so `claude` resolves to nothing and no
 * case reaches a real session. Each case plants its own scratch
 * repository, so no run reads another's plan or config.
 */
import type { CliEvent } from '../ports/index.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { eventsOf, plantScratchRepo, runRafa } from './cli-capture.js';

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
