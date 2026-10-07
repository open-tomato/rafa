/**
 * Tests for the project port's `gh api graphql` reads (`gh.ts`), through
 * the strict fake `gh` of `project-fake.ts`, and through a one-answer
 * runner where a case needs an answer word for word as `gh` 2.100.0 wrote
 * it on 2026-10-06.
 *
 * ## The controls
 *
 *  - The find of one number is read beside another project of the same
 *    owner, so a reader answering the first project it sees fails.
 *  - "No project" is read only off the measured missing-number answer: a
 *    failed call with another error, or `NOT_FOUND` at another path,
 *    must reject, so a reader treating every failure as "no project"
 *    fails.
 *  - The one item holding a Stage sits on the third page of items, so a
 *    reader stopping at one page answers none.
 */
import type { FakeProject } from './project-fake.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createGhProjectPort, findArgs, itemsArgs } from './gh.js';
import { STAGE_OPTIONS } from './options.js';
import { matchProjectFields, PROJECT_PAGE_SIZE, ProjectPortError } from './port.js';
import { createFakeProjectGh, fakeItemId, fakeOptionId, fakeProjectId } from './project-fake.js';

/** The template project, as the fake holds it. */
const TEMPLATE: FakeProject = { owner: 'open-tomato', number: 6, title: 'rafa board template', public: true };

/** The stdout `gh` wrote for a number `open-tomato` does not hold, word for word. */
const MISSING_STDOUT = '{"data":{"repositoryOwner":{"__typename":"Organization","login":"open-tomato","projectV2":null}},'
  + '"errors":[{"type":"NOT_FOUND","path":["repositoryOwner","projectV2"],"locations":[{"line":1,"column":115}],'
  + '"message":"Could not resolve to a ProjectV2 with the number 999."}]}';

/** A runner answering `result` to every call, recording each. */
function answering(result: GhResult): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    gh: (args) => {
      calls.push(args);
      return Promise.resolve(result);
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

describe('findArgs and itemsArgs', () => {
  it('refuses an owner or a number GitHub could not hold', () => {
    expect(() => findArgs({ owner: 'open tomato', number: 6 })).toThrow(RangeError);
    expect(() => findArgs({ owner: '', number: 6 })).toThrow(RangeError);
    expect(() => findArgs({ owner: 'open-tomato', number: 0 })).toThrow('not a project number: 0');
    expect(() => findArgs({ owner: 'open-tomato', number: 1.5 })).toThrow(RangeError);
    expect(() => itemsArgs('', null)).toThrow(RangeError);
  });

  it('sends the owner as a string variable and the number as an integer one, splicing neither', () => {
    const args = findArgs({ owner: 'open-tomato', number: 6 });
    expect(args.slice(0, 2)).toEqual(['api', 'graphql']);
    expect(fieldOf(args, 'owner')).toBe('-f owner=open-tomato');
    expect(fieldOf(args, 'number')).toBe('-F number=6');
    expect(args.at(-1)).not.toContain('open-tomato');
  });

  it('sends a cursor only after the first page', () => {
    expect(fieldOf(itemsArgs('PVT_1', null), 'after')).toBeUndefined();
    expect(fieldOf(itemsArgs('PVT_1', 'Mw'), 'after')).toBe('-f after=Mw');
    expect(fieldOf(itemsArgs('PVT_1', null), 'project')).toBe('-f project=PVT_1');
  });
});

describe('find', () => {
  it('answers null for a number the owner does not hold, read off the answer gh wrote', async () => {
    const runner = answering({ ok: false, stdout: MISSING_STDOUT, stderr: 'gh: Could not resolve to a ProjectV2 with the number 999.\n' });
    expect(await createGhProjectPort(runner.gh).find({ owner: 'open-tomato', number: 999 })).toBeNull();
    expect(runner.calls).toHaveLength(1);
  });

  it('answers null for an owner that does not exist', async () => {
    const runner = answering({ ok: true, stdout: '{"data":{"repositoryOwner":null}}', stderr: '' });
    expect(await createGhProjectPort(runner.gh).find({ owner: 'no-such-owner', number: 6 })).toBeNull();
  });

  it('rejects a failed call that is not the missing-number answer, keeping what gh wrote', async () => {
    // Not a reading: any failure but the missing-number answer, worded as a scope refusal might be.
    const scope = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\']';
    const port = createGhProjectPort(answering({ ok: false, stdout: '', stderr: `${scope}\n` }).gh);
    const rejection = port.find({ owner: 'open-tomato', number: 6 });
    await expect(rejection).rejects.toBeInstanceOf(ProjectPortError);
    await expect(rejection).rejects.toMatchObject({ detail: scope });
  });

  it('rejects NOT_FOUND at another path, and NOT_FOUND beside another error', async () => {
    const elsewhere = MISSING_STDOUT.replace('"path":["repositoryOwner","projectV2"]', '"path":["repositoryOwner"]');
    const beside = MISSING_STDOUT.replace(']}', '},{"type":"FORBIDDEN","path":["repositoryOwner","projectV2"],"message":"no"}]}');
    for (const stdout of [elsewhere, beside]) {
      const port = createGhProjectPort(answering({ ok: false, stdout, stderr: 'gh: failed\n' }).gh);
      await expect(port.find({ owner: 'open-tomato', number: 999 })).rejects.toThrow('board project: gh api graphql failed: gh: failed');
    }
  });

  it('rejects an answer that is not JSON, or not the recorded shape', async () => {
    const notJson = createGhProjectPort(answering({ ok: true, stdout: 'Bad gateway', stderr: '' }).gh);
    await expect(notJson.find({ owner: 'open-tomato', number: 6 })).rejects.toThrow('answered text that is not JSON: Bad gateway');
    const noFields = createGhProjectPort(answering({ ok: true, stdout: '{"data":{"repositoryOwner":{"login":"open-tomato","projectV2":{"id":"PVT_1","number":6,"title":"t","url":"u","closed":false,"public":true}}}}', stderr: '' }).gh);
    await expect(noFields.find({ owner: 'open-tomato', number: 6 })).rejects.toThrow('data.repositoryOwner.projectV2.fields is undefined, expected a mapping');
  });

  it('rejects fields past one page rather than answering a project short of some', async () => {
    const stdout = JSON.stringify({ data: { repositoryOwner: { login: 'acme', projectV2: {
      id: 'PVT_1', number: 2, title: 't', url: 'u', closed: false, public: false, fields: { pageInfo: { hasNextPage: true }, nodes: [] },
    } } } });
    const port = createGhProjectPort(answering({ ok: true, stdout, stderr: '' }).gh);
    await expect(port.find({ owner: 'acme', number: 2 })).rejects.toThrow(`fields holds more than ${String(PROJECT_PAGE_SIZE)} entries, one page`);
  });

  it('answers the numbered project, not another of the same owner, with its fields in order', async () => {
    const fake = createFakeProjectGh({ projects: [{ owner: 'open-tomato', number: 1, fields: [] }, TEMPLATE] });
    const project = await createGhProjectPort(fake.gh).find({ owner: 'open-tomato', number: 6 });
    expect(project && { ...project, fields: project.fields.length }).toEqual({
      owner: 'open-tomato',
      number: 6,
      id: fakeProjectId(TEMPLATE),
      title: 'rafa board template',
      url: 'https://github.com/orgs/open-tomato/projects/6',
      closed: false,
      public: true,
      fields: 18,
    });
    expect(project?.fields[0]).toEqual({ id: `PVTF_${fakeProjectId(TEMPLATE)}_0`, name: 'Title', dataType: 'TITLE', options: null });
    expect(project?.fields[13]?.options?.map(({ name }) => name)).toEqual([...STAGE_OPTIONS]);
    expect(fake.calls()).toHaveLength(1);
  });

  it('matches the template\'s five fields with their option ids', async () => {
    const project = await createGhProjectPort(createFakeProjectGh({ projects: [TEMPLATE] }).gh).find({ owner: 'open-tomato', number: 6 });
    const match = project === null
      ? null
      : matchProjectFields(project);
    expect(match?.mismatched).toEqual([]);
    expect(match?.matched[0]?.options.get('In review')).toBe(fakeOptionId(13, 8));
  });

  it('answers null through the fake for a number and an owner it does not hold', async () => {
    const port = createGhProjectPort(createFakeProjectGh({ projects: [TEMPLATE], owners: ['someone'] }).gh);
    expect(await port.find({ owner: 'open-tomato', number: 7 })).toBeNull();
    expect(await port.find({ owner: 'someone', number: 6 })).toBeNull();
    expect(await port.find({ owner: 'nobody', number: 6 })).toBeNull();
  });
});

describe('items', () => {
  it('rejects a node id that names nothing, keeping what gh wrote', async () => {
    const port = createGhProjectPort(createFakeProjectGh({ projects: [TEMPLATE] }).gh);
    const rejection = port.items('PVT_gone');
    await expect(rejection).rejects.toThrow('gh api graphql failed: gh: Could not resolve to a node with the global id of \'PVT_gone\'');
  });

  it('rejects a node that is not a project, and values past one page', async () => {
    const notProject = createGhProjectPort(answering({ ok: true, stdout: '{"data":{"node":{}}}', stderr: '' }).gh);
    await expect(notProject.items('I_1')).rejects.toThrow('data.node.items is undefined, expected a mapping');
    const many = createGhProjectPort(createFakeProjectGh({
      projects: [{ ...TEMPLATE, fields: Array.from({ length: PROJECT_PAGE_SIZE }, (_, index) => ({ name: `F${String(index)}`, dataType: 'TEXT' })),
        items: [{ values: Object.fromEntries(Array.from({ length: PROJECT_PAGE_SIZE - 1 }, (_, index) => [`F${String(index)}`, 'x'])) }] }],
    }).gh);
    await expect(many.items(fakeProjectId(TEMPLATE))).rejects.toThrow('fieldValues holds more than 100 entries, one page');
  });

  it('rejects a failed call', async () => {
    const fake = createFakeProjectGh({ projects: [TEMPLATE] });
    fake.failNext('gh: API rate limit exceeded\n');
    await expect(createGhProjectPort(fake.gh).items(fakeProjectId(TEMPLATE))).rejects.toMatchObject({ detail: 'gh: API rate limit exceeded' });
  });

  it('answers an item with no value with only its title, and passes over values the query does not select', async () => {
    const project = { ...TEMPLATE, items: [{ number: 821, title: 'An issue' }] };
    const [item] = await createGhProjectPort(createFakeProjectGh({ projects: [project] }).gh).items(fakeProjectId(project));
    expect(item && [...item.values]).toEqual([['Title', { kind: 'text', text: 'An issue' }]]);
  });

  it('reads each value by the exact name of its field', async () => {
    const project = { ...TEMPLATE, items: [{ number: 821, values: { 'Stage': 'In review', 'Rank': 7, 'Blocked by': '#119, #120', 'Progress': '6 / 11' } }] };
    const [item] = await createGhProjectPort(createFakeProjectGh({ projects: [project] }).gh).items(fakeProjectId(project));
    expect(item?.id).toBe(fakeItemId(project, 0));
    expect(item?.content).toEqual({ kind: 'issue', number: 821, repository: 'open-tomato/rafa' });
    expect(item?.archived).toBe(false);
    expect(item && Object.fromEntries(item.values)).toEqual({
      'Title': { kind: 'text', text: 'Item 0' },
      'Stage': { kind: 'option', optionId: fakeOptionId(13, 8), name: 'In review' },
      'Rank': { kind: 'number', number: 7 },
      'Blocked by': { kind: 'text', text: '#119, #120' },
      'Progress': { kind: 'text', text: '6 / 11' },
    });
  });

  it('reads a pull request, a draft, a redacted and an archived item', async () => {
    const project = { ...TEMPLATE, items: [
      { type: 'PULL_REQUEST' as const, number: 850, repository: 'acme/other' },
      { type: 'DRAFT_ISSUE' as const },
      { type: 'REDACTED' as const },
      { number: 3, archived: true },
    ] };
    const items = await createGhProjectPort(createFakeProjectGh({ projects: [project] }).gh).items(fakeProjectId(project));
    expect(items.map(({ content, archived }) => [content, archived])).toEqual([
      [{ kind: 'pull-request', number: 850, repository: 'acme/other' }, false],
      [{ kind: 'draft' }, false],
      [{ kind: 'redacted' }, false],
      [{ kind: 'issue', number: 3, repository: 'open-tomato/rafa' }, true],
    ]);
  });

  it('reads every page, the only Stage on the third, sending each cursor once', async () => {
    const count = PROJECT_PAGE_SIZE * 2 + 5;
    const items = Array.from({ length: count }, (_, index) => ({ number: index + 1, ...(index === count - 1
      ? { values: { Stage: 'Ready' } }
      : {}) }));
    const project = { ...TEMPLATE, items };
    const fake = createFakeProjectGh({ projects: [project] });
    const read = await createGhProjectPort(fake.gh).items(fakeProjectId(project));
    expect(read.map(({ content }) => (content.kind === 'issue'
      ? content.number
      : 0))).toEqual(items.map(({ number }) => number));
    expect(read.filter(({ values }) => values.has('Stage')).map(({ content }) => content)).toEqual([{ kind: 'issue', number: count, repository: 'open-tomato/rafa' }]);
    expect(fake.calls().map((args) => fieldOf(args, 'after'))).toEqual([undefined, `-f after=${btoa('100')}`, `-f after=${btoa('200')}`]);
  });

  it('answers no item for an empty project, in one call', async () => {
    const fake = createFakeProjectGh({ projects: [TEMPLATE] });
    expect(await createGhProjectPort(fake.gh).items(fakeProjectId(TEMPLATE))).toEqual([]);
    expect(fake.calls()).toHaveLength(1);
  });
});

describe('the fake', () => {
  it('refuses the number sent as a string, and any other command', async () => {
    const fake = createFakeProjectGh({ projects: [TEMPLATE] });
    const asString = findArgs({ owner: 'open-tomato', number: 6 }).map((arg) => (arg === '-F'
      ? '-f'
      : arg));
    expect((await fake.gh(asString)).stderr).toBe('fake gh: the find names its owner with -f and its number with -F\n');
    expect((await fake.gh(['project', 'list'])).stderr).toStartWith('fake gh: unmodelled command');
  });
});
