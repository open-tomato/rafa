/**
 * Tests for the type half of `rafa issue edit` (`./edit-type.ts`): the
 * `--type` line reading and its refusals, the refusal of an issue of
 * neither record type and of a tracker whose `edit` writes no type, the
 * `already` answer, the swap line, the planned edit and its sentence.
 *
 * Each refusal sits beside a passing control differing only in what the
 * refusal reads, and every refusal group opens its `describe`. The last
 * groups run the whole edit: `readEditLine` and `runIssueEdit` of
 * `./edit-run.ts` over the `local` tracker in a temporary directory, so
 * the move is measured against the file it writes, and a planned change
 * handed to the `github` tracker over the recorded fake
 * (`github-fake.ts`), so the `already` rule is measured against the
 * labels that adapter swaps rather than restated. No case reaches
 * GitHub or spawns a process.
 */
import type { EditRequest } from './edit-run.js';
import type { LineFlags } from './issue-tracker.js';
import type { EditableIssue, IssueRef, IssueType, Tracker } from '@open-tomato/rafa/ports';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { afterAll, describe, expect, it } from 'bun:test';

import { draftFixture } from '../../adapters/tracker/contract.js';
import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { createGithubTracker } from '../../adapters/tracker/github.js';
import { ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { createLocalTracker } from '../../adapters/tracker/local.js';

import { ISSUE_RECORD_TYPES, TYPE_FLAG } from './declarations.js';
import {
  EDIT_USAGE,
  readEditLine,
  readEditRequest,
  renderEditReport,
  requireEditingTracker,
  runIssueEdit,
  writeHeld,
} from './edit-run.js';
import {
  EDIT_RECORD_TYPES,
  holdsTypeAlone,
  planTypeEdit,
  readTypeFlag,
  requireRecordType,
  TYPE_RIVALS,
  typeMessage,
  typeSwapLine,
} from './edit-type.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-edit-type-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const USAGE = 'rafa issue edit <n> --type=<bug|debt>';
const NAME = 'github issue 12';
const BODY = 'The help names no --dry-run.\n';
const TITLE = 'cli-gap - issue edit: no --type';
const NOW = new Date('2026-11-27T09:00:00Z');

/** The types outside the record types, which a move refuses. */
const OTHER_TYPES: readonly IssueType[] = ISSUE_TYPES.filter((type) => !EDIT_RECORD_TYPES.includes(type));

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
    labels: ['module:cli-gap', 'type:debt', 'priority:low'],
    author: 'octocat',
    priority: 'low',
    type: 'debt',
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

/** The `CommandExit` `running` rejects with. Throws when it resolves or rejects otherwise. */
async function rejectionOf(running: Promise<unknown>): Promise<CommandExit> {
  try {
    await running;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the run resolved');
}

/** The tracker's pair. Throws when it lacks either member. */
function pairOf(tracker: Tracker): { editable: NonNullable<Tracker['editable']>; edit: NonNullable<Tracker['edit']> } {
  const { editable, edit } = tracker;
  if (editable === undefined || edit === undefined) throw new Error(`the ${tracker.kind} tracker has no editable and edit pair`);
  return { editable, edit };
}

describe('the record types', () => {
  it('are bug and debt, the list issue create files a record for', () => {
    expect(EDIT_RECORD_TYPES).toEqual(['bug', 'debt']);
    expect<readonly string[]>(EDIT_RECORD_TYPES).toEqual(ISSUE_RECORD_TYPES);
    expect(TYPE_FLAG).toBe('type');
  });

  it('leave seven types a move refuses, so the refusal cases below ran', () => {
    expect(OTHER_TYPES).toEqual(['code', 'spike', 'adr', 'chore', 'package-api', 'epic', 'spec']);
  });
});

describe('reading --type off the line', () => {
  it.each([
    ['a type outside the two', 'chore', '❌ --type is "chore", expected one of: bug, debt'],
    ['a record type in another case', 'Bug', '❌ --type is "Bug", expected one of: bug, debt'],
    ['a blank value', '', '❌ --type is "", expected one of: bug, debt'],
    ['the flag typed bare', true, '❌ --type needs a value: --type=<value>'],
  ] as const)('refuses %s with exit code 1, naming the usage', (_name, value, problem) => {
    const refused = exitOf(() => readTypeFlag({ type: value }, USAGE));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe(`${problem}\nUsage: ${USAGE}`);
  });

  it.each([...OTHER_TYPES])('refuses --type=%s, a type a move never writes', (type) => {
    expect(exitOf(() => readTypeFlag({ type }, USAGE)).message).toContain(`--type is "${type}", expected one of: bug, debt`);
  });

  it.each([...TYPE_RIVALS])('refuses --type beside --%s with exit code 1, and reads the rival alone', (rival) => {
    const refused = exitOf(() => readTypeFlag({ type: 'bug', [rival]: 'value' }, USAGE));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe(
      `❌ --type and --${rival} cannot be used together: one run makes one kind of change,`
      + ` so move the type in a run of its own\nUsage: ${USAGE}`,
    );
    expect(readTypeFlag({ [rival]: 'value' }, USAGE)).toBeUndefined();
  });

  it('names the append and replace flags and --priority as its rivals', () => {
    expect(TYPE_RIVALS).toEqual(['append-file', 'append', 'replace-file', 'priority']);
  });

  it('refuses the value before the rival, so a mistyped type is named first', () => {
    expect(exitOf(() => readTypeFlag({ type: 'chore', append: 'text' }, USAGE)).message).toContain('--type is "chore"');
  });

  it('answers undefined for a line that leaves it out, whatever else the line holds', () => {
    const lines: LineFlags[] = [{}, { append: 'text', reason: 'why' }, { 'replace-file': 'spec.md' }, { priority: 'high' }];

    for (const flags of lines) expect(readTypeFlag(flags, USAGE)).toBeUndefined();
  });

  it.each([...EDIT_RECORD_TYPES])('answers %s as typed, beside --title and --dry-run', (type) => {
    expect(readTypeFlag({ type, 'title': 'New', 'dry-run': true }, USAGE)).toBe(type);
  });
});

describe('the issue a move reads', () => {
  it('refuses a tracker whose editable reads no type with exit code 1, naming its kind', () => {
    const untyped: EditableIssue = { ref: refOf('linear'), title: TITLE, body: BODY, open: true, labels: [], author: '' };

    const refused = exitOf(() => requireRecordType(untyped));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe('❌ The linear tracker cannot move an issue\'s type: its edit writes none.');
  });

  it.each([...OTHER_TYPES])('refuses an issue of type %s with exit code 1, naming the two record types', (type) => {
    const refused = exitOf(() => requireRecordType(found({ type })));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe(
      `❌ ${NAME} is of type ${type}: --type moves an issue between bug and debt only, the two types a bug record is filed under.`,
    );
  });

  it.each([...EDIT_RECORD_TYPES])('answers %s for an issue of that type', (type) => {
    expect(requireRecordType(found({ type }))).toBe(type);
  });
});

describe('holding a type alone', () => {
  it.each([
    ['an issue of another type', 'debt', ['type:debt'], false],
    ['a second type label after its own', 'bug', ['type:bug', 'type:debt'], false],
    ['a type label the port does not name beside it', 'bug', ['type:bug', 'type:feature'], false],
    ['its label and others of no type', 'bug', ['module:cli-gap', 'type:bug', 'priority:low'], true],
    ['no label at all, as the local tracker answers', 'bug', [], true],
  ] as const)('reads %s', (_name, held, labels, alone) => {
    expect(holdsTypeAlone({ type: held, labels }, 'bug')).toBe(alone);
  });
});

describe('the swap line and the sentence', () => {
  it('names the type held, an arrow and the new one', () => {
    expect(typeSwapLine('debt', 'bug')).toBe('type: debt → bug');
    expect(typeSwapLine('bug', 'bug')).toBe('type: bug → bug');
  });

  it.each([
    ['a type moved', { type: 'bug', title: null }, false, `Moved ${NAME} to type bug.`],
    ['a type moved beside a title', { type: 'debt', title: 'New' }, false, `Changed the title of ${NAME} and moved it to type debt.`],
    ['a type held already', { type: 'bug', title: null }, true, `${NAME} is already of type bug; nothing was written.`],
  ] as const)('words %s', (_name, edit, already, sentence) => {
    expect(typeMessage(edit, already, NAME)).toBe(sentence);
  });
});

describe('planning a type edit', () => {
  it('refuses an issue of neither record type before planning anything', () => {
    expect(exitOf(() => planTypeEdit({ type: 'bug', title: null }, found({ type: 'chore' }))).message).toContain('is of type chore');
  });

  it('plans a type alone as a change naming it, with no text for gate 3 and the body kept', () => {
    expect(planTypeEdit({ type: 'bug', title: null }, found())).toEqual({
      added: '',
      shown: 'type: debt → bug',
      block: null,
      after: BODY,
      already: false,
      change: { type: 'bug' },
    });
  });

  it('plans a type beside a title as one change, the title being the text gate 3 reads', () => {
    expect(planTypeEdit({ type: 'bug', title: 'New' }, found())).toEqual({
      added: 'New',
      shown: 'New\n\ntype: debt → bug',
      block: null,
      after: BODY,
      already: false,
      change: { title: 'New', type: 'bug' },
    });
  });

  it('answers already for an issue of the type alone, and never beside a title', () => {
    const settled = found({ type: 'bug', labels: ['type:bug'] });

    expect(planTypeEdit({ type: 'debt', title: null }, settled).already).toBe(false);
    expect(planTypeEdit({ type: 'bug', title: null }, settled).already).toBe(true);
    expect(planTypeEdit({ type: 'bug', title: TITLE }, settled).already).toBe(false);
  });
});

describe('a --type line', () => {
  it.each([
    ['a reason beside it', { type: 'bug', reason: 'why' }, '--reason goes with an append only'],
    ['--while-in-development beside it', { 'type': 'bug', 'while-in-development': true }, '--while-in-development goes with an append only'],
    ['an append beside it', { type: 'bug', append: 'text', reason: 'why' }, '--type and --append cannot be used together'],
    ['a replace beside it', { 'type': 'bug', 'replace-file': 'b.md' }, '--type and --replace-file cannot be used together'],
  ] as const)('is refused with exit code 1 for %s, naming the usage', (_name, flags, problem) => {
    const refused = exitOf(() => readEditLine(['12'], flags));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain(problem);
    expect(refused.message).toContain(`Usage: ${EDIT_USAGE}`);
  });

  it('names --type in the usage and in the refusal of a line naming no edit', () => {
    expect(EDIT_USAGE).toContain('--type=<bug|debt>');
    expect(exitOf(() => readEditLine(['12'], {})).message).toContain('--title, --priority or --type');
  });

  it('reads as a title-kind request holding the type, alone or beside --title', async () => {
    const alone = await readEditRequest(readEditLine(['12'], { type: 'bug' }), () => Promise.resolve(''));
    const titled = readEditLine(['12'], { type: 'debt', title: 'New', 'dry-run': true });

    expect(alone).toMatchObject({ issue: 12, kind: 'title', type: 'bug', title: null, text: null, dryRun: false });
    expect(titled).toMatchObject({ kind: 'title', type: 'debt', title: 'New', dryRun: true });
  });
});

describe('a move over the local tracker', () => {
  let made = 0;

  /** A local tracker in a fresh root, holding one issue of `type`. */
  async function oneIssue(type: IssueType) {
    made += 1;
    const root = join(tempBase, `local-${String(made)}`);
    const tracker = createLocalTracker({ issuesDir: join(root, '.rafa', 'issues'), fallbackReason: null });
    const ref = await tracker.create(draftFixture({ type, module: 'cli-gap', cause: 'cli:new-context', priority: 'low', body: BODY }));
    return { root, tracker, ref };
  }

  /** Runs `--type=<type>` with `flags` over `tracker`; the trust and the editor are never read on `local`. */
  async function move(root: string, tracker: Tracker, flags: LineFlags) {
    const request: EditRequest = await readEditRequest(readEditLine(['1'], flags), () => Promise.resolve(''));
    return runIssueEdit({
      request,
      tracker: requireEditingTracker(tracker),
      root,
      specsDir: join(root, '.rafa', 'specs'),
      trust: () => {
        throw new Error('the local tracker reads no trust');
      },
      editor: () => Promise.reject(new Error('the local tracker reads no editor')),
      now: () => NOW,
    });
  }

  it('refuses an issue of type chore with exit code 1, the file left as it was', async () => {
    const { root, tracker, ref } = await oneIssue('chore');
    const before = await tracker.get(ref);

    const refused = await rejectionOf(move(root, tracker, { type: 'bug' }));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toBe(
      '❌ local issue 1 is of type chore: --type moves an issue between bug and debt only, the two types a bug record is filed under.',
    );
    expect(await tracker.get(ref)).toEqual(before);
  });

  it('prints the swap under --dry-run and writes nothing', async () => {
    const { root, tracker, ref } = await oneIssue('debt');

    const made = await move(root, tracker, { 'type': 'bug', 'dry-run': true });

    expect(made).toMatchObject({ outcome: 'replaced', written: false, added: 'type: debt → bug' });
    expect(renderEditReport(made).slice(-3)).toEqual([
      'added:',
      'type: debt → bug',
      '--dry-run: nothing was written; the edit would answer replaced.',
    ]);
    expect((await tracker.get(ref)).type).toBe('debt');
  });

  it('moves a debt to bug keeping its module, cause, priority and body, and the same line then answers already', async () => {
    const { root, tracker, ref } = await oneIssue('debt');
    const before = await tracker.get(ref);

    const moved = await move(root, tracker, { type: 'bug' });
    const again = await move(root, tracker, { type: 'bug' });

    expect(moved).toMatchObject({ outcome: 'replaced', written: true, exitCode: 0, message: 'Moved local issue 1 to type bug.' });
    expect(await tracker.get(ref)).toEqual({ ...before, type: 'bug' });
    expect(again).toMatchObject({ outcome: 'already', written: false, message: 'local issue 1 is already of type bug; nothing was written.' });
  });

  it('hands the run a plan its post-write check reads the type back from', async () => {
    const { tracker, ref } = await oneIssue('bug');
    const { editable, edit } = pairOf(tracker);
    const before = await editable(ref);

    const planned = planTypeEdit({ type: 'debt', title: null }, before);
    await edit(ref, planned.change);
    const after = await editable(ref);

    expect(after).toEqual({ ...before, type: 'debt' });
    expect(writeHeld(before, planned, after)).toBe(true);
    // The control: the same plan over a re-read whose type was not kept.
    expect(writeHeld(before, planned, { ...after, type: 'bug' })).toBe(false);
  });
});

describe('a planned move over the github fake', () => {
  /** The `gh issue edit` commands in `calls`. */
  function editsIn(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
    return calls.filter((call) => call[0] === 'issue' && call[1] === 'edit');
  }

  it('swaps the type label alone in one gh issue edit, and the same line then answers already', async () => {
    const fake = createFakeGh();
    const tracker = createGithubTracker({ gh: fake.run });
    await tracker.create(draftFixture({ opt: 0, type: 'debt', priority: 'low' }));
    const { editable, edit } = pairOf(tracker);
    const ref = refOf('github', '1');
    const request = { type: 'bug', title: null } as const;
    const before = await editable(ref);

    const planned = planTypeEdit(request, before);
    expect(planned.shown).toBe('type: debt → bug');
    expect(planned.already).toBe(false);
    await edit(ref, planned.change);

    expect(editsIn(fake.calls())).toEqual([['issue', 'edit', '1', '--add-label', 'type:bug', '--remove-label', 'type:debt']]);
    const after = await editable(ref);
    expect(after.labels).toEqual(['module:auth', 'priority:low', 'type:bug']);
    expect(after.body).toBe(before.body);
    expect(planTypeEdit(request, after).already).toBe(true);
  });
});
