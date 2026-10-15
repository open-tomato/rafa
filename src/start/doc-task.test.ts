/**
 * Tests for `docTaskPrompt` and `docTaskBaseRef` (`start/doc-task.ts`),
 * and for `dispatchTask` (`start/dispatch.ts`) handing the doc task's
 * section to the task declared `docs=repair` and to no other.
 *
 * Git is a recording fake and the rows come through the `readRows` seam,
 * so no store and no repository is opened. Each case where the section
 * is absent is paired with the `docs=repair` case that shows the same
 * place does put it in, so an absence is never a section that could not
 * have rendered. The lines the dispatch prints go to a sink output set
 * for each case and unset after it.
 */
import type { TaskSessionRunner } from './dispatch.js';
import type { DocTaskPlace } from './doc-task.js';
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { StaleDocRow } from '@open-tomato/rafa/store/stale-docs';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { parseTaskDeclaration } from '@open-tomato/rafa/core/plan';

import { DOC_TASK_HEADING, NO_SIGHTINGS_LINE } from '../docs/task-reading.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { dispatchTask } from './dispatch.js';
import { docTaskBaseRef, docTaskPrompt } from './doc-task.js';

/** The project root and checkout every case names; nothing is read there. */
const ROOT = '/work/project';
/** The home the section is redacted of. */
const HOME = '/home/someone';
/** The plan whose rows the seam answers. */
const PLAN = 'rafa-9-doc-plan';
/** The `PROMPT.md` text every case hands in. */
const PROMPT_MD = '# PROMPT.md\nDo the task.';
/** The doc task's line. */
const DOC_LINE = 'Repair the docs of what this plan changed  {agent=doc-updater docs=repair}';
/** Every other line a plan holds, each of which gets no section. */
const OTHER_LINES = [
  'Add the module  {agent=loop-implementer effort=medium}',
  'Rewrite the page  {agent=doc-updater}',
  'Rewrite the page  {agent=doc-updater docs=rewrite}',
  'Add the module',
];

/** A git result. */
function result(ok: boolean, stdout = ''): GitResult {
  return { ok, stdout, stderr: '' };
}

/** A fake git whose `origin/<base>` resolves when `remote` is true, recording each call. */
function fakeGit(calls: string[][], remote = true): GitRunner {
  return (args) => {
    calls.push([...args]);
    if (args[0] === 'symbolic-ref') return result(true, 'origin/main\n');
    if (args[0] === 'rev-parse') return result(remote);
    if (args[0] === 'merge-base') return result(true, 'abc123\n');
    if (args[0] === 'diff') return result(true, 'src/triage/triage.ts\0context/triage.md\0');
    return result(false);
  };
}

/** One `sighting` row of {@link PLAN}. */
function row(where: string | null, what: string): StaleDocRow {
  return {
    id: `${where ?? 'none'}-${what}`,
    sessionId: 'session-1',
    planStub: PLAN,
    taskLine: 'Add the module',
    kind: 'sighting',
    where,
    what,
    outcome: 'done',
    collectedAt: '2026-10-14T00:00:00.000Z',
  };
}

/** A place answering two rows, with git faked over `calls`. */
function place(calls: string[][], overrides: Partial<DocTaskPlace> = {}): DocTaskPlace {
  return {
    planStub: PLAN,
    prBase: 'integration',
    git: fakeGit(calls),
    readRows: () => [row('context/triage.md:12', 'names three channels'), row(null, 'the README lists seven fields')],
    ...overrides,
  };
}

/** The prompt `line` is handed through `docTaskPrompt` at `where`. */
function promptFor(line: string, where: DocTaskPlace | null): string {
  return docTaskPrompt(PROMPT_MD, {
    declaration: parseTaskDeclaration(line).declaration,
    repoRoot: ROOT,
    checkout: ROOT,
    home: HOME,
    place: where,
  });
}

describe('docTaskPrompt', () => {
  it('puts the section, a blank line, then PROMPT.md for a task declared docs=repair', () => {
    const calls: string[][] = [];

    const prompt = promptFor(DOC_LINE, place(calls));

    expect(prompt.startsWith(`${DOC_TASK_HEADING}\n`)).toBe(true);
    expect(prompt.endsWith(`\n\n${PROMPT_MD}`)).toBe(true);
    expect(prompt).toContain('- context/triage.md:12: names three channels');
    expect(prompt).toContain('- the README lists seven fields');
    expect(prompt).toContain('- `src/triage/triage.ts`');
    expect(prompt).toContain('- `context/triage.md`');
    expect(prompt).toContain('since it left `origin/integration`');
  });

  it('answers PROMPT.md unchanged for every other task, reading nothing', () => {
    for (const line of OTHER_LINES) {
      const calls: string[][] = [];
      let rowsRead = 0;
      const counting = place(calls, { readRows: () => { rowsRead += 1; return []; } });

      expect(promptFor(line, counting)).toBe(PROMPT_MD);
      expect(calls).toEqual([]);
      expect(rowsRead).toBe(0);
    }
    expect(promptFor(DOC_LINE, place([]))).not.toBe(PROMPT_MD);
  });

  it('answers PROMPT.md unchanged for the doc task when no place is named', () => {
    expect(promptFor(DOC_LINE, null)).toBe(PROMPT_MD);
    expect(docTaskPrompt(PROMPT_MD, {
      declaration: parseTaskDeclaration(DOC_LINE).declaration,
      repoRoot: ROOT,
      checkout: ROOT,
      home: HOME,
    })).toBe(PROMPT_MD);
  });

  it('reads no row for a run with no plan stub, and hands the touched files alone', () => {
    let rowsRead = 0;
    const calls: string[][] = [];
    const stubless = place(calls, { planStub: null, readRows: () => { rowsRead += 1; return [row(null, 'x')]; } });

    const prompt = promptFor(DOC_LINE, stubless);

    expect(rowsRead).toBe(0);
    expect(prompt).toContain(NO_SIGHTINGS_LINE);
    expect(prompt).toContain('- `src/triage/triage.ts`');
  });

  it('reads the files by git in the checkout and redacts paths under it', () => {
    const checkout = join(ROOT, '.rafa', 'worktrees', 'feat');
    const calls: string[][] = [];
    const prompt = docTaskPrompt(PROMPT_MD, {
      declaration: parseTaskDeclaration(DOC_LINE).declaration,
      repoRoot: ROOT,
      checkout,
      home: HOME,
      place: place(calls, { readRows: () => [row(`${checkout}/context/a.md`, 'stale')] }),
    });

    expect(prompt).toContain('- context/a.md: stale');
    expect(prompt).not.toContain(checkout);
    expect(calls.map((call) => call[0])).toEqual(['rev-parse', 'merge-base', 'diff']);
  });
});

describe('docTaskBaseRef', () => {
  it('names origin/<base> when that ref resolves, and the bare base when it does not', () => {
    const calls: string[][] = [];

    expect(docTaskBaseRef(fakeGit(calls), 'integration')).toBe('origin/integration');
    expect(calls).toEqual([['rev-parse', '--verify', '--quiet', 'origin/integration^{commit}']]);
    expect(docTaskBaseRef(fakeGit([], false), 'integration')).toBe('integration');
  });

  it('falls back to the branch origin HEAD names when pr.base is null', () => {
    const calls: string[][] = [];

    expect(docTaskBaseRef(fakeGit(calls), null)).toBe('origin/main');
    expect(calls[0]?.[0]).toBe('symbolic-ref');
  });
});

describe('dispatchTask, handing the doc task its section', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  /** Dispatches `line` through the run seam and answers the prompt the runner was handed. */
  async function dispatchedPrompt(line: string, where: DocTaskPlace | null): Promise<string> {
    const prompts: string[] = [];
    const run: TaskSessionRunner = (prompt) => {
      prompts.push(prompt);
      return Promise.resolve({ exitCode: 0, stdout: '' });
    };
    setActiveOutput(sinkOutput({}));
    const dispatch = await dispatchTask({
      taskInfo: { task: line, lineNum: 0, status: 'unchecked' },
      promptContent: PROMPT_MD,
      planContent: `- [ ] ${line}\n`,
      inject: 'full',
      repoRoot: ROOT,
      checkout: ROOT,
      home: HOME,
      settingSources: ['project', 'local'],
      serving: null,
      handout: null,
      base: null,
      docTask: where,
      run,
      newSessionId: () => 'session-under-test',
    });
    expect(dispatch.prompt).toBe(prompts[0] ?? '');
    return dispatch.prompt;
  }

  it('holds the section in the prompt of the task declared docs=repair, ahead of PROMPT.md', async () => {
    const prompt = await dispatchedPrompt(DOC_LINE, place([]));

    expect(prompt).toContain(`\n${DOC_TASK_HEADING}\n`);
    expect(prompt).toContain('- context/triage.md:12: names three channels');
    expect(prompt.indexOf(DOC_TASK_HEADING)).toBeLessThan(prompt.indexOf(PROMPT_MD));
  });

  it('holds no section in the prompt of every other task', async () => {
    for (const line of OTHER_LINES) {
      const prompt = await dispatchedPrompt(line, place([]));

      expect(prompt).not.toContain(DOC_TASK_HEADING);
    }
  });

  it('holds no section in the doc task\'s prompt when the dispatch names no place', async () => {
    expect(await dispatchedPrompt(DOC_LINE, null)).not.toContain(DOC_TASK_HEADING);
  });
});
