/**
 * Tests for the project rows of `rafa doctor` (`./doctor-project.ts`):
 * nothing read where the repository has no project, the three rows in
 * order, each failing row naming its fix, a row waiting on a failed one
 * sending nothing, and no item read.
 *
 * Every case drives one router: `gh auth status` and `gh repo view`
 * answered here, every `gh api graphql` call sent to the strict project
 * fake (`../board/project/project-fake.ts`). No case reaches GitHub.
 *
 * ## The controls
 *
 *  - "Nothing read" is read beside a run over the same router with the
 *    number set, which sends calls.
 *  - "No item read" is checked with a detector that a direct read of the
 *    items, over the same router, is shown to trip.
 *  - Each failing row is read beside the all-present run, which differs
 *    from it in the one answer the case changes.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { FakeProjectField } from '../board/project/project-fake.js';

import { describe, expect, it } from 'bun:test';

import { createGhProjectPort } from '../board/project/gh.js';
import { createFakeProjectGh, FAKE_PROJECT_REPOSITORY, FAKE_TEMPLATE_FIELDS, fakeProjectId } from '../board/project/project-fake.js';

import {
  DRIFT_CHECK,
  FIELDS_ROW,
  fieldsRow,
  PROJECT_ROW,
  readDoctorProject,
  renderDoctorProject,
  SCOPE_ROW,
} from './doctor-project.js';
import { PROJECT_HEADING } from './init-board-project.js';

/** The repository's owner, who holds the project. */
const OWNER = 'open-tomato';

/** `board.project.number`. */
const NUMBER = 6;

/** `board.project.template`. */
const TEMPLATE_URL = 'https://github.com/orgs/tmpl-org/projects/2';

/** The URL the fake gives the owner's project. */
const PROJECT_URL = `https://github.com/orgs/${OWNER}/projects/${String(NUMBER)}`;

/** The scopes the active account holds when a case names none. */
const SCOPES = 'gist, project, read:org, repo';

/** GitHub's documented refusal of a token without the `project` scope; NOT a reading, as `../board/project/refresh-warnings.ts` says. */
const SCOPE_REFUSAL = 'gh: Your token has not been granted the required scopes to execute this query. '
  + 'The \'projectV2\' field requires one of the following scopes: [\'read:project\'] (INSUFFICIENT_SCOPES)\n';

/** What a router is made with. */
interface RouterOptions {
  /** The active account's `scopes`. */
  readonly scopes?: string;
  /** The owner's project's fields; the template's when left out. */
  readonly fields?: readonly FakeProjectField[];
  /** False to plant no project. */
  readonly project?: boolean;
  /** Answers a refusal's stderr for a call this refuses, or null. */
  readonly refuse?: (args: readonly string[]) => string | null;
}

/** The router, and what it was handed. */
interface Router {
  readonly gh: GhRunner;
  readonly calls: () => readonly (readonly string[])[];
}

function answered(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: '' };
}

/** The router of the module note. */
function route(options: RouterOptions = {}): Router {
  const fake = createFakeProjectGh({
    projects: options.project === false
      ? []
      : [{ owner: OWNER, number: NUMBER, title: 'rafa', fields: options.fields ?? FAKE_TEMPLATE_FIELDS, items: [{ number: 10 }] }],
    owners: [OWNER],
    repositories: [{ nameWithOwner: FAKE_PROJECT_REPOSITORY, issues: [10] }],
  });
  const recorded: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    recorded.push(args);
    const refusal = options.refuse?.(args) ?? null;
    if (refusal !== null) return Promise.resolve({ ok: false, stdout: '', stderr: refusal });
    const line = args.join(' ');
    if (line === 'auth status --active --json hosts') {
      const account = { state: 'success', active: true, host: 'github.com', login: 'someone', scopes: options.scopes ?? SCOPES };
      return Promise.resolve(answered({ hosts: { 'github.com': [account] } }));
    }
    if (line === 'repo view --json nameWithOwner') return Promise.resolve(answered({ nameWithOwner: FAKE_PROJECT_REPOSITORY }));
    if (args[0] === 'api') return fake.gh(args);
    return Promise.resolve({ ok: false, stdout: '', stderr: `test gh: unrouted command: gh ${line}\n` });
  };
  return { gh, calls: () => [...recorded] };
}

/** Reads the rows over `router` with the number and template of the module note. */
async function readOver(router: Router, number: number | null = NUMBER): Promise<Awaited<ReturnType<typeof readDoctorProject>>> {
  return readDoctorProject({ gh: router.gh, number, template: TEMPLATE_URL });
}

/** True when a call is a read of a project's items: the query selects `items(`. */
function readsItems(args: readonly string[]): boolean {
  return args.some((arg) => arg.includes('items('));
}

/** The rows' names and outcomes. */
function outcomes(reading: Awaited<ReturnType<typeof readDoctorProject>>): readonly (readonly [string, string])[] {
  return (reading?.rows ?? []).map((row) => [row.name, row.outcome] as const);
}

describe('readDoctorProject, where the repository has no project', () => {
  it('reads nothing and sends no call without board.project.number, where the number set sends calls', async () => {
    const router = route();
    const control = route();

    const reading = await readOver(router, null);
    const read = await readOver(control);

    expect(reading).toBe(null);
    expect(router.calls()).toEqual([]);
    expect(read).not.toBe(null);
    expect(control.calls().length).toBeGreaterThan(0);
  });

  it('reads nothing without a gh runner', async () => {
    expect(await readDoctorProject({ gh: null, number: NUMBER, template: TEMPLATE_URL })).toBe(null);
  });

  it('renders no line for no reading', () => {
    expect(renderDoctorProject(null)).toEqual([]);
  });
});

describe('readDoctorProject, a project in place', () => {
  it('reads the three rows present, in order, with the project URL', async () => {
    const reading = await readOver(route());

    expect(reading?.number).toBe(NUMBER);
    expect(outcomes(reading)).toEqual([
      [SCOPE_ROW, 'present'],
      [`${PROJECT_ROW} ${String(NUMBER)}`, 'present'],
      [FIELDS_ROW, 'present'],
    ]);
    expect(reading?.rows[1]?.detail).toBe(PROJECT_URL);
  });

  it('renders the heading, the rows, and the drift line naming rafa board sync --dry-run', async () => {
    const reading = await readOver(route());

    expect(renderDoctorProject(reading)).toEqual([
      PROJECT_HEADING,
      `  present  ${SCOPE_ROW}`,
      `  present  ${PROJECT_ROW} ${String(NUMBER)}: ${PROJECT_URL}`,
      `  present  ${FIELDS_ROW}`,
      `Run ${DRIFT_CHECK} to check the project for drift.`,
    ]);
  });

  it('reads no item of the project, where a read of the items trips the same check', async () => {
    const router = route();
    const control = route();

    await readOver(router);
    await createGhProjectPort(control.gh).items(fakeProjectId({ owner: OWNER, number: NUMBER }));

    expect(router.calls().some(readsItems)).toBe(false);
    expect(control.calls().some(readsItems)).toBe(true);
  });
});

describe('readDoctorProject, the scope row', () => {
  it('is missing without the project scope, naming gh auth refresh -s project, and sends nothing past it', async () => {
    const router = route({ scopes: 'gist, read:project, repo' });

    const reading = await readOver(router);

    expect(outcomes(reading)).toEqual([
      [SCOPE_ROW, 'missing'],
      [`${PROJECT_ROW} ${String(NUMBER)}`, 'unknown'],
      [FIELDS_ROW, 'unknown'],
    ]);
    expect(reading?.rows[0]?.detail).toContain('gh auth refresh -s project');
    expect(reading?.rows[1]?.detail).toBe(`not read: the ${SCOPE_ROW} row is missing`);
    expect(router.calls().map((args) => args.join(' '))).toEqual(['auth status --active --json hosts']);
  });

  it('is unknown when gh auth status fails, saying what gh wrote', async () => {
    const reading = await readOver(route({ refuse: (args) => (args[0] === 'auth'
      ? 'You are not logged into any GitHub hosts.\n'
      : null) }));

    expect(reading?.rows[0]?.outcome).toBe('unknown');
    expect(reading?.rows[0]?.detail).toContain('You are not logged into any GitHub hosts.');
  });

  it('is unknown when gh auth status writes no JSON', async () => {
    const router = route();
    const gh: GhRunner = (args) => (args[0] === 'auth'
      ? Promise.resolve({ ok: true, stdout: 'not json', stderr: '' })
      : router.gh(args));

    const reading = await readDoctorProject({ gh, number: NUMBER, template: TEMPLATE_URL });

    expect(reading?.rows[0]?.outcome).toBe('unknown');
    expect(reading?.rows[0]?.detail).toContain('not JSON');
  });
});

describe('readDoctorProject, the project row', () => {
  it('is missing when the owner holds no project of that number, naming rafa init --board --project', async () => {
    const reading = await readOver(route({ project: false }));

    expect(outcomes(reading).slice(1)).toEqual([
      [`${PROJECT_ROW} ${String(NUMBER)}`, 'missing'],
      [FIELDS_ROW, 'unknown'],
    ]);
    expect(reading?.rows[1]?.detail).toBe(`board.project.number 6 names no project of ${OWNER}; run \`rafa init --board --project\` to make one`);
    expect(renderDoctorProject(reading)).not.toContain(`Run ${DRIFT_CHECK} to check the project for drift.`);
  });

  it('is missing, naming the scope fix, when the find is refused for the project scope', async () => {
    const reading = await readOver(route({ refuse: (args) => (args[0] === 'api'
      ? SCOPE_REFUSAL
      : null) }));

    expect(reading?.rows[1]?.outcome).toBe('missing');
    expect(reading?.rows[1]?.detail).toContain('gh auth refresh -s project');
  });

  it('is unknown when the repository cannot be read, saying why', async () => {
    const reading = await readOver(route({ refuse: (args) => (args[0] === 'repo'
      ? 'HTTP 401: Bad credentials\n'
      : null) }));

    expect(reading?.rows[1]?.outcome).toBe('unknown');
    expect(reading?.rows[1]?.detail).toContain('HTTP 401: Bad credentials');
    expect(reading?.rows[2]?.detail).toBe(`not read: the ${PROJECT_ROW} ${String(NUMBER)} row is unknown`);
  });
});

describe('readDoctorProject, the fields row', () => {
  it('is missing for a renamed field, naming it and board.project.template, with no drift line', async () => {
    const fields = FAKE_TEMPLATE_FIELDS.map((field) => (field.name === 'Stage'
      ? { ...field, name: 'Phase' }
      : field));

    const reading = await readOver(route({ fields }));

    expect(reading?.rows[2]?.outcome).toBe('missing');
    expect(reading?.rows[2]?.detail).toBe('The project has no field named "Stage". Give the project the fields and options of'
      + ` board.project.template (${TEMPLATE_URL}); until then the refresh skips that field.`);
    expect(renderDoctorProject(reading).at(-1)).toBe(`  missing  ${FIELDS_ROW}: ${String(reading?.rows[2]?.detail)}`);
  });

  it('names every field that does not match, an option missing among them', () => {
    const fields = FAKE_TEMPLATE_FIELDS.flatMap((field) => {
      if (field.name === 'Rank') return [];
      if (field.name === 'Horizon') return [{ ...field, options: ['Later', 'Next', 'Now'] }];
      return [field];
    }).map((field, index) => ({
      id: `F${String(index)}`,
      name: field.name,
      dataType: field.dataType,
      options: field.options?.map((name, at) => ({ id: `o${String(at)}`, name })) ?? null,
    }));

    const row = fieldsRow({ fields }, TEMPLATE_URL);

    expect(row.outcome).toBe('missing');
    expect(row.detail).toContain('The project\'s field "Horizon" has no option "Done", "Cancelled".');
    expect(row.detail).toContain('The project has no field named "Rank".');
    expect(row.detail).toContain('the refresh skips those fields.');
  });
});
