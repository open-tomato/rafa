/**
 * Tests for the route a `plan create` run resolves its spec through
 * (`src/commands/plan/spec-route.ts`): the candidate rule `--spec`
 * looks a file up with, the refusal a line naming no source gets, and
 * what the resolution is handed.
 *
 * The routes themselves are driven elsewhere and this file drives none
 * of them again: `src/board/spec-source.test.ts` walks the roadmap and
 * `src/board/plan-spec.test.ts` runs the board checks over planted `gh`
 * and `git` runners. What is measured here is the half that is the
 * COMMAND's — that the words reach `readSpecSourceFlags`, that the
 * `findSpec` handed over is this module's candidate rule and not the
 * bare path, and that both offers are handed over rather than left out,
 * which is the difference between an unlabelled issue being offered the
 * label and being refused.
 *
 * The resolution is a seam ({@link SpecRouteSeams}), so those cases
 * read the options a route was built with instead of reaching GitHub.
 * The control for the seam is the `--spec` case beside them, which runs
 * the REAL `resolvePlanSpec` over a planted file: it answers the spec,
 * which no stub could have done, and it spawns nothing, because the
 * file route calls neither runner.
 *
 * Two mutations of the module were driven on 2026-09-21, each restored
 * from a scratch copy and verified with `shasum -c`, against 14 pass
 * and 0 fail either side:
 *
 *  - `findSpec` handed over as the path typed, rather than the
 *    candidate rule: 12 pass and 2 fail, the wiring case and the
 *    `--spec` control, which then looked for the spec at the root
 *    alone.
 *  - `offerReady` handed over as null, as a run with no terminal gets:
 *    13 pass and 1 fail, the offers case alone.
 */
import type { SpecRouteSeams } from './spec-route.js';
import type { AlternativeOffer } from '../../board/blocked-line.js';
import type { PlanSpecOptions, PlanSpecResolution, ReadyOffer } from '../../board/plan-spec.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { noSourceMessage, SOURCE_REFUSAL_EXIT } from '../../board/spec-source.js';
import { CommandExit } from '../../cli/command.js';

import { findSpec, resolveCreateSpec, specCandidates, usageRefusal } from './spec-route.js';

/** A scratch directory of this file's own. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-spec-route-'));

/** Where snapshots live and where a `--spec` file is looked for, as a project configures it. */
const SPECS_DIR = join('.rafa', 'specs');

/** A spec body the planner is never handed here; only its presence is read. */
const SPEC = '# Spec: a route probe\n\nNothing to build.\n';

let planted = 0;

/** Plants a project root holding a spec at each of `paths`, relative to the root. */
function plant(...paths: readonly string[]): string {
  planted += 1;
  const repoRoot = join(tempRoot, `run-${String(planted)}`);
  mkdirSync(join(repoRoot, SPECS_DIR), { recursive: true });
  for (const path of paths) writeFileSync(join(repoRoot, path), SPEC, 'utf8');
  return repoRoot;
}

/** What a thrown `CommandExit` carried. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

/** A resolution that records what it was asked and answers a stopped run. */
function recording(): { seams: SpecRouteSeams; asked: () => PlanSpecOptions } {
  let taken: PlanSpecOptions | null = null;
  const stopped: PlanSpecResolution = { outcome: 'stopped', reason: 'dry-run' };
  const offerReady: ReadyOffer = () => Promise.resolve(true);
  const offerAlternative: AlternativeOffer = () => Promise.resolve(true);

  return {
    seams: {
      resolve: (options) => {
        taken = options;
        return Promise.resolve(stopped);
      },
      makeReadyOffer: () => offerReady,
      makeAlternativeOffer: () => offerAlternative,
    },
    asked: () => {
      if (taken === null) throw new Error('the resolution was never asked');
      return taken;
    },
  };
}

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('where --spec looks for its file', () => {
  it('reads a relative name against the root, then under the specs directory', () => {
    expect(specCandidates('my-feature.md', SPECS_DIR))
      .toEqual(['my-feature.md', join(SPECS_DIR, 'my-feature.md')]);
  });

  it('gives an absolute name its one candidate', () => {
    expect(specCandidates('/repo/specs/my-feature.md', SPECS_DIR)).toEqual(['/repo/specs/my-feature.md']);
  });

  it('drops a second candidate spelled as the first, which a specs directory of the root itself makes', () => {
    expect(specCandidates('my-feature.md', '.')).toEqual(['my-feature.md']);
  });

  it('keeps the path written from the root first, so it reads as it did before specs.dir was read', () => {
    expect(specCandidates(join(SPECS_DIR, 'my-feature.md'), SPECS_DIR))
      .toEqual([join(SPECS_DIR, 'my-feature.md'), join(SPECS_DIR, SPECS_DIR, 'my-feature.md')]);
  });

  it('answers the file at the root as it was typed', () => {
    const repoRoot = plant('my-feature.md');

    expect(findSpec(repoRoot, 'my-feature.md', SPECS_DIR)).toBe('my-feature.md');
  });

  it('answers the one under the specs directory when the root holds none', () => {
    const repoRoot = plant(join(SPECS_DIR, 'my-feature.md'));

    expect(findSpec(repoRoot, 'my-feature.md', SPECS_DIR)).toBe(join(SPECS_DIR, 'my-feature.md'));
  });

  it('refuses a spec in neither, naming both paths it looked at', () => {
    const repoRoot = plant();

    try {
      findSpec(repoRoot, 'missing.md', SPECS_DIR);
      throw new Error('expected a CommandExit, and the call answered instead');
    } catch (error) {
      expect(error).toBeInstanceOf(CommandExit);
      expect((error as CommandExit).exitCode).toBe(1);
      expect((error as CommandExit).message).toBe(
        `❌ Spec file not found: ${resolve(repoRoot, 'missing.md')}, or ${resolve(repoRoot, SPECS_DIR, 'missing.md')}`,
      );
    }
  });
});

describe('the refusal a line naming no source gets', () => {
  it('carries the usage, its flags and where a --spec file is looked for', () => {
    expect(usageRefusal(SPECS_DIR)).toBe([
      'Usage: rafa plan create (--spec=<file>.md | --issue=<n> | --next[=<roadmap-issue>])',
      '  [--stub=<name>] [--no-progress] [--refresh] [--dry-run] [--skip-review] [--no-comment] [--accept-refs]',
      noSourceMessage(SPECS_DIR),
    ].join('\n'));
  });

  it('is thrown before any resolution when the line names no source', async () => {
    const { seams } = recording();

    const thrown = await refusal(() => resolveCreateSpec({
      args: ['--stub=rafa-63'],
      repoRoot: plant(),
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      trustedAuthors: [],
    }, seams));

    expect(thrown.exitCode).toBe(SOURCE_REFUSAL_EXIT);
    expect(thrown.message).toBe(usageRefusal(SPECS_DIR));
  });
});

describe('what the resolution is handed', () => {
  it('carries the source the line named with its two flags, and the config the run resolved', async () => {
    const repoRoot = plant();
    const { seams, asked } = recording();

    const answer = await resolveCreateSpec({
      args: ['--issue=63', '--refresh', '--dry-run'],
      repoRoot,
      specsDir: SPECS_DIR,
      roadmapIssue: 31,
      trustedAuthors: ['octocat'],
    }, seams);

    expect(answer.outcome).toBe('stopped');
    expect(asked().request).toEqual({ kind: 'issue', issue: 63 });
    expect([asked().refresh, asked().dryRun]).toEqual([true, true]);
    expect([asked().repoRoot, asked().specsDir]).toEqual([repoRoot, SPECS_DIR]);
    expect([asked().roadmapIssue, asked().trustedAuthors]).toEqual([31, ['octocat']]);
  });

  it('hands over the candidate rule as findSpec, not the path as typed', async () => {
    const repoRoot = plant(join(SPECS_DIR, 'my-feature.md'));
    const { seams, asked } = recording();

    await resolveCreateSpec({
      args: ['--spec=my-feature.md'],
      repoRoot,
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      trustedAuthors: [],
    }, seams);

    expect(asked().findSpec('my-feature.md')).toBe(join(SPECS_DIR, 'my-feature.md'));
    expect(() => asked().findSpec('missing.md')).toThrow(CommandExit);
  });

  it('hands over both offers, so an unlabelled issue is offered the label', async () => {
    const { seams, asked } = recording();

    await resolveCreateSpec({
      args: ['--next'],
      repoRoot: plant(),
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      trustedAuthors: [],
    }, seams);

    expect(asked().offerReady).toBeFunction();
    expect(asked().offerAlternative).toBeFunction();
  });

  it('hands over the null a run with no terminal makes, rather than leaving the offer out', async () => {
    const { seams, asked } = recording();
    const unasked: SpecRouteSeams = { ...seams, makeReadyOffer: () => null, makeAlternativeOffer: () => null };

    await resolveCreateSpec({
      args: ['--next'],
      repoRoot: plant(),
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      trustedAuthors: [],
    }, unasked);

    expect(asked().offerReady).toBeNull();
    expect(asked().offerAlternative).toBeNull();
  });
});

describe('the --spec route through the resolution the command uses', () => {
  it('answers the spec found under the specs directory, with no issue to publish on', async () => {
    const repoRoot = plant(join(SPECS_DIR, 'my-feature.md'));

    const answer = await resolveCreateSpec({
      args: ['--spec=my-feature.md'],
      repoRoot,
      specsDir: SPECS_DIR,
      roadmapIssue: null,
      trustedAuthors: [],
    });

    expect(answer.outcome).toBe('spec');
    if (answer.outcome !== 'spec') throw new Error('expected a resolved spec');
    expect(answer.spec.path).toBe(join(SPECS_DIR, 'my-feature.md'));
    expect(answer.spec.issue).toBeNull();
    expect(answer.gate).toBeNull();
  });
});
