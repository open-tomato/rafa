/**
 * Tests for the project port's writes in `gh.ts` — copy, link and add
 * item — through the strict fake `gh` of `project-fake.ts`, and through a
 * runner answering a list of results in turn where a case needs a
 * mutation to fail after its lookup succeeded.
 *
 * ## The controls
 *
 *  - The copy goes to an owner already holding a project, so a copy
 *    answering the first project it sees, or a fixed number, fails; the
 *    template holds an item, so a copy carrying items over fails.
 *  - Each lookup that finds nothing is read with the call count, so an
 *    adapter sending the mutation anyway fails.
 *  - A second add of the same issue is read beside an add of another, so
 *    an adapter answering the first item every time fails.
 */
import type { FakeProject } from './project-fake.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import {
  ADD_ITEM_MUTATION,
  addItemArgs,
  contentArgs,
  COPY_MUTATION,
  copyArgs,
  createGhProjectPort,
  LINK_MUTATION,
  linkArgs,
  ownerArgs,
  repositoryArgs,
} from './gh.js';
import { matchProjectFields, ProjectPortError } from './port.js';
import {
  createFakeProjectGh,
  fakeContentId,
  fakeItemId,
  fakeOwnerId,
  fakeProjectId,
  fakeRepositoryId,
} from './project-fake.js';

/** The template project, holding one item a copy must leave behind. */
const TEMPLATE: FakeProject = { owner: 'open-tomato', number: 6, title: 'rafa board template', public: true, items: [{ number: 1 }] };

/** A project of the owner the copy goes to, there before it. */
const HELD: FakeProject = { owner: 'acme', number: 4, fields: [] };

/** The repository linked and whose issues are added. */
const REPOSITORY = { nameWithOwner: 'acme/widgets', issues: [12, 13], pullRequests: [14] };

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

/** A call that exited 0 with `data`. */
function answered(data: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify({ data }), stderr: '' };
}

/** The value of the `-f`/`-F` field `name` in `args`, with its flag. */
function fieldOf(args: readonly string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg.startsWith(`${name}=`));
  return index < 1
    ? undefined
    : `${args[index - 1] ?? ''} ${args[index] ?? ''}`;
}

/** The query or mutation text of `args`. */
function queryOf(args: readonly string[] | undefined): string {
  return args?.at(-1)?.replace(/^query=/u, '') ?? '';
}

describe('the write argvs', () => {
  it('refuses a login, a repository, a number, a node id or a title GitHub could not hold', () => {
    expect(() => ownerArgs('a b')).toThrow('not a GitHub login: "a b"');
    expect(() => repositoryArgs('acme')).toThrow('not a repository, owner/name: "acme"');
    expect(() => repositoryArgs('acme/widgets/extra')).toThrow(RangeError);
    expect(() => repositoryArgs('acme/..')).toThrow(RangeError);
    expect(() => contentArgs({ repository: 'acme/widgets', number: 0 })).toThrow('not an issue or pull request number: 0');
    expect(() => copyArgs('', 'O_1', 'widgets')).toThrow('not a project node id: ""');
    expect(() => copyArgs('PVT_1', 'O_1', '  ')).toThrow('not a project title: an empty one');
    expect(() => linkArgs('PVT_1', '')).toThrow('not a repository node id: ""');
    expect(() => addItemArgs('PVT_1', '')).toThrow('not an issue or pull request node id: ""');
  });

  it('sends every value as a variable, the number as an integer, splicing none', () => {
    const copy = copyArgs('PVT_template', 'O_acme', 'widgets');
    expect([fieldOf(copy, 'template'), fieldOf(copy, 'owner'), fieldOf(copy, 'title')]).toEqual(['-f template=PVT_template', '-f owner=O_acme', '-f title=widgets']);
    expect(queryOf(copy)).toBe(COPY_MUTATION);
    expect(COPY_MUTATION).toContain('includeDraftIssues: false');
    expect(queryOf(linkArgs('PVT_1', 'R_1'))).toBe(LINK_MUTATION);
    expect(queryOf(addItemArgs('PVT_1', 'I_1'))).toBe(ADD_ITEM_MUTATION);
    expect(fieldOf(contentArgs({ repository: 'acme/widgets', number: 12 }), 'number')).toBe('-F number=12');
    for (const args of [copy, linkArgs('PVT_1', 'R_1'), addItemArgs('PVT_1', 'I_1'), repositoryArgs('acme/widgets')]) {
      expect(queryOf(args)).not.toMatch(/PVT_|O_acme|R_1|I_1|widgets"/u);
    }
  });
});

describe('copy', () => {
  it('copies the template to the owner as its next project, with the five fields and none of the items', async () => {
    const fake = createFakeProjectGh({ projects: [TEMPLATE, HELD] });
    const port = createGhProjectPort(fake.gh);
    const copied = await port.copy({ templateId: fakeProjectId(TEMPLATE), owner: 'acme', title: 'widgets' });
    expect([copied.owner, copied.number, copied.title, copied.public]).toEqual(['acme', 5, 'widgets', false]);
    expect(matchProjectFields(copied).mismatched).toEqual([]);
    expect(await port.items(copied.id)).toEqual([]);
    expect((await port.find({ owner: 'acme', number: 5 }))?.id).toBe(copied.id);
    const [lookup, mutation] = fake.calls();
    expect([queryOf(lookup).split(' ')[0], queryOf(mutation).split(' ')[0]]).toEqual(['query($owner:', 'mutation($template:']);
    expect(fieldOf(fake.calls()[1] ?? [], 'owner')).toBe(`-f owner=${fakeOwnerId('acme')}`);
  });

  it('gives a second copy the number after the first', async () => {
    const port = createGhProjectPort(createFakeProjectGh({ projects: [TEMPLATE], owners: ['acme'] }).gh);
    const first = await port.copy({ templateId: fakeProjectId(TEMPLATE), owner: 'acme', title: 'one' });
    const second = await port.copy({ templateId: fakeProjectId(TEMPLATE), owner: 'acme', title: 'two' });
    expect([first.number, second.number]).toEqual([1, 2]);
  });

  it('rejects an owner that does not exist, sending no mutation', async () => {
    const fake = createFakeProjectGh({ projects: [TEMPLATE] });
    const rejection = createGhProjectPort(fake.gh).copy({ templateId: fakeProjectId(TEMPLATE), owner: 'nobody', title: 'widgets' });
    await expect(rejection).rejects.toThrow('board project: there is no owner named nobody to copy the project to');
    expect(fake.calls()).toHaveLength(1);
  });

  it('rejects a refused mutation keeping what gh wrote, and a payload with no project', async () => {
    const owner = answered({ repositoryOwner: { id: 'O_1', login: 'acme' } });
    const scope = 'gh: Your token has not been granted the required scopes to execute this query.';
    const refused = createGhProjectPort(answeringInTurn([owner, { ok: false, stdout: '', stderr: `${scope}\n` }]).gh);
    await expect(refused.copy({ templateId: 'PVT_1', owner: 'acme', title: 'w' })).rejects.toMatchObject({ detail: scope });
    const empty = createGhProjectPort(answeringInTurn([owner, answered({ copyProjectV2: { projectV2: null } })]).gh);
    await expect(empty.copy({ templateId: 'PVT_1', owner: 'acme', title: 'w' })).rejects.toThrow('data.copyProjectV2.projectV2 is null, expected a mapping');
  });
});

describe('link', () => {
  it('links the repository by its node id, once however often it is linked', async () => {
    const fake = createFakeProjectGh({ projects: [HELD], repositories: [REPOSITORY] });
    const port = createGhProjectPort(fake.gh);
    await port.link(fakeProjectId(HELD), 'acme/widgets');
    await port.link(fakeProjectId(HELD), 'acme/widgets');
    expect(fake.linked(fakeProjectId(HELD))).toEqual(['acme/widgets']);
    expect(fieldOf(fake.calls()[1] ?? [], 'repository')).toBe(`-f repository=${fakeRepositoryId('acme/widgets')}`);
  });

  it('rejects a repository that does not exist with what gh wrote, sending no mutation', async () => {
    const fake = createFakeProjectGh({ projects: [HELD], repositories: [REPOSITORY] });
    const rejection = createGhProjectPort(fake.gh).link(fakeProjectId(HELD), 'acme/gadgets');
    await expect(rejection).rejects.toBeInstanceOf(ProjectPortError);
    await expect(rejection).rejects.toMatchObject({ detail: 'gh: Could not resolve to a Repository with the name \'acme/gadgets\'.' });
    expect(fake.calls()).toHaveLength(1);
    expect(fake.linked(fakeProjectId(HELD))).toEqual([]);
  });

  it('rejects a payload with no repository', async () => {
    const runner = answeringInTurn([answered({ repository: { id: 'R_1' } }), answered({ linkProjectV2ToRepository: { repository: null } })]);
    await expect(createGhProjectPort(runner.gh).link('PVT_1', 'acme/widgets'))
      .rejects.toThrow('data.linkProjectV2ToRepository.repository is null, expected a mapping');
  });
});

describe('addItem', () => {
  it('adds an issue and a pull request, answering each item, and the same item for a second add', async () => {
    const project = { ...HELD, items: [{ number: 1 }] };
    const fake = createFakeProjectGh({ projects: [project], repositories: [REPOSITORY] });
    const port = createGhProjectPort(fake.gh);
    const issue = await port.addItem(fakeProjectId(project), { repository: 'acme/widgets', number: 12 });
    const pull = await port.addItem(fakeProjectId(project), { repository: 'acme/widgets', number: 14 });
    const again = await port.addItem(fakeProjectId(project), { repository: 'acme/widgets', number: 12 });
    expect([issue, pull, again]).toEqual([fakeItemId(project, 1), fakeItemId(project, 2), fakeItemId(project, 1)]);
    const items = await port.items(fakeProjectId(project));
    expect(items.map(({ content }) => content)).toEqual([
      { kind: 'issue', number: 1, repository: 'open-tomato/rafa' },
      { kind: 'issue', number: 12, repository: 'acme/widgets' },
      { kind: 'pull-request', number: 14, repository: 'acme/widgets' },
    ]);
    expect(fieldOf(fake.calls()[1] ?? [], 'content')).toBe(`-f content=${fakeContentId('acme/widgets', 12)}`);
  });

  it('rejects a number the repository does not hold with what gh wrote, sending no mutation', async () => {
    const fake = createFakeProjectGh({ projects: [HELD], repositories: [REPOSITORY] });
    const rejection = createGhProjectPort(fake.gh).addItem(fakeProjectId(HELD), { repository: 'acme/widgets', number: 999999 });
    await expect(rejection).rejects.toMatchObject({ detail: 'gh: Could not resolve to an issue or pull request with the number of 999999.' });
    expect(fake.calls()).toHaveLength(1);
  });

  it('rejects a refused add, and a lookup answering a number that is neither an issue nor a pull request', async () => {
    const lookup = answered({ repository: { id: 'R_1', issueOrPullRequest: { id: 'I_1' } } });
    const refused = createGhProjectPort(answeringInTurn([lookup, { ok: false, stdout: '', stderr: 'gh: API rate limit exceeded\n' }]).gh);
    await expect(refused.addItem('PVT_1', { repository: 'acme/widgets', number: 12 })).rejects.toMatchObject({ detail: 'gh: API rate limit exceeded' });
    const neither = createGhProjectPort(answeringInTurn([answered({ repository: { id: 'R_1', issueOrPullRequest: {} } })]).gh);
    await expect(neither.addItem('PVT_1', { repository: 'acme/widgets', number: 12 }))
      .rejects.toThrow('data.repository.issueOrPullRequest.id is undefined, expected a non-empty string');
  });
});

describe('the fake\'s writes', () => {
  it('refuses the content number sent as a string, and a mutation naming what it does not hold', async () => {
    const fake = createFakeProjectGh({ projects: [HELD], repositories: [REPOSITORY] });
    const asString = contentArgs({ repository: 'acme/widgets', number: 12 }).map((arg) => (arg === '-F'
      ? '-f'
      : arg));
    expect((await fake.gh(asString)).stderr).toBe('fake gh: the content lookup names its number with -F\n');
    expect((await fake.gh(addItemArgs(fakeProjectId(HELD), 'I_unknown'))).stderr).toStartWith('fake gh: the add names a project or content');
    expect((await fake.gh(linkArgs('PVT_unknown', fakeRepositoryId('acme/widgets')))).stderr).toStartWith('fake gh: the link names');
    expect((await fake.gh(copyArgs('PVT_unknown', fakeOwnerId('acme'), 'w'))).stderr).toStartWith('fake gh: the copy names');
  });
});
