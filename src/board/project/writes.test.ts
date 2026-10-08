/**
 * Tests for the batched, paced field writes of `writes.ts`, through the
 * strict fake `gh` of `project-fake.ts`, and through a runner answering a
 * list of results in turn where a case needs an answer the fake does not
 * make: a rate-limited request whose data answers some of its writes.
 *
 * ## The controls
 *
 *  - Every write case reads the items back, and the item beside the one
 *    written keeps its values, so a writer landing every write on the
 *    first item fails.
 *  - The rate-limited fill writes three fields per item, so the item cut
 *    across the first two requests counts as not updated, and a writer
 *    counting items only from the refused request's first write fails;
 *    the items of the first request are read written, so a writer
 *    reporting every item as not updated fails.
 *  - The scope refusal is read beside a rate-limit one, so a writer
 *    treating every failure as a rate limit fails.
 *  - The writes are paced by the options a caller passes, read off
 *    `board.project.writeBatchSize` and `board.project.writePauseMs`:
 *    the cases hold a batch of {@link BATCH_SIZE} and a pause of
 *    {@link PAUSE_MS}, and one case paces the same writes at another size
 *    and pause, so a writer keeping a size or a pause of its own fails.
 *    Each refused size or pause sits beside the least one accepted.
 */
import type { FakeProject } from './project-fake.js';
import type { ProjectFieldWrite } from './writes.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createGhProjectPort } from './gh.js';
import { matchProjectFields, ProjectPortError } from './port.js';
import { createFakeProjectGh, FAKE_RATE_LIMIT_MESSAGE, fakeItemId, fakeProjectId } from './project-fake.js';
import { writeAlias, writeBatchArgs, writeProjectFields } from './writes.js';

/** The field writes per request the cases pass, as `board.project.writeBatchSize`. */
const BATCH_SIZE = 5;

/** The pause between requests the cases pass, as `board.project.writePauseMs`. */
const PAUSE_MS = 0;

/** How many items the rate-limited fill writes, three fields each. */
const FILL_ITEMS = 16;

/** A project of `count` items, the first holding a Stage, a Rank and a Blocked by. */
function projectOf(count: number): FakeProject {
  return {
    owner: 'acme',
    number: 2,
    items: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      values: index === 0
        ? { 'Stage': 'Backlog', 'Rank': 9, 'Blocked by': '#7' }
        : {},
    })),
  };
}

/** The ids the writes name: the five fields' ids and Stage's options by name, read through the port. */
async function idsOf(gh: GhRunner, project: FakeProject): Promise<{ field: (name: string) => string; option: (name: string) => string }> {
  const found = await createGhProjectPort(gh).find({ owner: project.owner, number: project.number });
  const matched = matchProjectFields(found ?? { fields: [] }).matched;
  const byName = new Map(matched.map((entry) => [entry.template.name, entry]));
  return {
    field: (name) => byName.get(name)?.field.id ?? '',
    option: (name) => byName.get('Stage')?.options.get(name) ?? '',
  };
}

/** The values of every item of `project`, read through the port, by item. */
async function valuesOf(gh: GhRunner, project: FakeProject): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const items = await createGhProjectPort(gh).items(fakeProjectId(project));
  return items.map(({ values }) => Object.fromEntries([...values]
    .filter(([name]) => name !== 'Title')
    .map(([name, value]) => [name, value.kind === 'option'
      ? value.name
      : value.kind === 'number'
        ? value.number
        : value.text])));
}

/** A runner answering `results` in turn, recording each call. */
function answeringInTurn(results: readonly GhResult[]): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    gh: (args) => {
      calls.push(args);
      return Promise.resolve(results[calls.length - 1] ?? { ok: false, stdout: '', stderr: 'no answer left\n' });
    },
  };
}

/** The cases' pace, {@link BATCH_SIZE} and {@link PAUSE_MS}, with a sleep recording each pause and waiting for none. */
function recordingSleep(): { batchSize: number; pauseMs: number; sleep: (ms: number) => Promise<void>; pauses: number[] } {
  const pauses: number[] = [];
  return {
    batchSize: BATCH_SIZE,
    pauseMs: PAUSE_MS,
    pauses,
    sleep: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  };
}

/** The value of the `-f`/`-F` field `name` in `args`, with its flag. */
function fieldOf(args: readonly string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg.startsWith(`${name}=`));
  return index < 1
    ? undefined
    : `${args[index - 1] ?? ''} ${args[index] ?? ''}`;
}

/** The mutation text of `args`. */
function queryOf(args: readonly string[] | undefined): string {
  return args?.at(-1)?.replace(/^query=/u, '') ?? '';
}

/** One clear of `fieldId` on item `itemId`. */
function clearOf(itemId: string, fieldId = 'F_1'): ProjectFieldWrite {
  return { kind: 'clear', itemId, fieldId };
}

describe('writeBatchArgs', () => {
  it('refuses an empty batch, and a node id, number or text GitHub could not hold', () => {
    const set = (value: Extract<ProjectFieldWrite, { kind: 'set' }>['value']): ProjectFieldWrite => ({ kind: 'set', itemId: 'I_1', fieldId: 'F_1', value });
    expect(() => writeBatchArgs('PVT_1', [])).toThrow('not a batch of writes: an empty one');
    expect(() => writeBatchArgs('', [clearOf('I_1')])).toThrow('not a project node id: ""');
    expect(() => writeBatchArgs('PVT_1', [clearOf('')])).toThrow('not an item node id: ""');
    expect(() => writeBatchArgs('PVT_1', [clearOf('I_1', '')])).toThrow('not a field node id: ""');
    expect(() => writeBatchArgs('PVT_1', [set({ kind: 'option', optionId: '' })])).toThrow('not an option node id: ""');
    expect(() => writeBatchArgs('PVT_1', [set({ kind: 'number', number: 1.5 })])).toThrow('not a whole number gh sends as one: 1.5');
    expect(() => writeBatchArgs('PVT_1', [set({ kind: 'text', text: '' })])).toThrow('not a text to set: an empty one, which is a clear');
    expect(writeBatchArgs('PVT_1', [set({ kind: 'number', number: 3 })])).toContain('value0=3');
  });

  it('aliases each write and sends every value as a variable, the number as an integer, splicing none', () => {
    const args = writeBatchArgs('PVT_1', [
      { kind: 'set', itemId: 'I_a', fieldId: 'F_stage', value: { kind: 'option', optionId: 'opt_ready' } },
      { kind: 'set', itemId: 'I_a', fieldId: 'F_rank', value: { kind: 'number', number: 4 } },
      { kind: 'set', itemId: 'I_b', fieldId: 'F_blocked', value: { kind: 'text', text: '#119, #120' } },
      clearOf('I_b', 'F_progress'),
    ]);
    const query = queryOf(args);
    expect([fieldOf(args, 'project'), fieldOf(args, 'value0'), fieldOf(args, 'value1'), fieldOf(args, 'value2')])
      .toEqual(['-f project=PVT_1', '-f value0=opt_ready', '-F value1=4', '-f value2=#119, #120']);
    expect(query).toContain('$value0: String!, ');
    expect(query).toContain('$value1: Float!, ');
    expect(query).toContain(`${writeAlias(3)}: clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item3, fieldId: $field3 })`);
    expect(query).toContain('w1: updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item1, fieldId: $field1, value: { number: $value1 } })');
    expect(query).not.toMatch(/PVT_1|I_a|F_stage|opt_ready|#119/u);
    expect(fieldOf(args, 'value3')).toBeUndefined();
  });
});

describe('writeProjectFields', () => {
  it('sets an option, a number and a text, and clears a value, leaving the item beside them as it was', async () => {
    const project = projectOf(3);
    const fake = createFakeProjectGh({ projects: [project] });
    const ids = await idsOf(fake.gh, project);
    const writes: readonly ProjectFieldWrite[] = [
      { kind: 'set', itemId: fakeItemId(project, 1), fieldId: ids.field('Stage'), value: { kind: 'option', optionId: ids.option('Ready') } },
      { kind: 'set', itemId: fakeItemId(project, 1), fieldId: ids.field('Rank'), value: { kind: 'number', number: 2 } },
      { kind: 'set', itemId: fakeItemId(project, 1), fieldId: ids.field('Blocked by'), value: { kind: 'text', text: '#4' } },
      clearOf(fakeItemId(project, 0), ids.field('Rank')),
    ];
    const before = fake.calls().length;
    const result = await writeProjectFields(fake.gh, fakeProjectId(project), writes, recordingSleep());
    expect(result).toEqual({ written: 4, notUpdated: 0, rateLimited: false, detail: '' });
    expect(fake.calls().length - before).toBe(1);
    expect(await valuesOf(fake.gh, project)).toEqual([
      { 'Stage': 'Backlog', 'Blocked by': '#7' },
      { 'Stage': 'Ready', 'Rank': 2, 'Blocked by': '#4' },
      {},
    ]);
  });

  it('sends no request and takes no pause for no writes', async () => {
    const fake = createFakeProjectGh();
    const pacing = recordingSleep();
    expect(await writeProjectFields(fake.gh, 'PVT_1', [], pacing)).toEqual({ written: 0, notUpdated: 0, rateLimited: false, detail: '' });
    expect([fake.calls(), pacing.pauses]).toEqual([[], []]);
  });

  /** The requests and pauses of `writes` over `project`, each request named by its count of writes, paced at `batchSize` and `pauseMs`. */
  async function paceOf(project: FakeProject, batchSize: number, pauseMs: number): Promise<{ events: readonly string[]; written: number }> {
    const fake = createFakeProjectGh({ projects: [project] });
    const ids = await idsOf(fake.gh, project);
    const writes = (project.items ?? []).map((_, index) => clearOf(fakeItemId(project, index), ids.field('Stage')));
    const events: string[] = [];
    const gh: GhRunner = (args) => {
      events.push(`request of ${String((queryOf(args).match(/: clearProjectV2ItemFieldValue\(/gu) ?? []).length)}`);
      return fake.gh(args);
    };
    const sleep = (ms: number): Promise<void> => {
      events.push(`pause of ${String(ms)}`);
      return Promise.resolve();
    };
    const result = await writeProjectFields(gh, fakeProjectId(project), writes, { batchSize, pauseMs, sleep });
    expect((await valuesOf(fake.gh, project))[0]).toEqual({ 'Rank': 9, 'Blocked by': '#7' });
    return { events, written: result.written };
  }

  it('batches the writes 5 to a request and pauses 0 ms between two requests only', async () => {
    const project = projectOf(11);
    expect(await paceOf(project, BATCH_SIZE, PAUSE_MS)).toEqual({
      events: ['request of 5', 'pause of 0', 'request of 5', 'pause of 0', 'request of 1'],
      written: 11,
    });
  });

  it('paces the same writes at another size and pause when the options name them', async () => {
    expect(await paceOf(projectOf(11), 4, 250)).toEqual({
      events: ['request of 4', 'pause of 250', 'request of 4', 'pause of 250', 'request of 3'],
      written: 11,
    });
  });

  it('refuses a batch size below 1 and a pause below 0 with nothing sent, beside the least of each accepted', async () => {
    const fake = createFakeProjectGh();
    const writes = [clearOf('I_a')];
    const sleep = recordingSleep().sleep;
    await expect(writeProjectFields(fake.gh, 'PVT_1', writes, { batchSize: 0, pauseMs: PAUSE_MS, sleep }))
      .rejects.toThrow('not a batch size of writes: 0, expected a whole number from 1');
    await expect(writeProjectFields(fake.gh, 'PVT_1', writes, { batchSize: 1.5, pauseMs: PAUSE_MS, sleep }))
      .rejects.toThrow('not a batch size of writes: 1.5, expected a whole number from 1');
    await expect(writeProjectFields(fake.gh, 'PVT_1', writes, { batchSize: BATCH_SIZE, pauseMs: -1, sleep }))
      .rejects.toThrow('not a pause between write requests: -1, expected a whole number from 0');
    expect(fake.calls()).toEqual([]);
    const project = projectOf(2);
    expect(await paceOf(project, 1, 0)).toEqual({ events: ['request of 1', 'pause of 0', 'request of 1'], written: 2 });
  });

  it('checks every write before the first request goes', async () => {
    const fake = createFakeProjectGh();
    const writes = [...Array.from({ length: BATCH_SIZE }, (_, index) => clearOf(`I_${String(index)}`)), clearOf('')];
    await expect(writeProjectFields(fake.gh, 'PVT_1', writes, recordingSleep())).rejects.toThrow(RangeError);
    expect(fake.calls()).toEqual([]);
  });
});

describe('a rate-limit refusal', () => {
  it('stops the writes and answers how many issues were not updated, the item cut across two requests among them', async () => {
    const project = projectOf(FILL_ITEMS);
    const fake = createFakeProjectGh({ projects: [project], rateLimitAfter: 1 });
    const ids = await idsOf(fake.gh, project);
    const writes = (project.items ?? []).flatMap((_, index): ProjectFieldWrite[] => [
      { kind: 'set', itemId: fakeItemId(project, index), fieldId: ids.field('Stage'), value: { kind: 'option', optionId: ids.option('Triage') } },
      { kind: 'set', itemId: fakeItemId(project, index), fieldId: ids.field('Rank'), value: { kind: 'number', number: index + 1 } },
      { kind: 'set', itemId: fakeItemId(project, index), fieldId: ids.field('Progress'), value: { kind: 'text', text: '1 / 2' } },
    ]);
    const pacing = recordingSleep();
    const before = fake.calls().length;
    const result = await writeProjectFields(fake.gh, fakeProjectId(project), writes, pacing);
    expect(result).toEqual({
      written: BATCH_SIZE,
      notUpdated: FILL_ITEMS - 1,
      rateLimited: true,
      detail: `gh: ${FAKE_RATE_LIMIT_MESSAGE}`,
    });
    expect([fake.calls().length - before, pacing.pauses]).toEqual([2, [PAUSE_MS]]);
    const values = await valuesOf(fake.gh, project);
    expect(values[0]).toEqual({ 'Stage': 'Triage', 'Rank': 1, 'Blocked by': '#7', 'Progress': '1 / 2' });
    expect(values[1]).toEqual({ Stage: 'Triage', Rank: 2 });
    expect(values[2]).toEqual({});
  });

  it('reads a secondary rate limit off what gh wrote, and rejects any other refusal keeping it', async () => {
    const project = projectOf(2);
    const fake = createFakeProjectGh({ projects: [project] });
    const writes = [clearOf(fakeItemId(project, 0)), clearOf(fakeItemId(project, 1))];
    const secondary = 'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)';
    fake.failNext(`${secondary}\n`);
    expect(await writeProjectFields(fake.gh, fakeProjectId(project), writes, recordingSleep()))
      .toEqual({ written: 0, notUpdated: 2, rateLimited: true, detail: secondary });
    const scope = 'gh: Your token has not been granted the required scopes to execute this query.';
    fake.failNext(`${scope}\n`);
    const rejection = writeProjectFields(fake.gh, fakeProjectId(project), writes, recordingSleep());
    await expect(rejection).rejects.toBeInstanceOf(ProjectPortError);
    await expect(rejection).rejects.toMatchObject({ detail: scope });
  });

  it('counts a write the refused request answers anyway as written', async () => {
    const stdout = JSON.stringify({
      data: { w0: { projectV2Item: { id: 'I_a' } }, w1: null, w2: null },
      errors: [{ type: 'RATE_LIMITED', message: FAKE_RATE_LIMIT_MESSAGE }],
    });
    const runner = answeringInTurn([{ ok: false, stdout, stderr: `gh: ${FAKE_RATE_LIMIT_MESSAGE}\n` }]);
    const writes = [clearOf('I_a'), clearOf('I_b'), clearOf('I_b', 'F_2')];
    expect(await writeProjectFields(runner.gh, 'PVT_1', writes, recordingSleep()))
      .toEqual({ written: 1, notUpdated: 1, rateLimited: true, detail: `gh: ${FAKE_RATE_LIMIT_MESSAGE}` });
  });
});

describe('the answer', () => {
  it('rejects an answer missing a write\'s item, and one that is not JSON', async () => {
    const short = answeringInTurn([{ ok: true, stdout: JSON.stringify({ data: { w0: { projectV2Item: { id: 'I_a' } }, w1: null } }), stderr: '' }]);
    await expect(writeProjectFields(short.gh, 'PVT_1', [clearOf('I_a'), clearOf('I_b')], recordingSleep()))
      .rejects.toThrow('data.w1 is null, expected a mapping');
    const text = answeringInTurn([{ ok: true, stdout: '<html>', stderr: '' }]);
    await expect(writeProjectFields(text.gh, 'PVT_1', [clearOf('I_a')], recordingSleep())).rejects.toThrow('answered text that is not JSON');
  });
});

describe('the fake\'s field writes', () => {
  it('refuses a request whole when one write names an option of another field, or sends its number as a string', async () => {
    const project = projectOf(2);
    const fake = createFakeProjectGh({ projects: [project] });
    const ids = await idsOf(fake.gh, project);
    const good: ProjectFieldWrite = clearOf(fakeItemId(project, 0), ids.field('Stage'));
    const foreign: ProjectFieldWrite = { kind: 'set', itemId: fakeItemId(project, 1), fieldId: ids.field('Rank'), value: { kind: 'option', optionId: ids.option('Ready') } };
    expect((await fake.gh(writeBatchArgs(fakeProjectId(project), [good, foreign]))).stderr)
      .toBe('fake gh: w1 sets singleSelectOptionId on "Rank", a NUMBER field\n');
    const rank: ProjectFieldWrite = { kind: 'set', itemId: fakeItemId(project, 1), fieldId: ids.field('Rank'), value: { kind: 'number', number: 3 } };
    const asString = writeBatchArgs(fakeProjectId(project), [good, rank]).map((arg) => (arg === '-F'
      ? '-f'
      : arg));
    expect((await fake.gh(asString)).stderr).toBe('fake gh: w1 sends its number with -F, declared Float!\n');
    expect((await valuesOf(fake.gh, project))[0]).toEqual({ 'Stage': 'Backlog', 'Rank': 9, 'Blocked by': '#7' });
  });
});
