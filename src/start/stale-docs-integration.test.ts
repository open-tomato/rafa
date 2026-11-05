/**
 * Integration test: the doc task's `unsettled` entries over a `local`
 * tracker in a temporary directory, run the way `start()` runs them: one
 * handler per run (`createStartStaleDocs`), handed the doc task's report
 * after the task ends `done`, and asked for its print after the last task.
 *
 * The chain is the real one, resolved from a config naming `local`, so the
 * tracker is the adapter's own, writing issue files under the run's root.
 * Three runs are shown:
 *
 *   - a doc task reporting two entries leaves exactly one issue holding
 *     two lines;
 *   - a later run for the same version, a new handler with nothing carried
 *     over, adds a third line to that same issue, and a line it repeats is
 *     held rather than added twice;
 *   - a run whose chain resolves no tracker prints its lines once and
 *     creates nothing.
 *
 * The issue files are read straight off the directory, so a second issue
 * could not hide behind the tracker's own listing.
 */
import type { TrackerResolution } from '@open-tomato/rafa-board/adapters/tracker/resolve';
import type { StaleDocsTaskInput, StartStaleDocsConfig } from '@open-tomato/rafa-run/start/stale-docs';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { parseTaskDeclaration } from '@open-tomato/rafa/core/plan';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { createLocalTracker, localIssuesDir } from '@open-tomato/rafa-board/adapters/tracker/local';
import { STALE_DOCS_MARKER, staleDocsTitle } from '@open-tomato/rafa-release/docs/release-issue';
import { createStartStaleDocs } from '@open-tomato/rafa-run/start/stale-docs';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-start-stale-docs-integration-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

const VERSION = '1.4.0';
const DOC_TASK = 'Repair the docs of what this plan changed  {agent=doc-updater docs=repair}';

const CONFIG: StartStaleDocsConfig = {
  trackerDefault: 'local',
  trackerFallback: [],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  prBase: null,
  releaseEnabled: false,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

const PAGE_LINE = 'context/triage.md:12: names three channels';
const README_LINE = 'README.md: shows the old flag';
const SKILL_LINE = 'src/bundled/skills/dev-planner/SKILL.md: lists seven report fields';

/** What a doc task prints: a report whose `stale_docs` lists each `where: what` line. */
function sessionOutput(lines: readonly string[]): string {
  const entries = lines.flatMap((line) => {
    const at = line.indexOf(': ');
    return [
      `  - where: ${JSON.stringify(line.slice(0, at))}`,
      `    what: ${JSON.stringify(line.slice(at + 2))}`,
    ];
  });
  return [
    'Repaired the docs.',
    '',
    '```rafa:report',
    'status: done',
    'feedback: "repaired what it could"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    'stale_docs:',
    ...entries,
    'changes: []',
    '```',
    '',
  ].join('\n');
}

let sessionCount = 0;

/** The doc task's input, ended `done`, whose report holds `lines` as unsettled entries. */
function docTask(lines: readonly string[]): StaleDocsTaskInput {
  sessionCount += 1;
  const { text, declaration } = parseTaskDeclaration(DOC_TASK);
  return {
    planStub: 'rafa-1072-demo',
    dispatch: { sessionId: `session-${sessionCount}`, taskText: text, output: sessionOutput(lines), declaration },
    outcome: 'done',
  };
}

/** A fresh project root, made under the temporary base. */
function newRoot(): string {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  return root;
}

/** The issue files under the root's `local` tracker directory, by name. */
function issueFiles(root: string): string[] {
  const dir = localIssuesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.md'))
    .sort();
}

/** The unticked checklist items of an issue file's text, in order. */
function itemsOf(contents: string): string[] {
  return contents.split('\n').filter((line) => line.startsWith('- [ ] '))
    .map((line) => line.slice('- [ ] '.length));
}

/** Sets a sink output as the active output, answering the info lines it takes. */
function captureInfo(): string[] {
  const info: string[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      info.push(message);
    },
  }));
  return info;
}

describe('the doc task\'s unsettled entries over a local tracker', () => {
  it('leaves exactly one issue holding two lines, and a later run for the same version adds a third to it', async () => {
    // Arrange
    captureInfo();
    const root = newRoot();
    const makeRun = () => createStartStaleDocs({
      repoRoot: root,
      checkout: root,
      config: CONFIG,
      home: join(tempBase, 'home'),
      env: {},
      readVersion: () => VERSION,
    });

    // Act: the first run, one doc task reporting two entries.
    const first = await makeRun().afterTask(docTask([PAGE_LINE, README_LINE]));

    // Assert: one issue, holding both lines under the marker and the title.
    expect(first?.lines.map((line) => line.action)).toEqual(['created', 'appended']);
    const afterFirst = issueFiles(root);
    expect(afterFirst).toHaveLength(1);
    const firstContents = readFileSync(join(localIssuesDir(root), afterFirst[0] ?? ''), 'utf8');
    expect(firstContents).toContain(staleDocsTitle(VERSION));
    expect(firstContents).toContain(STALE_DOCS_MARKER);
    expect(itemsOf(firstContents)).toEqual([PAGE_LINE, README_LINE]);

    // Act: a later run, a new handler, repeating one line and reporting one new.
    const second = await makeRun().afterTask(docTask([README_LINE, SKILL_LINE]));

    // Assert: still one issue file, the same one, now holding three lines.
    expect(second?.lines.map((line) => line.action)).toEqual(['held', 'appended']);
    expect(issueFiles(root)).toEqual(afterFirst);
    const secondContents = readFileSync(join(localIssuesDir(root), afterFirst[0] ?? ''), 'utf8');
    expect(itemsOf(secondContents)).toEqual([PAGE_LINE, README_LINE, SKILL_LINE]);

    // And the tracker itself lists one open marked issue.
    const tracker = createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null });
    const open = await tracker.openIssues?.('chore') ?? [];
    expect(open.filter((issue) => issue.body.includes(STALE_DOCS_MARKER))).toHaveLength(1);
  });

  it('prints the lines once after the last task and creates nothing when no tracker is resolved', async () => {
    // Arrange: a chain that resolves no tracker, beside a control root that does.
    const info = captureInfo();
    const root = newRoot();
    const resolve = (): Promise<TrackerResolution> => Promise.reject(new Error('tracker chain exhausted: local: unavailable'));
    const run = createStartStaleDocs({
      repoRoot: root,
      checkout: root,
      config: CONFIG,
      home: join(tempBase, 'home'),
      env: {},
      resolve,
      readVersion: () => VERSION,
    });

    // Act
    const handled = await run.afterTask(docTask([PAGE_LINE, README_LINE]));
    const printed = run.atRunEnd();
    const printedAgain = run.atRunEnd();

    // Assert: the lines are kept, printed once under one heading, and no issue exists.
    expect(handled?.lines.map((line) => line.action)).toEqual(['kept', 'kept']);
    expect(issueFiles(root)).toEqual([]);
    expect(printed).toHaveLength(3);
    expect(printed[0]).toContain(staleDocsTitle(VERSION));
    expect(printed.slice(1).map((line) => line.trim())).toEqual([`- [ ] ${PAGE_LINE}`, `- [ ] ${README_LINE}`]);
    expect(printedAgain).toEqual([]);
    for (const line of printed) expect(info).toContain(line);
  });

  describe('with the newest root release tag read', () => {
    /** A run for `version` whose newest root release tag reads `newest`. */
    const runFor = (root: string, version: string, newest: string | null) => createStartStaleDocs({
      repoRoot: root,
      checkout: root,
      config: CONFIG,
      home: join(tempBase, 'home'),
      env: {},
      readVersion: () => version,
      readNewestRelease: () => newest,
    });

    it('joins the open chore of the same title instead of creating a second', async () => {
      // Arrange
      captureInfo();
      const root = newRoot();
      await runFor(root, VERSION, '1.3.0').afterTask(docTask([PAGE_LINE]));

      // Act
      const again = await runFor(root, VERSION, '1.3.0').afterTask(docTask([README_LINE]));

      // Assert
      expect(again?.lines.map((line) => line.action)).toEqual(['appended']);
      const files = issueFiles(root);
      expect(files).toHaveLength(1);
      expect(itemsOf(readFileSync(join(localIssuesDir(root), files[0] ?? ''), 'utf8'))).toEqual([PAGE_LINE, README_LINE]);
    });

    it('retitles the open chore when the forecast moved, rather than creating a second', async () => {
      // Arrange: a chore open for 1.4.0, then a forecast that moves to 1.5.0.
      captureInfo();
      const root = newRoot();
      await runFor(root, VERSION, '1.3.0').afterTask(docTask([PAGE_LINE]));
      const before = issueFiles(root);

      // Act
      const moved = await runFor(root, '1.5.0', '1.3.0').afterTask(docTask([README_LINE]));

      // Assert: the same file now carries the new title and both lines.
      expect(moved?.lines.map((line) => line.action)).toEqual(['appended']);
      expect(issueFiles(root)).toEqual(before);
      const contents = readFileSync(join(localIssuesDir(root), before[0] ?? ''), 'utf8');
      expect(contents).toContain(staleDocsTitle('1.5.0'));
      expect(contents).not.toContain(staleDocsTitle(VERSION));
      expect(itemsOf(contents)).toEqual([PAGE_LINE, README_LINE]);
    });

    it('leaves a chore of a released version alone and files a new one', async () => {
      // Arrange: a chore open for 1.4.0, which has since been released.
      captureInfo();
      const root = newRoot();
      await runFor(root, VERSION, '1.3.0').afterTask(docTask([PAGE_LINE]));
      const [releasedFile] = issueFiles(root);
      const releasedBefore = readFileSync(join(localIssuesDir(root), releasedFile ?? ''), 'utf8');

      // Act
      const next = await runFor(root, '1.5.0', VERSION).afterTask(docTask([README_LINE]));

      // Assert: the released chore is byte for byte as it was; a second holds the line.
      expect(next?.lines.map((line) => line.action)).toEqual(['created']);
      expect(readFileSync(join(localIssuesDir(root), releasedFile ?? ''), 'utf8')).toBe(releasedBefore);
      const files = issueFiles(root);
      expect(files).toHaveLength(2);
      const fresh = files.find((name) => name !== releasedFile) ?? '';
      const freshContents = readFileSync(join(localIssuesDir(root), fresh), 'utf8');
      expect(freshContents).toContain(staleDocsTitle('1.5.0'));
      expect(itemsOf(freshContents)).toEqual([README_LINE]);
    });

    it('leaves one open marked chore holding both lines when two wrap-ups race to create', async () => {
      // Arrange: a root with no chore, and two runs that both find none.
      captureInfo();
      const root = newRoot();

      // Act
      const [left, right] = await Promise.all([
        runFor(root, VERSION, '1.3.0').afterTask(docTask([PAGE_LINE])),
        runFor(root, VERSION, '1.3.0').afterTask(docTask([README_LINE])),
      ]);

      // Assert: no call failed, and exactly one chore is open, holding both lines.
      const actions = [left, right].flatMap((handled) => handled?.lines.map((line) => line.action) ?? []);
      expect(actions).not.toContain('failed');
      expect(issueFiles(root)).toHaveLength(2);
      expect([left, right].flatMap((handled) => handled?.lines ?? []).some((line) => 'duplicate' in line)).toBe(true);
      const tracker = createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null });
      const open = (await tracker.openIssues?.('chore') ?? []).filter((issue) => issue.body.includes(STALE_DOCS_MARKER));
      expect(open).toHaveLength(1);
      expect(itemsOf(open[0]?.body ?? '').sort()).toEqual([PAGE_LINE, README_LINE].sort());
    });
  });
});
