/**
 * Tests for the plan format's entry: the surface the `./plan` subpath
 * exposes, and how a module inside the package reaches it.
 *
 * The export list is spelled HERE rather than read off the modules, so
 * a name added to the entry or dropped from it fails a case instead of
 * agreeing with itself. Each value is held identical to its module's
 * own, which tells a re-export apart from a copy or a wrapper answering
 * the same thing.
 *
 * The pipeline cases run a plan through the entry alone, the way a
 * caller importing only `./plan` would: read its blocks, parse it, and
 * render a declared task in every mode the entry names. One more reads a
 * session's report, and an output without one, through the entry. And
 * one checks a PREREQUISITES file the same way: parse it, merge it into
 * a config holding no item, and run the preflight over the merge with a
 * stand-in probe runner answering the probe's failure, so the halt it
 * words is the one `loop start` would stop on.
 *
 * The resolution cases pin why the entry is imported as
 * `./plan/index.js` from `src/`. Measured on bun 1.3.14 before this
 * entry existed, that specifier threw `Cannot find module` from `src/`,
 * which is the control that the case can fail; `./plan` and `./plan.js`
 * resolved to the `rafa plan` command then, as they do now.
 *
 * Seven mutations of the entry were driven against this file, one run
 * each, with the unmutated entry green before them and restored
 * byte-identical after, and every one reddened at least one case:
 * `renderInjection`'s export dropped, `parseTaskDeclaration` exported as
 * well, `parsePlan` exported as a wrapper, `INJECT_MODES` exported as a
 * copy, the block reader's two functions exported under each other's
 * names (red on the block case too), `RAFA_BLOCK_KINDS` exported as
 * `PLAN_BLOCK_KINDS`, and `renderInjection` exported as a wrapper
 * forcing `full` (red on the `stage` and `task` renderings too). The
 * parse case went red under none of them; a wrong `parsePlan` is caught
 * by its identity case. Four more were driven the same way when the
 * report parser joined the entry: `parseReport`'s export dropped (red on
 * the name list, its identity case and the report case), `parseReport`
 * exported as a wrapper, `FINDING_KINDS` exported as a copy, and
 * `FINDING_SIGNALS` exported as `REPORT_STATUSES`, each of the last
 * three red on its identity case alone.
 *
 * Four more were driven on 2026-09-15 when the preflight and the
 * PREREQUISITES parser joined the entry, one run each over this file,
 * `src/index.test.ts` and `src/tests/package-build.test.ts`, with 161
 * pass before and after and every file restored byte-identical (sha256):
 * `runPreflight`'s export dropped (red on the name list, its identity
 * case and the PREREQUISITES case, and the other two files each reported
 * an error, both importing the root that re-exports it),
 * `mergePlanPrerequisites` exported as a wrapper dropping the plan's
 * items (red on its identity case and the PREREQUISITES case),
 * `forkWorktree` exported as well (red on the name list), and `Database`
 * re-exported from `bun:sqlite` (red on the name list, and on the node
 * case of `package-build.test.ts`).
 *
 * The type names are not checked here, and `check-types` skips this
 * file. Checked through a tsconfig outside the repo, a probe importing
 * all thirty-three compiled, and one importing `TaskDeclaration`, which
 * the entry leaves out, failed with TS2305. Checked again on 2026-09-15,
 * a probe re-exporting all fifty-one the entry now exports compiled, and
 * one naming `ForkOptions`, which the entry leaves out, failed with
 * TS2305.
 */
import type { PlanTask } from './index.js';

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { INJECT_MODES } from '../config.js';
import {
  loadPlanPrerequisites,
  mergePlanPrerequisites,
  parsePrerequisites,
  planPrerequisites,
  prerequisitesPathForPlan,
} from '../preflight/prerequisites-md.js';
import { PROBE_TIMEOUT_MS, runPreflight, runShellProbe } from '../preflight/run.js';
import { FINDING_KINDS, FINDING_SIGNALS, parseReport, REPORT_STATUSES } from '../report/parse.js';

import { isRafaBlockKind, RAFA_BLOCK_KINDS, readRafaBlocks } from './blocks.js';
import { renderInjection } from './inject.js';
import { parsePlan, PLAN_BLOCK_KINDS, PLAN_HEADER_FIELDS } from './parse.js';

import * as entry from './index.js';

/** The runtime names the entry exposes, sorted as `sort` sorts them. */
const RUNTIME_EXPORTS = [
  'FINDING_KINDS',
  'FINDING_SIGNALS',
  'INJECT_MODES',
  'PLAN_BLOCK_KINDS',
  'PLAN_HEADER_FIELDS',
  'PROBE_TIMEOUT_MS',
  'RAFA_BLOCK_KINDS',
  'REPORT_STATUSES',
  'isRafaBlockKind',
  'loadPlanPrerequisites',
  'mergePlanPrerequisites',
  'parsePlan',
  'parsePrerequisites',
  'parseReport',
  'planPrerequisites',
  'prerequisitesPathForPlan',
  'readRafaBlocks',
  'renderInjection',
  'runPreflight',
  'runShellProbe',
];

/** Each runtime name, the entry's value for it, and its module's own. */
const REEXPORTS: readonly (readonly [string, unknown, unknown])[] = [
  ['FINDING_KINDS', entry.FINDING_KINDS, FINDING_KINDS],
  ['FINDING_SIGNALS', entry.FINDING_SIGNALS, FINDING_SIGNALS],
  ['INJECT_MODES', entry.INJECT_MODES, INJECT_MODES],
  ['PLAN_BLOCK_KINDS', entry.PLAN_BLOCK_KINDS, PLAN_BLOCK_KINDS],
  ['PLAN_HEADER_FIELDS', entry.PLAN_HEADER_FIELDS, PLAN_HEADER_FIELDS],
  ['PROBE_TIMEOUT_MS', entry.PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS],
  ['RAFA_BLOCK_KINDS', entry.RAFA_BLOCK_KINDS, RAFA_BLOCK_KINDS],
  ['REPORT_STATUSES', entry.REPORT_STATUSES, REPORT_STATUSES],
  ['isRafaBlockKind', entry.isRafaBlockKind, isRafaBlockKind],
  ['loadPlanPrerequisites', entry.loadPlanPrerequisites, loadPlanPrerequisites],
  ['mergePlanPrerequisites', entry.mergePlanPrerequisites, mergePlanPrerequisites],
  ['parsePlan', entry.parsePlan, parsePlan],
  ['parsePrerequisites', entry.parsePrerequisites, parsePrerequisites],
  ['parseReport', entry.parseReport, parseReport],
  ['planPrerequisites', entry.planPrerequisites, planPrerequisites],
  ['prerequisitesPathForPlan', entry.prerequisitesPathForPlan, prerequisitesPathForPlan],
  ['readRafaBlocks', entry.readRafaBlocks, readRafaBlocks],
  ['renderInjection', entry.renderInjection, renderInjection],
  ['runPreflight', entry.runPreflight, runPreflight],
  ['runShellProbe', entry.runShellProbe, runShellProbe],
];

/** The `src/` directory, which the `rafa plan` command sits in. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** Joins lines into a document ending in a newline, as an editor saves one. */
function doc(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** A header, both contexts, and two tasks, the second one declared. */
const PLAN = doc(
  '# Plan: Entry',
  '',
  '```rafa:plan',
  'stub: entry-fixture',
  '```',
  '',
  '```rafa:context',
  'Every task reads the plan through the entry.',
  '```',
  '',
  '# Stage: only',
  '',
  '```rafa:stage-context',
  'This stage has two tasks.',
  '```',
  '',
  '- [ ] Read the plan',
  '- [ ] Render the task  {agent=loop-implementer}',
);

/** The declared task, as the entry's parser reads it. */
function declaredTask(): PlanTask {
  const found = entry.parsePlan(PLAN).tasks.find((task) => task.text === 'Render the task');
  if (found === undefined) {
    throw new Error('the fixture holds no task "Render the task"');
  }
  return found;
}

describe('the ./plan entry', () => {
  it('exports exactly the runtime names it declares', () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it.each(REEXPORTS)('re-exports %s itself, not a copy or a wrapper', (_name, value, own) => {
    expect(value).toBe(own);
  });
});

describe('a plan read through the entry alone', () => {
  it('reads every block, each of a kind the entry names', () => {
    const blocks = entry.readRafaBlocks(PLAN);

    expect(blocks.map((block) => block.kind)).toEqual(['plan', 'context', 'stage-context']);
    expect(blocks.every((block) => entry.isRafaBlockKind(block.kind))).toBe(true);
  });

  it('parses the header, both contexts and the declared task', () => {
    const model = entry.parsePlan(PLAN);

    expect(model.header).toMatchObject({ stub: 'entry-fixture' });
    expect(model.context).toBe('Every task reads the plan through the entry.');
    expect(model.stages).toMatchObject([
      { name: 'only', context: 'This stage has two tasks.' },
    ]);
    expect(declaredTask().declaration).not.toBeNull();
    expect(model.issues).toEqual([]);
  });

  it.each([...entry.INJECT_MODES])('renders %s for a task the entry parsed, with no fallback', (mode) => {
    const task = declaredTask();
    const rendered = entry.renderInjection({
      mode,
      plan: PLAN,
      task: { task: task.task, lineNum: task.lineNum },
    });

    expect(rendered).toMatchObject({ requested: mode, mode, fallback: null });
  });
});

describe('a session output read through the entry alone', () => {
  it('reads a report block into its findings, and an output without one into an absence', () => {
    const output = doc(
      'Done.',
      '```rafa:report',
      'status: done',
      'findings:',
      '  - trigger: "when reading a report through the entry"',
      '    kind: pattern',
      '    what: "the entry reaches the report parser"',
      '    signal: silent',
      '```',
    );

    expect(entry.parseReport(output)).toMatchObject({
      present: true,
      report: { status: 'done', findings: [{ kind: 'pattern', signal: 'silent' }] },
      issues: [],
    });
    expect(entry.parseReport(doc('Done.'))).toMatchObject({ present: false, reason: 'no-block' });
  });
});

describe('a PREREQUISITES file checked through the entry alone', () => {
  it('parses the file named beside a plan, merges it and halts on the probe that failed', async () => {
    const content = doc(
      '# Prerequisites',
      '',
      '## Checks [auto]',
      '',
      '- [ ] Bun is installed: `bun --version`',
      '',
      '## Manual',
      '',
      '- [ ] Merge the pull request',
    );
    const probes: string[] = [];
    const warnings: string[] = [];
    const items = entry.mergePlanPrerequisites({ prerequisitesRequired: [], prerequisitesOptional: [] }, content);
    const report = await entry.runPreflight(items, {
      cwd: SRC_DIR,
      env: {},
      timeoutMs: entry.PROBE_TIMEOUT_MS,
      runProbe: (probe) => {
        probes.push(probe);
        return Promise.resolve({ exitCode: 127, stderr: 'sh: bun: not found\n', timedOut: false });
      },
      warn: (message) => {
        warnings.push(message);
      },
      now: () => 0,
    });

    expect(entry.prerequisitesPathForPlan(join(SRC_DIR, 'PLAN-entry.md'))).toBe(join(SRC_DIR, 'PREREQUISITES-entry.md'));
    expect(entry.parsePrerequisites(content).map((item) => item.tag)).toEqual(['auto', 'human']);
    expect(items.required).toMatchObject([{ probe: 'bun --version' }]);
    expect(items.reminders).toMatchObject([{ description: 'Merge the pull request', tag: 'human' }]);
    expect(probes).toEqual(['bun --version']);
    expect(report.halt).toContain('preflight halted: 1 required item failed');
    expect(report.halt).toContain('probe `bun --version` exited 127: sh: bun: not found');
    expect(report.knownMissing).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('importing the entry from src/', () => {
  it('reaches this entry as ./plan/index.js', () => {
    expect(Bun.resolveSync('./plan/index.js', SRC_DIR)).toBe(join(SRC_DIR, 'plan', 'index.ts'));
  });

  it.each(['./plan', './plan.js'])('leaves %s resolving to the rafa plan command', (specifier) => {
    expect(Bun.resolveSync(specifier, SRC_DIR)).toBe(join(SRC_DIR, 'plan.ts'));
  });
});
