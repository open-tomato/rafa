/**
 * Tests for `rafa epic new` (`new.ts`): the pure pieces — the draft a
 * line makes, the kebab rule, the slug-in-use reading, the labels and the
 * lines written — and the command dispatched over one planted `gh` that
 * keeps each board's body, so the line a run appends is read back from
 * the body it wrote.
 *
 * The board: open `type:roadmap` boards #31 (the default, the
 * lowest-numbered labelled one) and #40, epic #50 on `epic:alpha` with
 * its member #51, and a closed epic #60 on `epic:Retired`, spelled in
 * mixed case so the slug check has to compare without case to refuse
 * `retired`. #31's body holds a checklist between two prose sections, so
 * the case reading it back holds every other byte of it.
 *
 * The planted `gh` tells its two `gh issue list` calls apart by their
 * flags (`--state all` for the listing, `--search` for the title search
 * the default board asks), never by the first two words alone. Every
 * case refusing before a write asserts that no write was sent, and the
 * first case, which sends all of them, is the control that the filter
 * reading the writes can find one.
 */
import type { EpicNewResult } from './new.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../../adapters/tracker/github.js';
import { renderEpicBody } from '../../board/epic-template.js';
import { createGhProjectPort } from '../../board/project/gh.js';
import { createFakeProjectGh, fakeProjectId } from '../../board/project/project-fake.js';
import { writePositionFile } from '../../project/position.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { EPIC_PROJECT_NUMBER, recordingEpicRefresh, withProjectNumber } from './epic-project-fake.js';
import {
  createEpicNewCommand,
  DEFAULT_HORIZON,
  EPIC_NEW_REFUSAL_EXIT,
  epicIssueLabels,
  epicLabelDescription,
  issuesLabelled,
  KEBAB_SLUG,
  lineFailedMessage,
  readEpicDraft,
  renderEpicNew,
  takenSlugMessage,
} from './new.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-new-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** The number `gh issue create` answers for the new epic. */
const CREATED = 101;

/** The URL `gh issue create` prints for it. */
const CREATED_URL = `https://github.com/acme/app/issues/${String(CREATED)}`;

/** The default board's body: a checklist between two prose sections. */
const DEFAULT_BODY = 'Owner: @alice\n\n## Next, in order\n\n- [ ] #50 alpha\n- [x] #7 shipped\n\n## Naming\n\nKept as written.\n';

/** The second board's body. */
const SECOND_BODY = '- [ ] #50 alpha\n';

/** One issue as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function raw(number: number, title: string, body: string, labels: readonly string[], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  const stateReason = state === 'CLOSED'
    ? 'COMPLETED'
    : null;
  return { number, title, body, state, stateReason, labels: labels.map((name) => ({ name })) };
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(31, 'Platform board', DEFAULT_BODY, ['type:roadmap']),
  raw(40, 'Payments board', SECOND_BODY, ['type:roadmap']),
  raw(50, 'Epic alpha', '## Acceptance criteria\n\nWorks.\n', ['type:epic', 'epic:alpha', 'horizon:now']),
  raw(51, 'Alpha one', 'Open.', ['epic:alpha']),
  raw(60, 'Epic retired', 'Gone.', ['type:epic', 'epic:Retired', 'horizon:later'], 'CLOSED'),
];

/** How the planted `gh` answers. */
interface Planted {
  /** Label names the repository holds. */
  readonly labels?: readonly string[];
  readonly failListing?: boolean;
  readonly failLabelList?: boolean;
  readonly failLabelCreate?: boolean;
  readonly failIssueCreate?: boolean;
  /** Fail every body write. */
  readonly failWrite?: boolean;
}

/** A planted `gh` and what it holds after a run. */
interface PlantedGh {
  readonly gh: GhRunner;
  readonly calls: readonly (readonly string[])[];
  /** Each board's body, as the writes left it. */
  readonly bodies: ReadonlyMap<number, string>;
}

/** The issue number of a `repos/{owner}/{repo}/issues/<n>` path, or null for any other. */
function issueOfPath(path: string | undefined): number | null {
  const match = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/u.exec(path ?? '');
  return match === null
    ? null
    : Number(match[1]);
}

/** The value of a `body=<text>` field, or null when `args` holds none. */
function bodyField(args: readonly string[]): string | null {
  const field = args.find((arg) => arg.startsWith('body='));
  return field === undefined
    ? null
    : field.slice('body='.length);
}

/** A `gh` answering the listing, the title search, the label list and every write, keeping each body. */
function plantedGh(planted: Planted = {}): PlantedGh {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  const calls: (readonly string[])[] = [];
  const bodies = new Map<number, string>([[31, DEFAULT_BODY], [40, SECOND_BODY]]);

  const api = (args: readonly string[]): GhResult => {
    const issue = issueOfPath(args[1]);
    const body = issue === null
      ? undefined
      : bodies.get(issue);
    if (issue === null || body === undefined) return failed(`unplanted: gh ${args.join(' ')}`);
    if (!args.includes('PATCH')) return ok(JSON.stringify({ body }));
    if (planted.failWrite === true) return failed('HTTP 502: Bad Gateway');
    const written = bodyField(args) ?? '';
    bodies.set(issue, written);
    return ok(JSON.stringify({ body: written }));
  };

  const gh: GhRunner = (args) => {
    calls.push([...args]);
    const [noun, verb] = args;
    const words = args.join(' ');
    if (noun === 'issue' && verb === 'list' && args.includes('--search')) return Promise.resolve(ok('[]'));
    if (noun === 'issue' && verb === 'list' && words.includes('--state all')) {
      return Promise.resolve(planted.failListing === true
        ? failed('error connecting to api.github.com')
        : ok(JSON.stringify(LISTING)));
    }
    if (noun === 'label' && verb === 'list') {
      return Promise.resolve(planted.failLabelList === true
        ? failed('HTTP 401: Bad credentials')
        : ok(JSON.stringify((planted.labels ?? ['type:epic', 'epic:alpha']).map((name) => ({ name })))));
    }
    if (noun === 'label' && verb === 'create') {
      return Promise.resolve(planted.failLabelCreate === true
        ? failed('HTTP 403: Must have admin rights')
        : ok(''));
    }
    if (noun === 'issue' && verb === 'create') {
      return Promise.resolve(planted.failIssueCreate === true
        ? failed('HTTP 422: Validation Failed')
        : ok(`Creating issue in acme/app\n\n${CREATED_URL}\n`));
    }
    if (noun === 'api') return Promise.resolve(api(args));
    return Promise.resolve(failed(`unplanted: gh ${words}`));
  };
  return { gh, calls, bodies };
}

/** A fresh project with no `roadmap.issue`. */
function plantCase(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
}

/** Dispatches `rafa epic new <words>` from `project` over `planted`. */
async function run(words: readonly string[], planted: PlantedGh = plantedGh(), project: PlantedProject = plantCase()) {
  const outcome = await dispatchInProject(['epic', 'new', ...words], [EPIC_SUBJECT], [createEpicNewCommand({ gh: planted.gh })], project);
  return { ...outcome, calls: planted.calls, bodies: planted.bodies };
}

/** The calls that change something on GitHub: a label or issue create, or a body write. */
function writesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[1] === 'create' || call.includes('PATCH'));
}

/** What a refusal thrown by `read` carries: its exit code and message. */
function refusalOf(read: () => unknown): { exitCode: unknown; message: string } {
  try {
    read();
  } catch (error) {
    return { exitCode: (error as { exitCode?: unknown }).exitCode, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

/** The listing as `BoardIssue`s. */
function boardIssues(): readonly BoardIssue[] {
  return LISTING.map((row) => {
    const issue = row as { number: number; title: string; body: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; labels: { name: string }[] };
    const labels = issue.labels.map((label) => label.name);
    return { ...issue, labels, type: typeOfLabels(labels), module: 'unassigned' };
  });
}

describe('KEBAB_SLUG', () => {
  it('takes lowercase letters and digits joined by single hyphens', () => {
    expect(['auth', 'sign-in', 'v2-billing', '2026'].filter((slug) => KEBAB_SLUG.test(slug))).toEqual(['auth', 'sign-in', 'v2-billing', '2026']);
  });

  it('refuses capitals, underscores, spaces, colons and leading, trailing or doubled hyphens', () => {
    const refused = ['Auth', 'sign_in', 'sign in', 'epic:auth', '-auth', 'auth-', 'sign--in', ''];

    expect(refused.filter((slug) => KEBAB_SLUG.test(slug))).toEqual([]);
  });
});

describe('readEpicDraft', () => {
  it('reads the title, the slug and the horizon, later when left out', () => {
    expect(readEpicDraft(['  Sign-in  '], { slug: 'sign-in' })).toEqual({ title: 'Sign-in', slug: 'sign-in', horizon: 'later' });
    expect(DEFAULT_HORIZON).toBe('later');
    expect(readEpicDraft(['Billing'], { slug: 'billing', horizon: 'now' }).horizon).toBe('now');
  });

  it('refuses a slug that is not a kebab word with exit code 2, and names the rule', () => {
    const refused = refusalOf(() => readEpicDraft(['Sign-in'], { slug: 'Sign_In' }));

    expect(refused.exitCode).toBe(EPIC_NEW_REFUSAL_EXIT);
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toContain('--slug is "Sign_In", which is not a kebab word');
  });

  it('refuses a missing slug, a horizon outside the three, no title, two words and a blank title with exit code 1', () => {
    expect(refusalOf(() => readEpicDraft(['X'], {})).message).toContain('--slug is required');
    expect(refusalOf(() => readEpicDraft(['X'], { slug: 'x', horizon: 'soon' })).message)
      .toContain('--horizon is "soon", expected one of: now, next, later');
    expect(refusalOf(() => readEpicDraft([], { slug: 'x' })).message).toContain('Expected one title, quoted, got none');
    expect(refusalOf(() => readEpicDraft(['Sign', 'in'], { slug: 'x' })).message).toContain('got 2: Sign in');
    expect(refusalOf(() => readEpicDraft(['  '], { slug: 'x' })).message).toContain('one line holding some text');
    expect(refusalOf(() => readEpicDraft(['a\nb'], { slug: 'x' })).exitCode).toBe(1);
  });
});

describe('issuesLabelled and takenSlugMessage', () => {
  it('finds every issue carrying epic:<slug>, open or closed, without case', () => {
    expect(issuesLabelled('alpha', boardIssues())).toEqual([50, 51]);
    expect(issuesLabelled('retired', boardIssues())).toEqual([60]);
    expect(issuesLabelled('beta', boardIssues())).toEqual([]);
  });

  it('names the slug, the issues and the label', () => {
    expect(takenSlugMessage('alpha', [50, 51]))
      .toBe('The slug alpha is already labelled: #50, #51 carry epic:alpha, so an epic on it would take them over. Pick another slug.');
  });
});

describe('the labels and the lines', () => {
  it('creates the issue with type:epic, its epic label and its horizon, in that order', () => {
    expect(epicIssueLabels({ slug: 'sign-in', horizon: 'next' })).toEqual(['type:epic', 'epic:sign-in', 'horizon:next']);
    expect(epicLabelDescription('sign-in')).toBe('A member of the sign-in epic');
  });

  it('prints the epic, where its line went and its URL', () => {
    const result: EpicNewResult = {
      epic: { number: 9, url: 'https://github.com/o/r/issues/9', title: 'Auth' },
      slug: 'auth',
      label: 'epic:auth',
      labelOutcome: 'created',
      horizon: 'later',
      board: 31,
      line: { issue: 31, status: 'edited', attempts: 1, problem: '' },
    };

    expect(renderEpicNew(result)).toEqual([
      'Created epic #9 Auth, horizon later; created epic:auth.',
      'Added its line to board #31.',
      'https://github.com/o/r/issues/9',
    ]);
    expect(renderEpicNew({ ...result, labelOutcome: 'present', line: { ...result.line, status: 'nothing-to-edit', attempts: 0 } }).slice(0, 2)).toEqual([
      'Created epic #9 Auth, horizon later; kept epic:auth, which the repository held already.',
      'Board #31 names it already.',
    ]);
  });
});

describe('rafa epic new', () => {
  it('creates the label, the issue from the template with its labels, and its line on the default board, in that order', async () => {
    const result = await run(['Sign-in without passwords', '--slug=passwordless']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(writesOf(result.calls)).toEqual([
      ['label', 'create', 'epic:passwordless', '--description=A member of the passwordless epic'],
      [
        'issue',
        'create',
        '--title=Sign-in without passwords',
        `--body=${renderEpicBody()}`,
        '--label=type:epic',
        '--label=epic:passwordless',
        '--label=horizon:later',
      ],
      ['api', 'repos/{owner}/{repo}/issues/31', '-X', 'PATCH', '-f', `body=${String(result.bodies.get(31))}`],
    ]);
    expect(result.bodies.get(31)).toBe(DEFAULT_BODY.replace(
      '- [x] #7 shipped\n',
      `- [x] #7 shipped\n- [ ] #${String(CREATED)} Sign-in without passwords\n`,
    ));
    expect(result.bodies.get(40)).toBe(SECOND_BODY);
    expect(result.stdout).toBe([
      `Created epic #${String(CREATED)} Sign-in without passwords, horizon later; created epic:passwordless.`,
      'Added its line to board #31.',
      CREATED_URL,
      '',
    ].join('\n'));
  });

  it('reads the board listing once', async () => {
    const result = await run(['Auth', '--slug=auth']);
    const listings = result.calls.filter((call) => call[0] === 'issue' && call[1] === 'list' && call.join(' ').includes('--state all'));

    expect(result.exitCode).toBe(0);
    expect(listings).toHaveLength(1);
  });

  it('labels the issue with the horizon --horizon names', async () => {
    const result = await run(['Auth', '--slug=auth', '--horizon=now']);
    const create = result.calls.find((call) => call[0] === 'issue' && call[1] === 'create');

    expect(result.exitCode).toBe(0);
    expect(create?.slice(-3)).toEqual(['--label=type:epic', '--label=epic:auth', '--label=horizon:now']);
  });

  it('adds the line to the current board a position file names, not the default', async () => {
    const project = plantCase();
    writePositionFile(project.root, { current: { board: 40, epic: null }, previous: null, home: { board: 31, epic: null } });

    const result = await run(['Auth', '--slug=auth'], plantedGh(), project);

    expect(result.exitCode).toBe(0);
    expect(result.bodies.get(40)).toBe(`${SECOND_BODY}- [ ] #${String(CREATED)} Auth\n`);
    expect(result.bodies.get(31)).toBe(DEFAULT_BODY);
    expect(result.stdout).toContain('Added its line to board #40.\n');
  });

  it('refuses a slug an issue already carries, without case and closed included, with exit code 2 and no write', async () => {
    const taken = await run(['Retired again', '--slug=retired']);

    expect(taken.exitCode).toBe(EPIC_NEW_REFUSAL_EXIT);
    expect(taken.stderr).toContain(takenSlugMessage('retired', [60]));
    expect(writesOf(taken.calls)).toEqual([]);

    const member = await run(['Alpha again', '--slug=alpha']);

    expect(member.exitCode).toBe(2);
    expect(member.stderr).toContain('#50, #51 carry epic:alpha');
    expect(writesOf(member.calls)).toEqual([]);
  });

  it('refuses a slug that is not a kebab word with exit code 2 before asking gh anything', async () => {
    const result = await run(['Auth', '--slug=Auth_Flow']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('which is not a kebab word');
    expect(result.calls).toEqual([]);
  });

  it('keeps a repository label no issue carries and creates the rest', async () => {
    const result = await run(['Auth', '--slug=auth'], plantedGh({ labels: ['EPIC:Auth'] }));

    expect(result.exitCode).toBe(0);
    expect(result.calls.filter((call) => call[0] === 'label' && call[1] === 'create')).toEqual([]);
    expect(result.calls.filter((call) => call[0] === 'issue' && call[1] === 'create')).toHaveLength(1);
    expect(result.stdout).toContain('kept epic:auth, which the repository held already.');
  });

  it('refuses a listing or a label list that cannot be read with exit code 2 and no write', async () => {
    const listing = await run(['Auth', '--slug=auth'], plantedGh({ failListing: true }));
    const labels = await run(['Auth', '--slug=auth'], plantedGh({ failLabelList: true }));

    expect(listing.exitCode).toBe(2);
    expect(listing.stderr).toContain('Could not read the board, so no epic was created');
    expect(writesOf(listing.calls)).toEqual([]);
    expect(labels.exitCode).toBe(2);
    expect(labels.stderr).toContain('Could not read the repository\'s labels (the first 100)');
    expect(writesOf(labels.calls)).toEqual([]);
  });

  it('refuses a failed label create with exit code 1, creating no issue', async () => {
    const result = await run(['Auth', '--slug=auth'], plantedGh({ failLabelCreate: true }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not create the label epic:auth, so no epic was created');
    expect(result.calls.filter((call) => call[0] === 'issue' && call[1] === 'create')).toEqual([]);
    expect(result.bodies.get(31)).toBe(DEFAULT_BODY);
  });

  it('refuses a failed issue create with exit code 1, naming the label left, and edits no board', async () => {
    const result = await run(['Auth', '--slug=auth'], plantedGh({ failIssueCreate: true }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not create the epic issue');
    expect(result.stderr).toContain('The label epic:auth stands with no issue carrying it');
    expect(result.calls.filter((call) => call.includes('PATCH'))).toEqual([]);
  });

  it('refuses a board line that did not land with exit code 1, naming the epic created and the line to add', async () => {
    const result = await run(['Auth', '--slug=auth'], plantedGh({ failWrite: true }));

    expect(result.exitCode).toBe(1);
    expect(result.calls.filter((call) => call.includes('PATCH'))).toHaveLength(2);
    expect(result.stderr).toContain(`Created epic #${String(CREATED)} (${CREATED_URL}), but could not add its line to board #31`);
    expect(result.stderr).toContain(`Add "- [ ] #${String(CREATED)}" to board #31's checklist by hand.`);
    expect(lineFailedMessage({ number: 9, url: 'u' }, 4, 'why')).toBe('❌ Created epic #9 (u), but could not add its line to board #4: why\n'
      + 'Add "- [ ] #9" to board #4\'s checklist by hand.');
  });

  it('gives the epic, its labels and the board line as the json result', async () => {
    const result = await run(['Auth', '--slug=auth', '--horizon=next', '--output=json']);
    const data = eventsOf(result.stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;

    expect(result.exitCode).toBe(0);
    expect(data?.data).toEqual({
      epic: { number: CREATED, url: CREATED_URL, title: 'Auth' },
      slug: 'auth',
      label: 'epic:auth',
      labelOutcome: 'created',
      horizon: 'next',
      board: 31,
      line: { issue: 31, status: 'edited', attempts: 1, problem: '' },
    });
  });
});

describe('rafa epic new, and the project', () => {
  /** The repository `gh repo view` answers, which holds the new epic. */
  const REPOSITORY = 'acme/app';

  /** The planted `gh`, with `gh repo view` and `gh api graphql` routed to a project fake holding the new epic. */
  function projectRouted(planted: PlantedGh = plantedGh()): { readonly gh: GhRunner; readonly project: ReturnType<typeof createFakeProjectGh>; readonly graphql: () => number } {
    const project = createFakeProjectGh({
      projects: [{ owner: 'acme', number: EPIC_PROJECT_NUMBER }],
      repositories: [{ nameWithOwner: REPOSITORY, issues: [CREATED] }],
    });
    let graphql = 0;
    const gh: GhRunner = (args) => {
      if (args.join(' ') === 'repo view --json nameWithOwner') {
        return Promise.resolve({ ok: true, stdout: JSON.stringify({ nameWithOwner: REPOSITORY }), stderr: '' } satisfies GhResult);
      }
      if (args[0] === 'api' && args[1] === 'graphql') {
        graphql += 1;
        return project.gh(args);
      }
      return planted.gh(args);
    };
    return { gh, project, graphql: () => graphql };
  }

  /** Dispatches `rafa epic new <words>` over `gh` and `refresh` in a project whose config is `config`. */
  async function runWith(words: readonly string[], gh: GhRunner, refresh: ReturnType<typeof recordingEpicRefresh>, config: string) {
    const project = plantProject(mkdtempSync(join(tempBase, 'case-')), config);
    const command = createEpicNewCommand({ gh, projectRefresh: refresh.refresh });
    return dispatchInProject(['epic', 'new', ...words], [EPIC_SUBJECT], [command], project);
  }

  it('adds the new epic to the project, then refreshes it with its members and the shifted Ranks, its warning last', async () => {
    const routed = projectRouted();
    const recorded = recordingEpicRefresh(['a project warning']);

    const result = await runWith(['Auth', '--slug=auth'], routed.gh, recorded, withProjectNumber('tracker:\n  default: local\n'));
    const items = await createGhProjectPort(routed.project.gh).items(fakeProjectId({ owner: 'acme', number: EPIC_PROJECT_NUMBER }));

    expect(result.exitCode).toBe(0);
    expect(items.map(({ content }) => content)).toEqual([{ kind: 'issue', repository: REPOSITORY, number: CREATED }]);
    expect(recorded.calls()).toEqual([{ number: EPIC_PROJECT_NUMBER, issues: [CREATED], widening: { membersOf: [CREATED], shiftedRanks: true } }]);
    expect(result.stdout).toEndWith(`${CREATED_URL}\nwarn: a project warning\n`);
  });

  it('adds nothing and calls no refresh with board.project.number unset, the control of the case above', async () => {
    const routed = projectRouted();
    const recorded = recordingEpicRefresh(['a project warning']);

    const result = await runWith(['Auth', '--slug=auth'], routed.gh, recorded, 'tracker:\n  default: local\n');

    expect(result.exitCode).toBe(0);
    expect(routed.graphql()).toBe(0);
    expect(recorded.calls()).toEqual([]);
    expect(result.stdout).toEndWith(`${CREATED_URL}\n`);
  });

  it('adds nothing and calls no refresh for a board line that did not land, keeping exit code 1', async () => {
    const routed = projectRouted(plantedGh({ failWrite: true }));
    const recorded = recordingEpicRefresh();

    const result = await runWith(['Auth', '--slug=auth'], routed.gh, recorded, withProjectNumber('tracker:\n  default: local\n'));

    expect(result.exitCode).toBe(1);
    expect(routed.graphql()).toBe(0);
    expect(recorded.calls()).toEqual([]);
  });
});
