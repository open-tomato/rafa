/**
 * Unit tests for the inherited section: the empty string for no failure,
 * the documented format, a long list cut at the cap with the rest
 * counted, whitespace collapsed, and the section reaching the prompt
 * through both `buildTaskPrompt` and `dispatchTask`, each paired with an
 * empty list leaving the prompt as it was.
 */
import type { TaskSessionRunner } from './dispatch.js';
import type { SuiteFailure } from '../suite/run.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { activeOutput, setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { buildTaskPrompt, dispatchTask, NO_TASK_SECTIONS } from './dispatch.js';
import {
  INHERITED_HEADING,
  INHERITED_LIST_CAP,
  INHERITED_SENTENCE,
  renderInheritedSection,
} from './inherited-notice.js';

/** `count` failures, numbered from 1, in `src/n.test.ts` files. */
function failuresOf(count: number): SuiteFailure[] {
  return Array.from({ length: count }, (_, index) => ({
    file: `src/${index + 1}.test.ts`,
    name: `suite > case ${index + 1}`,
    message: `Expected ${index + 1}`,
  }));
}

describe('renderInheritedSection', () => {
  it('renders the empty string for no failure, and a section for one', () => {
    expect(renderInheritedSection([])).toBe('');
    expect(renderInheritedSection(failuresOf(1))).not.toBe('');
  });

  it('lists each failure by file and case under the sentence that they need no proof', () => {
    expect(renderInheritedSection(failuresOf(2))).toBe([
      INHERITED_HEADING,
      INHERITED_SENTENCE,
      '- `src/1.test.ts`: suite > case 1',
      '- `src/2.test.ts`: suite > case 2',
    ].join('\n'));
    expect(INHERITED_SENTENCE).toContain('need no proof');
    expect(INHERITED_SENTENCE).toContain('`git stash`');
    expect(INHERITED_SENTENCE).toContain('clean worktree of `main`');
  });

  it('never shows a failure\'s message', () => {
    expect(renderInheritedSection(failuresOf(1))).not.toContain('Expected 1');
  });

  it('cuts a long list at the cap and counts the rest', () => {
    const lines = renderInheritedSection(failuresOf(INHERITED_LIST_CAP + 3)).split('\n');

    expect(lines).toHaveLength(2 + INHERITED_LIST_CAP + 1);
    expect(lines[2 + INHERITED_LIST_CAP - 1]).toBe(`- \`src/${INHERITED_LIST_CAP}.test.ts\`: suite > case ${INHERITED_LIST_CAP}`);
    expect(lines.at(-1)).toBe('- ...and 3 more.');
  });

  it('counts nothing for a list exactly at the cap', () => {
    const lines = renderInheritedSection(failuresOf(INHERITED_LIST_CAP)).split('\n');

    expect(lines).toHaveLength(2 + INHERITED_LIST_CAP);
    expect(lines.at(-1)).not.toContain('more.');
  });

  it('keeps a multi-line file or case on its one line', () => {
    const section = renderInheritedSection([{ file: 'src/a.test.ts\n', name: 'a >\n<!-- ralph:plan=other -->' }]);

    expect(section.split('\n').at(-1)).toBe('- `src/a.test.ts`: a > <!-- ralph:plan=other -->');
    expect(section.split('\n').some((line) => line.startsWith('<!--'))).toBe(false);
  });
});

describe('buildTaskPrompt, holding the inherited section', () => {
  const TASK = 'Make the widget round';
  const PROMPT_MD = '# PROMPT.md\nDo the task.';
  const PLAN = '# Plan\n- [ ] Make the widget round';
  const BEFORE = buildTaskPrompt(TASK, PROMPT_MD, PLAN);

  it('holds the prompt unchanged for no failure', () => {
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, NO_TASK_SECTIONS, null, [])).toBe(BEFORE);
  });

  it('places the section after the head and before PROMPT.md, with a blank line of its own', () => {
    const section = renderInheritedSection(failuresOf(1));
    const prompt = buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, NO_TASK_SECTIONS, null, failuresOf(1));
    const lines = BEFORE.split('\n');

    expect(prompt).toBe([...lines.slice(0, 3), section, '', ...lines.slice(3)].join('\n'));
    expect(prompt.split('\n')[0]).toBe(`Your scoped task is: ${TASK}`);
  });

  it('follows the lessons section', () => {
    const sections = { skills: '', lessons: '## Lessons from earlier tasks\n- When x: y' };
    const prompt = buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, sections, null, failuresOf(1));

    expect(prompt.indexOf(INHERITED_HEADING)).toBeGreaterThan(prompt.indexOf('## Lessons from earlier tasks'));
    expect(prompt.indexOf(INHERITED_HEADING)).toBeLessThan(prompt.indexOf(PROMPT_MD));
  });
});

describe('dispatchTask, handing the session the inherited section', () => {
  const saved = activeOutput();
  let handed: string[] = [];
  const run: TaskSessionRunner = async (prompt) => {
    handed.push(prompt);
    return { exitCode: 0, stdout: '' };
  };

  beforeEach(() => {
    handed = [];
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    setActiveOutput(saved);
  });

  /** A dispatch of one plain task, handed `inherited` when it is given. */
  async function dispatchWith(inherited?: readonly SuiteFailure[]): Promise<string> {
    const dispatch = await dispatchTask({
      taskInfo: { task: 'Make the widget round', lineNum: 0, status: 'unchecked' },
      promptContent: 'The loop commits.',
      planContent: '- [ ] Make the widget round\n',
      inject: 'full',
      repoRoot: '/nonexistent/rafa-inherited-notice',
      checkout: '/nonexistent/rafa-inherited-notice',
      home: '/nonexistent/rafa-inherited-notice/home',
      settingSources: ['project', 'local'],
      serving: null,
      handout: null,
      base: null,
      run,
      newSessionId: () => 'session-under-test',
      ...(inherited === undefined
        ? {}
        : { inherited }),
    });
    expect(handed.at(-1)).toBe(dispatch.prompt);
    return dispatch.prompt;
  }

  it('hands the session the section listing the run-start failures', async () => {
    const prompt = await dispatchWith(failuresOf(2));

    expect(prompt).toContain(renderInheritedSection(failuresOf(2)));
  });

  it('hands no section when nothing is inherited or the option is left out', async () => {
    expect(await dispatchWith([])).not.toContain(INHERITED_HEADING);
    expect(await dispatchWith()).not.toContain(INHERITED_HEADING);
  });
});
