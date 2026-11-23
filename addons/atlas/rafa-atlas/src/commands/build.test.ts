/**
 * Tests for the `build` command over a fixture project in a tmpdir: a
 * build writes the replica under `ATLAS_PROJECT_ROOT` and prints the rows
 * of each bucket, json mode hands the summary to `output.result`, and a
 * root with no store refuses with an error line, a plain `Error` (which
 * the dispatcher ends with exit code 1) and no replica written. The
 * fixture store is written with core's store writer; no real row is
 * copied. The `--github` cases hand `runBuild` a stub `gh`
 * (`../ingest/testdata/github.fixture.ts`): without the flag the stub,
 * which throws, is never called; with it, a stub answering `ok: false`
 * gives one warning naming its stderr and a build that still succeeds.
 */
import type { BuildSummary } from '../build/index.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openReplica } from '@open-tomato/atlas-data/replica';
import { afterAll, describe, expect, it } from 'bun:test';

import { replicaPathOf } from '../build/index.js';
import { PRS_SOURCE } from '../ingest/github.js';
import { writeFixtureStore } from '../ingest/testdata/effort-store.fixture.js';
import { failingGh, FIXTURE_GH_STDERR, fixtureGh, throwingGh } from '../ingest/testdata/github.fixture.js';

import { buildCommand, partialLines, runBuild } from './build.js';
import { testContext } from './testdata/context.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-command-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

describe('the build command over a fixture project', () => {
  it('writes the replica under ATLAS_PROJECT_ROOT and prints the rows of each bucket', async () => {
    const root = join(scope, 'project');
    writeFixtureStore(root);
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root } });

    await buildCommand.run(context);

    const replicaPath = replicaPathOf(root);
    expect(existsSync(replicaPath)).toBe(true);
    const reader = openReplica(replicaPath);
    const replica = reader.current();
    reader.close();
    expect(printed.error).toEqual([]);
    expect(printed.info[0]).toBe(`atlas: built ${replicaPath} (build ${replica.meta.buildId})`);
    expect(printed.info).toContain('  task_facts: 4 rows');
    expect(printed.info).toContain('  plan_facts: 1 row');
    expect(printed.info.at(-1)).toBe('atlas: serve it with rafa module exec @open-tomato/rafa-atlas serve');
    expect(printed.results).toEqual([]);
  });

  it('hands the build summary to output.result in json mode', async () => {
    const root = join(scope, 'json');
    writeFixtureStore(root);
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, outputMode: 'json' });

    await buildCommand.run(context);

    expect(printed.results).toHaveLength(1);
    const summary = printed.results[0] as BuildSummary;
    expect(summary.replicaPath).toBe(replicaPathOf(root));
    expect(summary.tables).toEqual(expect.objectContaining({ task_facts: 4 }));
  });

  it('refuses a root with no effort store with an error line, writing no replica', async () => {
    const root = join(scope, 'empty');
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root } });

    const refusal = await buildCommand.run(context).then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).toHaveProperty('name', 'Error');
    expect((refusal as Error).message).toContain('no effort store');
    expect(printed.error).toHaveLength(1);
    expect(printed.error[0]).toContain(`no effort store at ${join(root, '.rafa', 'effort')}`);
    expect(printed.error[0]).toContain('ATLAS_PROJECT_ROOT');
    expect(printed.info).toEqual([]);
    expect(existsSync(replicaPathOf(root))).toBe(false);
  });

  it('control: the same root builds once a store is written there', async () => {
    const root = join(scope, 'empty-then-filled');
    const first = testContext({ env: { ATLAS_PROJECT_ROOT: root } });
    await expect(buildCommand.run(first.context)).rejects.toThrow('no effort store');

    writeFixtureStore(root);
    const second = testContext({ env: { ATLAS_PROJECT_ROOT: root } });
    await buildCommand.run(second.context);

    expect(second.printed.error).toEqual([]);
    expect(existsSync(replicaPathOf(root))).toBe(true);
  });
});

describe('the build command\'s --github flag', () => {
  it('declares --github as a boolean flag', () => {
    expect(buildCommand.flags.map((flag) => [flag.name, flag.type])).toEqual([['github', 'boolean']]);
  });

  it('never calls gh without --github: the stub throws, and the build succeeds', async () => {
    const root = join(scope, 'no-github');
    writeFixtureStore(root);
    const gh = throwingGh();
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root } });

    const summary = await runBuild(context, gh.runner);

    expect(gh.calls).toEqual([]);
    expect(printed.error).toEqual([]);
    expect(summary.sources.find((stamp) => stamp.source === PRS_SOURCE)?.reason).toBe('not read: the build ran without --github');
  });

  it('control: with --github the same stub is called', async () => {
    const root = join(scope, 'github-throws');
    writeFixtureStore(root);
    const gh = throwingGh();
    const { context } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags: { github: true } });

    await runBuild(context, gh.runner);

    expect(gh.calls).toHaveLength(1);
  });

  it('warns once naming gh\'s stderr when gh answers ok false, and still writes the replica', async () => {
    const root = join(scope, 'github-fails');
    writeFixtureStore(root);
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags: { github: true } });

    const summary = await runBuild(context, failingGh().runner);

    expect(printed.error).toEqual([]);
    expect(printed.warn.filter((line) => line.includes(FIXTURE_GH_STDERR))).toEqual([
      `atlas: ${PRS_SOURCE} read in part: the GitHub read failed, so every other source is built as without --github: gh pr list failed: ${FIXTURE_GH_STDERR}`,
    ]);
    expect(existsSync(replicaPathOf(root))).toBe(true);
    expect(summary.tables).toEqual(expect.objectContaining({ task_facts: 4, pr_facts: 0 }));
  });

  it('fills pr_facts with --github over a stub answering the fixture lists, and warns of no prs_merged', async () => {
    const root = join(scope, 'github-reads');
    writeFixtureStore(root);
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags: { github: true } });

    const summary = await runBuild(context, fixtureGh().runner);

    expect(summary.tables).toEqual(expect.objectContaining({ pr_facts: 5 }));
    expect(printed.warn.filter((line) => line.includes(PRS_SOURCE) || line.includes('prs_merged'))).toEqual([]);
  });

  it('refuses a --github value that is not true or false with an error line, writing no replica', async () => {
    const root = join(scope, 'github-bad');
    writeFixtureStore(root);
    const { context, printed } = testContext({ env: { ATLAS_PROJECT_ROOT: root }, flags: { github: 'maybe' } });

    await expect(buildCommand.run(context)).rejects.toThrow('--github is "maybe"');
    expect(printed.error).toEqual([expect.stringContaining('--github is "maybe", expected no value, true or false')]);
    expect(existsSync(replicaPathOf(root))).toBe(false);
  });
});

describe('partialLines', () => {
  it('warns once per source read in part, and for none read whole', () => {
    const stamp = { asOf: null, readAt: '2026-11-05T12:00:00.000Z', rows: 0 };
    const summary: BuildSummary = {
      replicaPath: '/replica',
      buildId: 'b',
      tables: {},
      sources: [
        { ...stamp, source: 'local.tasks', partial: true, reason: 'sessions lacks usage' },
        { ...stamp, source: 'local.daily', partial: false, reason: null },
      ],
    };

    expect(partialLines(summary)).toEqual(['atlas: local.tasks read in part: sessions lacks usage']);
  });
});
