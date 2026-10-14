/**
 * Integration test: `createStartTriage` over a session output whose report
 * holds one `stale_docs` entry and one public bug, run the way `start()`
 * runs it: the report is stored first (`recordTaskReport`), then handed to
 * the triage.
 *
 * The tracker is a real `local` tracker under a temporary root, wrapped to
 * count `create` calls. The bug is filed exactly once, and the stale-doc
 * entry reaches no tracker: the store holds one `sighting` row under the
 * plan stub.
 */
import type { StartTriageOptions } from './triage.js';
import type { Tracker } from '../ports/index.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { createLocalTracker, localIssuesDir } from '../adapters/tracker/local.js';
import { setActiveOutput } from '../core/output/index.js';
import { readStaleDocsForPlan } from '../effort/store/stale-docs.js';
import { recordTaskReport } from '../report/record.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { createPrivateTriageTracker } from '../triage/triage.js';

import { createStartTriage } from './triage.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-start-triage-stale-docs-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

const CLOCK = (): string => '2026-10-14T09:00:00.000Z';
const PLAN_STUB = 'demo';
const TASK_TEXT = 'Wire the loop';
const SESSION_ID = 'session-1';

const CONFIG: StartTriageOptions['config'] = {
  trackerDefault: 'local',
  trackerFallback: [],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  triageSimilarityThreshold: 0.3,
  triageSimilarityCandidates: 3,
};

const OUTPUT = [
  'Wired the loop.',
  '',
  '```rafa:report',
  'status: done',
  'feedback: "Wired the loop."',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs:',
  '  - what: "The parser drops a field"',
  '    artifact: "parse.ts: field dropped"',
  '    security: false',
  'stale_docs:',
  '  - where: "context/triage.md:12"',
  '    what: "says three channels, the code has four"',
  '```',
  '',
].join('\n');

describe('createStartTriage over a report with one stale_docs entry and one public bug', () => {
  it('calls the tracker\'s create once, for the bug, and stores one sighting row under the plan stub', async () => {
    // Arrange
    const root = join(tempBase, 'root');
    mkdirSync(root, { recursive: true });
    const trackerPath = join(root, 'PLAN_TRACKER-demo.md');
    writeFileSync(trackerPath, '# Plan: demo\n\n- [x] Wire the loop  {agent=loop-implementer}\n', 'utf8');
    setActiveOutput(sinkOutput({}));

    const inner = createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK });
    const created: unknown[] = [];
    const tracker: Tracker = {
      ...inner,
      create: (draft) => {
        created.push(draft);
        return inner.create(draft);
      },
    };
    const triage = createStartTriage({
      repoRoot: root,
      config: CONFIG,
      env: {},
      resolve: () => Promise.resolve({
        tracker,
        degraded: false,
        fallbackReason: null,
        attempts: [{ kind: 'local', ok: true, reason: null }],
      }),
      privateTracker: createPrivateTriageTracker(root, { now: CLOCK }),
    });
    const dispatch = { sessionId: SESSION_ID, planStub: PLAN_STUB, taskLine: TASK_TEXT };

    // Act
    recordTaskReport(root, { dispatch, outcome: 'done', output: OUTPUT });
    const result = await triage({
      trackerPath,
      lineNum: 2,
      planStub: PLAN_STUB,
      dispatch: { sessionId: SESSION_ID, taskText: TASK_TEXT, output: OUTPUT },
      outcome: 'done',
    });

    // Assert: first the tracker, then the store.
    expect(created).toHaveLength(1);
    expect(result?.bugs.map(({ action }) => action)).toEqual(['filed']);
    expect(result?.staleDocs.map(({ channel, action }) => [channel, action])).toEqual([['docs', 'skipped']]);

    const rows = readStaleDocsForPlan(root, PLAN_STUB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'sighting',
      planStub: PLAN_STUB,
      sessionId: SESSION_ID,
      where: 'context/triage.md:12',
      what: 'says three channels, the code has four',
    });
  });
});
