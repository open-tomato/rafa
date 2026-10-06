/**
 * A strict fake of the project port's `gh api graphql` calls (`./gh.ts`)
 * behind a {@link GhRunner}: in-memory owners and their projects, each
 * with its fields and items, and repositories with their issues and pull
 * requests, recording every command it is handed. No case that uses it
 * spawns a process or reaches GitHub.
 *
 * This module is a test helper that is not itself a test file, as
 * `./facts-fake.ts` is: bun runs nothing in it until a `*.test.ts` calls
 * it, and `check-types` reads it.
 *
 * ## What it answers, and from which reading
 *
 * The shapes are the ones `./gh.ts`'s module note records, read off `gh`
 * 2.100.0 on 2026-10-06: a field with its `id`, `name` and `dataType`,
 * and `options` only on a single select; an item's title as a text value
 * of the field `Title`, and its repository and labels values as `{}`,
 * the query selecting neither; a page cursor the base64 of the last index
 * read. A number the owner does not hold, and a node id that names
 * nothing, fail with the stdout and stderr `gh` wrote for them, word for
 * word; an owner that does not exist answers `repositoryOwner` null.
 * {@link FAKE_TEMPLATE_FIELDS} are the eighteen fields the template
 * answered, in its order.
 * A draft's content as `{}` and a redacted item's as null are NOT
 * readings: no project read held either, and the adapter reads neither.
 *
 * The id lookups before a write answer as `./gh.ts`'s module note
 * records: an owner that does not exist as `repositoryOwner` null, a
 * repository or a number it does not hold failing with `NOT_FOUND` and
 * the stderr `gh` wrote. The node ids the fake makes (`O_fake_<login>`,
 * `R_fake_<owner/name>`, `I_fake_...`, `PR_fake_...`) are its own.
 *
 * ## The writes it holds
 *
 * The three mutations change what later reads answer, from the fake's
 * own rule, not a reading, since no mutation was sent to GitHub: a copy
 * becomes the owner's project of the next free number, with the
 * template's fields and none of its items; a link is kept in
 * {@link FakeProjectGh.linked}; an add appends an item holding no value,
 * or answers the item already there for the same content, the way
 * GitHub's documentation says `addProjectV2ItemById` does. A mutation
 * naming a project, owner, repository or content id it does not hold is
 * refused with a `fake gh:` message.
 *
 * ## Strict
 *
 * Anything but those calls — another command, a query of another
 * shape, the project number sent as a string with `-f` rather than as an
 * integer with `-F` — is refused with `ok` false and a message opening
 * with `fake gh:`, the prefix of every message the fake invents.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { HORIZON_OPTIONS, STAGE_OPTIONS } from './rules.js';

/** The repository an item's content belongs to when none is given. */
export const FAKE_PROJECT_REPOSITORY = 'open-tomato/rafa';

/** One field the fake holds. */
export interface FakeProjectField {
  readonly name: string;
  readonly dataType: string;
  /** Its options, for a single select. */
  readonly options?: readonly string[];
}

/** The template's fields, as `open-tomato` project 6 answered them; see the module note. */
export const FAKE_TEMPLATE_FIELDS: readonly FakeProjectField[] = Object.freeze([
  { name: 'Title', dataType: 'TITLE' },
  { name: 'Assignees', dataType: 'ASSIGNEES' },
  { name: 'Status', dataType: 'SINGLE_SELECT', options: ['Todo', 'In Progress', 'Done'] },
  { name: 'Labels', dataType: 'LABELS' },
  { name: 'Linked pull requests', dataType: 'LINKED_PULL_REQUESTS' },
  { name: 'Milestone', dataType: 'MILESTONE' },
  { name: 'Repository', dataType: 'REPOSITORY' },
  { name: 'Reviewers', dataType: 'REVIEWERS' },
  { name: 'Parent issue', dataType: 'PARENT_ISSUE' },
  { name: 'Sub-issues progress', dataType: 'SUB_ISSUES_PROGRESS' },
  { name: 'Created', dataType: 'CREATED' },
  { name: 'Updated', dataType: 'UPDATED' },
  { name: 'Closed', dataType: 'CLOSED' },
  { name: 'Stage', dataType: 'SINGLE_SELECT', options: STAGE_OPTIONS },
  { name: 'Horizon', dataType: 'SINGLE_SELECT', options: HORIZON_OPTIONS },
  { name: 'Rank', dataType: 'NUMBER' },
  { name: 'Blocked by', dataType: 'TEXT' },
  { name: 'Progress', dataType: 'TEXT' },
]);

/** One item the fake holds. */
export interface FakeProjectItem {
  /** `ISSUE` when left out. */
  readonly type?: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE' | 'REDACTED';
  /** The issue's or pull request's number; ignored for a draft or redacted item. */
  readonly number?: number;
  /** {@link FAKE_PROJECT_REPOSITORY} when left out. */
  readonly repository?: string;
  readonly archived?: boolean;
  /** Its title, answered as the `Title` text value; `Item <n>` when left out. */
  readonly title?: string;
  /** Its values by field name: an option's name or a text for a select or text field, a number for a number field. */
  readonly values?: Readonly<Record<string, string | number>>;
}

/** One project the fake holds. */
export interface FakeProject {
  readonly owner: string;
  readonly number: number;
  /** `PVT_fake_<owner>_<number>` when left out. */
  readonly id?: string;
  readonly title?: string;
  readonly public?: boolean;
  readonly closed?: boolean;
  /** {@link FAKE_TEMPLATE_FIELDS} when left out. */
  readonly fields?: readonly FakeProjectField[];
  readonly items?: readonly FakeProjectItem[];
}

/** One repository the fake holds. */
export interface FakeRepository {
  /** `owner/name`; its owner exists too. */
  readonly nameWithOwner: string;
  readonly issues?: readonly number[];
  readonly pullRequests?: readonly number[];
}

/** What the fake is made with. */
export interface FakeProjectGhOptions {
  readonly projects?: readonly FakeProject[];
  /** Logins that exist and hold no project here; every project's and repository's owner exists too. */
  readonly owners?: readonly string[];
  readonly repositories?: readonly FakeRepository[];
}

/** The fake, and what it recorded. */
export interface FakeProjectGh {
  readonly gh: GhRunner;
  /** Every argv handed over, in order, refused ones included. */
  calls(): readonly (readonly string[])[];
  /** Makes the next call fail with `stderr`, as a refused `gh` would. */
  failNext(stderr: string): void;
  /** The repositories linked to the project whose node id is `projectId`, in link order. */
  linked(projectId: string): readonly string[];
}

type Json = Readonly<Record<string, unknown>>;

/** An issue or pull request of a held repository, by its node id. */
interface HeldContent {
  readonly type: 'ISSUE' | 'PULL_REQUEST';
  readonly repository: string;
  readonly number: number;
}

/** A field as the fake answers it, with the ids it made. */
interface HeldField extends FakeProjectField {
  readonly id: string;
  readonly optionIds: ReadonlyMap<string, string>;
}

function ok(data: Json): GhResult {
  return { ok: true, stdout: JSON.stringify({ data }), stderr: '' };
}

function refused(message: string): GhResult {
  return { ok: false, stdout: '', stderr: `fake gh: ${message}\n` };
}

/** A failure carrying the data and one `NOT_FOUND` error, as `gh` wrote it. */
function notFound(data: Json, path: readonly string[], column: number, message: string): GhResult {
  const errors = [{ type: 'NOT_FOUND', path, locations: [{ line: 1, column }], message }];
  return { ok: false, stdout: JSON.stringify({ data, errors }), stderr: `gh: ${message}\n` };
}

/** The node id of `project`. */
export function fakeProjectId(project: Pick<FakeProject, 'owner' | 'number' | 'id'>): string {
  return project.id ?? `PVT_fake_${project.owner}_${String(project.number)}`;
}

/** The node id of the `index`th item of `project`. */
export function fakeItemId(project: Pick<FakeProject, 'owner' | 'number' | 'id'>, index: number): string {
  return `PVTI_${fakeProjectId(project)}_${String(index)}`;
}

/** The node id of the owner `login`. */
export function fakeOwnerId(login: string): string {
  return `O_fake_${login}`;
}

/** The node id of the repository `nameWithOwner`. */
export function fakeRepositoryId(nameWithOwner: string): string {
  return `R_fake_${nameWithOwner}`;
}

/** The node id of an issue, or of a pull request, of `nameWithOwner`. */
export function fakeContentId(nameWithOwner: string, number: number, type: 'ISSUE' | 'PULL_REQUEST' = 'ISSUE'): string {
  return `${type === 'ISSUE'
    ? 'I'
    : 'PR'}_fake_${nameWithOwner}_${String(number)}`;
}

/** The id the fake gives the `option`th option of the `field`th field: eight hex digits, as GitHub's are. */
export function fakeOptionId(field: number, option: number): string {
  return `${field.toString(16).padStart(4, '0')}${option.toString(16).padStart(4, '0')}`;
}

/** The fields of `project`, with their ids. */
function heldFields(project: FakeProject): readonly HeldField[] {
  return (project.fields ?? FAKE_TEMPLATE_FIELDS).map((field, index) => ({
    ...field,
    id: `${field.options === undefined
      ? 'PVTF'
      : 'PVTSSF'}_${fakeProjectId(project)}_${String(index)}`,
    optionIds: new Map((field.options ?? []).map((name, option) => [name, fakeOptionId(index, option)])),
  }));
}

/** The `-f` and `-F` fields of `args`, by name, or null when the argv is not the recorded shape. */
function fieldsOf(args: readonly string[]): ReadonlyMap<string, { readonly flag: string; readonly value: string }> | null {
  if (args[0] !== 'api' || args[1] !== 'graphql') return null;
  const fields = new Map<string, { flag: string; value: string }>();
  for (let index = 2; index < args.length; index += 2) {
    const [flag = '', field = ''] = [args[index], args[index + 1]];
    const split = field.indexOf('=');
    if ((flag !== '-f' && flag !== '-F') || split < 1) return null;
    fields.set(field.slice(0, split), { flag, value: field.slice(split + 1) });
  }
  return fields;
}

/** The value nodes of one item, as the items read answers them. */
function valueNodes(item: FakeProjectItem, index: number, fields: readonly HeldField[]): readonly Json[] | string {
  const nodes: Json[] = [{}, {}];
  const title = fields.find(({ dataType }) => dataType === 'TITLE');
  if (title !== undefined) nodes.push({ text: item.title ?? `Item ${String(index)}`, field: { id: title.id, name: title.name } });
  for (const [name, value] of Object.entries(item.values ?? {})) {
    const field = fields.find((held) => held.name === name);
    if (field === undefined) return `item ${String(index)} holds a value of "${name}", which the project does not hold`;
    const ref = { id: field.id, name: field.name };
    const optionId = field.optionIds.get(String(value));
    if (field.dataType === 'SINGLE_SELECT' && optionId === undefined) return `"${name}" has no option ${JSON.stringify(value)}`;
    nodes.push(field.dataType === 'SINGLE_SELECT'
      ? { optionId, name: value, field: ref }
      : field.dataType === 'NUMBER'
        ? { number: value, field: ref }
        : { text: value, field: ref });
  }
  return nodes;
}

/** The item node of `item`, as the items read answers it. */
function itemNode(project: FakeProject, item: FakeProjectItem, index: number, valuesFirst: number): Json | string {
  const type = item.type ?? 'ISSUE';
  const values = valueNodes(item, index, heldFields(project));
  if (typeof values === 'string') return values;
  const content = type === 'ISSUE' || type === 'PULL_REQUEST'
    ? { number: item.number ?? index + 1, repository: { nameWithOwner: item.repository ?? FAKE_PROJECT_REPOSITORY } }
    : type === 'DRAFT_ISSUE'
      ? {}
      : null;
  return {
    id: fakeItemId(project, index),
    type,
    isArchived: item.archived ?? false,
    content,
    fieldValues: { pageInfo: { hasNextPage: values.length > valuesFirst }, nodes: values.slice(0, valuesFirst) },
  };
}

/** Makes the fake; see the module note. */
export function createFakeProjectGh(options: FakeProjectGhOptions = {}): FakeProjectGh {
  let projects: readonly FakeProject[] = options.projects ?? [];
  const repositories = options.repositories ?? [];
  const owners = new Set([
    ...(options.owners ?? []),
    ...projects.map(({ owner }) => owner),
    ...repositories.map(({ nameWithOwner }) => nameWithOwner.split('/')[0] ?? ''),
  ]);
  const contents = new Map<string, HeldContent>(repositories.flatMap(({ nameWithOwner, issues = [], pullRequests = [] }) => [
    ...issues.map((number) => [fakeContentId(nameWithOwner, number), { type: 'ISSUE', repository: nameWithOwner, number }] as const),
    ...pullRequests.map((number) => [fakeContentId(nameWithOwner, number, 'PULL_REQUEST'), { type: 'PULL_REQUEST', repository: nameWithOwner, number }] as const),
  ]));
  let links: ReadonlyMap<string, readonly string[]> = new Map();
  const recorded: (readonly string[])[] = [];
  let failure: string | null = null;

  const projectById = (id: string | undefined): FakeProject | undefined => projects.find((held) => fakeProjectId(held) === id);

  const replaceProject = (old: FakeProject, next: FakeProject): void => {
    projects = projects.map((held) => (held === old
      ? next
      : held));
  };

  const answerOwner = (owner: string): GhResult => (owners.has(owner)
    ? ok({ repositoryOwner: { id: fakeOwnerId(owner), login: owner } })
    : ok({ repositoryOwner: null }));

  const answerRepository = (owner: string, name: string, number: string | undefined): GhResult => {
    const nameWithOwner = `${owner}/${name}`;
    const repository = repositories.find((held) => held.nameWithOwner === nameWithOwner);
    if (repository === undefined) return notFound({ repository: null }, ['repository'], 57, `Could not resolve to a Repository with the name '${nameWithOwner}'.`);
    const id = fakeRepositoryId(nameWithOwner);
    if (number === undefined) return ok({ repository: { id } });
    const held = [...contents].find(([, content]) => content.repository === nameWithOwner && String(content.number) === number);
    return held === undefined
      ? notFound({ repository: { id, issueOrPullRequest: null } }, ['repository', 'issueOrPullRequest'], 101, `Could not resolve to an issue or pull request with the number of ${number}.`)
      : ok({ repository: { id, issueOrPullRequest: { id: held[0] } } });
  };

  const answerCopy = (templateId: string, ownerId: string, title: string): GhResult => {
    const template = projectById(templateId);
    const owner = [...owners].find((login) => fakeOwnerId(login) === ownerId);
    if (template === undefined || owner === undefined) return refused(`the copy names a template or owner the fake does not hold: ${templateId}, ${ownerId}`);
    const number = Math.max(0, ...projects.filter((held) => held.owner === owner).map((held) => held.number)) + 1;
    const copied: FakeProject = { owner, number, title, public: false, closed: false, fields: template.fields ?? FAKE_TEMPLATE_FIELDS, items: [] };
    projects = [...projects, copied];
    const found = answerFind(owner, String(number));
    const data = (JSON.parse(found.stdout) as { data: { repositoryOwner: { projectV2: Json } } }).data.repositoryOwner.projectV2;
    return ok({ copyProjectV2: { projectV2: data } });
  };

  const answerLink = (projectId: string, repositoryId: string): GhResult => {
    const repository = repositories.find(({ nameWithOwner }) => fakeRepositoryId(nameWithOwner) === repositoryId);
    if (projectById(projectId) === undefined || repository === undefined) {
      return refused(`the link names a project or repository the fake does not hold: ${projectId}, ${repositoryId}`);
    }
    const held = links.get(projectId) ?? [];
    links = new Map([...links, [projectId, held.includes(repository.nameWithOwner)
      ? held
      : [...held, repository.nameWithOwner]]]);
    return ok({ linkProjectV2ToRepository: { repository: { id: repositoryId } } });
  };

  const answerAddItem = (projectId: string, contentId: string): GhResult => {
    const project = projectById(projectId);
    const content = contents.get(contentId);
    if (project === undefined || content === undefined) return refused(`the add names a project or content the fake does not hold: ${projectId}, ${contentId}`);
    const items = project.items ?? [];
    const index = items.findIndex((item) => (item.type ?? 'ISSUE') === content.type
      && (item.repository ?? FAKE_PROJECT_REPOSITORY) === content.repository
      && item.number === content.number);
    if (index >= 0) return ok({ addProjectV2ItemById: { item: { id: fakeItemId(project, index) } } });
    const next = { ...project, items: [...items, { type: content.type, repository: content.repository, number: content.number }] };
    replaceProject(project, next);
    return ok({ addProjectV2ItemById: { item: { id: fakeItemId(next, items.length) } } });
  };

  /** The mutation or id lookup `query` asks, or null when it is none of them. */
  const answerWrite = (query: string, fields: ReadonlyMap<string, { readonly flag: string; readonly value: string }>): GhResult | null => {
    const value = (name: string): string => fields.get(name)?.value ?? '';
    if (query.includes('copyProjectV2(')) return answerCopy(value('template'), value('owner'), value('title'));
    if (query.includes('linkProjectV2ToRepository(')) return answerLink(value('project'), value('repository'));
    if (query.includes('addProjectV2ItemById(')) return answerAddItem(value('project'), value('content'));
    if (query.includes('repositoryOwner(login: $owner) { id')) return answerOwner(value('owner'));
    if (query.includes('repository(owner: $owner, name: $name)')) {
      const number = fields.get('number');
      if (number !== undefined && number.flag !== '-F') return refused('the content lookup names its number with -F');
      return answerRepository(value('owner'), value('name'), number?.value);
    }
    return null;
  };

  const answerFind = (owner: string, number: string): GhResult => {
    if (!owners.has(owner)) return ok({ repositoryOwner: null });
    const project = projects.find((held) => held.owner === owner && String(held.number) === number);
    if (project === undefined) {
      return notFound({ repositoryOwner: { login: owner, projectV2: null } }, ['repositoryOwner', 'projectV2'], 115, `Could not resolve to a ProjectV2 with the number ${number}.`);
    }
    const fields = heldFields(project).map(({ id, name, dataType, options: names, optionIds }) => ({
      id,
      name,
      dataType,
      ...(names === undefined
        ? {}
        : { options: names.map((option) => ({ id: optionIds.get(option), name: option })) }),
    }));
    return ok({
      repositoryOwner: {
        login: owner,
        projectV2: {
          id: fakeProjectId(project),
          number: project.number,
          title: project.title ?? `Project ${number}`,
          url: `https://github.com/orgs/${owner}/projects/${number}`,
          closed: project.closed ?? false,
          public: project.public ?? false,
          fields: { pageInfo: { hasNextPage: false }, nodes: fields },
        },
      },
    });
  };

  const answerItems = (query: string, id: string, cursor: string | undefined): GhResult => {
    const project = projects.find((held) => fakeProjectId(held) === id);
    if (project === undefined) return notFound({ node: null }, ['node'], 40, `Could not resolve to a node with the global id of '${id}'`);
    const [, first = '0'] = /items\(first: (\d+), after: \$after\)/u.exec(query) ?? [];
    const [, valuesFirst = '0'] = /fieldValues\(first: (\d+)\)/u.exec(query) ?? [];
    const items = project.items ?? [];
    const start = cursor === undefined
      ? 0
      : Number(atob(cursor));
    const end = Math.min(items.length, start + Number(first));
    const nodes = items.slice(start, end).map((item, offset) => itemNode(project, item, start + offset, Number(valuesFirst)));
    const fault = nodes.find((node) => typeof node === 'string');
    if (fault !== undefined) return refused(fault);
    return ok({
      node: {
        items: {
          pageInfo: {
            hasNextPage: end < items.length,
            endCursor: end === 0
              ? null
              : btoa(String(end)),
          },
          nodes,
        },
      },
    });
  };

  const answer = (args: readonly string[]): GhResult => {
    const fields = fieldsOf(args);
    const query = fields?.get('query')?.value;
    if (fields === null || query === undefined) return refused(`unmodelled command: gh ${args.join(' ')}`);
    const write = answerWrite(query, fields);
    if (write !== null) return write;
    if (query.includes('projectV2(number: $number)')) {
      const owner = fields.get('owner');
      const number = fields.get('number');
      if (owner?.flag !== '-f' || number?.flag !== '-F') return refused('the find names its owner with -f and its number with -F');
      return answerFind(owner.value, number.value);
    }
    if (query.includes('node(id: $project)')) {
      const id = fields.get('project')?.value;
      if (id === undefined) return refused('the items read names no project');
      return answerItems(query, id, fields.get('after')?.value);
    }
    return refused(`unmodelled query: ${query}`);
  };

  const gh: GhRunner = (args) => {
    recorded.push(Object.freeze([...args]));
    if (failure !== null) {
      const stderr = failure;
      failure = null;
      return Promise.resolve({ ok: false, stdout: '', stderr });
    }
    return Promise.resolve(answer(args));
  };

  return {
    gh,
    calls: () => [...recorded],
    failNext: (stderr) => {
      failure = stderr;
    },
    linked: (projectId) => links.get(projectId) ?? [],
  };
}
