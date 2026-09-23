/**
 * Black-box acceptance tests for the spend mark and the `spends` field,
 * spawned as `bun src/rafa.ts <words>` in a scratch git repository of its
 * own, proving the definition of done of `.rafa/specs/rafa-82-every-
 * command-spends-claude.md`'s "help and describe" items over the CLI
 * surface a caller who reads only the command line actually gets, rather
 * than the `renderHelp`/`describeRegistry` unit tests of `src/cli/
 * help.test.ts` and `src/cli/describe.test.ts`, which dispatch in-process
 * over registries the case builds.
 *
 * Every run goes through `./cli-capture.js`'s `plantScratchRepo` and
 * `runRafa`, as `./cli-surface.test.ts` does: a scratch HOME and a PATH
 * holding only a `bin/` of the case's own and git's directory, so `claude`
 * resolves to nothing and no case reaches a real session.
 */
import type { DescribeDocument } from '../cli/describe.js';
import type { CliEvent } from '../ports/index.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { eventsOf, plantScratchRepo, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own, holding one scratch repository per case. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-spends-cli-surface-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one spawned case may run. */
const RUN_TIMEOUT = { timeout: 30_000 };

/** The names of every subject action and top-level command whose `spends` is not null, across the whole document. */
function spendersOf(document: DescribeDocument): string[] {
  return [
    ...document.subjects.flatMap((subject) => subject.actions
      .filter((action) => action.spends !== null)
      .map((action) => `${subject.name} ${action.name}`)),
    ...document.commands
      .filter((command) => command.spends !== null)
      .map((command) => command.name),
  ];
}

describe('rafa --help, spawned', () => {
  it('marks the plan and loop subject lines and closes on the legend line', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['--help']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('  plan       create plans from specs; list, show, validate and risk-read them 🪙\n');
    expect(run.stdout).toContain('  loop       start a plan; stop, pause, resume, show and list its sessions 🪙\n');
    expect(run.stdout).toContain('🪙  starts Claude Code sessions, which spend your Claude usage\n');
  }, RUN_TIMEOUT);
});

describe('rafa pr --help, spawned', () => {
  it('ends the triage line with its condition, 🪙 with --resolve', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['pr', '--help']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      '  triage    assess a pull request: its class, the evidence, and a follow-up\n'
      + '            prompt 🪙 with --resolve\n',
    );
  }, RUN_TIMEOUT);
});

describe('rafa plan create --help, spawned', () => {
  it('has a Spends: line', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['plan', 'create', '--help']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Spends:\n  🪙 one planning session\n');
  }, RUN_TIMEOUT);
});

describe('rafa describe --output=json, spawned', () => {
  it('gives spends for exactly the declared commands and null for the rest', () => {
    const scratch = plantScratchRepo(tempBase);

    const run = runRafa(scratch, scratch.repo, ['describe', '--output=json']);

    expect(run.exitCode).toBe(0);
    const events = eventsOf(run.stdout);
    const result = events.find((event) => event.type === 'result') as Extract<CliEvent, { type: 'result' }> | undefined;
    expect(result?.ok).toBe(true);

    const document = result?.data as DescribeDocument;
    expect(spendersOf(document).sort()).toEqual(['loop start', 'next', 'plan create', 'pr triage', 'skill backfill'].sort());
  }, RUN_TIMEOUT);
});
