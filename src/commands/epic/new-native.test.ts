/**
 * Tests for `rafa epic new` under `board.relationships: native`
 * (`new.ts`, its "Native mode" note): the pure pieces the mode adds, and
 * the command dispatched over one planted `gh` from a project whose
 * config names the mode.
 *
 * The board: the default board #31, epic #50 on `epic:alpha` and its
 * member #51. The `epic:alpha` label is there so a native run given
 * `--slug=alpha` can show that no slug check runs, and each such case
 * has a labels-mode control over the same `gh` that refuses the slug, so
 * a pass is not a check that could never have failed.
 *
 * The labels-mode cases themselves live in `new.test.ts`, which this
 * change left as it was: they are the reading that labels mode sends
 * the same calls and prints the same lines.
 */
import type { EpicNewResult } from './new.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { renderEpicBody } from '../../board/epic-template.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { NATIVE_MODE } from './move-native.js';
import {
  createEpicNewCommand,
  EPIC_NEW_REFUSAL_EXIT,
  NATIVE_SLUG_WARNING,
  nativeEpicIssueLabels,
  readNativeEpicDraft,
  renderEpicNew,
} from './new.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-new-native-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command is dispatched under. */
const EPIC_SUBJECT = { name: 'epic', summary: 'the epics' };

/** A config naming the native mode. */
const NATIVE_CONFIG = 'tracker:\n  default: local\nboard:\n  relationships: native\n';

/** A config naming no mode: `labels`. */
const LABELS_CONFIG = 'tracker:\n  default: local\n';

/** A config `loadConfig` refuses: a mode that is neither. */
const REFUSED_CONFIG = 'tracker:\n  default: local\nboard:\n  relationships: sub-issues\n';

/** The number `gh issue create` answers for the new epic. */
const CREATED = 101;

/** The URL `gh issue create` prints for it. */
const CREATED_URL = `https://github.com/acme/app/issues/${String(CREATED)}`;

/** The default board's body. */
const BOARD_BODY = '## Next, in order\n\n- [ ] #50 alpha\n';

/** One issue as the labels-mode listing writes it. */
function raw(number: number, title: string, body: string, labels: readonly string[]): object {
  return { number, title, body, state: 'OPEN', stateReason: null, labels: labels.map((name) => ({ name })) };
}

/** The board the module note describes. */
const LISTING: readonly object[] = [
  raw(31, 'Platform board', BOARD_BODY, ['type:roadmap']),
  raw(50, 'Epic alpha', '## Acceptance criteria\n\nWorks.\n', ['type:epic', 'epic:alpha', 'horizon:now']),
  raw(51, 'Alpha one', 'Open.', ['epic:alpha']),
];

/** A planted `gh` and what it holds after a run. */
interface PlantedGh {
  readonly gh: GhRunner;
  readonly calls: readonly (readonly string[])[];
  /** The board's body, as the writes left it. */
  readonly body: () => string;
}

/** A `gh` answering the listing, the title search, the label calls, the issue create and the board's body. */
function plantedGh(planted: { readonly failIssueCreate?: boolean } = {}): PlantedGh {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const failed = (stderr: string): GhResult => ({ ok: false, stdout: '', stderr });
  const calls: (readonly string[])[] = [];
  let body = BOARD_BODY;

  const answer = (args: readonly string[]): GhResult => {
    const [noun, verb] = args;
    const words = args.join(' ');
    if (noun === 'issue' && verb === 'list' && args.includes('--search')) return ok('[]');
    if (noun === 'issue' && verb === 'list' && words.includes('--state all')) return ok(JSON.stringify(LISTING));
    if (noun === 'label' && verb === 'list') return ok(JSON.stringify([{ name: 'type:epic' }, { name: 'epic:alpha' }]));
    if (noun === 'label' && verb === 'create') return ok('');
    if (noun === 'issue' && verb === 'create') {
      return planted.failIssueCreate === true
        ? failed('HTTP 422: Validation Failed')
        : ok(`Creating issue in acme/app\n\n${CREATED_URL}\n`);
    }
    if (noun === 'api' && verb === 'repos/{owner}/{repo}/issues/31') {
      if (!args.includes('PATCH')) return ok(JSON.stringify({ body }));
      const field = args.find((arg) => arg.startsWith('body=')) ?? 'body=';
      body = field.slice('body='.length);
      return ok(JSON.stringify({ body }));
    }
    return failed(`unplanted: gh ${words}`);
  };

  const gh: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve(answer(args));
  };
  return { gh, calls, body: () => body };
}

/** Dispatches `rafa epic new <words>` from a fresh project holding `config`, over `planted`. */
async function run(words: readonly string[], config: string = NATIVE_CONFIG, planted: PlantedGh = plantedGh()) {
  const project: PlantedProject = plantProject(mkdtempSync(join(tempBase, 'case-')), config);
  const outcome = await dispatchInProject(['epic', 'new', ...words], [EPIC_SUBJECT], [createEpicNewCommand({ gh: planted.gh })], project);
  return { ...outcome, calls: planted.calls, body: planted.body() };
}

/** The calls that change something on GitHub: a label or issue create, or a body write. */
function writesOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[1] === 'create' || call.includes('PATCH'));
}

/** The calls about repository labels: a list or a create. */
function labelCallsOf(calls: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return calls.filter((call) => call[0] === 'label');
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

describe('the native-mode pieces', () => {
  it('creates the issue with type:epic and its horizon only, in that order', () => {
    expect(nativeEpicIssueLabels('next')).toEqual(['type:epic', 'horizon:next']);
  });

  it('reads the title and the horizon, later when left out, and not the slug, even one that is no kebab word', () => {
    const draft = readNativeEpicDraft(['  Sign-in  '], { slug: 'Not_Kebab' });

    expect(draft).toEqual({ title: 'Sign-in', horizon: 'later' });
    expect(Object.keys(draft)).toEqual(['title', 'horizon']);
    expect(readNativeEpicDraft(['Billing'], { horizon: 'now' }).horizon).toBe('now');
  });

  it('refuses no title, two words and a horizon outside the three with exit code 1, as labels mode does', () => {
    expect(refusalOf(() => readNativeEpicDraft([], {})).message).toContain('Expected one title, quoted, got none');
    expect(refusalOf(() => readNativeEpicDraft(['Sign', 'in'], {})).message).toContain('got 2: Sign in');
    expect(refusalOf(() => readNativeEpicDraft(['a\nb'], {})).exitCode).toBe(1);
    expect(refusalOf(() => readNativeEpicDraft(['X'], { horizon: 'soon' })).message)
      .toContain('--horizon is "soon", expected one of: now, next, later');
  });

  it('opens the slug warning with the mode', () => {
    expect(NATIVE_SLUG_WARNING.startsWith(`${NATIVE_MODE}: `)).toBe(true);
    expect(NATIVE_SLUG_WARNING).toBe('board.relationships is native: an epic is named by its number and title,'
      + ' so --slug is not used and no epic: label is created');
  });

  it('prints the epic by number and title with the mode named where labels mode names its label', () => {
    const result: EpicNewResult = {
      epic: { number: 9, url: 'https://github.com/o/r/issues/9', title: 'Auth' },
      relationships: 'native',
      horizon: 'later',
      board: 31,
      line: { issue: 31, status: 'edited', attempts: 1, problem: '' },
    };

    expect(renderEpicNew(result)).toEqual([
      'Created epic #9 Auth, horizon later; board.relationships is native, so it is named by its number and title'
      + ' and no epic: label was created.',
      'Added its line to board #31.',
      'https://github.com/o/r/issues/9',
    ]);
  });
});

describe('rafa epic new in native mode', () => {
  it('creates the issue with type:epic and its horizon, then its board line, and asks nothing about labels', async () => {
    const result = await run(['Sign-in without passwords']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(labelCallsOf(result.calls)).toEqual([]);
    expect(writesOf(result.calls)).toEqual([
      ['issue', 'create', '--title=Sign-in without passwords', `--body=${renderEpicBody()}`, '--label=type:epic', '--label=horizon:later'],
      ['api', 'repos/{owner}/{repo}/issues/31', '-X', 'PATCH', '-f', `body=${result.body}`],
    ]);
    expect(result.body).toBe(`${BOARD_BODY}- [ ] #${String(CREATED)} Sign-in without passwords\n`);
    expect(result.stdout).toBe([
      `Created epic #${String(CREATED)} Sign-in without passwords, horizon later; ${NATIVE_MODE}, so it is named by its`
      + ' number and title and no epic: label was created.',
      'Added its line to board #31.',
      CREATED_URL,
      '',
    ].join('\n'));
  });

  it('reads the board listing once', async () => {
    const result = await run(['Auth', '--horizon=now']);
    const listings = result.calls.filter((call) => call[0] === 'issue' && call[1] === 'list' && call.join(' ').includes('--state all'));

    expect(result.exitCode).toBe(0);
    expect(listings).toHaveLength(1);
    expect(result.stdout).not.toContain('warn: ');
    expect(writesOf(result.calls)[0]?.slice(-2)).toEqual(['--label=type:epic', '--label=horizon:now']);
  });

  it('warns that a slug given is not used, checks it not at all, and creates the epic', async () => {
    const taken = await run(['Alpha again', '--slug=alpha']);
    const notKebab = await run(['Auth', '--slug=Auth_Flow']);

    for (const result of [taken, notKebab]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`warn: ${NATIVE_SLUG_WARNING}\n`);
      expect(labelCallsOf(result.calls)).toEqual([]);
      expect(writesOf(result.calls).map((call) => call.slice(0, 2))).toEqual([['issue', 'create'], ['api', 'repos/{owner}/{repo}/issues/31']]);
      expect(writesOf(result.calls)[0]?.some((arg) => arg.startsWith('--label=epic:'))).toBe(false);
    }
  });

  it('refuses the same lines in labels mode (control: the slug checks run there)', async () => {
    const taken = await run(['Alpha again', '--slug=alpha'], LABELS_CONFIG);
    const notKebab = await run(['Auth', '--slug=Auth_Flow'], LABELS_CONFIG);
    const missing = await run(['Auth'], LABELS_CONFIG);

    expect(taken.exitCode).toBe(EPIC_NEW_REFUSAL_EXIT);
    expect(taken.stderr).toContain('#50, #51 carry epic:alpha');
    expect(writesOf(taken.calls)).toEqual([]);
    expect(notKebab.exitCode).toBe(EPIC_NEW_REFUSAL_EXIT);
    expect(notKebab.calls).toEqual([]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('--slug is required');
  });

  it('reads a config loadConfig refuses as labels mode, so the line is refused first, as before', async () => {
    const result = await run(['Auth', '--slug=Auth_Flow'], REFUSED_CONFIG);

    expect(result.exitCode).toBe(EPIC_NEW_REFUSAL_EXIT);
    expect(result.stderr).toContain('which is not a kebab word');
    expect(result.stderr).not.toContain('The config cannot be used');
    expect(result.calls).toEqual([]);
  });

  it('refuses a line with no title with exit code 1 before asking gh anything', async () => {
    const result = await run([]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Expected one title, quoted, got none');
    expect(result.calls).toEqual([]);
  });

  it('refuses a failed issue create with exit code 1, naming no label left, and edits no board', async () => {
    const result = await run(['Auth'], NATIVE_CONFIG, plantedGh({ failIssueCreate: true }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not create the epic issue: ');
    expect(result.stderr).not.toContain('stands with no issue carrying it');
    expect(result.calls.filter((call) => call.includes('PATCH'))).toEqual([]);
    expect(result.body).toBe(BOARD_BODY);
  });

  it('gives the epic and its board line as the json result, relationships native, the slug and label keys left out', async () => {
    const result = await run(['Auth', '--horizon=next', '--output=json']);
    const event = eventsOf(result.stdout).find((each) => each.type === 'result') as { data?: Record<string, unknown> } | undefined;

    expect(result.exitCode).toBe(0);
    expect(event?.data).toEqual({
      epic: { number: CREATED, url: CREATED_URL, title: 'Auth' },
      relationships: 'native',
      horizon: 'next',
      board: 31,
      line: { issue: 31, status: 'edited', attempts: 1, problem: '' },
    });
    expect(Object.keys(event?.data ?? {})).toEqual(['epic', 'relationships', 'horizon', 'board', 'line']);
  });
});
