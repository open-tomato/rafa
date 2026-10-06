/**
 * The project port's `gh api graphql` adapter (`./port.ts`): every call
 * goes through the `GhRunner` seam (`src/adapters/tracker/github.ts`), so
 * no case reaches GitHub and the strict fake (`./project-fake.ts`) answers
 * the shapes recorded here.
 *
 * Every value a call names — an owner's login, a project's node id, a
 * page cursor — travels as a GraphQL variable, never spliced into the
 * query text; the project number goes as `-F number=<n>`, which `gh`
 * sends as an integer.
 *
 * ## What `gh` answered
 *
 * Measured with `gh` 2.100.0 on 2026-10-06, read-only:
 *
 *  - The find on `open-tomato` and `6` exited 0 with
 *    `{"data":{"repositoryOwner":{"login":...,"projectV2":{...}}}}`. The
 *    owner is read through `repositoryOwner(login:)` and
 *    `... on ProjectV2Owner`, which answered for the organization
 *    `open-tomato` and the user `marcostomatti` alike.
 *  - A number the owner does not hold (`999`, on both) exited 1, with
 *    `gh: Could not resolve to a ProjectV2 with the number 999.` on stderr
 *    and, on stdout, the data with `projectV2` null beside one error of
 *    `type` `NOT_FOUND` at the path `repositoryOwner.projectV2`. That
 *    answer, and only that one, is read as no project: any other failed
 *    call rejects.
 *  - An owner that does not exist exited 0 with
 *    `{"data":{"repositoryOwner":null}}`, read as no project too.
 *  - The items of an organization project of 160 issues, read by node id
 *    at {@link PROJECT_PAGE_SIZE}, came in two pages, each `rateLimit`
 *    cost 1. A value of a type the query does not select — a repository,
 *    the labels — answered `{}`, and is passed over. The title answered
 *    as a text value of the field `Title`. No item there was archived,
 *    a draft or redacted: `type`'s four values (`ISSUE`, `PULL_REQUEST`,
 *    `DRAFT_ISSUE`, `REDACTED`) and the value types' nullable `number`,
 *    `text` and `optionId` are read off the schema by introspection, not
 *    off an answer. A null value is read as no value.
 *  - A node id that names nothing exited 1 with `NOT_FOUND` at `node`;
 *    {@link ProjectPort.items} rejects on it, since a project found a
 *    moment ago and gone now is not one to read as empty.
 *
 * ## The writes, and what was and was not measured
 *
 * Copy, link and add item each read the node id their mutation needs,
 * then send the mutation: `repositoryOwner(login:) { id }` for the copy's
 * owner, `repository(owner:, name:) { id }` for the link, and
 * `issueOrPullRequest(number:)` under it for the item. Those lookups were
 * measured read-only with `gh` 2.100.0 on 2026-10-06: an owner answered
 * `{"data":{"repositoryOwner":{"id":"O_...","login":...}}}` (`U_...` for
 * a user), and an owner that does not exist `repositoryOwner` null, exit
 * 0; a repository that does not exist exited 1 with `NOT_FOUND` at
 * `repository`, and a number it does not hold exited 1 with `NOT_FOUND`
 * at `repository.issueOrPullRequest`, each with `gh: Could not resolve
 * ...` on stderr. All three reject: a write has nothing to answer null
 * about.
 *
 * The mutations' inputs and payloads were read off the schema by
 * introspection the same day: `copyProjectV2` takes `projectId`,
 * `ownerId`, `title` and an optional `includeDraftIssues`, sent false, and
 * answers `projectV2`; `linkProjectV2ToRepository` takes `projectId` and
 * `repositoryId` and answers `repository`; `addProjectV2ItemById` takes
 * `projectId` and `contentId` and answers `item`. No mutation was sent to
 * GitHub, so their answers to a second link of the same repository, or
 * a second add of the same issue, are NOT readings: the adapter reads
 * only the payload the schema names, and rejects a null one.
 */
import type {
  Project,
  ProjectContentRef,
  ProjectCopy,
  ProjectField,
  ProjectFieldValue,
  ProjectItem,
  ProjectItemContent,
  ProjectOption,
  ProjectPort,
  ProjectRef,
} from './port.js';
import type { GhRunner } from '../../adapters/tracker/github.js';

import { describeValue, isMapping } from '../../config-sections.js';

import { PROJECT_PAGE_SIZE, ProjectPortError } from './port.js';

/** A login GitHub accepts: letters, digits and hyphens. */
const LOGIN = /^[A-Za-z\d-]+$/u;

/** The GraphQL error type GitHub answers for a project or node that is not there. */
const NOT_FOUND = 'NOT_FOUND';

/** The path of the error a missing project number answers. */
const MISSING_PROJECT_PATH = 'repositoryOwner.projectV2';

/** How long a refused answer is quoted in a refusal. */
const QUOTED_LENGTH = 200;

/** What the find reads of each field. */
const FIELD_SELECTION = '... on ProjectV2FieldCommon { id name dataType } ... on ProjectV2SingleSelectField { options { id name } }';

/** What the find and the copy read of a project. */
const PROJECT_SELECTION = 'id number title url closed public'
  + ` fields(first: ${String(PROJECT_PAGE_SIZE)}) { pageInfo { hasNextPage } nodes { ${FIELD_SELECTION} } }`;

/** What the find asks; see the module note. */
export const FIND_QUERY = 'query($owner: String!, $number: Int!) { repositoryOwner(login: $owner) { login ... on ProjectV2Owner'
  + ` { projectV2(number: $number) { ${PROJECT_SELECTION} } } } }`;

/** The node id of an owner, read before the copy. */
export const OWNER_QUERY = 'query($owner: String!) { repositoryOwner(login: $owner) { id login } }';

/** The copy; see the module note. */
export const COPY_MUTATION = 'mutation($template: ID!, $owner: ID!, $title: String!) { copyProjectV2(input:'
  + ` { projectId: $template, ownerId: $owner, title: $title, includeDraftIssues: false }) { projectV2 { ${PROJECT_SELECTION} } } }`;

/** The node id of a repository, read before the link. */
export const REPOSITORY_QUERY = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }';

/** The link; see the module note. */
export const LINK_MUTATION = 'mutation($project: ID!, $repository: ID!) { linkProjectV2ToRepository(input:'
  + ' { projectId: $project, repositoryId: $repository }) { repository { id } } }';

/** The node id of an issue or a pull request, read before the add. */
export const CONTENT_QUERY = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name)'
  + ' { id issueOrPullRequest(number: $number) { ... on Issue { id } ... on PullRequest { id } } } }';

/** The add; see the module note. */
export const ADD_ITEM_MUTATION = 'mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input:'
  + ' { projectId: $project, contentId: $content }) { item { id } } }';

/** A repository name GitHub accepts after its owner. */
const REPOSITORY_NAME = /^[\w.-]+$/u;

/** The field a value belongs to. */
const VALUE_FIELD = 'field { ... on ProjectV2FieldCommon { id name } }';

/** What the items read asks of each value. */
const VALUE_SELECTION = `... on ProjectV2ItemFieldSingleSelectValue { optionId name ${VALUE_FIELD} }`
  + ` ... on ProjectV2ItemFieldNumberValue { number ${VALUE_FIELD} }`
  + ` ... on ProjectV2ItemFieldTextValue { text ${VALUE_FIELD} }`;

/** What the items read asks of each item's content. */
const CONTENT_SELECTION = '... on Issue { number repository { nameWithOwner } } ... on PullRequest { number repository { nameWithOwner } }';

/** What the items read asks, one page at a time; see the module note. */
export const ITEMS_QUERY = 'query($project: ID!, $after: String) { node(id: $project) { ... on ProjectV2'
  + ` { items(first: ${String(PROJECT_PAGE_SIZE)}, after: $after) { pageInfo { hasNextPage endCursor }`
  + ` nodes { id type isArchived content { ${CONTENT_SELECTION} }`
  + ` fieldValues(first: ${String(PROJECT_PAGE_SIZE)}) { pageInfo { hasNextPage } nodes { ${VALUE_SELECTION} } } } } } } }`;

/** The content kind of each item `type` with a number. */
const NUMBERED_TYPES: Readonly<Record<string, 'issue' | 'pull-request'>> = Object.freeze({ ISSUE: 'issue', PULL_REQUEST: 'pull-request' });

/** A mapping of answer keys. */
type Answer = Readonly<Record<string, unknown>>;

function refuse(problem: string, detail = ''): never {
  throw new ProjectPortError(problem, detail);
}

function readMapping(value: unknown, where: string): Answer {
  if (!isMapping(value)) refuse(`${where} is ${describeValue(value)}, expected a mapping`);
  return value;
}

function readString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') refuse(`${where} is ${describeValue(value)}, expected a non-empty string`);
  return value;
}

function readBoolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') refuse(`${where} is ${describeValue(value)}, expected true or false`);
  return value;
}

function readWhole(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    refuse(`${where} is ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

function readList(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) refuse(`${where} is ${describeValue(value)}, expected a list`);
  return value;
}

/** The nodes of the one-page connection at `where`, refusing a second page. */
function readOnePage(value: unknown, where: string): readonly unknown[] {
  const connection = readMapping(value, where);
  if (readMapping(connection['pageInfo'], `${where}.pageInfo`)['hasNextPage'] !== false) {
    refuse(`${where} holds more than ${String(PROJECT_PAGE_SIZE)} entries, one page`);
  }
  return readList(connection['nodes'], `${where}.nodes`);
}

/** The `gh api graphql` argv sending `query` with `fields`, each `-f` but the ones named `-F`. */
function graphqlArgs(query: string, fields: readonly (readonly [flag: '-f' | '-F', name: string, value: string])[]): readonly string[] {
  return Object.freeze(['api', 'graphql', ...fields.flatMap(([flag, name, value]) => [flag, `${name}=${value}`]), '-f', `query=${query}`]);
}

/** `text` parsed as JSON, or undefined when it is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** What `gh` wrote on a failed call, for a refusal's detail. */
function written(stdout: string, stderr: string): string {
  return stderr.trim() || stdout.trim();
}

/** The `data` of a call that exited 0, or a rejection naming what `gh` wrote. */
async function readData(gh: GhRunner, args: readonly string[]): Promise<Answer> {
  const result = await gh(args);
  if (!result.ok) refuse(`gh api graphql failed: ${written(result.stdout, result.stderr)}`, written(result.stdout, result.stderr));
  const answer = parsed(result.stdout);
  if (answer === undefined) refuse(`gh api graphql answered text that is not JSON: ${result.stdout.slice(0, QUOTED_LENGTH)}`, result.stdout);
  return readMapping(readMapping(answer, 'the answer')['data'], 'data');
}

/** True when a failed find's stdout is the missing-number answer; see the module note. */
function isMissingProject(stdout: string): boolean {
  const answer = parsed(stdout);
  if (!isMapping(answer) || !Array.isArray(answer['errors']) || answer['errors'].length === 0) return false;
  const owner = isMapping(answer['data'])
    ? answer['data']['repositoryOwner']
    : undefined;
  return isMapping(owner) && owner['projectV2'] === null && answer['errors'].every((error) => isMapping(error)
    && error['type'] === NOT_FOUND
    && Array.isArray(error['path'])
    && error['path'].join('.') === MISSING_PROJECT_PATH);
}

/** One option at `where`. */
function readOption(value: unknown, where: string): ProjectOption {
  const option = readMapping(value, where);
  return { id: readString(option['id'], `${where}.id`), name: readString(option['name'], `${where}.name`) };
}

/** One field at `where`. */
function readField(value: unknown, where: string): ProjectField {
  const field = readMapping(value, where);
  return {
    id: readString(field['id'], `${where}.id`),
    name: readString(field['name'], `${where}.name`),
    dataType: readString(field['dataType'], `${where}.dataType`),
    options: 'options' in field
      ? readList(field['options'], `${where}.options`).map((option, index) => readOption(option, `${where}.options[${String(index)}]`))
      : null,
  };
}

/** The project at `where`, held by `owner`. */
function readProject(owner: string, value: unknown, where: string): Project {
  const project = readMapping(value, where);
  return {
    owner,
    number: readWhole(project['number'], `${where}.number`),
    id: readString(project['id'], `${where}.id`),
    title: readString(project['title'], `${where}.title`),
    url: readString(project['url'], `${where}.url`),
    closed: readBoolean(project['closed'], `${where}.closed`),
    public: readBoolean(project['public'], `${where}.public`),
    fields: readOnePage(project['fields'], `${where}.fields`).map((field, index) => readField(field, `${where}.fields.nodes[${String(index)}]`)),
  };
}

/** The argv of the find; throws a `RangeError` on an owner or number GitHub could not hold. */
export function findArgs(ref: ProjectRef): readonly string[] {
  requireLogin(ref.owner);
  requireNumber(ref.number, 'a project number');
  return graphqlArgs(FIND_QUERY, [['-f', 'owner', ref.owner], ['-F', 'number', String(ref.number)]]);
}

/** Throws a `RangeError` on an empty node id, naming `what`, article and all, it should have named. */
function requireNodeId(id: string, what: string): void {
  if (id === '') throw new RangeError(`not ${what} node id: ""`);
}

/** Throws a `RangeError` on a login GitHub could not hold. */
function requireLogin(login: string): void {
  if (!LOGIN.test(login)) throw new RangeError(`not a GitHub login: ${JSON.stringify(login)}`);
}

/** Throws a `RangeError` on a number no issue, pull request or project could hold. */
function requireNumber(number: number, what: string): void {
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`not ${what}: ${String(number)}`);
}

/** `owner/name` split in two; throws a `RangeError` on anything else. */
function splitRepository(repository: string): readonly [owner: string, name: string] {
  const [owner = '', name = '', ...rest] = repository.split('/');
  if (rest.length > 0 || !LOGIN.test(owner) || !REPOSITORY_NAME.test(name) || name === '.' || name === '..') {
    throw new RangeError(`not a repository, owner/name: ${JSON.stringify(repository)}`);
  }
  return [owner, name];
}

/** The argv of the owner lookup before a copy. */
export function ownerArgs(owner: string): readonly string[] {
  requireLogin(owner);
  return graphqlArgs(OWNER_QUERY, [['-f', 'owner', owner]]);
}

/** The argv of the copy of `templateId` to the owner whose node id is `ownerId`. */
export function copyArgs(templateId: string, ownerId: string, title: string): readonly string[] {
  requireNodeId(templateId, 'a project');
  requireNodeId(ownerId, 'an owner');
  if (title.trim() === '') throw new RangeError('not a project title: an empty one');
  return graphqlArgs(COPY_MUTATION, [['-f', 'template', templateId], ['-f', 'owner', ownerId], ['-f', 'title', title]]);
}

/** The argv of the repository lookup before a link. */
export function repositoryArgs(repository: string): readonly string[] {
  const [owner, name] = splitRepository(repository);
  return graphqlArgs(REPOSITORY_QUERY, [['-f', 'owner', owner], ['-f', 'name', name]]);
}

/** The argv of the link of the repository `repositoryId` to the project `projectId`. */
export function linkArgs(projectId: string, repositoryId: string): readonly string[] {
  requireNodeId(projectId, 'a project');
  requireNodeId(repositoryId, 'a repository');
  return graphqlArgs(LINK_MUTATION, [['-f', 'project', projectId], ['-f', 'repository', repositoryId]]);
}

/** The argv of the issue or pull request lookup before an add; the number as an integer. */
export function contentArgs(content: ProjectContentRef): readonly string[] {
  const [owner, name] = splitRepository(content.repository);
  requireNumber(content.number, 'an issue or pull request number');
  return graphqlArgs(CONTENT_QUERY, [['-f', 'owner', owner], ['-f', 'name', name], ['-F', 'number', String(content.number)]]);
}

/** The argv of the add of the content `contentId` to the project `projectId`. */
export function addItemArgs(projectId: string, contentId: string): readonly string[] {
  requireNodeId(projectId, 'a project');
  requireNodeId(contentId, 'an issue or pull request');
  return graphqlArgs(ADD_ITEM_MUTATION, [['-f', 'project', projectId], ['-f', 'content', contentId]]);
}

/** The argv of one page of items, from `cursor` on, or from the start when null. */
export function itemsArgs(projectId: string, cursor: string | null): readonly string[] {
  requireNodeId(projectId, 'a project');
  return graphqlArgs(ITEMS_QUERY, [['-f', 'project', projectId], ...(cursor === null
    ? []
    : [['-f', 'after', cursor] as const])]);
}

/** The field name and value at `where`, or null for a value the query does not select or a null one. */
function readValue(value: unknown, where: string): readonly [string, ProjectFieldValue] | null {
  const node = readMapping(value, where);
  if (!('field' in node)) return null;
  const name = readString(readMapping(node['field'], `${where}.field`)['name'], `${where}.field.name`);
  if ('optionId' in node) {
    return node['optionId'] === null
      ? null
      : [name, { kind: 'option', optionId: readString(node['optionId'], `${where}.optionId`), name: readString(node['name'], `${where}.name`) }];
  }
  if ('number' in node) {
    const number = node['number'];
    if (number !== null && (typeof number !== 'number' || !Number.isFinite(number))) refuse(`${where}.number is ${describeValue(number)}, expected a number`);
    return number === null
      ? null
      : [name, { kind: 'number', number }];
  }
  const text = node['text'];
  if (text !== null && typeof text !== 'string') refuse(`${where}.text is ${describeValue(text)}, expected a string`);
  return text === null || text === undefined
    ? null
    : [name, { kind: 'text', text }];
}

/** The content of the item at `where`, by its `type`. */
function readContent(item: Answer, where: string): ProjectItemContent {
  const type = item['type'];
  if (type === 'DRAFT_ISSUE') return { kind: 'draft' };
  if (type === 'REDACTED') return { kind: 'redacted' };
  const kind = typeof type === 'string'
    ? NUMBERED_TYPES[type]
    : undefined;
  if (kind === undefined) refuse(`${where}.type is ${describeValue(type)}, expected ISSUE, PULL_REQUEST, DRAFT_ISSUE or REDACTED`);
  const content = readMapping(item['content'], `${where}.content`);
  return {
    kind,
    number: readWhole(content['number'], `${where}.content.number`),
    repository: readString(readMapping(content['repository'], `${where}.content.repository`)['nameWithOwner'], `${where}.content.repository.nameWithOwner`),
  };
}

/** The item at `where`. */
function readItem(value: unknown, where: string): ProjectItem {
  const item = readMapping(value, where);
  const values = readOnePage(item['fieldValues'], `${where}.fieldValues`)
    .map((node, index) => readValue(node, `${where}.fieldValues.nodes[${String(index)}]`));
  return {
    id: readString(item['id'], `${where}.id`),
    archived: readBoolean(item['isArchived'], `${where}.isArchived`),
    content: readContent(item, where),
    values: new Map(values.filter((value) => value !== null)),
  };
}

/** One page of items: the items read, and the cursor of the next page, if any. */
function readItemsPage(data: Answer): { items: readonly ProjectItem[]; next: string | null } {
  const where = 'data.node.items';
  const items = readMapping(readMapping(data['node'], 'data.node')['items'], where);
  const pageInfo = readMapping(items['pageInfo'], `${where}.pageInfo`);
  return {
    items: readList(items['nodes'], `${where}.nodes`).map((item, index) => readItem(item, `${where}.nodes[${String(index)}]`)),
    next: pageInfo['hasNextPage'] === true
      ? readString(pageInfo['endCursor'], `${where}.pageInfo.endCursor`)
      : null,
  };
}

/** Finds the project `ref` names; see the module note. */
async function find(gh: GhRunner, ref: ProjectRef): Promise<Project | null> {
  const result = await gh(findArgs(ref));
  if (!result.ok) {
    if (isMissingProject(result.stdout)) return null;
    refuse(`gh api graphql failed: ${written(result.stdout, result.stderr)}`, written(result.stdout, result.stderr));
  }
  const answer = parsed(result.stdout);
  if (answer === undefined) refuse(`gh api graphql answered text that is not JSON: ${result.stdout.slice(0, QUOTED_LENGTH)}`, result.stdout);
  const owner = readMapping(readMapping(answer, 'the answer')['data'], 'data')['repositoryOwner'];
  if (owner === null) return null;
  const held = readMapping(owner, 'data.repositoryOwner');
  return readProject(readString(held['login'], 'data.repositoryOwner.login'), held['projectV2'], 'data.repositoryOwner.projectV2');
}

/** The node id of the mapping at `where` in `data`, its path split on dots. */
function readNodeId(data: Answer, where: string): string {
  const node = where.split('.').reduce<unknown>((value, key, index, keys) => {
    const at = ['data', ...keys.slice(0, index)].join('.');
    return readMapping(value, at)[key];
  }, data);
  return readString(readMapping(node, `data.${where}`)['id'], `data.${where}.id`);
}

/** Copies the template; see the module note. */
async function copy(gh: GhRunner, request: ProjectCopy): Promise<Project> {
  const owner = (await readData(gh, ownerArgs(request.owner)))['repositoryOwner'];
  if (owner === null) refuse(`there is no owner named ${request.owner} to copy the project to`);
  const ownerId = readString(readMapping(owner, 'data.repositoryOwner')['id'], 'data.repositoryOwner.id');
  const data = await readData(gh, copyArgs(request.templateId, ownerId, request.title));
  const where = 'data.copyProjectV2.projectV2';
  return readProject(request.owner, readMapping(data['copyProjectV2'], 'data.copyProjectV2')['projectV2'], where);
}

/** Links `repository` to the project `projectId`; see the module note. */
async function link(gh: GhRunner, projectId: string, repository: string): Promise<void> {
  requireNodeId(projectId, 'a project');
  const repositoryId = readNodeId(await readData(gh, repositoryArgs(repository)), 'repository');
  readNodeId(await readData(gh, linkArgs(projectId, repositoryId)), 'linkProjectV2ToRepository.repository');
}

/** Adds the issue or pull request `content` names to the project `projectId`; see the module note. */
async function addItem(gh: GhRunner, projectId: string, content: ProjectContentRef): Promise<string> {
  requireNodeId(projectId, 'a project');
  const contentId = readNodeId(await readData(gh, contentArgs(content)), 'repository.issueOrPullRequest');
  return readNodeId(await readData(gh, addItemArgs(projectId, contentId)), 'addProjectV2ItemById.item');
}

/** Every item of the project `projectId`, page after page. */
async function items(gh: GhRunner, projectId: string): Promise<readonly ProjectItem[]> {
  const read: ProjectItem[] = [];
  let cursor: string | null = null;
  do {
    const page = readItemsPage(await readData(gh, itemsArgs(projectId, cursor)));
    read.push(...page.items);
    cursor = page.next;
  } while (cursor !== null);
  return read;
}

/** Makes the project port over `gh`; see the module note. */
export function createGhProjectPort(gh: GhRunner): ProjectPort {
  return {
    find: (ref) => find(gh, ref),
    items: (projectId) => items(gh, projectId),
    copy: (request) => copy(gh, request),
    link: (projectId, repository) => link(gh, projectId, repository),
    addItem: (projectId, content) => addItem(gh, projectId, content),
  };
}
