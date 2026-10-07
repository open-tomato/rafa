/**
 * Tests for the run of `rafa issue edit` (`./edit-run.ts`): the line
 * rules, the four gates in order, `--dry-run`, the write, `already`, the
 * re-read with `conflict` and its two saved bodies, and the outcomes.
 *
 * The run is driven over a fake tracker held in memory, whose `edit`
 * can be made to change the body around the write, and a stand-in `gh`
 * answering `api user` and the collaborators path for the trust lookups,
 * logging every call. No case reaches GitHub or spawns a process. Each
 * refusal sits beside a passing control differing only in what the
 * refusing gate reads, and each "nothing written" claim reads the fake's
 * edit log, which the passing cases show fills.
 *
 * Three cases dispatch a line over a `local` project
 * (`tests/cli-capture.ts`) through a stand-in command calling
 * {@link editIssue}, since the registered command is `./edit.ts`'s.
 */
import type { EditRequest } from './edit-run.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { RafaCommand } from '../../cli/command.js';
import type { EditableIssue, IssueDraft, IssueEdit, IssueRef, Tracker, TrackerKind } from '../../ports/index.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalTracker, localIssuesDir } from '../../adapters/tracker/local.js';
import { renderUpdateBlock } from '../../board/issue-edit-body.js';
import { SPEC_LABEL } from '../../board/issue.js';
import { branchName } from '../../board/naming.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { createGhEditorLogin, ghBoardTrust } from '../../board/trust.js';
import { IN_DEVELOPMENT_LABEL } from '../../claims/stale.js';
import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';
import { fileStamp } from '../effort/fix-schema.js';

import {
  EDIT_USAGE,
  editIssue,
  EditRefusal,
  readEditLine,
  readEditRequest,
  renderEditReport,
  requireEditingTracker,
  runIssueEdit,
  saveConflictBodies,
} from './edit-run.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-edit-run-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const REPO = 'open-tomato/rafa';
const ISSUE = 12;
const TITLE = 'Sync design for devices';
const NOW = new Date(2026, 9, 6, 12, 0);
const REASON = 'sync design';
const TEXT = 'One workflow moves or seeds an environment.';
const HOME_PATH_TEXT = 'The copy sits under /Users/jdoe/projects/app/.rafa/specs.';
const SPECS_DIR = join('.rafa', 'specs');

const COMPLETE = [
  '## What you get\n\nAn edit command.\n',
  '## Starting position\n\nNo way to change a body.\n',
  '## Design\n\nFour gates in order.\n',
  '## What can go wrong\n\nA leak reaches the board.\n',
  '## Tasks the plan must carry\n\n- add the gate\n',
  '## Definition of done\n\n- a leak is refused\n',
].join('\n');
const INCOMPLETE = COMPLETE.replace('Four gates in order.\n', '');

/** The block the append of {@link TEXT} for {@link REASON} on {@link NOW} adds. */
const BLOCK = renderUpdateBlock(NOW, REASON, TEXT);

// ---------------------------------------------------------------------
// The fake tracker and the stand-in gh
// ---------------------------------------------------------------------

/** What the fake holds of the one issue. */
type HeldIssue = Omit<EditableIssue, 'ref'>;

/** The fake tracker, its edit log and what it holds now. */
interface FakeTracker {
  readonly tracker: Tracker;
  readonly edits: IssueEdit[];
  readonly held: () => HeldIssue;
}

interface FakeOptions {
  readonly kind?: TrackerKind;
  /** What the board makes of the issue right after a write lands: a browser edit, a normalisation. */
  readonly afterEdit?: (issue: HeldIssue) => HeldIssue;
  /** Rejects every write. */
  readonly refuseEdit?: boolean;
}

/** A call no case makes. */
function unused(): Promise<never> {
  return Promise.reject(new Error('fake tracker: not used by issue edit'));
}

/** A tracker holding issue {@link ISSUE} as `issue`, with `editable` and `edit` over it. */
function fakeTracker(issue: Partial<HeldIssue> = {}, options: FakeOptions = {}): FakeTracker {
  let held: HeldIssue = { title: TITLE, body: COMPLETE, open: true, labels: [SPEC_LABEL], author: 'octocat', ...issue };
  const edits: IssueEdit[] = [];
  const kind = options.kind ?? 'github';
  const holds = (ref: IssueRef): boolean => ref.externalId === String(ISSUE);
  const tracker: Tracker = {
    kind,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: () => Promise.resolve({ ok: true }),
    find: unused,
    get: unused,
    create: unused,
    comment: unused,
    transition: unused,
    editable: (ref) => holds(ref)
      ? Promise.resolve({ ref, ...held })
      : Promise.reject(new Error(`no issue ${ref.externalId}`)),
    edit: (ref, change) => {
      if (options.refuseEdit === true) return Promise.reject(new Error('HTTP 403: Resource not accessible'));
      if (!holds(ref)) return Promise.reject(new Error(`no issue ${ref.externalId}`));
      edits.push(change);
      held = { ...held, ...change };
      if (options.afterEdit !== undefined) held = options.afterEdit(held);
      return Promise.resolve();
    },
  };
  return { tracker, edits, held: () => held };
}

/** A `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A `gh` result that failed, writing `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** What the collaborators endpoint answers for one permission. */
function permissionOf(permission: string): GhResult {
  return wrote(JSON.stringify({ permission, role_name: permission, user: {} }));
}

/** A stand-in `gh` and the calls it took. */
interface StandInGh {
  readonly gh: GhRunner;
  readonly calls: string[];
}

/** A `gh` answering `api user` with `user` and the collaborators path from `permissions`; a 404 for any other login. */
function standInGh(user: GhResult, permissions: Readonly<Record<string, GhResult>>): StandInGh {
  const calls: string[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args.join(' '));
    const [verb, path] = args;
    if (verb === 'api' && path === 'user') return Promise.resolve(user);
    const login = /^repos\/\{owner\}\/\{repo\}\/collaborators\/([^/]+)\/permission$/u.exec(path ?? '')?.[1];
    if (verb === 'api' && login !== undefined) {
      return Promise.resolve(permissions[login] ?? failed('gh: Not Found (HTTP 404)'));
    }
    return Promise.reject(new Error(`stand-in gh: no route for ${args.join(' ')}`));
  };
  return { gh, calls };
}

/** A `gh` for which `octocat` runs the edit and holds write access. */
function memberGh(more: Readonly<Record<string, GhResult>> = {}): StandInGh {
  return standInGh(wrote(JSON.stringify({ login: 'octocat', id: 1 })), { octocat: permissionOf('write'), ...more });
}

// ---------------------------------------------------------------------
// Running the edit
// ---------------------------------------------------------------------

/** An append of {@link TEXT} for {@link REASON}. */
function appendRequest(over: Partial<EditRequest> = {}): EditRequest {
  return {
    issue: ISSUE,
    kind: 'append',
    text: TEXT,
    reason: REASON,
    title: null,
    whileInDevelopment: false,
    dryRun: false,
    ...over,
  };
}

/** A replace of the body with `text`. */
function replaceRequest(text: string, over: Partial<EditRequest> = {}): EditRequest {
  return { ...appendRequest(), kind: 'replace', text, reason: null, ...over };
}

/** A fresh project root of the case's own. */
function freshRoot(): string {
  return mkdtempSync(join(tempBase, 'root-'));
}

interface RunOver {
  readonly gh?: StandInGh;
  readonly trustedAuthors?: readonly string[];
  readonly root?: string;
}

/** Runs `request` over `fake`, with the trust and the editor read over the stand-in `gh`. */
function run(fake: FakeTracker, request: EditRequest, over: RunOver = {}) {
  const { gh } = over.gh ?? memberGh();
  return runIssueEdit({
    request,
    tracker: requireEditingTracker(fake.tracker),
    root: over.root ?? freshRoot(),
    specsDir: SPECS_DIR,
    trust: () => ghBoardTrust({ gh, trustedAuthors: over.trustedAuthors ?? [], repo: REPO }),
    editor: createGhEditorLogin({ gh }),
    now: () => NOW,
  });
}

/** The refusal `running` rejects with, failing the case when it resolves or rejects otherwise. */
async function refusalOf(running: Promise<unknown>): Promise<EditRefusal> {
  try {
    await running;
  } catch (error) {
    if (error instanceof EditRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal, and the edit ran');
}

/** The `CommandExit` `call` throws, failing the case when it throws nothing or something else. */
function exitOf(call: () => unknown): CommandExit {
  try {
    call();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and nothing was thrown');
}

/** A root holding a saved copy of issue {@link ISSUE} under {@link SPECS_DIR}. */
function rootWithSavedCopy(): string {
  const root = freshRoot();
  mkdirSync(join(root, SPECS_DIR), { recursive: true });
  writeFileSync(join(root, SPECS_DIR, `rafa-${String(ISSUE)}-sync-design.md`), COMPLETE);
  return root;
}

// ---------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------

describe('readEditLine, the edits a line may ask for', () => {
  it('reads an append from a file with its reason', () => {
    expect(readEditLine(['12'], { 'append-file': 'u.md', reason: 'sync design' })).toEqual({
      issue: 12,
      kind: 'append',
      source: { from: 'file', flag: 'append-file', path: 'u.md' },
      reason: 'sync design',
      title: null,
      whileInDevelopment: false,
      dryRun: false,
    });
  });

  it('reads an append from the line, --while-in-development and --dry-run beside it', () => {
    const line = readEditLine(['12'], { append: TEXT, reason: REASON, 'while-in-development': true, 'dry-run': true });

    expect(line.source).toEqual({ from: 'line', text: TEXT });
    expect(line.whileInDevelopment).toBe(true);
    expect(line.dryRun).toBe(true);
  });

  it('reads a replace alone and with a title, and a title alone', () => {
    expect(readEditLine(['12'], { 'replace-file': 'b.md' })).toMatchObject({ kind: 'replace', title: null });
    expect(readEditLine(['12'], { 'replace-file': 'b.md', title: 'New' })).toMatchObject({ kind: 'replace', title: 'New' });
    expect(readEditLine(['12'], { title: 'New' })).toMatchObject({ kind: 'title', title: 'New', source: null });
  });
});

describe('readEditLine, the refusals of the line, each exit 1 naming the usage', () => {
  const cases: readonly (readonly [string, readonly string[], Record<string, string | boolean>, string])[] = [
    ['no issue', [], { append: TEXT, reason: REASON }, 'Name the issue number'],
    ['two issues', ['12', '13'], { append: TEXT, reason: REASON }, 'Expected one issue number, got 2'],
    ['a word that is no number', ['twelve'], { append: TEXT, reason: REASON }, '"twelve" is no issue number'],
    ['no edit at all', ['12'], {}, 'Name the edit'],
    ['both append flags', ['12'], { append: TEXT, 'append-file': 'u.md', reason: REASON }, 'name the added text one way'],
    ['an append beside a replace', ['12'], { append: TEXT, 'replace-file': 'b.md', reason: REASON }, 'either appends or replaces'],
    ['an append beside a title', ['12'], { append: TEXT, title: 'New', reason: REASON }, '--title and --append'],
    ['an append without a reason', ['12'], { append: TEXT }, '--reason is required with an append'],
    ['a reason beside a replace', ['12'], { 'replace-file': 'b.md', reason: REASON }, '--reason goes with an append only'],
    ['a reason beside a title', ['12'], { title: 'New', reason: REASON }, '--reason goes with an append only'],
    ['--while-in-development beside a replace', ['12'], { 'replace-file': 'b.md', 'while-in-development': true }, 'goes with an append only'],
    ['--while-in-development beside a title', ['12'], { title: 'New', 'while-in-development': true }, 'goes with an append only'],
    ['a blank reason', ['12'], { append: TEXT, reason: '  ' }, '--reason cannot be blank'],
    ['a title typed bare', ['12'], { title: true }, '--title needs a value'],
    ['a value given to --dry-run', ['12'], { title: 'New', 'dry-run': 'maybe' }, '--dry-run takes no value'],
  ];

  for (const [name, args, flags, problem] of cases) {
    it(`refuses ${name}`, () => {
      const refusal = exitOf(() => readEditLine(args, flags));

      expect(refusal.exitCode).toBe(1);
      expect(refusal.message).toContain(problem);
      expect(refusal.message).toContain(`Usage: ${EDIT_USAGE}`);
    });
  }
});

describe('readEditRequest, the text a line names', () => {
  it('reads a file whole, and standard input for -', async () => {
    const file = join(freshRoot(), 'u.md');
    writeFileSync(file, `${TEXT}\n`);

    const fromFile = await readEditRequest(readEditLine(['12'], { 'append-file': file, reason: REASON }), unused);
    const fromStdin = await readEditRequest(
      readEditLine(['12'], { 'replace-file': '-' }),
      () => Promise.resolve(COMPLETE),
    );

    expect(fromFile.text).toBe(`${TEXT}\n`);
    expect(fromStdin.text).toBe(COMPLETE);
  });

  it('refuses a file that cannot be read and one holding nothing but whitespace, with exit 1', async () => {
    const blank = join(freshRoot(), 'blank.md');
    writeFileSync(blank, '  \n\n');
    const missing = join(freshRoot(), 'missing.md');

    const reads = [missing, blank].map((path) => readEditRequest(readEditLine(['12'], { 'append-file': path, reason: REASON }), unused));
    const [unreadable, empty] = await Promise.all(reads.map((reading) => reading.then(
      () => null,
      (error: unknown) => error,
    )));

    expect(unreadable).toBeInstanceOf(CommandExit);
    expect((unreadable as CommandExit).message).toContain(`--append-file cannot read "${missing}"`);
    expect((empty as CommandExit).exitCode).toBe(1);
    expect((empty as CommandExit).message).toContain('read nothing but whitespace');
  });

  it('reads no file for a title change', async () => {
    const request = await readEditRequest(readEditLine(['12'], { title: 'New' }), unused);

    expect(request).toMatchObject({ kind: 'title', text: null, title: 'New' });
  });
});

// ---------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------

describe('runIssueEdit, an append', () => {
  it('keeps the original part byte for byte and ends the body with the dated block', async () => {
    const fake = fakeTracker();

    const made = await run(fake, appendRequest());

    expect(made).toMatchObject({ outcome: 'appended', exitCode: 0, written: true, refresh: null, scratch: null });
    expect(fake.held().body.startsWith(COMPLETE)).toBe(true);
    expect(fake.held().body.endsWith(`**Updated 2026-10-06, ${REASON}:**\n\n${TEXT}`)).toBe(true);
    expect(fake.edits).toHaveLength(1);
  });

  it('answers already for the same line run twice, writing nothing the second time', async () => {
    const fake = fakeTracker();
    await run(fake, appendRequest());
    const after = fake.held().body;

    const again = await run(fake, appendRequest());

    expect(again).toMatchObject({ outcome: 'already', exitCode: 0, written: false });
    expect(fake.edits).toHaveLength(1);
    expect(fake.held().body).toBe(after);
  });

  it('appends again for the same text with another reason', async () => {
    const fake = fakeTracker();
    await run(fake, appendRequest());

    const other = await run(fake, appendRequest({ reason: 'second thoughts' }));

    expect(other.outcome).toBe('appended');
    expect(fake.edits).toHaveLength(2);
  });

  it('answers stale-copy on an issue with a saved copy, naming the refresh line', async () => {
    const fake = fakeTracker();

    const made = await run(fake, appendRequest(), { root: rootWithSavedCopy() });

    expect(made).toMatchObject({ outcome: 'stale-copy', exitCode: 0, written: true });
    expect(made.refresh).toBe(`rafa plan create --issue=${String(ISSUE)} --refresh`);
    expect(made.message).toContain(`rafa plan create --issue=${String(ISSUE)} --refresh`);
  });

  it('reads CRLF as LF and a trimmed end as the same body after the write', async () => {
    const fake = fakeTracker({}, {
      afterEdit: (issue) => ({ ...issue, body: `${issue.body.replace(/\n/gu, '\r\n')}\r\n\r\n` }),
    });

    const made = await run(fake, appendRequest());

    expect(made.outcome).toBe('appended');
  });
});

describe('runIssueEdit, replace and title', () => {
  it('replaces the body of a spec under no plan', async () => {
    const fake = fakeTracker();
    const body = `${COMPLETE}\n## Notes\n\nRewritten.\n`;

    const made = await run(fake, replaceRequest(body));

    expect(made).toMatchObject({ outcome: 'replaced', exitCode: 0, written: true });
    expect(fake.edits).toEqual([{ body: body.trimEnd() }]);
    expect(made.message).toContain('Replaced the body of github issue 12');
  });

  it('replaces the body and the title in one write', async () => {
    const fake = fakeTracker();

    const made = await run(fake, replaceRequest(COMPLETE, { title: 'Sync design, again' }));

    expect(fake.edits).toEqual([{ body: COMPLETE.trimEnd(), title: 'Sync design, again' }]);
    expect(made.message).toContain('the body and the title');
  });

  it('changes the title alone, the body untouched', async () => {
    const fake = fakeTracker();

    const made = await run(fake, { ...appendRequest(), kind: 'title', text: null, reason: null, title: 'Renamed' });

    expect(made.outcome).toBe('replaced');
    expect(fake.edits).toEqual([{ title: 'Renamed' }]);
    expect(fake.held().body).toBe(COMPLETE);
  });
});

describe('runIssueEdit, the gates in order, nothing written on a refusal', () => {
  it('refuses an editor without write access as ownership, exit 2', async () => {
    const fake = fakeTracker();
    const gh = standInGh(wrote(JSON.stringify({ login: 'octocat' })), { octocat: permissionOf('read') });

    const refusal = await refusalOf(run(fake, appendRequest(), { gh }));

    expect(refusal.exitCode).toBe(2);
    expect(refusal.refusal).toBe('ownership');
    expect(refusal.message).toStartWith('❌ refused ownership: ');
    expect(fake.edits).toEqual([]);
  });

  it('lets the same editor through when board.trustedAuthors lists it', async () => {
    const fake = fakeTracker();
    const gh = standInGh(wrote(JSON.stringify({ login: 'octocat' })), { octocat: permissionOf('read') });

    const made = await run(fake, appendRequest(), { gh, trustedAuthors: ['octocat'] });

    expect(made.outcome).toBe('appended');
  });

  it('refuses as ownership-unknown when gh api user fails, never as trusted', async () => {
    const fake = fakeTracker();
    const gh = standInGh(failed('gh auth login required'), { octocat: permissionOf('write') });

    const refusal = await refusalOf(run(fake, appendRequest(), { gh }));

    expect(refusal.refusal).toBe('ownership-unknown');
    expect(refusal.exitCode).toBe(2);
    expect(refusal.message).toContain('gh auth login required');
    expect(fake.edits).toEqual([]);
  });

  it('refuses a trusted editor on an issue an outsider opened, with the remedy plan create gives', async () => {
    const fake = fakeTracker({ author: 'stranger' });

    const refusal = await refusalOf(run(fake, appendRequest(), { gh: memberGh({ stranger: permissionOf('read') }) }));

    expect(refusal.refusal).toBe('ownership');
    expect(refusal.exitCode).toBe(2);
    expect(refusal.message).toContain('stranger');
    expect(refusal.message).toContain('a member must open the spec');
    expect(fake.edits).toEqual([]);
  });

  it('refuses as ownership-unknown when the author lookup fails', async () => {
    const fake = fakeTracker({ author: 'stranger' });

    const refusal = await refusalOf(run(fake, appendRequest(), { gh: memberGh({ stranger: failed('HTTP 502') }) }));

    expect(refusal.refusal).toBe('ownership-unknown');
  });

  it('refuses added text holding a home path before any write, as text', async () => {
    const fake = fakeTracker();

    const refusal = await refusalOf(run(fake, appendRequest({ text: HOME_PATH_TEXT })));

    expect(refusal.refusal).toBe('text');
    expect(refusal.exitCode).toBe(2);
    expect(refusal.message).toContain('the text added to issue #12');
    expect(fake.edits).toEqual([]);
  });

  it('refuses a leak in a new title as text', async () => {
    const refusal = await refusalOf(run(fakeTracker(), replaceRequest(COMPLETE, { title: HOME_PATH_TEXT })));

    expect(refusal.refusal).toBe('text');
  });

  it('refuses a replace leaving a complete spec failing its template, as text', async () => {
    const fake = fakeTracker();

    const refusal = await refusalOf(run(fake, replaceRequest(INCOMPLETE)));

    expect(refusal.refusal).toBe('text');
    expect(refusal.message).toContain('issue #12 as edited');
    expect(fake.edits).toEqual([]);
  });

  it('refuses a replace on spec:ready as spec-ready, pointing at an append', async () => {
    const fake = fakeTracker({ labels: [SPEC_LABEL, SPEC_READY_LABEL] });

    const refusal = await refusalOf(run(fake, replaceRequest(COMPLETE)));

    expect(refusal.refusal).toBe('spec-ready');
    expect(refusal.exitCode).toBe(2);
    expect(refusal.message).toContain('--append-file=');
    expect(fake.edits).toEqual([]);
  });

  it('lets an append to the same spec:ready issue through', async () => {
    const made = await run(fakeTracker({ labels: [SPEC_LABEL, SPEC_READY_LABEL] }), appendRequest());

    expect(made.outcome).toBe('appended');
  });

  it('refuses a replace on a planned issue as planned', async () => {
    const refusal = await refusalOf(run(fakeTracker(), replaceRequest(COMPLETE), { root: rootWithSavedCopy() }));

    expect(refusal.refusal).toBe('planned');
  });

  it('refuses an append to an in-development issue, naming the loop branch', async () => {
    const fake = fakeTracker({ labels: [SPEC_LABEL, IN_DEVELOPMENT_LABEL] });

    const refusal = await refusalOf(run(fake, appendRequest()));

    expect(refusal.refusal).toBe('in-development');
    expect(refusal.exitCode).toBe(2);
    expect(refusal.message).toContain(branchName(ISSUE, TITLE));
    expect(refusal.message).toContain('--while-in-development');
    expect(fake.edits).toEqual([]);
  });

  it('lets that append through under --while-in-development as stale-copy, saying the loop keeps its copy', async () => {
    const fake = fakeTracker({ labels: [SPEC_LABEL, IN_DEVELOPMENT_LABEL] });

    const made = await run(fake, appendRequest({ whileInDevelopment: true }));

    expect(made).toMatchObject({ outcome: 'stale-copy', branch: branchName(ISSUE, TITLE), written: true });
    expect(made.message).toContain('the loop plans from the copy it already has');
    expect(fake.edits).toHaveLength(1);
  });

  it('refuses any edit to a closed issue as closed', async () => {
    const refusal = await refusalOf(run(fakeTracker({ open: false }), appendRequest()));

    expect(refusal.refusal).toBe('closed');
  });

  it('answers the first gate when several would refuse: the editor before a leak and a closed issue', async () => {
    const fake = fakeTracker({ open: false, author: 'stranger' });
    const gh = standInGh(failed('gh auth login required'), {});

    const refusal = await refusalOf(run(fake, appendRequest({ text: HOME_PATH_TEXT }), { gh }));

    expect(refusal.refusal).toBe('ownership-unknown');
  });

  it('weighs the gates before already: a line run again on an issue since closed is refused', async () => {
    const fake = fakeTracker();
    await run(fake, appendRequest());
    const closed = fakeTracker({ ...fake.held(), open: false });

    const refusal = await refusalOf(run(closed, appendRequest()));

    expect(refusal.refusal).toBe('closed');
  });
});

describe('runIssueEdit, the local tracker', () => {
  it('asks nobody about ownership and reads gates 1 and 2 as local', async () => {
    const fake = fakeTracker({ author: '', labels: [] }, { kind: 'local' });
    const gh = standInGh(failed('never asked'), {});

    const made = await run(fake, appendRequest(), { gh });

    expect(made.outcome).toBe('appended');
    expect(gh.calls).toEqual([]);
    expect(made.readings.slice(0, 2).map((reading) => [reading.gate, reading.line.startsWith('local: ')])).toEqual([
      ['editor', true],
      ['author', true],
    ]);
  });

  it('weighs an empty author on any other tracker over gh, and refuses it', async () => {
    const fake = fakeTracker({ author: '' });

    const refusal = await refusalOf(run(fake, appendRequest()));

    expect(refusal.refusal).toBe('ownership-unknown');
    expect(fake.edits).toEqual([]);
  });
});

describe('runIssueEdit, --dry-run', () => {
  it('weighs every gate, prints the added block and writes nothing', async () => {
    const fake = fakeTracker();

    const made = await run(fake, appendRequest({ dryRun: true }));

    expect(made).toMatchObject({ outcome: 'appended', dryRun: true, written: false, added: BLOCK });
    expect(made.readings.map((reading) => reading.gate)).toEqual(['editor', 'author', 'text', 'state']);
    expect(made.message).toStartWith('--dry-run: nothing was written; the edit would answer appended.');
    expect(fake.edits).toEqual([]);
    expect(renderEditReport(made)).toEqual([
      'editor: octocat, who has write access to open-tomato/rafa',
      'author: #12 was opened by octocat, who has write access to open-tomato/rafa',
      'text: the added text names no machine path or credential, and the edited body still fills the spec template',
      'state: open, labelled type:spec, with no saved copy and no loop building from it',
      'added:',
      BLOCK,
      made.message,
    ]);
  });

  it('names the would-be stale-copy and its refresh line', async () => {
    const made = await run(fakeTracker(), appendRequest({ dryRun: true }), { root: rootWithSavedCopy() });

    expect(made).toMatchObject({ outcome: 'stale-copy', written: false });
    expect(made.message).toContain('rafa plan create --issue=12 --refresh');
  });

  it('still refuses with exit 2, the readings that passed opening the message', async () => {
    const fake = fakeTracker();

    const refusal = await refusalOf(run(fake, appendRequest({ text: HOME_PATH_TEXT, dryRun: true })));

    expect(refusal.exitCode).toBe(2);
    expect(refusal.message.split('\n').slice(0, 2)).toEqual([
      'editor: octocat, who has write access to open-tomato/rafa',
      'author: #12 was opened by octocat, who has write access to open-tomato/rafa',
    ]);
    expect(refusal.message).toContain('❌ refused text: ');
    expect(fake.edits).toEqual([]);
  });

  it('opens a refusal with no readings without --dry-run', async () => {
    const refusal = await refusalOf(run(fakeTracker(), appendRequest({ text: HOME_PATH_TEXT })));

    expect(refusal.message).toStartWith('❌ refused text: ');
    expect(refusal.readings.map((reading) => reading.gate)).toEqual(['editor', 'author']);
  });
});

describe('runIssueEdit, after the write', () => {
  it('answers conflict with exit 1 when the body changed around the write, saving both bodies', async () => {
    const browserEdit = `${COMPLETE}\nA line typed in the browser.\n`;
    const fake = fakeTracker({}, { afterEdit: (issue) => ({ ...issue, body: browserEdit }) });
    const root = freshRoot();

    const made = await run(fake, appendRequest(), { root });

    expect(made).toMatchObject({ outcome: 'conflict', exitCode: 1, written: true });
    const scratch = made.scratch;
    if (scratch === null) throw new Error('expected the conflict to save both bodies');
    expect(scratch).toEqual({
      before: join('.rafa', 'scratch', `rafa-12-edit-before-${fileStamp(NOW)}.md`),
      after: join('.rafa', 'scratch', `rafa-12-edit-after-${fileStamp(NOW)}.md`),
    });
    expect(readFileSync(join(root, scratch.before), 'utf8')).toBe(COMPLETE);
    expect(readFileSync(join(root, scratch.after), 'utf8')).toBe(browserEdit);
    expect(made.message).toContain(scratch.before);
    expect(made.message).toContain(scratch.after);
  });

  it('answers conflict for a replace the tracker did not keep as sent', async () => {
    const fake = fakeTracker({}, { afterEdit: (issue) => ({ ...issue, body: COMPLETE }) });

    const made = await run(fake, replaceRequest(`${COMPLETE}\nMore.\n`));

    expect(made.outcome).toBe('conflict');
  });

  it('answers conflict for a title the tracker did not keep', async () => {
    const fake = fakeTracker({}, { afterEdit: (issue) => ({ ...issue, title: TITLE }) });

    const made = await run(fake, { ...appendRequest(), kind: 'title', text: null, reason: null, title: 'Renamed' });

    expect(made.outcome).toBe('conflict');
  });

  it('refuses with exit 1 a write the tracker rejects, naming what it said', async () => {
    const fake = fakeTracker({}, { refuseEdit: true });

    const running = run(fake, appendRequest());

    await expect(running).rejects.toBeInstanceOf(CommandExit);
    await expect(running).rejects.toMatchObject({ exitCode: 1, message: expect.stringContaining('HTTP 403') });
  });
});

describe('saveConflictBodies', () => {
  it('never overwrites a pair saved in the same second, taking the next suffix', () => {
    const root = freshRoot();

    const first = saveConflictBodies(root, ISSUE, NOW, 'one', 'two');
    const second = saveConflictBodies(root, ISSUE, NOW, 'three', 'four');

    expect(second.before).toBe(first.before.replace(/\.md$/u, '-2.md'));
    expect(readFileSync(join(root, first.before), 'utf8')).toBe('one');
    expect(readFileSync(join(root, second.after), 'utf8')).toBe('four');
  });
});

describe('requireEditingTracker', () => {
  it('refuses with exit 1 a tracker without editable and edit, naming its kind', () => {
    const bare: Tracker = { ...fakeTracker({}, { kind: 'linear' }).tracker, editable: undefined, edit: undefined };

    const refusal = exitOf(() => requireEditingTracker(bare));

    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toContain('The linear tracker cannot edit an issue');
  });
});

// ---------------------------------------------------------------------
// From a line, dispatched over a local project
// ---------------------------------------------------------------------

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** A `gh` refusing every call, so no dispatched case can reach GitHub: the local tracker asks it nothing. */
const noGh: GhRunner = (args) => Promise.reject(new Error(`no gh in a local project: gh ${args.join(' ')}`));

/** A stand-in for `./edit.ts`'s command: the run, its lines, and a non-zero exit as a CommandExit. */
const STAND_IN_COMMAND: RafaCommand = {
  name: 'issue edit',
  subject: 'issue',
  action: 'edit',
  summary: 'stand-in for the edit run',
  description: 'Runs editIssue and prints its report, ending with the exit code of its outcome.',
  examples: [],
  args: [{ name: 'n', description: 'The issue.', type: 'string', required: true }],
  flags: ['append-file', 'append', 'reason', 'replace-file', 'title'].map((name) => ({
    name,
    description: name,
    type: 'string' as const,
  })).concat(['dry-run', 'while-in-development'].map((name) => ({ name, description: name, type: 'boolean' as const }))),
  outputs: ['text'],
  run: async (context) => {
    const made = await editIssue(context, { now: () => NOW, gh: noGh });
    for (const line of renderEditReport(made)) context.output.info(line);
    if (made.exitCode !== 0) throw new CommandExit(made.exitCode, made.message);
  },
};

/** The issue each dispatched case files first. */
const DRAFT: IssueDraft = {
  opt: 0,
  title: TITLE,
  body: 'Seen twice.\n',
  type: 'spec',
  module: 'cli',
  priority: null,
  project: null,
  blockedBy: [],
};

/** A fresh `local` project holding issue 1, and a tracker reading it. */
async function plantLocalIssue() {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), 'tracker:\n  default: local\n');
  const tracker = createLocalTracker({ issuesDir: localIssuesDir(project.root), fallbackReason: null });
  await tracker.create(DRAFT);
  const read = async (): Promise<string> => {
    const { editable } = requireEditingTracker(tracker);
    return (await editable({ opt: 0, kind: 'local', externalId: '1', url: null })).body;
  };
  return { project, read };
}

describe('editIssue, dispatched over a local project', () => {
  it('appends to a local issue from a file, the original part unchanged', async () => {
    const { project, read } = await plantLocalIssue();
    const file = join(project.root, 'u.md');
    writeFileSync(file, `${TEXT}\n`);

    const outcome = await dispatchInProject(
      ['issue', 'edit', '1', `--append-file=${file}`, `--reason=${REASON}`],
      SUBJECTS,
      [STAND_IN_COMMAND],
      project,
    );

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: 'Appended an update to local issue 1; the original part is unchanged.\n',
      stderr: '',
    });
    expect(await read()).toBe(`Seen twice.\n\n${BLOCK}`);
  });

  it('answers stale-copy with the refresh line when specs.dir holds a saved copy', async () => {
    const { project } = await plantLocalIssue();
    mkdirSync(join(project.root, SPECS_DIR), { recursive: true });
    writeFileSync(join(project.root, SPECS_DIR, 'rafa-1-sync-design.md'), COMPLETE);

    const outcome = await dispatchInProject(
      ['issue', 'edit', '1', `--append=${TEXT}`, `--reason=${REASON}`],
      SUBJECTS,
      [STAND_IN_COMMAND],
      project,
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('rafa plan create --issue=1 --refresh');
  });

  it('refuses a line without a reason with exit 1, the issue file untouched', async () => {
    const { project, read } = await plantLocalIssue();
    const before = await read();

    const outcome = await dispatchInProject(['issue', 'edit', '1', `--append=${TEXT}`], SUBJECTS, [STAND_IN_COMMAND], project);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--reason is required with an append');
    expect(await read()).toBe(before);
    expect(existsSync(join(project.root, '.rafa', 'scratch'))).toBe(false);
  });
});
