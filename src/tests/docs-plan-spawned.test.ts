/**
 * `rafa docs plan` and `rafa release status`, spawned as the real
 * `rafa` binary (`src/tests/cli-capture.ts`) in a scratch project whose
 * tracker is `local`: the proof that the registered command and the
 * status row hold over the real process, not only over the in-process
 * dispatch `src/commands/docs/plan.test.ts` drives.
 *
 * The fixture is one stale-docs issue on the `local` tracker holding
 * two open lines and one ticked line. Cases:
 *   1. `docs plan` writes a plan holding exactly two task lines, one per
 *      open line, none for the ticked line;
 *   2. `release status` over the same fixture prints a count of two.
 *
 * The scratch PATH holds no `gh`, and `tracker.default: local` lands the
 * chain on the `local` tracker, so no case reaches a network.
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker, localIssuesDir } from '@open-tomato/rafa-board/adapters/tracker/local';
import { STALE_DOCS_MARKER } from '@open-tomato/rafa-release/docs/release-issue';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** This suite's temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-docs-plan-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one case may take: each spawns `rafa` twice. */
const CASE_TIMEOUT_MS = 60_000;

/** The project config: the `local` tracker, and no release settings beyond the defaults. */
const LOCAL_CONFIG = 'version: 1\ntracker:\n  default: local\n  fallback: [local]\n';

/** The two lines the issue holds open, in body order. */
const OPEN_LINES = ['context/triage.md:12: names three channels, not four', 'README.md: the install step names npm'] as const;

/** The line the issue holds ticked, which no task may be written for. */
const TICKED_LINE = 'src/PROMPT.md: says seven fields';

/** The stale-docs issue's body: the marker, then one ticked line between two open ones. */
const BODY = [
  STALE_DOCS_MARKER,
  '',
  'Lines the doc tasks could not settle.',
  '',
  `- [ ] ${OPEN_LINES[0]}`,
  `- [x] ${TICKED_LINE}`,
  `- [ ] ${OPEN_LINES[1]}`,
  '',
].join('\n');

/** The one plan file `rafa docs plan` wrote under `repo`, as its path. */
function writtenPlan(repo: string): string {
  const dir = join(repo, '.rafa', 'plans');
  const files = readdirSync(dir).filter((name) => name.startsWith('PLAN-'));
  expect(files).toEqual(['PLAN-rafa-1-doc-update.md']);
  return join(dir, files[0] ?? '');
}

describe('rafa docs plan and rafa release status, spawned over a local tracker', () => {
  it('writes a plan of exactly two tasks, and the status over the same fixture counts two', async () => {
    // Arrange
    const scratch = plantScratchRepo(tempBase);
    plantProjectConfig(scratch.repo, LOCAL_CONFIG);
    const tracker = createLocalTracker({ issuesDir: localIssuesDir(scratch.repo), fallbackReason: null });
    await tracker.create({
      opt: 0,
      title: 'Release 1.2.0: update stale docs',
      body: BODY,
      type: 'chore',
      module: 'docs',
      priority: null,
      project: null,
      blockedBy: [],
    });

    // Act
    const plan = runRafa(scratch, scratch.repo, ['docs', 'plan']);
    const status = runRafa(scratch, scratch.repo, ['release', 'status']);

    // Assert
    expectExit(plan, 0, scratch);
    const text = readFileSync(writtenPlan(scratch.repo), 'utf8');
    const taskLines = text.split('\n').filter((line) => line.startsWith('- ['));
    expect(taskLines).toHaveLength(2);
    expect(taskLines[0]).toContain(OPEN_LINES[0]);
    expect(taskLines[1]).toContain(OPEN_LINES[1]);
    expect(taskLines.every((line) => line.endsWith('{agent=doc-updater}'))).toBe(true);
    expect(text).not.toContain(TICKED_LINE);

    expectExit(status, 0, scratch);
    expect(status.stdout).toMatch(/stale docs\s+2 open lines/);
  }, CASE_TIMEOUT_MS);
});
