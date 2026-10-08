/**
 * Tests for the project step of `rafa init --board`
 * (`./init-board-project.ts`, `setUpProject`), each sent through one
 * router: the project's reads and writes to `../board/project/project-fake.ts`,
 * the facts reads to `../board/project/facts-fake.ts`, and the scope, the
 * repository, the board listing and the labelled boards to answers made
 * here off one table of issues. No case reaches GitHub.
 *
 * ## The board
 *
 * Board #1 lists #10 and a ticked #30. #40 is open and on no line. #50,
 * #60 and #70 are closed and on no line: #50 by pull request #51, merged
 * into `main` with a shipping fragment `main` still holds, so its Stage is
 * In review; #60 by hand, so Done; #70 as not planned, so Cancelled. The
 * template is `tmpl-org`'s project 2; the repository's owner,
 * `open-tomato`, holds no project until the step copies one, which the
 * fake numbers 1.
 *
 * So a first run adds #1, #10, #30 and #40 (open, or closed with a Rank)
 * and #50 (In review), and leaves #60 and #70 out.
 *
 * ## The controls
 *
 *  - The second run that writes nothing follows a first run, over the
 *    same fake and root, that sent every write.
 *  - The refused scope that sends nothing past `gh auth status` is read
 *    beside the first run, whose scope holds `project`.
 *  - Each refused part that lets the later parts run is read on the
 *    project and file those parts changed.
 *
 * Every root is a directory under this file's own temporary root.
 */
import type { ProjectSetupConfig, ProjectSetupOptions, ProjectSetupReport } from './init-board-project.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { FakeFactsIssue } from '../board/project/facts-fake.js';
import type { FakeProjectField, FakeProjectGh } from '../board/project/project-fake.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeFactsGh } from '../board/project/facts-fake.js';
import { createGhProjectPort } from '../board/project/gh.js';
import { recordingFeed } from '../board/project/progress-fake.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, FAKE_TEMPLATE_FIELDS } from '../board/project/project-fake.js';
import { openProjectRunner, retryReporter } from '../board/project/project-runner.js';
import { flakyGh, TIMED_OUT_STDERR } from '../board/project/retry-fake.js';
import { callNumber } from '../board/project/retry.js';
import { parseConfigText } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';
import { dispatchInProject, plantProject } from '../tests/cli-capture.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { createBoardSyncCommand } from './board/sync.js';
import {
  PROJECT_HEADING,
  projectPartLine,
  projectRefOf,
  projectSetupChanged,
  readScopePart,
  renderProjectSetup,
  setUpProject,
} from './init-board-project.js';

/** The repository's owner, who receives the copy. */
const OWNER = 'open-tomato';

/** The template's owner and number. */
const TEMPLATE = { owner: 'tmpl-org', number: 2 };

/** The template's URL, as `board.project.template` names it. */
const TEMPLATE_URL = `https://github.com/orgs/${TEMPLATE.owner}/projects/${String(TEMPLATE.number)}`;

/** The number the fake gives the first copy to {@link OWNER}. */
const COPY_NUMBER = 1;

/** A shipping fragment's text. */
const FRAGMENT = '---\nplan: rafa-1\ntitle: One plan\nlevel: minor\n---\n\n- loop: a note\n';

/** One issue of the board, as both the listing and the facts read it. */
interface PlantedIssue extends FakeFactsIssue {
  readonly body?: string;
}

/** The board of the module note. */
const ISSUES: readonly PlantedIssue[] = [
  { number: 1, state: 'OPEN', labels: ['type:roadmap'], body: '- [ ] #10 first\n- [x] #30 shipped\n' },
  { number: 10, state: 'OPEN', labels: ['type:spec', 'spec:ready'] },
  { number: 30, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec'] },
  { number: 40, state: 'OPEN', labels: ['type:spec', 'needs-triage'] },
  { number: 50, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec'], closedBy: [51] },
  { number: 60, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['type:spec'] },
  { number: 70, state: 'CLOSED', stateReason: 'NOT_PLANNED', labels: ['type:spec'] },
];

/** The issues a first run adds, lowest first. */
const ADDED: readonly number[] = [1, 10, 30, 40, 50];

/** The config every case reads but where a case says otherwise. */
const CONFIG: ProjectSetupConfig = {
  boardProjectNumber: null,
  boardProjectRetries: false,
  boardProjectRetryWaitSeconds: 1,
  boardProjectWriteBatchSize: 5,
  boardProjectWritePauseMs: 0,
  boardProjectTemplate: TEMPLATE_URL,
  boardRelationships: 'labels',
  roadmapIssue: null,
  releaseFragments: '.changes',
};

/** The scopes the active account holds when a case names none. */
const SCOPES = 'gist, project, read:org, repo';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-project-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh project root holding `text` as its project config, the one `rafa init` writes when left out. */
function rootHolding(label: string, text: string = projectConfigText()): string {
  const root = mkdtempSync(join(tempBase, `${label}-`));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
  return root;
}

/** What the project config under `root` reads `board.project.number` as. */
function savedNumber(root: string): number | null {
  const path = join(root, '.rafa', 'config.yaml');
  return parseConfigText(readFileSync(path, 'utf8'), path).values.boardProjectNumber ?? null;
}

/** An issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function listed(issue: PlantedIssue): Readonly<Record<string, unknown>> {
  return {
    number: issue.number,
    title: `#${String(issue.number)}`,
    body: issue.body ?? '',
    state: issue.state,
    stateReason: issue.stateReason ?? '',
    labels: (issue.labels ?? []).map((name) => ({ name })),
  };
}

function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** What a router is made with. */
interface RouterOptions {
  /** The `scopes` string of the active account. */
  readonly scopes?: string;
  /** The projects `open-tomato` holds before the step; none when left out. */
  readonly held?: readonly { readonly number: number; readonly items?: readonly number[] }[];
  /** The template's fields; the template's own when left out. */
  readonly templateFields?: readonly FakeProjectField[];
  /** False to plant no template. */
  readonly template?: boolean;
  /** How many field-write requests are answered before the rest are refused as rate-limited. */
  readonly rateLimitAfter?: number;
  /** Answers the refusal's stderr for a call this refuses, by its argv and how many matching calls came before it. */
  readonly refuse?: (args: readonly string[]) => string | null;
  /** The issues whose labels list names a cursor it has already read, so their facts are refused. */
  readonly repeating?: readonly number[];
  /** Issues planted beyond the board of the module note, open and on no roadmap line. */
  readonly extraIssues?: readonly PlantedIssue[];
}

/** The router, the project fake behind it, and what was recorded. */
interface Router {
  readonly gh: GhRunner;
  readonly project: FakeProjectGh;
  readonly calls: () => readonly (readonly string[])[];
}

/** The router of the module note. */
function route(options: RouterOptions = {}): Router {
  const issues = [...ISSUES, ...(options.extraIssues ?? [])];
  const project = createFakeProjectGh({
    ...options.rateLimitAfter === undefined
      ? {}
      : { rateLimitAfter: options.rateLimitAfter },
    projects: [
      ...options.template === false
        ? []
        : [{ ...TEMPLATE, title: 'rafa board template', public: true, fields: options.templateFields ?? FAKE_TEMPLATE_FIELDS }],
      ...(options.held ?? []).map(({ number, items = [] }) => ({ owner: OWNER, number, items: items.map((issue) => ({ number: issue })) })),
    ],
    owners: [OWNER, TEMPLATE.owner],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: issues.map(({ number }) => number) }],
  });
  const repeating = new Set(options.repeating ?? []);
  const facts = createFakeFactsGh({
    issues: issues.map((issue) => (repeating.has(issue.number)
      ? { ...issue, repeatsCursor: 'labels' as const }
      : issue)),
    pulls: [{ number: 51, state: 'MERGED', baseRefName: 'main', headRefOid: 'head51', files: [{ path: '.changes/rafa-1.md', changeType: 'ADDED' }] }],
    trees: { head51: { '.changes/rafa-1.md': FRAGMENT }, main: { '.changes/rafa-1.md': FRAGMENT } },
  });
  const recorded: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    recorded.push(args);
    const line = args.join(' ');
    const refusal = options.refuse?.(args) ?? null;
    if (refusal !== null) return Promise.resolve({ ok: false, stdout: '', stderr: refusal });
    if (line === 'auth status --active --json hosts') {
      return Promise.resolve(answered({ hosts: { 'github.com': [{ state: 'success', active: true, host: 'github.com', login: 'someone', tokenSource: 'keyring', scopes: options.scopes ?? SCOPES, gitProtocol: 'ssh' }] } }));
    }
    if (line === 'repo view --json nameWithOwner') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (line.startsWith('issue list --label type:roadmap --state open')) {
      return Promise.resolve(answered(issues.filter(({ labels = [] }) => labels.includes('type:roadmap')).map(listed)));
    }
    if (line.startsWith('issue list --state all')) return Promise.resolve(answered(issues.map(listed)));
    if (args[0] === 'api' && args.includes('owner={owner}')) return facts.gh(args);
    if (args[0] === 'api') return project.gh(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `test gh: unrouted command: gh ${line}\n` });
  };
  return { gh, project, calls: () => [...recorded] };
}

/** The pauses a run took, in order. */
interface Paced {
  readonly sleep: (ms: number) => Promise<void>;
  readonly pauses: number[];
}

function paced(): Paced {
  const pauses: number[] = [];
  return {
    pauses,
    sleep: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  };
}

/** The options of a run over `router` and `root`, with `config` over {@link CONFIG}. */
function options(router: Router, root: string, config: Partial<ProjectSetupConfig> = {}, sleep = paced().sleep): ProjectSetupOptions {
  return { root, config: { ...CONFIG, ...config }, gh: router.gh, sleep };
}

/** The mutations of `calls`, by the GraphQL mutation each sends. */
function mutations(calls: readonly (readonly string[])[]): readonly string[] {
  const names = ['copyProjectV2', 'linkProjectV2ToRepository', 'addProjectV2ItemById', 'updateProjectV2ItemFieldValue', 'clearProjectV2ItemFieldValue'];
  return calls.flatMap((args) => names.filter((name) => args.some((arg) => arg.includes(`${name}(`))));
}

/** The issues the first facts query of `calls` reads, in the order it names them. */
function itemsPartFacts(calls: readonly (readonly string[])[]): readonly number[] {
  const query = calls.find((args) => args.includes('owner={owner}')) ?? [];
  return query.flatMap((arg) => [...arg.matchAll(/ issue\(number: (\d+)\)/gu)].map((match) => Number(match[1])));
}

/** Each part's outcome, by kind. */
function outcomes(report: ProjectSetupReport): Readonly<Record<string, string>> {
  return Object.fromEntries(report.parts.map(({ kind, outcome }) => [kind, outcome]));
}

/** The issues `open-tomato`'s project `number` holds, lowest first, with the values each holds by field name. */
async function heldOn(router: Router, number: number): Promise<ReadonlyMap<number, ReadonlyMap<string, unknown>>> {
  const port = createGhProjectPort(router.project.gh);
  const found = await port.find({ owner: OWNER, number });
  if (found === null) throw new Error(`no project ${String(number)}`);
  const items = await port.items(found.id);
  return new Map(items.flatMap(({ content, values }) => (content.kind === 'issue'
    ? [[content.number, new Map([...values].map(([name, value]) => [name, value.kind === 'option'
      ? value.name
      : value.kind === 'number'
        ? value.number
        : value.text]))] as const]
    : [])).sort(([a], [b]) => a - b));
}

describe('setUpProject, a first run', () => {
  it('copies the template, links the repository, adds and fills the issues, and saves the number', async () => {
    const router = route();
    const root = rootHolding('first');
    const pacing = paced();

    const report = await setUpProject(options(router, root, {}, pacing.sleep));

    expect(report.parts.map(({ name }) => name)).toEqual(['project scope', 'project', 'project issues', 'project fields', 'board.project.number']);
    expect(outcomes(report)).toEqual({ scope: 'present', project: 'created', items: 'created', fields: 'created', setting: 'created' });
    expect(report.project).toEqual({ owner: OWNER, number: COPY_NUMBER, url: `https://github.com/orgs/${OWNER}/projects/${String(COPY_NUMBER)}` });
    expect(report.parts[1]?.detail).toBe(`copied ${TEMPLATE_URL} to https://github.com/orgs/${OWNER}/projects/1, titled rafa, and linked ${FAKE_PROJECT_REPOSITORY}`);
    expect(report.parts[2]?.detail).toBe('added 5 issues to the project');
    expect(report.problems).toEqual([]);
    expect(projectSetupChanged(report)).toBe(true);

    const held = await heldOn(router, COPY_NUMBER);
    expect([...held.keys()]).toEqual(ADDED);
    expect(held.get(30)?.get('Rank')).toBe(2);
    expect(held.get(30)?.get('Stage')).toBe('Done');
    expect(held.get(50)?.get('Stage')).toBe('In review');
    expect(held.get(40)?.get('Stage')).toBe('Triage');
    expect(savedNumber(root)).toBe(COPY_NUMBER);
  });

  it('titles the copy after the repository, links it once, and never adds #60, closed by hand, or #70, not planned', async () => {
    const router = route();

    await setUpProject(options(router, rootHolding('title')));

    const copied = router.calls().find((args) => args.some((arg) => arg.includes('copyProjectV2(')));
    expect(copied).toContain('title=rafa');
    const found = await createGhProjectPort(router.project.gh).find({ owner: OWNER, number: COPY_NUMBER });
    expect(router.project.linked(found?.id ?? '')).toEqual([FAKE_PROJECT_REPOSITORY]);
    expect(mutations(router.calls()).filter((name) => name === 'addProjectV2ItemById')).toHaveLength(ADDED.length);
  });

  it('paces the adds board.project.writePauseMs apart, with none before the first', async () => {
    const router = route();
    const pausedAfter: number[] = [];
    const pauses = new Set<number>();
    const sleep = (ms: number): Promise<void> => {
      pauses.add(ms);
      pausedAfter.push(router.calls().length);
      return Promise.resolve();
    };

    await setUpProject(options(router, rootHolding('paced'), { boardProjectWritePauseMs: 250 }, sleep));

    expect([...pauses]).toEqual([250]);
    const adds = router.calls().flatMap((args, index) => (args.some((arg) => arg.includes('addProjectV2ItemById('))
      ? [index]
      : []));
    expect(adds).toHaveLength(ADDED.length);
    const pausedBetween = (from: number, to: number): boolean => pausedAfter.some((count) => count > from && count <= to);
    expect(pausedBetween(-1, adds[0] ?? 0)).toBe(false);
    for (const [index, add] of adds.slice(1).entries()) expect(pausedBetween(adds[index] ?? 0, add)).toBe(true);
  });
});

describe('setUpProject, a second run', () => {
  it('reports every part present and sends no write, after a first run that sent every one', async () => {
    const router = route();
    const root = rootHolding('second');
    await setUpProject(options(router, root));
    const firstWrites = mutations(router.calls());
    expect(firstWrites).toContain('copyProjectV2');
    expect(firstWrites).toContain('updateProjectV2ItemFieldValue');
    const before = router.calls().length;
    const text = readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8');

    const report = await setUpProject(options(router, root, { boardProjectNumber: savedNumber(root) }));

    expect(outcomes(report)).toEqual({ scope: 'present', project: 'present', items: 'present', fields: 'present', setting: 'present' });
    expect(projectSetupChanged(report)).toBe(false);
    expect(mutations(router.calls().slice(before))).toEqual([]);
    expect(readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8')).toBe(text);
  });

  it('reads facts for no unranked closed issue the project already holds, where the first run read #50\'s', async () => {
    const router = route();
    const root = rootHolding('facts');
    await setUpProject(options(router, root));
    const first = router.calls();

    await setUpProject(options(router, root, { boardProjectNumber: COPY_NUMBER }));

    // The first facts query of a run is the issues part's; the fill's refresh reads every item's after it.
    expect(itemsPartFacts(first)).toEqual([50, 60, 70]);
    expect(itemsPartFacts(router.calls().slice(first.length))).toEqual([60, 70]);
  });
});

describe('setUpProject, the scope part', () => {
  it('refuses a token without the project scope, naming the fix, and tries nothing else', async () => {
    const router = route({ scopes: 'gist, read:project, repo' });
    const root = rootHolding('scope');
    const text = readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8');

    const report = await setUpProject(options(router, root));

    expect(outcomes(report)).toEqual({ scope: 'refused', project: 'refused', items: 'refused', fields: 'refused', setting: 'refused' });
    expect(report.parts[0]?.detail).toContain('gh auth refresh -s project');
    expect(report.parts.slice(1).every(({ detail }) => detail.startsWith('not tried:'))).toBe(true);
    expect(router.calls()).toEqual([['auth', 'status', '--active', '--json', 'hosts']]);
    expect(readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8')).toBe(text);
    expect(report.project).toBeNull();
  });

  it('answers the scope fix for a project call refused for its scope after gh auth status passed', async () => {
    const refusal = 'GraphQL: Your token has not been granted the required scopes to execute this query. The \'id\' field requires one of the following scopes: [\'read:project\'] (INSUFFICIENT_SCOPES)';
    const router = route({ refuse: (args) => (args.some((arg) => arg.includes('projectV2(number: $number)'))
      ? refusal
      : null) });

    const report = await setUpProject(options(router, rootHolding('late-scope')));

    expect(report.parts[1]?.outcome).toBe('refused');
    expect(report.parts[1]?.detail).toContain('gh auth refresh -s project');
  });
});

describe('readScopePart', () => {
  /** The scope part read off one `gh auth status` answer. */
  async function read(result: GhResult): Promise<{ outcome: string; detail: string }> {
    const part = await readScopePart(() => Promise.resolve(result));
    return { outcome: part.outcome, detail: part.detail };
  }

  /** An answer of one account on github.com. */
  function account(fields: Readonly<Record<string, unknown>>): GhResult {
    return answered({ hosts: { 'github.com': [{ state: 'success', active: true, scopes: 'project', ...fields }] } });
  }

  it('refuses read:project alone, an inactive account, and one not logged in, where project passes', async () => {
    expect((await read(account({ scopes: 'repo, read:project' }))).outcome).toBe('refused');
    expect((await read(account({ active: false }))).outcome).toBe('refused');
    expect((await read(account({ state: 'error' }))).outcome).toBe('refused');
    expect((await read(answered({ hosts: {} }))).outcome).toBe('refused');
    expect((await read(account({ scopes: 'repo, project' }))).outcome).toBe('present');
  });

  it('refuses a gh auth status that failed or wrote no JSON, naming what it wrote', async () => {
    const failed = await read({ ok: false, stdout: '', stderr: 'not logged in\n' });
    const garbled = await read({ ok: true, stdout: 'hosts', stderr: '' });

    expect(failed.outcome).toBe('refused');
    expect(failed.detail).toContain('gh auth status --active --json hosts failed: not logged in');
    expect(garbled.outcome).toBe('refused');
    expect(garbled.detail).toContain('not JSON');
  });
});

describe('setUpProject, the copy part', () => {
  it('finds the project board.project.number names present, copying and linking nothing', async () => {
    const router = route({ held: [{ number: 6, items: ADDED }] });
    const root = rootHolding('held', 'version: 1\nboard:\n  project:\n    number: 6\n');

    const report = await setUpProject(options(router, root, { boardProjectNumber: 6 }));

    expect(report.parts[1]).toEqual({ kind: 'project', name: 'project', outcome: 'present', detail: `https://github.com/orgs/${OWNER}/projects/6` });
    expect(report.parts[2]?.outcome).toBe('present');
    expect(report.parts[4]?.outcome).toBe('present');
    expect(mutations(router.calls()).filter((name) => name === 'copyProjectV2' || name === 'linkProjectV2ToRepository')).toEqual([]);
  });

  it('copies anew when board.project.number names no project, and saves the new number over the old', async () => {
    const router = route();
    const root = rootHolding('stale', 'version: 1\nboard:\n  project:\n    number: 9\n');

    const report = await setUpProject(options(router, root, { boardProjectNumber: 9 }));

    expect(report.parts[1]?.outcome).toBe('created');
    expect(report.project?.number).toBe(COPY_NUMBER);
    expect(report.parts[4]?.outcome).toBe('created');
    expect(savedNumber(root)).toBe(COPY_NUMBER);
  });

  it('refuses a template that is not there, trying nothing after it and saving no number', async () => {
    const router = route({ template: false });
    const root = rootHolding('no-template');

    const report = await setUpProject(options(router, root));

    expect(outcomes(report)).toEqual({ scope: 'present', project: 'refused', items: 'refused', fields: 'refused', setting: 'refused' });
    expect(report.parts[1]?.detail).toContain(`the template ${TEMPLATE_URL} was not found`);
    expect(mutations(router.calls())).toEqual([]);
    expect(savedNumber(root)).toBeNull();
  });

  it('refuses a link the board refused, and still adds, fills and saves the copy so a second run does not copy again', async () => {
    const router = route({ refuse: (args) => (args.some((arg) => arg.includes('linkProjectV2ToRepository('))
      ? 'GraphQL: Resource not accessible\n'
      : null) });
    const root = rootHolding('link');

    const report = await setUpProject(options(router, root));

    expect(report.parts[1]?.outcome).toBe('refused');
    expect(report.parts[1]?.detail).toContain(`but ${FAKE_PROJECT_REPOSITORY} was not linked`);
    expect(outcomes(report)).toMatchObject({ items: 'created', fields: 'created', setting: 'created' });
    expect(savedNumber(root)).toBe(COPY_NUMBER);
  });

  it('refuses a repository that could not be read, trying nothing after it', async () => {
    const router = route({ refuse: (args) => (args.join(' ') === 'repo view --json nameWithOwner'
      ? 'no git remotes found\n'
      : null) });

    const report = await setUpProject(options(router, rootHolding('no-repo')));

    expect(outcomes(report)).toEqual({ scope: 'present', project: 'refused', items: 'refused', fields: 'refused', setting: 'refused' });
    expect(report.parts[1]?.detail).toContain('no git remotes found');
  });
});

describe('setUpProject, the issues and fields parts', () => {
  it('refuses an add refused part way, naming how many went through, and still fills and saves', async () => {
    let adds = 0;
    const router = route({ refuse: (args) => {
      if (!args.some((arg) => arg.includes('addProjectV2ItemById('))) return null;
      adds += 1;
      return adds === 3
        ? 'GraphQL: something went wrong\n'
        : null;
    } });
    const root = rootHolding('add');

    const report = await setUpProject(options(router, root));

    expect(report.parts[2]?.outcome).toBe('refused');
    expect(report.parts[2]?.detail).toContain('2 issues of 5 added, then #30 was refused');
    expect(report.parts[2]?.detail).toContain('rafa init --board --project');
    expect(report.parts[3]?.outcome).toBe('created');
    expect(savedNumber(root)).toBe(COPY_NUMBER);
    expect([...(await heldOn(router, COPY_NUMBER)).keys()]).toEqual([1, 10]);
  });

  it('refuses a fill the rate limit refused with the count of issues not updated, and still saves the number', async () => {
    const router = route({ rateLimitAfter: 0 });
    const root = rootHolding('rate');

    const report = await setUpProject(options(router, root));

    expect(report.parts[3]?.outcome).toBe('refused');
    expect(report.parts[3]?.detail).toContain('5 issues were not updated');
    expect(report.parts[3]?.listed).toBeUndefined();
    expect(report.problems).toEqual([]);
    expect(report.parts[4]?.outcome).toBe('created');
  });

  it('writes the other fields of a template whose Stage is renamed, keeping the skipped field\'s line', async () => {
    const fields = FAKE_TEMPLATE_FIELDS.map((field) => (field.name === 'Stage'
      ? { ...field, name: 'Stages' }
      : field));
    const router = route({ templateFields: fields });

    const report = await setUpProject(options(router, rootHolding('renamed')));

    expect(report.parts[3]?.outcome).toBe('created');
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('"Stage" was skipped');
    expect((await heldOn(router, COPY_NUMBER)).get(30)?.get('Rank')).toBe(2);
  });
});

describe('setUpProject, the fields part over refused issues', () => {
  /** The part rows `report` renders from the fields part on, up to the number's row. */
  function fieldsLines(report: ProjectSetupReport): readonly string[] {
    const lines = renderProjectSetup(report);
    const from = lines.findIndex((line) => line.includes('project fields'));
    return lines.slice(from, lines.findIndex((line) => line.includes('board.project.number')));
  }

  it('reads created with #40 listed under it, filling the four other issues, beside a run refusing none', async () => {
    const control = await setUpProject(options(route(), rootHolding('none-refused')));
    const router = route({ repeating: [40] });

    const report = await setUpProject(options(router, rootHolding('one-refused')));

    expect(control.parts[3]?.outcome).toBe('created');
    expect(control.parts[3]?.listed).toBeUndefined();
    expect(report.parts[3]?.outcome).toBe('created');
    expect(report.parts[3]?.detail).toEndWith('; 1 issue not refreshed');
    expect(report.parts[3]?.listed).toHaveLength(1);
    expect(report.parts[3]?.listed?.[0]).toStartWith('#40 not refreshed: ');
    expect(report.problems).toEqual([]);
    const held = await heldOn(router, COPY_NUMBER);
    expect([...held.keys()]).toEqual([...ADDED]);
    expect(held.get(30)?.get('Stage')).toBe('Done');
    expect(held.get(50)?.get('Stage')).toBe('In review');
    expect(held.get(40)?.get('Stage')).toBeUndefined();
    const lines = fieldsLines(report);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith('  created  project fields: wrote ');
    expect(lines[1]).toBe(`           ${report.parts[3]?.listed?.[0] ?? ''}`);
  });

  it('reads present with #40 still listed on a second run that has nothing else to write', async () => {
    const router = route({ repeating: [40] });
    const root = rootHolding('refused-again');
    await setUpProject(options(router, root));
    expect(mutations(router.calls())).toContain('updateProjectV2ItemFieldValue');
    const before = router.calls().length;

    const report = await setUpProject(options(router, root, { boardProjectNumber: savedNumber(root) }));

    expect(mutations(router.calls().slice(before))).toEqual([]);
    expect(projectSetupChanged(report)).toBe(false);
    expect(report.parts[3]?.outcome).toBe('present');
    expect(report.parts[3]?.detail).toBe('every value is as the rules give it; 1 issue not refreshed');
    expect(report.parts[3]?.listed?.map((line) => line.split(':')[0])).toEqual(['#40 not refreshed']);
    expect(fieldsLines(report)).toEqual(['  present  project fields', `           ${report.parts[3]?.listed?.[0] ?? ''}`]);
  });

  it('reads refused only when every issue the project holds was refused, each listed lowest first', async () => {
    const router = route({ repeating: ISSUES.map(({ number }) => number) });

    const report = await setUpProject(options(router, rootHolding('all-refused')));

    expect(report.parts[2]?.detail).toBe('added 4 issues to the project');
    expect(report.parts[3]?.outcome).toBe('refused');
    expect(report.parts[3]?.detail).toBe('no item was filled: 4 issues not refreshed');
    expect(report.parts[3]?.listed?.map((line) => line.split(':')[0])).toEqual([1, 10, 30, 40].map((issue) => `#${String(issue)} not refreshed`));
    expect(mutations(router.calls())).not.toContain('updateProjectV2ItemFieldValue');
    expect(report.parts[4]?.outcome).toBe('created');
  });
});

describe('setUpProject, an add retried over a network timeout', () => {
  it('retries a timed-out add twice then succeeds, printing both retry lines, with the items part created', async () => {
    const router = route();
    const flaky = flakyGh(router.gh, [TIMED_OUT_STDERR, TIMED_OUT_STDERR], (args) => callNumber(args) === 10);
    const printed: string[] = [];
    const output = sinkOutput({ info: (line) => printed.push(line) });
    const retryConfig = { boardProjectRetries: 3, boardProjectRetryWaitSeconds: 1 };
    const gh = openProjectRunner(flaky.gh, retryConfig, { sleep: () => Promise.resolve(), onRetry: retryReporter(output, 'text') });
    const pacing = paced();

    const report = await setUpProject({ root: rootHolding('retry-add'), config: { ...CONFIG, ...retryConfig }, gh, sleep: pacing.sleep });

    expect(report.parts[2]?.outcome).toBe('created');
    expect(report.parts[2]?.detail).toBe('added 5 issues to the project');
    expect(printed).toEqual([
      'retrying #10 (1 of 3): operation timed out',
      'retrying #10 (2 of 3): operation timed out',
    ]);
    const held = await heldOn(router, COPY_NUMBER);
    expect([...held.keys()]).toEqual([...ADDED]);
  });
});

describe('setUpProject, the fields part over a NOT_FOUND facts read', () => {
  it('refuses #40 alone on NOT_FOUND, fills the rest, and prints no retry line', async () => {
    const router = route({
      refuse: (args) => (args.some((arg) => arg.startsWith('query=') && arg.includes('issue(number: 40)'))
        ? 'GraphQL: Could not resolve to an Issue with the number of 40. (NOT_FOUND)\n'
        : null),
    });
    const printed: string[] = [];
    const output = sinkOutput({ info: (line) => printed.push(line) });
    const retryConfig = { boardProjectRetries: 3, boardProjectRetryWaitSeconds: 1 };
    const gh = openProjectRunner(router.gh, retryConfig, { sleep: () => Promise.resolve(), onRetry: retryReporter(output, 'text') });
    const pacing = paced();

    const report = await setUpProject({ root: rootHolding('not-found'), config: { ...CONFIG, ...retryConfig }, gh, sleep: pacing.sleep });

    expect(report.parts[3]?.outcome).toBe('created');
    expect(report.parts[3]?.listed).toHaveLength(1);
    expect(report.parts[3]?.listed?.[0]).toStartWith('#40 not refreshed: ');
    expect(printed).toEqual([]);
    const held = await heldOn(router, COPY_NUMBER);
    expect(held.get(30)?.get('Stage')).toBe('Done');
    expect(held.get(50)?.get('Stage')).toBe('In review');
    expect(held.get(40)?.get('Stage')).toBeUndefined();
  });
});

describe('setUpProject and rafa board sync, over an issue of 116 cross-references and one whose cursor repeats', () => {
  /** The subject `board sync` is dispatched under. */
  const BOARD_SUBJECT = { name: 'board', summary: 'the boards' };

  it('fills the busy issue, refuses alone and names the one whose cursor repeats, reads the fields part created, and syncs with exit code 0', async () => {
    const router = route({
      extraIssues: [
        { number: 80, state: 'OPEN', labels: ['needs-triage'], issueMentions: 116 },
        { number: 90, state: 'OPEN', labels: ['needs-triage'] },
      ],
      repeating: [90],
    });
    const project = plantProject(mkdtempSync(join(tempBase, 'paging-')));

    const report = await setUpProject(options(router, project.root));

    expect(report.parts[3]?.outcome).toBe('created');
    expect(report.parts[3]?.listed).toHaveLength(1);
    expect(report.parts[3]?.listed?.[0]).toStartWith('#90 not refreshed: ');
    const held = await heldOn(router, COPY_NUMBER);
    expect(held.get(80)?.get('Stage')).toBe('Triage');
    expect(held.get(90)?.get('Stage')).toBeUndefined();

    const sync = await dispatchInProject(
      ['board', 'sync'],
      [BOARD_SUBJECT],
      [createBoardSyncCommand({ gh: router.gh, sleep: () => Promise.resolve() })],
      project,
    );

    expect(sync.exitCode).toBe(0);
    expect(sync.stdout).toContain('#90 not refreshed: ');
  });
});

describe('setUpProject, the phases it feeds', () => {
  /** The start and end lines of `steps`, the progress lines left out. */
  function bounds(steps: readonly string[]): readonly string[] {
    return steps.filter((step) => step.includes(' start ') || step.includes(' end '));
  }

  it('adds the five issues one at a time, then reads their facts and writes their fields as the refresh feeds them', async () => {
    const router = route();
    const recording = recordingFeed();

    const report = await setUpProject({ ...options(router, rootHolding('phases')), progress: recording.feed });

    expect(outcomes(report)['items']).toBe('created');
    expect(recording.steps().filter((step) => step.startsWith('adds '))).toEqual([
      'adds start 0/5',
      'adds progress 1/5',
      'adds progress 2/5',
      'adds progress 3/5',
      'adds progress 4/5',
      'adds progress 5/5',
      'adds end 5/5 0 refused',
    ]);
    const writes = recording.steps().find((step) => step.startsWith('writes start ')) ?? '';
    const total = writes.slice('writes start 0/'.length);
    expect(Number(total)).toBeGreaterThan(0);
    expect(bounds(recording.steps())).toEqual([
      'adds start 0/5',
      'adds end 5/5 0 refused',
      'facts start 0/5',
      'facts end 5/5 0 refused',
      `writes start 0/${total}`,
      `writes end ${total}/${total} 0 refused`,
    ]);
  });

  it('ends the adds of a refused add counting the two added and the three left, beside the run above', async () => {
    let adds = 0;
    const router = route({ refuse: (args) => {
      if (!args.some((arg) => arg.includes('addProjectV2ItemById('))) return null;
      adds += 1;
      return adds === 3
        ? 'GraphQL: something went wrong\n'
        : null;
    } });
    const recording = recordingFeed();

    const report = await setUpProject({ ...options(router, rootHolding('phases-refused')), progress: recording.feed });

    expect(report.parts[2]?.outcome).toBe('refused');
    expect(bounds(recording.steps()).slice(0, 4)).toEqual(['adds start 0/5', 'adds end 2/5 3 refused', 'facts start 0/2', 'facts end 2/2 0 refused']);
  });

  it('opens no adds phase on a second run with nothing missing, the facts read still fed', async () => {
    const router = route();
    const root = rootHolding('phases-second');
    const first = await setUpProject(options(router, root));
    const recording = recordingFeed();

    const second = await setUpProject({ ...options(router, root, { boardProjectNumber: first.project?.number ?? null }), progress: recording.feed });

    expect(outcomes(second)['items']).toBe('present');
    expect(bounds(recording.steps())).toEqual(['facts start 0/5', 'facts end 5/5 0 refused']);
  });
});

describe('projectRefOf', () => {
  it('reads an organisation\'s and a user\'s project URL, and nothing else', () => {
    expect(projectRefOf('https://github.com/orgs/acme/projects/2')).toEqual({ owner: 'acme', number: 2 });
    expect(projectRefOf('https://github.com/users/someone/projects/14')).toEqual({ owner: 'someone', number: 14 });
    expect(projectRefOf('https://github.com/orgs/acme/projects/2/views/1')).toBeNull();
    expect(projectRefOf('https://github.com/acme/projects/2')).toBeNull();
  });
});

describe('renderProjectSetup', () => {
  it('writes the heading, a row per part with the detail of every part not present and its listed lines under it, then each problem', () => {
    const report: ProjectSetupReport = {
      parts: [
        { kind: 'scope', name: 'project scope', outcome: 'present', detail: 'held' },
        { kind: 'project', name: 'project', outcome: 'created', detail: 'copied' },
        { kind: 'items', name: 'project issues', outcome: 'refused', detail: 'why' },
        { kind: 'fields', name: 'project fields', outcome: 'present', detail: 'unshown', listed: ['#4 not refreshed: a reason'] },
      ],
      project: null,
      problems: ['a skipped field'],
    };

    expect(renderProjectSetup(report)).toEqual([
      PROJECT_HEADING,
      '  present  project scope',
      '  created  project: copied',
      '  refused  project issues: why',
      '  present  project fields',
      '           #4 not refreshed: a reason',
      'a skipped field',
    ]);
    expect(projectPartLine({ kind: 'fields', name: 'project fields', outcome: 'present', detail: 'unshown' })).toBe('  present  project fields');
  });
});
