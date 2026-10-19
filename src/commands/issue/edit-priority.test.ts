/**
 * Tests for the priority half of `rafa issue edit` (`./edit-priority.ts`):
 * the `--priority` line reading and its refusals, the refusal on a
 * tracker whose `edit` writes no priority, the `already` answer, the
 * swap line and the planned edit.
 *
 * Each refusal sits beside a passing control differing only in what the
 * refusal reads. The last two groups hand a planned change to the
 * `local` tracker over a temporary directory and to the `github` tracker
 * over the recorded fake (`github-fake.ts`), so the `already` rule is
 * measured against what each adapter writes rather than restated. One
 * case hands a plan to `writeHeld` of `./edit-run.ts`, which is how the
 * plan's shape is held to the one that module's run takes. No case
 * reaches GitHub or spawns a process.
 */
import type { LineFlags } from './issue-tracker.js';
import type { EditableIssue, IssuePriority, IssueRef, Tracker } from '@open-tomato/rafa/ports';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { draftFixture } from '../../adapters/tracker/contract.js';
import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { ISSUE_PRIORITIES } from '../../adapters/tracker/issue-values.js';
import { createLocalTracker } from '../../adapters/tracker/local.js';

import { PRIORITY_FLAG } from './declarations.js';
import {
  holdsPriorityAlone,
  planPriorityEdit,
  PRIORITY_RIVALS,
  priorityMessage,
  readPriorityFlag,
  requireHeldPriority,
  swapLine,
} from './edit-priority.js';
import { writeHeld } from './edit-run.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-edit-priority-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const USAGE = 'rafa issue edit <n> --priority=<priority>';
const NAME = 'github issue 12';
const BODY = 'Codes stay valid one step too long.\n';
const TITLE = 'Replay window';

/** A ref to issue `externalId` on a tracker of `kind`. */
function refOf(kind: string, externalId = '12'): IssueRef {
  return { opt: 0, kind, externalId, url: null };
}

/** An issue as `editable` answers it on GitHub, with any field replaced. */
function found(overrides: Partial<EditableIssue> = {}): EditableIssue {
  return {
    ref: refOf('github'),
    title: TITLE,
    body: BODY,
    open: true,
    labels: ['type:bug', 'needs-triage'],
    author: 'octocat',
    priority: null,
    ...overrides,
  };
}

/** The `CommandExit` `act` throws. Throws when it throws none. */
function exitOf(act: () => unknown): CommandExit {
  try {
    act();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and nothing was thrown');
}

/** The tracker's pair. Throws when it lacks either member. */
function pairOf(tracker: Tracker): { editable: NonNullable<Tracker['editable']>; edit: NonNullable<Tracker['edit']> } {
  const { editable, edit } = tracker;
  if (editable === undefined || edit === undefined) throw new Error(`the ${tracker.kind} tracker has no editable and edit pair`);
  return { editable, edit };
}

describe('reading --priority off the line', () => {
  it('names the flag and the three flags it is refused beside', () => {
    expect(PRIORITY_FLAG).toBe('priority');
    expect(PRIORITY_RIVALS).toEqual(['append-file', 'append', 'replace-file']);
  });

  it('answers undefined for a line that leaves it out, whatever else the line holds', () => {
    const lines: LineFlags[] = [
      {},
      { 'append': 'text', 'reason': 'why' },
      { 'append-file': 'update.md', 'reason': 'why' },
      { 'replace-file': 'spec.md', 'title': 'New' },
    ];

    for (const flags of lines) expect(readPriorityFlag(flags, USAGE)).toBeUndefined();
  });

  it.each([...ISSUE_PRIORITIES])('answers %s as typed', (priority) => {
    expect(readPriorityFlag({ priority }, USAGE)).toBe(priority);
  });

  it('holds four priorities to read, so the case above ran', () => {
    expect(ISSUE_PRIORITIES).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it.each([
    ['a value outside the priorities', 'p0', '❌ --priority is "p0", expected one of: urgent, high, medium, low'],
    ['a priority in another case', 'High', '❌ --priority is "High", expected one of: urgent, high, medium, low'],
    ['a blank value', '', '❌ --priority is "", expected one of: urgent, high, medium, low'],
    ['the flag typed bare', true, '❌ --priority needs a value: --priority=<value>'],
  ] as const)('refuses %s with exit code 1, naming the usage', (_name, value, problem) => {
    const refused = exitOf(() => readPriorityFlag({ priority: value }, USAGE));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe(`${problem}\nUsage: ${USAGE}`);
  });

  it.each([...PRIORITY_RIVALS])('refuses --priority beside --%s with exit code 1, and reads the rival alone', (rival) => {
    const refused = exitOf(() => readPriorityFlag({ priority: 'high', [rival]: 'value' }, USAGE));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe(
      `❌ --priority and --${rival} cannot be used together: one run makes one kind of change,`
      + ` so set the priority in a run of its own\nUsage: ${USAGE}`,
    );
    expect(readPriorityFlag({ [rival]: 'value' }, USAGE)).toBeUndefined();
  });

  it('refuses a rival typed bare or blank too, since the line still names it', () => {
    expect(exitOf(() => readPriorityFlag({ priority: 'high', append: true }, USAGE)).message)
      .toContain('--priority and --append cannot be used together');
    expect(exitOf(() => readPriorityFlag({ 'priority': 'high', 'replace-file': '' }, USAGE)).message)
      .toContain('--priority and --replace-file cannot be used together');
  });

  it('names the first rival in the order of the list when a line holds two', () => {
    const refused = exitOf(() => readPriorityFlag({ 'priority': 'low', 'replace-file': 'spec.md', 'append': 'text' }, USAGE));

    expect(refused.message).toContain('--priority and --append cannot be used together');
  });

  it('refuses the value before the rival, so a mistyped priority is named first', () => {
    const refused = exitOf(() => readPriorityFlag({ priority: 'p0', append: 'text' }, USAGE));

    expect(refused.message).toContain('--priority is "p0"');
  });

  it('reads --priority beside --title, --dry-run and the two append-only flags, which are not its to refuse', () => {
    const flags: LineFlags = { 'priority': 'medium', 'title': 'New', 'dry-run': true, 'reason': 'why', 'while-in-development': true };

    expect(readPriorityFlag(flags, USAGE)).toBe('medium');
  });
});

describe('a tracker whose edit writes no priority', () => {
  it('is refused with exit code 1, naming its kind', () => {
    const lacking: EditableIssue = { ref: refOf('linear'), title: TITLE, body: BODY, open: true, labels: [], author: '' };

    const refused = exitOf(() => requireHeldPriority(lacking));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe('❌ The linear tracker cannot set a priority: its edit writes none.');
  });

  it('is refused for a planned edit too, with the same sentence', () => {
    const lacking: EditableIssue = { ref: refOf('linear'), title: TITLE, body: BODY, open: true, labels: [], author: '' };

    const refused = exitOf(() => planPriorityEdit({ priority: 'high', title: null }, lacking));

    expect(refused.message).toBe('❌ The linear tracker cannot set a priority: its edit writes none.');
  });

  it.each([
    ['null for an issue triage has set none for', null],
    ['the priority an issue holds', 'low'],
  ] as const)('answers %s on a tracker that reads one', (_name, priority) => {
    expect(requireHeldPriority(found({ priority }))).toBe(priority);
  });
});

describe('holding a priority alone', () => {
  it.each([
    ['its label and nothing of triage', 'high', ['type:bug', 'priority:high'], true],
    ['no label at all, as the local tracker answers', 'high', [], true],
    ['the triage label beside it', 'high', ['priority:high', 'needs-triage'], false],
    ['a second priority label after it', 'high', ['priority:high', 'priority:low'], false],
    ['a priority label the port does not name beside it', 'high', ['priority:high', 'priority:p0'], false],
  ] as const)('reads an issue holding %s', (_name, priority, labels, alone) => {
    expect(holdsPriorityAlone({ priority, labels }, priority)).toBe(alone);
  });

  it.each([
    ['another priority', 'low'],
    ['none', null],
    ['no reading of one', undefined],
  ] as const)('is false for an issue holding %s', (_name, held) => {
    expect(holdsPriorityAlone({ priority: held, labels: [] }, 'high')).toBe(false);
  });
});

describe('the swap line', () => {
  it.each([
    ['needs-triage for an issue holding none', null, 'high', 'priority: needs-triage → high'],
    ['the priority the issue holds', 'low', 'urgent', 'priority: low → urgent'],
    ['the same priority twice when it is held already', 'medium', 'medium', 'priority: medium → medium'],
  ] as const)('names %s, an arrow and the new one', (_name, held, priority, line) => {
    expect(swapLine(held, priority)).toBe(line);
  });
});

describe('planning a priority edit', () => {
  it('plans a priority alone as a change naming it, with no text for gate 3 and the body kept', () => {
    const planned = planPriorityEdit({ priority: 'high', title: null }, found());

    expect(planned).toEqual({
      added: '',
      shown: 'priority: needs-triage → high',
      block: null,
      after: BODY,
      already: false,
      change: { priority: 'high' },
    });
  });

  it('plans a priority beside a title as one change, the title being the text gate 3 reads', () => {
    const planned = planPriorityEdit({ priority: 'urgent', title: 'Replay window, off by one' }, found({ priority: 'low' }));

    expect(planned).toEqual({
      added: 'Replay window, off by one',
      shown: 'Replay window, off by one\n\npriority: low → urgent',
      block: null,
      after: BODY,
      already: false,
      change: { title: 'Replay window, off by one', priority: 'urgent' },
    });
  });

  it('answers already for an issue holding the priority alone, and not for one still in triage', () => {
    const settled = found({ priority: 'high', labels: ['type:bug', 'priority:high'] });
    const inTriage = found({ priority: 'high', labels: ['type:bug', 'priority:high', 'needs-triage'] });

    expect(planPriorityEdit({ priority: 'high', title: null }, settled).already).toBe(true);
    expect(planPriorityEdit({ priority: 'high', title: null }, inTriage).already).toBe(false);
    expect(planPriorityEdit({ priority: 'low', title: null }, settled).already).toBe(false);
  });

  it('never answers already beside a title, which is written whatever the priority', () => {
    const settled = found({ priority: 'high', labels: ['priority:high'] });

    const planned = planPriorityEdit({ priority: 'high', title: TITLE }, settled);

    expect(planned.already).toBe(false);
    expect(planned.change).toEqual({ title: TITLE, priority: 'high' });
  });
});

describe('the sentence of a priority edit', () => {
  it.each([
    ['a priority set', { priority: 'high', title: null }, false, `Set the priority of ${NAME} to high; it is out of triage.`],
    [
      'a priority set beside a title',
      { priority: 'low', title: 'New' },
      false,
      `Changed the title of ${NAME} and set its priority to low; it is out of triage.`,
    ],
    [
      'a priority held already',
      { priority: 'medium', title: null },
      true,
      `${NAME} already holds priority medium and is out of triage; nothing was written.`,
    ],
  ] as const)('words %s', (_name, edit, already, sentence) => {
    expect(priorityMessage(edit, already, NAME)).toBe(sentence);
  });
});

describe('a planned change over the local tracker', () => {
  it('is written by edit and read back, and the same line then answers already', async () => {
    const tracker = createLocalTracker({ issuesDir: join(tempBase, 'local-issues'), fallbackReason: null });
    const { editable, edit } = pairOf(tracker);
    const ref = await tracker.create(draftFixture({ priority: null }));
    const before = await editable(ref);
    const request = { priority: 'high', title: null } as const;

    const planned = planPriorityEdit(request, before);
    expect(planned.shown).toBe('priority: needs-triage → high');
    expect(planned.already).toBe(false);
    await edit(ref, planned.change);

    const after = await editable(ref);
    expect(after).toEqual({ ...before, priority: 'high' });
    expect((await tracker.get(ref)).priority).toBe('high');
    expect(planPriorityEdit(request, after).already).toBe(true);
  });

  it('hands the run a plan its post-write check takes, the body read back as it was', async () => {
    const tracker = createLocalTracker({ issuesDir: join(tempBase, 'local-held'), fallbackReason: null });
    const { editable, edit } = pairOf(tracker);
    const ref = await tracker.create(draftFixture({ priority: 'low' }));
    const before = await editable(ref);

    const planned = planPriorityEdit({ priority: 'urgent', title: 'Replay window, off by one' }, before);
    await edit(ref, planned.change);
    const after = await editable(ref);

    expect(after).toEqual({ ...before, title: 'Replay window, off by one', priority: 'urgent' });
    expect(writeHeld(before, planned, after)).toBe(true);
    // The control: the same plan over a re-read whose title was not kept.
    expect(writeHeld(before, planned, { ...after, title: before.title })).toBe(false);
  });
});

describe('a planned change over the github fake', () => {
  /** A github tracker over a fresh fake holding issue 1 with `priority`, and the fake. */
  async function overOneIssue(priority: IssuePriority | null): Promise<{ tracker: Tracker; fake: ReturnType<typeof createFakeGh> }> {
    const fake = createFakeGh();
    const tracker = createGithubTracker({ gh: fake.run });
    await tracker.create(draftFixture({ opt: 0, priority }));
    return { tracker, fake };
  }

  /** The `gh issue edit` commands in `calls`. */
  function editsIn(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
    return calls.filter((call) => call[0] === 'issue' && call[1] === 'edit');
  }

  it('takes an issue out of triage in one gh issue edit, and the same line then answers already', async () => {
    const { tracker, fake } = await overOneIssue(null);
    const { editable, edit } = pairOf(tracker);
    const ref = refOf('github', '1');
    const request = { priority: 'high', title: null } as const;
    const before = await editable(ref);

    const planned = planPriorityEdit(request, before);
    expect(planned.shown).toBe('priority: needs-triage → high');
    await edit(ref, planned.change);

    expect(editsIn(fake.calls())).toEqual([['issue', 'edit', '1', '--add-label', 'priority:high', '--remove-label', 'needs-triage']]);
    const after = await editable(ref);
    expect(after.labels).toEqual(['module:auth', 'type:bug', 'priority:high']);
    expect(planPriorityEdit(request, after).already).toBe(true);
  });

  it('answers already exactly where the adapter has nothing to send', async () => {
    const { tracker, fake } = await overOneIssue('high');
    const { editable, edit } = pairOf(tracker);
    const ref = refOf('github', '1');
    const request = { priority: 'high', title: null } as const;

    // Held alone: `already`, and the adapter sends no edit for the same change.
    const settled = planPriorityEdit(request, await editable(ref));
    expect(settled.already).toBe(true);
    await edit(ref, settled.change);
    expect(editsIn(fake.calls())).toEqual([]);

    // Back in triage beside its priority: not `already`, and the adapter sends one edit.
    fake.update('1', (issue) => ({ ...issue, labels: [...issue.labels, 'needs-triage'] }));
    const inTriage = planPriorityEdit(request, await editable(ref));
    expect(inTriage.already).toBe(false);
    await edit(ref, inTriage.change);
    expect(editsIn(fake.calls())).toEqual([['issue', 'edit', '1', '--remove-label', 'needs-triage']]);
  });
});
