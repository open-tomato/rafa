/**
 * Tests for the `local` Tracker adapter (`src/adapters/tracker/local.ts`).
 *
 * The adapter contract runs first, over a fresh directory for each case.
 * The source's own cases follow, from
 * `packages/shared/issue-tracker/src/adapters/local.test.ts` in
 * open-tomato at commit `47abf440a9748aa6cec1c64bf91b210c5444bbab`
 * (2026-07-28), ported to `bun:test` and to what the copy changes:
 * files named by issue number, a fallback reason that can be null, a
 * skipped file reported through `warn`. The rest hold each change the
 * module note lists.
 *
 * Every directory is made under one temporary directory this file
 * creates and removes, and a case that names a path holds it under that
 * directory. No case writes under the repository or the home.
 *
 * Each refusal sits beside a control that what it refused would
 * otherwise have been read or written: the refused external ids beside
 * an issue the same tracker reads and a planted issue file one of them
 * would have named, the refused kind beside the same number read as a
 * local ref, the refused state beside a transition that does change the
 * file.
 *
 * Eighteen mutations of `local.ts` were driven against `src/adapters/`
 * on 2026-09-14, one run each, with 242 pass before and after and the
 * module restored byte-identical (sha256), and every one but the last
 * reddened at least one case:
 *
 *   - The exclusive create dropped reddened the racing case and the
 *     ordering case, which creates its ten issues at once. Numbering from
 *     1 whatever is held reddened the numbering case.
 *   - Text matched in the title alone reddened the contract's body case
 *     and the joined-text case. Text matched case-sensitively reddened
 *     the contract's title case, the narrowing case and the joined-text
 *     case. The limit ignored reddened the contract's limit case and the
 *     ordering case, and numbers sorted as names the ordering case alone.
 *   - A foreign kind accepted reddened the kind refusal. Leading zeros
 *     accepted reddened the `01` and `0` refusals and the numbering case,
 *     which then counted `099.md`. The number check dropped, with the raw
 *     id joined into the path, reddened all eleven id refusals.
 *   - Every listing failure swallowed reddened the `ENOTDIR` case. One
 *     unreadable file failing the listing reddened the numbering case and
 *     both skip cases, and the active output read at import the
 *     active-output case alone.
 *   - No check before a write reddened the four write refusals, the
 *     refused transition and the refused draft. A comment recording its
 *     writer's reason, and `capturedAt` read off the system clock, each
 *     reddened the kept-reason case. Issues created in `backlog`
 *     reddened the thirteen cases holding a fresh issue in `todo`. The
 *     tracker unfrozen reddened the frozen case.
 *   - `FIELD_CHECKS` missing `comments` left every case green, and
 *     `check-types` failed with TS1360 at the record: that closure is the
 *     compiler's to hold, since no file this module reads or writes can
 *     carry a comment the check would refuse.
 */
import type { LocalIssueRecord, LocalTrackerOptions } from './local.js';
import type { IssueRef, IssueState, IssueType, Output, Tracker } from '../../ports/index.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../output/active.js';

import { draftFixture, runTrackerContract } from './contract.js';
import {
  createLocalTracker,
  listLocalIssues,
  localIssuesDir,
  parseLocalIssue,
  renderLocalIssue,
} from './local.js';

/** The instant every tracker here is stamped from, unless a case names another. */
const NOW = '2026-07-27T18:04:00Z';

/** A later instant, for a second tracker over the same directory. */
const LATER = '2026-07-28T09:00:00Z';

/** The fallback reason every tracker here records, unless a case names another. */
const REASON = 'github: gh auth status exited 1 (network)';

/** The members each refusal lists. */
const TYPES = 'code, bug, spike, adr, chore, package-api';
const STATES = 'backlog, todo, in-progress, in-review, done, released, cancelled';

/** What an external id that is not an issue number is refused with, after the id. */
const NUMBER_REFUSAL = 'is not a local issue number, expected a positive whole number with no leading zero';

/** What a ref of another kind is refused with. */
const KIND_REFUSAL = 'local tracker: refused a ref of kind "github"; this tracker reads local refs only';

/** An ISO 8601 timestamp as `toISOString` writes one. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let tempDir = '';
let made = 0;

/** A directory of its own under this file's temporary directory, not yet on disk. */
function freshDir(name: string): string {
  made += 1;
  return join(tempDir, `${made}-${name}`);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-local-tracker-'));
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

/** A local tracker over `issuesDir`, stamped from {@link NOW} and recording {@link REASON}. */
function localTracker(issuesDir: string, options: Partial<LocalTrackerOptions> = {}): Tracker {
  return createLocalTracker({ issuesDir, fallbackReason: REASON, now: () => NOW, ...options });
}

/** A record of the fixture draft, with any field replaced. */
function record(overrides: Partial<LocalIssueRecord> = {}): LocalIssueRecord {
  return {
    draft: draftFixture(),
    fallbackReason: 'github: unreachable',
    capturedAt: NOW,
    state: 'todo',
    comments: [],
    ...overrides,
  };
}

/** Issue `number` under `issuesDir`, read off the disk rather than through a tracker. */
function readIssue(issuesDir: string, number: number): LocalIssueRecord {
  const path = join(issuesDir, `${number}.md`);
  return parseLocalIssue(readFileSync(path, 'utf8'), path);
}

/** The external ids of a list of refs, in order. */
function ids(refs: readonly IssueRef[]): string[] {
  return refs.map((ref) => ref.externalId);
}

/** An output that keeps each `warn` message and drops everything else. */
function warnOnlyOutput(warned: string[]): Output {
  const ignore = (): void => {};
  return {
    info: ignore,
    warn: (message) => {
      warned.push(message);
    },
    error: ignore,
    debug: ignore,
    emit: ignore,
    result: ignore,
  };
}

/** The directory the contract case running now made its tracker over. */
let contractDir = '';

runTrackerContract({
  name: 'local',
  expectsProjects: false,
  expectedKind: 'local',
  create: async () => {
    contractDir = freshDir('contract');
    return localTracker(contractDir);
  },
  readComments: async (ref) => {
    const path = join(contractDir, `${ref.externalId}.md`);
    return parseLocalIssue(await readFile(path, 'utf8'), path).comments;
  },
});

describe('the issue file format', () => {
  it('round-trips every record field through the frontmatter', () => {
    const issue = record({
      draft: draftFixture({ blockedBy: [259] }),
      comments: [`${LATER}: seen again`],
    });

    expect(parseLocalIssue(renderLocalIssue(issue))).toEqual(issue);
  });

  it('writes the fields in the order the module note lists them, then the body as it is', () => {
    const rendered = renderLocalIssue(record());
    const [, block = ''] = /^---\n([\s\S]*?)\n---\n/.exec(rendered) ?? [];

    expect([...block.matchAll(/^(\w+):/gm)].map((match) => match[1])).toEqual([
      'opt',
      'type',
      'module',
      'priority',
      'project',
      'title',
      'blockedBy',
      'state',
      'fallbackReason',
      'capturedAt',
      'comments',
    ]);
    expect(block).toContain('opt: 260');
    expect(block).not.toContain('## Context');
    expect(rendered.endsWith(`\n---\n${draftFixture().body}`)).toBe(true);
  });

  it('throws when the frontmatter is missing', () => {
    expect(() => parseLocalIssue('## Context\n\nno frontmatter\n'))
      .toThrow('local tracker: the issue has no YAML frontmatter block');
  });

  const edges: Record<string, Partial<LocalIssueRecord>> = {
    'a null priority': { draft: draftFixture({ priority: null }) },
    'a null project': { draft: draftFixture({ project: null }) },
    'no blockers': { draft: draftFixture({ blockedBy: [] }) },
    'several blockers': { draft: draftFixture({ blockedBy: [100, 200, 300] }) },
    'a body whose first line is ---': { draft: draftFixture({ body: '---\nEdge case body\n' }) },
    'a body holding --- mid-document': {
      draft: draftFixture({ body: 'Intro paragraph.\n\n---\n\nMore text follows.\n' }),
    },
    'a title holding a colon': { draft: draftFixture({ title: 'Fix: TOTP replay window off-by-one' }) },
    'a title opening with #': { draft: draftFixture({ title: '#259 replay window off-by-one' }) },
    'a body with no trailing newline': { draft: draftFixture({ body: 'No trailing newline here' }) },
    'a body with several trailing newlines': {
      draft: draftFixture({ body: 'Body with trailing blank lines\n\n\n' }),
    },
    'a title holding a newline and a --- line': { draft: draftFixture({ title: 'Two\n---\nlines' }) },
    'a title YAML would read as a boolean': { draft: draftFixture({ title: 'yes' }) },
    'a title YAML would read as a number': { draft: draftFixture({ title: '0x10' }) },
    'an empty body': { draft: draftFixture({ body: '' }) },
    'a null fallback reason': { fallbackReason: null },
    'a fallback reason holding a # after a space': { fallbackReason: 'github: exit 1 # network' },
    'a comment holding a newline': { comments: [`${LATER}: line one\nline two`] },
  };

  for (const [label, overrides] of Object.entries(edges)) {
    it(`round-trips ${label}`, () => {
      const issue = record(overrides);

      expect(parseLocalIssue(renderLocalIssue(issue))).toEqual(issue);
    });
  }
});

describe('reading an issue file', () => {
  const base = renderLocalIssue(record({ draft: draftFixture({ blockedBy: [259] }) }));

  it('reads the file every refusal below is planted in', () => {
    expect(parseLocalIssue(base, '/tmp/1.md').draft.blockedBy).toEqual([259]);
  });

  it.each([
    ['an invalid type', 'type: bug', 'type: not-a-real-type', `type is "not-a-real-type", expected one of: ${TYPES}`],
    [
      'an invalid state',
      'state: todo',
      'state: not-a-real-state',
      `state is "not-a-real-state", expected one of: ${STATES}`,
    ],
    ['a missing module', 'module: auth\n', '', 'module is undefined, expected a string'],
    ['a blocker written as a string', '- 259', '- "259"', 'blockedBy is a list, expected a list of numbers'],
    ['a title YAML reads as a number', 'title: Fix TOTP replay window off-by-one', 'title: 0x10', 'title is 16, expected a string'],
  ])('throws a located error for %s', (_label, from, to, problem) => {
    const planted = base.replace(from, to);

    expect(planted).not.toBe(base);
    expect(() => parseLocalIssue(planted, '/tmp/1.md'))
      .toThrow(`local tracker: invalid issue at /tmp/1.md: ${problem}`);
  });

  it('throws a located error for frontmatter that is a list', () => {
    expect(() => parseLocalIssue('---\n- a\n- b\n---\nbody', '/tmp/1.md'))
      .toThrow('local tracker: invalid issue at /tmp/1.md: the frontmatter is a list, expected a mapping');
  });

  it('throws a located error for frontmatter that is not YAML', () => {
    expect(() => parseLocalIssue('---\ntitle: [unclosed\n---\nbody', '/tmp/1.md'))
      .toThrow('local tracker: invalid issue at /tmp/1.md: ');
  });

  it('ignores a key it does not write', () => {
    const issue = record();
    const withExtra = renderLocalIssue(issue).replace('---\n', '---\nreviewer: someone\n');

    expect(withExtra).toContain('reviewer: someone');
    expect(parseLocalIssue(withExtra)).toEqual(issue);
  });
});

describe('writing an issue file', () => {
  it.each([
    ['a state', record({ state: 'bogus' as IssueState }), `state is "bogus", expected one of: ${STATES}`],
    [
      'a draft type',
      record({ draft: draftFixture({ type: 'epic' as IssueType }) }),
      `type is "epic", expected one of: ${TYPES}`,
    ],
    ['a clock reading', record({ capturedAt: 42 as unknown as string }), 'capturedAt is 42, expected a string'],
    [
      'a body',
      record({ draft: { ...draftFixture(), body: undefined as unknown as string } }),
      'body is undefined, expected a string',
    ],
  ])('refuses %s no read would accept, naming it', (_label, issue, problem) => {
    expect(() => renderLocalIssue(issue)).toThrow(TypeError);
    expect(() => renderLocalIssue(issue)).toThrow(`local tracker: refused to write an invalid issue: ${problem}`);
  });
});

describe('createLocalTracker', () => {
  it('numbers the first issue 1 whatever its draft opt, naming its file after it', async () => {
    const dir = freshDir('first');

    const ref = await localTracker(dir).create(draftFixture({ opt: 260 }));

    expect(ref).toEqual({ opt: 260, kind: 'local', externalId: '1', url: null });
    expect(dir.startsWith(tempDir)).toBe(true);
    expect(readdirSync(dir)).toEqual(['1.md']);
    expect(readIssue(dir, 1).draft.opt).toBe(260);
  });

  it('numbers an issue one past the highest issue file, counting a corrupt one and no other file', async () => {
    const dir = freshDir('numbering');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '7.md'), 'no frontmatter at all\n');
    const others = ['099.md', '+50.md', '-40.md', '1e3.md', '12.txt', 'notes.md', '99999999999999999999.md'];
    for (const name of others) writeFileSync(join(dir, name), renderLocalIssue(record()));
    const warned: string[] = [];
    const tracker = localTracker(dir, { warn: (message) => warned.push(message) });

    const ref = await tracker.create(draftFixture());

    expect(ref.externalId).toBe('8');
    expect(readIssue(dir, 8).draft.title).toBe(draftFixture().title);
    expect(ids(await tracker.find({}))).toEqual(['8']);
    expect(warned).toEqual([
      `local tracker: the issue at ${join(dir, '7.md')} has no YAML frontmatter block; find skipped it`,
    ]);
  });

  it('gives racing creates distinct numbers, overwriting none', async () => {
    const dir = freshDir('race');
    const tracker = localTracker(dir);
    const titles = ['one', 'two', 'three', 'four', 'five'];

    const refs = await Promise.all(titles.map((title) => tracker.create(draftFixture({ opt: 0, title }))));

    expect(ids(refs).sort((a, b) => Number(a) - Number(b))).toEqual(['1', '2', '3', '4', '5']);
    expect((await Promise.all(refs.map((ref) => tracker.get(ref)))).map((issue) => issue.title))
      .toEqual(titles);
  });

  it('records the fallback reason it was made with, and null when made with none', async () => {
    const dir = freshDir('reasons');

    await localTracker(dir).create(draftFixture());
    await localTracker(dir, { fallbackReason: null }).create(draftFixture());

    expect(readIssue(dir, 1).fallbackReason).toBe(REASON);
    expect(readFileSync(join(dir, '1.md'), 'utf8')).toContain(`\nfallbackReason: "${REASON}"\n`);
    expect(readIssue(dir, 2).fallbackReason).toBeNull();
    expect(readFileSync(join(dir, '2.md'), 'utf8')).toContain('\nfallbackReason: null\n');
  });

  it('keeps the reason and time recorded at create when a tracker made with others writes the issue', async () => {
    const dir = freshDir('kept');
    const ref = await localTracker(dir).create(draftFixture());
    const later = localTracker(dir, { fallbackReason: null, now: () => LATER });

    await later.comment(ref, 'seen again');
    await later.transition(ref, 'in-progress');
    const laterRef = await later.create(draftFixture());

    expect(readIssue(dir, 1)).toMatchObject({
      fallbackReason: REASON,
      capturedAt: NOW,
      state: 'in-progress',
      comments: [`${LATER}: seen again`],
    });
    expect(laterRef.externalId).toBe('2');
    expect(readIssue(dir, 2)).toMatchObject({ fallbackReason: null, capturedAt: LATER });
  });

  it('stamps the issue and each comment from the system clock when made with no clock', async () => {
    const dir = freshDir('clock');
    const tracker = createLocalTracker({ issuesDir: dir, fallbackReason: null });
    const before = Date.now();

    const ref = await tracker.create(draftFixture());
    await tracker.comment(ref, 'stamped');
    const after = Date.now();

    const issue = readIssue(dir, 1);
    const commentStamp = (issue.comments[0] ?? '').replace(/: stamped$/, '');
    for (const stamp of [issue.capturedAt, commentStamp]) {
      expect(stamp).toMatch(ISO_TIMESTAMP);
      expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(stamp)).toBeLessThanOrEqual(after);
    }
  });

  it('answers preflight ok before its directory exists, creating nothing', async () => {
    const dir = freshDir('preflight');

    expect(await localTracker(dir).preflight()).toEqual({ ok: true });
    expect(existsSync(dir)).toBe(false);
  });

  it('rejects a get for an issue it does not hold, keeping the file system error as the cause', async () => {
    const dir = freshDir('missing');

    await expect(localTracker(dir).get({ opt: 999, kind: 'local', externalId: '999', url: null }))
      .rejects.toMatchObject({
        message: `local tracker: no issue 999 under ${dir}`,
        cause: expect.objectContaining({ code: 'ENOENT' }),
      });
  });

  it.each([
    '../outside',
    '01',
    '0',
    '-1',
    '+1',
    '1.5',
    '1e0',
    ' 1',
    '1.md',
    '',
    '9007199254740993',
  ])('refuses the external id %p, reading and writing no file', async (externalId) => {
    const dir = freshDir('refs');
    const tracker = localTracker(dir);
    const ref = await tracker.create(draftFixture());
    const outside = join(dir, '..', 'outside.md');
    writeFileSync(outside, renderLocalIssue(record({ draft: draftFixture({ title: 'Outside' }) })));
    const refused = { ...ref, externalId };
    const refusal = `local tracker: externalId ${JSON.stringify(externalId)} ${NUMBER_REFUSAL}`;

    expect((await tracker.get(ref)).title).toBe(draftFixture().title);
    expect(parseLocalIssue(readFileSync(outside, 'utf8')).draft.title).toBe('Outside');
    await expect(tracker.get(refused)).rejects.toThrow(refusal);
    await expect(tracker.comment(refused, 'planted')).rejects.toThrow(refusal);
    await expect(tracker.transition(refused, 'done')).rejects.toThrow(refusal);
    expect(readdirSync(dir)).toEqual(['1.md']);
    expect(readIssue(dir, 1)).toMatchObject({ state: 'todo', comments: [] });
    expect(parseLocalIssue(readFileSync(outside, 'utf8'))).toMatchObject({ state: 'todo', comments: [] });
  });

  it('refuses a ref of another kind whose number it holds', async () => {
    const dir = freshDir('kinds');
    const tracker = localTracker(dir);
    const ref = await tracker.create(draftFixture());
    const foreign = { ...ref, kind: 'github' };

    expect((await tracker.get(ref)).title).toBe(draftFixture().title);
    await expect(tracker.get(foreign)).rejects.toThrow(KIND_REFUSAL);
    await expect(tracker.comment(foreign, 'planted')).rejects.toThrow(KIND_REFUSAL);
    await expect(tracker.transition(foreign, 'done')).rejects.toThrow(KIND_REFUSAL);
    expect(readIssue(dir, 1)).toMatchObject({ state: 'todo', comments: [] });
  });

  it('appends a comment to the issue file rather than losing it', async () => {
    const dir = freshDir('comment');
    const tracker = localTracker(dir);

    const ref = await tracker.create(draftFixture());
    await tracker.comment(ref, 'also fails on the staging box');

    expect(readFileSync(join(dir, '1.md'), 'utf8')).toContain('also fails on the staging box');
    expect(readIssue(dir, 1).comments).toEqual([`${NOW}: also fails on the staging box`]);
  });

  it('keeps the original body and both comments after two comments', async () => {
    const dir = freshDir('two-comments');
    const tracker = localTracker(dir);

    const ref = await tracker.create(draftFixture());
    await tracker.comment(ref, 'also fails on the staging box');
    await tracker.comment(ref, 'confirmed on a clean checkout too');

    expect((await tracker.get(ref)).body).toBe(draftFixture().body);
    expect(readIssue(dir, 1).comments).toEqual([
      `${NOW}: also fails on the staging box`,
      `${NOW}: confirmed on a clean checkout too`,
    ]);
  });

  it('keeps the original body after a comment followed by a transition', async () => {
    const dir = freshDir('comment-transition');
    const tracker = localTracker(dir);

    const ref = await tracker.create(draftFixture());
    await tracker.comment(ref, 'also fails on the staging box');
    await tracker.transition(ref, 'in-progress');
    const issue = await tracker.get(ref);

    expect(issue.body).toBe(draftFixture().body);
    expect(issue.state).toBe('in-progress');
  });

  it('refuses a transition to a state no read would accept, leaving the file byte-identical', async () => {
    const dir = freshDir('bad-state');
    const tracker = localTracker(dir);
    const ref = await tracker.create(draftFixture());
    const path = join(dir, '1.md');
    const before = readFileSync(path, 'utf8');

    await expect(tracker.transition(ref, 'bogus' as IssueState)).rejects.toThrow(
      `local tracker: refused to write an invalid issue: state is "bogus", expected one of: ${STATES}`,
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
    await tracker.transition(ref, 'done');
    expect(readFileSync(path, 'utf8')).not.toBe(before);
  });

  it('refuses a draft no read would accept, creating no file and no directory', async () => {
    const dir = freshDir('bad-draft');

    await expect(localTracker(dir).create(draftFixture({ type: 'epic' as IssueType }))).rejects.toThrow(
      `local tracker: refused to write an invalid issue: type is "epic", expected one of: ${TYPES}`,
    );
    expect(existsSync(dir)).toBe(false);
  });

  it('answers a frozen tracker', () => {
    expect(Object.isFrozen(localTracker(freshDir('frozen')))).toBe(true);
  });
});

describe('find over local issues', () => {
  it('narrows by module, type, state and text together', async () => {
    const dir = freshDir('narrow');
    const tracker = localTracker(dir);
    const window = await tracker.create(draftFixture({ title: 'Replay window' }));
    await tracker.create(draftFixture({ title: 'Replay docs', type: 'chore' }));
    await tracker.create(draftFixture({ title: 'Replay invoices', module: 'billing' }));
    const closed = await tracker.create(draftFixture({ title: 'Replay window again' }));
    await tracker.transition(closed, 'done');

    expect(ids(await tracker.find({ text: 'replay' }))).toEqual(['1', '2', '3', '4']);
    expect(ids(await tracker.find({ module: 'auth', type: 'bug', state: 'todo', text: 'REPLAY' })))
      .toEqual([window.externalId]);
    expect(ids(await tracker.find({ state: 'done' }))).toEqual([closed.externalId]);
    expect(ids(await tracker.find({ type: 'chore' }))).toEqual(['2']);
    expect(ids(await tracker.find({ module: 'billing' }))).toEqual(['3']);
  });

  it('matches text across the newline joining the title and the body', async () => {
    const dir = freshDir('joined');
    const tracker = localTracker(dir);
    await tracker.create(draftFixture({ title: 'Replay window', body: 'Codes stay valid.\n' }));

    expect(ids(await tracker.find({ text: 'window\ncodes' }))).toEqual(['1']);
    expect(await tracker.find({ text: 'window codes' })).toEqual([]);
  });

  it('answers issues lowest number first, comparing numbers rather than names, then takes the limit', async () => {
    const dir = freshDir('order');
    const tracker = localTracker(dir);
    await Promise.all(Array.from({ length: 10 }, () => tracker.create(draftFixture({ opt: 0 }))));

    const found = await tracker.find({});

    expect(ids(found)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(found[0]).toEqual({ opt: 0, kind: 'local', externalId: '1', url: null });
    expect(ids(await tracker.find({ limit: 2 }))).toEqual(['1', '2']);
    expect(await tracker.find({ limit: 0 })).toEqual([]);
  });

  it('answers no issues for a directory that does not exist, creating none', async () => {
    const dir = freshDir('absent');

    expect(await localTracker(dir).find({})).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });

  it('rejects when its directory path names a file', async () => {
    const dir = freshDir('not-a-directory');
    writeFileSync(dir, 'a file, not a directory\n');

    await expect(localTracker(dir).find({})).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('skips an unreadable issue file, reporting it, and answers the rest', async () => {
    const dir = freshDir('corrupt');
    await localTracker(dir).create(draftFixture());
    writeFileSync(join(dir, '2.md'), '## Context\n\nno frontmatter at all\n');
    mkdirSync(join(dir, '3.md'));
    const warned: string[] = [];

    const issues = await listLocalIssues(dir, (message) => {
      warned.push(message);
    });

    expect(issues.map(({ number, path }) => [number, path])).toEqual([[1, join(dir, '1.md')]]);
    expect(warned).toHaveLength(2);
    expect(warned[0]).toBe(
      `local tracker: the issue at ${join(dir, '2.md')} has no YAML frontmatter block; find skipped it`,
    );
    expect(warned[1]?.startsWith(`local tracker: could not read ${join(dir, '3.md')}: `)).toBe(true);
    expect(warned[1]?.endsWith('; find skipped it')).toBe(true);
  });

  it('reports a skipped file through the output active when find runs, when made with no warn', async () => {
    const dir = freshDir('active');
    const tracker = createLocalTracker({ issuesDir: dir, fallbackReason: null, now: () => NOW });
    await tracker.create(draftFixture());
    writeFileSync(join(dir, '2.md'), 'no frontmatter\n');
    const warned: string[] = [];

    setActiveOutput(warnOnlyOutput(warned));
    try {
      expect(ids(await tracker.find({}))).toEqual(['1']);
    } finally {
      setActiveOutput(null);
    }

    expect(warned).toEqual([
      `local tracker: the issue at ${join(dir, '2.md')} has no YAML frontmatter block; find skipped it`,
    ]);
  });
});

describe('localIssuesDir', () => {
  it('answers .rafa/issues under the repository root', () => {
    expect(localIssuesDir('/repo')).toBe(join('/repo', '.rafa', 'issues'));
  });
});
