/**
 * Tests for the issue a plan is written from (`src/board/issue.ts`): the
 * read, the closed and unlabelled refusals, the snapshot written under
 * `specs.dir`, the `--refresh` rule and the local notes appended to it.
 *
 * Two seams, no process. The read is driven through the strict recorded
 * fake (`src/adapters/tracker/github-fake.ts`), which models
 * `gh issue view <n> --json` and writes exactly the fields asked for, so
 * a field list this module got wrong is refused by the fake rather than
 * quietly answered. `author` is one of the fields it models, added with
 * the read that asks for it: the fake plants `rafa-fake`, the account
 * its own `gh auth status` names, as every issue's author, which is why
 * the login the read case asserts is that one and not the spec's. Everything the fake cannot produce — a payload that
 * is not JSON, one answering another issue's number, a body that is not
 * a string, a command that failed — is driven through {@link stubGh}, a
 * runner answering one recorded result. No case spawns `gh`, reaches
 * GitHub or reads the configuration `gh` keeps under the home.
 *
 * The fake numbers the issues it is handed from 1, so the read cases are
 * about ITS numbers rather than the spec's `#20`; the cases that need a
 * particular number drive the stub, where the number is the test's own.
 *
 * Every file this file writes sits under a temporary directory made in
 * `tmpdir` and removed afterwards. `specs.dir` is a RELATIVE setting in
 * every case but one, as a project configures it, so the snapshot cases
 * read back through the temporary root they were given: a resolution
 * that reached the real home or the real `.rafa/specs` would find
 * nothing there and redden. Two cases assert the absolute path against
 * the root outright, one of them under an absolute `specs.dir`.
 *
 * ## What passes while wrong
 *
 * A refusal is the shape that passes for the wrong reason most easily: a
 * `requireSpecIssue` that threw at everything satisfies both refusal
 * cases, and a `writeSpecSnapshot` that refused every existing snapshot
 * satisfies the `--refresh` one. So each refusal sits beside the reading
 * it must LET THROUGH over the same seam — an open labelled issue, a
 * snapshot that matches, a notes file that changed nothing — and the
 * two refusal sentences are asserted apart, since an operator told
 * "closed" about an unlabelled issue looks in the wrong place.
 *
 * The author is the other shape that passes while wrong, in the other
 * direction: a read answering the EMPTY login for every issue satisfies
 * every case that only asks the command not to fail, and the empty
 * login is what the module answers on purpose for an author it cannot
 * read. So the login is asserted against the one the payload named —
 * `rafa-fake` off the fake, `vilmibm` and `app/dependabot` off the
 * recorded person and bot mappings — beside the case that drives six
 * authors no login can be made of and asserts the empty string with the
 * rest of the issue still read.
 *
 * The `--refresh` rule has one case that no simpler implementation
 * passes: the issue body is unchanged and only the LOCAL NOTES were
 * edited. A rule comparing the body alone would write nothing and say
 * the snapshot was unchanged, which is the silent version of planning
 * from text nobody wrote.
 *
 * ## Mutations driven
 *
 * Eight mutations of `issue.ts` were driven on 2026-09-19, one at a
 * time, over `env -u CLAUDECODE bun test src/board/`, the module
 * restored from a scratch copy and verified with `shasum -c` after
 * each. 211 pass either side, and each count below is that run's own:
 *
 *  - the closed refusal dropped: 2 fail, the closed case and the one
 *    that asserts closed is named ahead of the missing label.
 *  - the `type:spec` refusal dropped: 1 fail, the unlabelled case.
 *  - the `--refresh` rule dropped, so an existing snapshot is rewritten
 *    without asking: 2 fail, the differing snapshot and the changed
 *    notes.
 *  - the notes not appended to the snapshot: 2 fail, the notes case and
 *    the changed-notes one.
 *  - "differs" measured over the issue body alone, with the appended
 *    notes cut off both sides before the comparison: 1 fail, the
 *    changed-notes case, and only that one — which is the whole reason
 *    it is written.
 *  - the payload's number not checked against the number asked for: 1
 *    fail, the case that answers issue 21 to a read of 20.
 *  - CRLF normalisation dropped from the snapshot text: 1 fail, the
 *    normalisation case. The trailing-blank-line half of that function
 *    was left in, so the case saw the half that was taken out.
 *  - the notes name collision left unrefused: 1 fail, the `Notes` title
 *    case.
 *
 * Two more were driven on 2026-09-21 over the same command, with the
 * module copied to a scratch path, restored from the copy and verified
 * with `shasum -c` after each. 404 pass either side:
 *
 *  - the author read as the empty login for every payload, with
 *    {@link ISSUE_VIEW_FIELDS} left asking for it: 4 fail, the six-field
 *    read, the person's mapping, the bot's mapping, and the
 *    JSON/not-JSON case that reads a login too.
 *  - `author` dropped from {@link ISSUE_VIEW_FIELDS}, the reading left
 *    in: 3 fail, the field-list case, the six-field read — whose issue
 *    now carries no author at all rather than failing, which is the
 *    lenient reading working as written — and the case asserting the
 *    command in a failure message, since the field list is spelled in
 *    it.
 */
import type { SpecIssue } from './issue.js';
import type { FakeGh } from '../adapters/tracker/github-fake.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../adapters/tracker/github-fake.js';
import { CommandExit } from '../cli/command.js';

import {
  closedIssueMessage,
  createGhSpecIssueReader,
  hasSpecLabel,
  ISSUE_REFUSAL_EXIT,
  ISSUE_VIEW_FIELDS,
  LOCAL_NOTES_HEADING,
  missingSpecLabelMessage,
  readLocalNotes,
  REFRESH_FLAG,
  requireSpecIssue,
  snapshotText,
  SPEC_LABEL,
  writeSpecSnapshot,
} from './issue.js';
import { notesPath, specPath } from './naming.js';

/** Where every file this file writes goes. */
let root = '';

/** Where `specs.dir` points in every snapshot case: a relative setting, as configured. */
const SPECS_DIR = '.rafa/specs';

/** The title every snapshot case plans from, and the slug it spells. */
const TITLE = 'Plans from the board';

/** The stub `TITLE` spells, through `./naming.ts`. */
const STUB = 'rafa-20-plans-board';

/** A runner answering `result` to every command, recording what it was handed. */
function stubGh(result: GhResult): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  let calls: readonly (readonly string[])[] = [];
  return {
    run: (args) => {
      calls = [...calls, Object.freeze([...args])];
      return Promise.resolve(result);
    },
    calls: () => calls,
  };
}

/** A `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A `gh` result that failed, writing `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** What a planted issue is made of. */
interface IssueSeed {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
}

/** One issue in a fake repository, with the number the fake gave it. */
interface Planted {
  readonly fake: FakeGh;
  readonly number: number;
}

/** A fake `gh` holding one issue, made with its labels and closed when the seed says so. */
async function plantIssue(seed: IssueSeed): Promise<Planted> {
  const fake = createFakeGh();
  const made = await Promise.all(seed.labels.map((label) => fake.run(['label', 'create', label, '--force'])));
  expect(made.every((result) => result.ok)).toBe(true);

  const label = seed.labels.length === 0
    ? []
    : ['--label', seed.labels.join(',')];
  const created = await fake.run(['issue', 'create', '--title', seed.title, '--body', seed.body, ...label]);
  expect(created.ok).toBe(true);

  const number = Number(created.stdout.trim().replace(/^.*\//u, ''));
  if (seed.state === 'CLOSED') {
    fake.update(String(number), (issue) => ({ ...issue, state: 'CLOSED', stateReason: 'COMPLETED' }));
  }
  return { fake, number };
}

/** An issue as the read answers one, for the cases that need no `gh` at all. */
function issueOf(fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number: 20,
    title: TITLE,
    body: '## What you get\n\nA plan from the board.\n',
    state: 'OPEN',
    labels: [SPEC_LABEL],
    author: 'octocat',
    ...fields,
  };
}

/** The snapshot path a case asserts against, as the planner is handed it. */
const snapshotAt = (): string => specPath(SPECS_DIR, 20, TITLE);

/** Writes `text` to `file` under the temporary root, making its directory. */
function plantFile(path: string, text: string): string {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** What the file at `path` under the temporary root holds. */
function fileAt(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-board-issue-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createGhSpecIssueReader', () => {
  it('reads the six fields off one gh issue view command', async () => {
    const { fake, number } = await plantIssue({
      title: 'Plans from the board',
      body: '## What you get\n\nA plan.\n',
      labels: [SPEC_LABEL, 'spec:ready'],
    });
    const before = fake.calls().length;

    const issue = await createGhSpecIssueReader({ gh: fake.run })(number);

    expect(issue).toEqual({
      number,
      title: 'Plans from the board',
      body: '## What you get\n\nA plan.\n',
      state: 'OPEN',
      labels: [SPEC_LABEL, 'spec:ready'],
      author: 'rafa-fake',
    });
    expect(fake.calls().slice(before))
      .toEqual([['issue', 'view', String(number), '--json', ISSUE_VIEW_FIELDS]]);
  });

  it('asks for the spec\'s fields and the author, which the strict fake models', () => {
    expect(ISSUE_VIEW_FIELDS).toBe('number,title,body,state,labels,author');
    expect(ISSUE_VIEW_FIELDS.split(',')).toContain('author');
  });

  it('keeps the login off the author mapping gh answers, and nothing else of it', async () => {
    const payload = {
      number: 20,
      title: TITLE,
      body: 'body',
      state: 'OPEN',
      labels: [],
      author: { id: 'MDQ6VXNlcjk4NDgy', is_bot: false, login: 'vilmibm', name: 'Nate Smith' },
    };

    const issue = await createGhSpecIssueReader({ gh: stubGh(wrote(JSON.stringify(payload))).run })(20);

    expect(issue.author).toBe('vilmibm');
    expect(issue).toEqual({ number: 20, title: TITLE, body: 'body', state: 'OPEN', labels: [], author: 'vilmibm' });
  });

  it('reads a bot author, whose mapping carries no id and no name, by its login', async () => {
    const payload = {
      number: 20,
      title: TITLE,
      body: 'body',
      state: 'OPEN',
      labels: [],
      author: { is_bot: true, login: 'app/dependabot' },
    };

    expect((await createGhSpecIssueReader({ gh: stubGh(wrote(JSON.stringify(payload))).run })(20)).author)
      .toBe('app/dependabot');
  });

  it('reads an author it cannot make a login of as the empty login, rather than failing the command', async () => {
    const unreadable: readonly unknown[] = [undefined, null, 'vilmibm', {}, { login: 12 }, []];

    for (const author of unreadable) {
      const payload = { number: 20, title: TITLE, body: 'body', state: 'OPEN', labels: [], author };
      const issue = await createGhSpecIssueReader({ gh: stubGh(wrote(JSON.stringify(payload))).run })(20);

      expect(issue.author).toBe('');
      expect(issue.title).toBe(TITLE);
    }
  });

  it('reads a closed issue as closed, beside an open one read as open', async () => {
    const open = await plantIssue({ title: 'Open', body: 'body', labels: [] });
    const shut = await plantIssue({ title: 'Shut', body: 'body', labels: [], state: 'CLOSED' });

    expect((await createGhSpecIssueReader({ gh: open.fake.run })(open.number)).state).toBe('OPEN');
    expect((await createGhSpecIssueReader({ gh: shut.fake.run })(shut.number)).state).toBe('CLOSED');
  });

  it('fails naming the command and what gh wrote when the read failed', async () => {
    const stub = stubGh(failed('GraphQL: Could not resolve to an issue or pull request with the number of 20.\n'));

    await expect(createGhSpecIssueReader({ gh: stub.run })(20)).rejects.toThrow(
      /gh issue view 20 --json number,title,body,state,labels,author failed: GraphQL: Could not resolve/u,
    );
  });

  it('fails when the read wrote no output at all, rather than answering an empty issue', async () => {
    const stub = stubGh({ ok: false, stdout: '', stderr: '' });

    await expect(createGhSpecIssueReader({ gh: stub.run })(20)).rejects.toThrow(/failed and wrote nothing/u);
  });

  it('fails when the payload is not JSON, and passes when it is', async () => {
    const issue = { number: 20, title: TITLE, body: 'body', state: 'OPEN', labels: [], author: { login: 'octocat' } };

    await expect(createGhSpecIssueReader({ gh: stubGh(wrote('not json')).run })(20))
      .rejects.toThrow(/wrote output that is not JSON/u);
    await expect(createGhSpecIssueReader({ gh: stubGh(wrote(JSON.stringify(issue))).run })(20))
      .resolves.toEqual({ ...issue, state: 'OPEN', labels: [], author: 'octocat' });
  });

  it('fails when the payload answers another issue than the one asked for', async () => {
    const stub = stubGh(wrote(JSON.stringify({ number: 21, title: TITLE, body: 'body', state: 'OPEN', labels: [] })));

    await expect(createGhSpecIssueReader({ gh: stub.run })(20))
      .rejects.toThrow(/number 21, expected the issue asked for, 20/u);
  });

  it('fails on a field that is not the shape it is read as', async () => {
    const refusals: readonly [Record<string, unknown>, RegExp][] = [
      [{ title: 12 }, /title 12, expected a string/u],
      [{ body: null }, /body null, expected a string/u],
      [{ state: 'MERGED' }, /state "MERGED", expected "OPEN" or "CLOSED"/u],
      [{ labels: [{ colour: 'red' }] }, /labels that are not a list of named labels/u],
      [{ labels: 'type:spec' }, /labels that are not a list of named labels/u],
    ];

    for (const [field, message] of refusals) {
      const payload = { number: 20, title: TITLE, body: 'body', state: 'OPEN', labels: [], ...field };
      await expect(createGhSpecIssueReader({ gh: stubGh(wrote(JSON.stringify(payload))).run })(20))
        .rejects.toThrow(message);
    }
  });

  it('reads labels off the objects gh answers, not off strings', async () => {
    const { fake, number } = await plantIssue({ title: 'Labelled', body: 'body', labels: [SPEC_LABEL] });

    expect((await createGhSpecIssueReader({ gh: fake.run })(number)).labels).toEqual([SPEC_LABEL]);
  });

  it('refuses a number that is not a positive whole one, sending no command', async () => {
    const stub = stubGh(wrote('{}'));
    const read = createGhSpecIssueReader({ gh: stub.run });

    await expect(read(0)).rejects.toThrow(TypeError);
    await expect(read(-1)).rejects.toThrow(TypeError);
    await expect(read(1.5)).rejects.toThrow(/expected a positive whole number/u);
    expect(stub.calls()).toEqual([]);
  });
});

describe('the two refusals', () => {
  it('lets an open issue carrying the label through', () => {
    expect(() => requireSpecIssue(issueOf())).not.toThrow();
  });

  it('refuses a closed issue with exit 2 and a sentence naming it', () => {
    expect(() => requireSpecIssue(issueOf({ state: 'CLOSED' }))).toThrow(CommandExit);
    expect(() => requireSpecIssue(issueOf({ state: 'CLOSED' }))).toThrow(closedIssueMessage(20));
    expect(closedIssueMessage(20)).toMatch(/^issue #20 is closed/u);

    try {
      requireSpecIssue(issueOf({ state: 'CLOSED' }));
      expect.unreachable();
    } catch (error) {
      expect((error as CommandExit).exitCode).toBe(ISSUE_REFUSAL_EXIT);
    }
  });

  it('refuses an issue without the type:spec label with exit 2 and its own sentence', () => {
    const unlabelled = issueOf({ labels: ['spec:ready', 'type:bug'] });

    expect(() => requireSpecIssue(unlabelled)).toThrow(missingSpecLabelMessage(20));
    expect(missingSpecLabelMessage(20)).toMatch(/is not labelled type:spec/u);
    expect(missingSpecLabelMessage(20)).not.toMatch(/closed/u);

    try {
      requireSpecIssue(unlabelled);
      expect.unreachable();
    } catch (error) {
      expect((error as CommandExit).exitCode).toBe(ISSUE_REFUSAL_EXIT);
    }
  });

  it('names the closed state first on an issue that is both closed and unlabelled', () => {
    expect(() => requireSpecIssue(issueOf({ state: 'CLOSED', labels: [] })))
      .toThrow(closedIssueMessage(20));
  });

  it('matches the label trimmed and whatever its case, and no other label', () => {
    expect(hasSpecLabel([' Type:Spec '])).toBe(true);
    expect(hasSpecLabel(['type:spec'])).toBe(true);
    expect(hasSpecLabel(['type:specification'])).toBe(false);
    expect(hasSpecLabel(['spec'])).toBe(false);
    expect(hasSpecLabel([])).toBe(false);
  });
});

describe('snapshotText', () => {
  it('answers the body under one trailing newline when there are no notes', () => {
    expect(snapshotText('# Spec\n\nBody.\n\n\n', null)).toBe('# Spec\n\nBody.\n');
    expect(snapshotText('# Spec\n\nBody.', null)).toBe('# Spec\n\nBody.\n');
  });

  it('appends the notes under the Local notes heading', () => {
    expect(snapshotText('# Spec\n', 'The host is behind the VPN.\n'))
      .toBe(`# Spec\n\n${LOCAL_NOTES_HEADING}\n\nThe host is behind the VPN.\n`);
  });

  it('writes no heading for a notes file holding nothing but whitespace', () => {
    expect(snapshotText('# Spec\n', '\n  \n')).toBe('# Spec\n');
    expect(snapshotText('# Spec\n', '')).toBe('# Spec\n');
  });

  it('normalises CRLF line endings, and keeps a markdown line break', () => {
    expect(snapshotText('# Spec\r\n\r\nBody.\r\n', null)).toBe('# Spec\n\nBody.\n');
    expect(snapshotText('One line  \nand the next\n', null)).toBe('One line  \nand the next\n');
  });
});

describe('writeSpecSnapshot', () => {
  it('writes the body under specs.dir, named from the id and the slug', () => {
    const issue = issueOf({ body: '# Spec\n\nBody.\n' });

    const written = writeSpecSnapshot({ repoRoot: root, specsDir: SPECS_DIR, issue, refresh: false });

    expect(written.action).toBe('created');
    expect(written.path).toBe(join(SPECS_DIR, `${STUB}.md`));
    expect(written.absolute).toBe(join(root, SPECS_DIR, `${STUB}.md`));
    expect(written.absolute.startsWith(root)).toBe(true);
    expect(written.notes).toBeNull();
    expect(fileAt(written.path)).toBe('# Spec\n\nBody.\n');
  });

  it('appends the local notes file beside the spec, and answers its path', () => {
    const root2 = mkdtempSync(join(tmpdir(), 'rafa-board-notes-'));
    const notes = notesPath(SPECS_DIR, 20);
    mkdirSync(join(root2, SPECS_DIR), { recursive: true });
    writeFileSync(join(root2, notes), 'Built at /Users/someone/projects/rafa.\n');

    const written = writeSpecSnapshot({
      repoRoot: root2,
      specsDir: SPECS_DIR,
      issue: issueOf({ body: '# Spec\n' }),
      refresh: false,
    });

    expect(written.notes).toBe(notes);
    expect(readFileSync(written.absolute, 'utf8'))
      .toBe(`# Spec\n\n${LOCAL_NOTES_HEADING}\n\nBuilt at /Users/someone/projects/rafa.\n`);
    rmSync(root2, { recursive: true, force: true });
  });

  it('leaves a snapshot that matches alone, rewriting nothing', () => {
    const root2 = mkdtempSync(join(tmpdir(), 'rafa-board-same-'));
    const issue = issueOf({ body: '# Spec\n' });
    const first = writeSpecSnapshot({ repoRoot: root2, specsDir: SPECS_DIR, issue, refresh: false });
    const stamp = statSync(first.absolute).mtimeMs;

    const again = writeSpecSnapshot({ repoRoot: root2, specsDir: SPECS_DIR, issue, refresh: false });

    expect(first.action).toBe('created');
    expect(again.action).toBe('unchanged');
    expect(statSync(again.absolute).mtimeMs).toBe(stamp);
    rmSync(root2, { recursive: true, force: true });
  });

  it('refuses a snapshot that differs without --refresh, and leaves the file as it was', () => {
    const root2 = mkdtempSync(join(tmpdir(), 'rafa-board-differs-'));
    const path = snapshotAt();
    mkdirSync(join(root2, SPECS_DIR), { recursive: true });
    writeFileSync(join(root2, path), '# Spec\n\nThe text this run planned from.\n');

    const write = (): unknown => writeSpecSnapshot({
      repoRoot: root2,
      specsDir: SPECS_DIR,
      issue: issueOf({ body: '# Spec\n\nEdited on the board.\n' }),
      refresh: false,
    });

    expect(write).toThrow(CommandExit);
    expect(write).toThrow(REFRESH_FLAG);
    expect(write).toThrow(/no longer matches it/u);
    expect(readFileSync(join(root2, path), 'utf8')).toBe('# Spec\n\nThe text this run planned from.\n');
    rmSync(root2, { recursive: true, force: true });
  });

  it('rewrites a snapshot that differs under --refresh', () => {
    const root2 = mkdtempSync(join(tmpdir(), 'rafa-board-refresh-'));
    const path = snapshotAt();
    mkdirSync(join(root2, SPECS_DIR), { recursive: true });
    writeFileSync(join(root2, path), '# Spec\n\nThe old text.\n');

    const written = writeSpecSnapshot({
      repoRoot: root2,
      specsDir: SPECS_DIR,
      issue: issueOf({ body: '# Spec\n\nEdited on the board.\n' }),
      refresh: true,
    });

    expect(written.action).toBe('refreshed');
    expect(readFileSync(written.absolute, 'utf8')).toBe('# Spec\n\nEdited on the board.\n');
    rmSync(root2, { recursive: true, force: true });
  });

  it('refuses when only the local notes changed, with the issue body untouched', () => {
    const root2 = mkdtempSync(join(tmpdir(), 'rafa-board-notes-changed-'));
    const issue = issueOf({ body: '# Spec\n' });
    mkdirSync(join(root2, SPECS_DIR), { recursive: true });
    writeFileSync(join(root2, notesPath(SPECS_DIR, 20)), 'The first note.\n');
    const first = writeSpecSnapshot({ repoRoot: root2, specsDir: SPECS_DIR, issue, refresh: false });
    writeFileSync(join(root2, notesPath(SPECS_DIR, 20)), 'A second note, added today.\n');

    const write = (): unknown => writeSpecSnapshot({ repoRoot: root2, specsDir: SPECS_DIR, issue, refresh: false });

    expect(first.action).toBe('created');
    expect(write).toThrow(CommandExit);
    expect(write).toThrow(REFRESH_FLAG);
    expect(writeSpecSnapshot({ repoRoot: root2, specsDir: SPECS_DIR, issue, refresh: true }).action)
      .toBe('refreshed');
    expect(readFileSync(first.absolute, 'utf8')).toMatch(/A second note, added today\./u);
    rmSync(root2, { recursive: true, force: true });
  });

  it('refuses the one title whose slug spells the notes file', () => {
    const write = (): unknown => writeSpecSnapshot({
      repoRoot: root,
      specsDir: SPECS_DIR,
      issue: issueOf({ title: 'Notes' }),
      refresh: false,
    });

    expect(write).toThrow(CommandExit);
    expect(write).toThrow(/would overwrite the notes/u);
    expect(specPath(SPECS_DIR, 20, 'Notes')).toBe(notesPath(SPECS_DIR, 20));
  });

  it('refuses a snapshot path that is a directory rather than a file', () => {
    const root2 = mkdtempSync(join(tmpdir(), 'rafa-board-dir-'));
    mkdirSync(join(root2, snapshotAt()), { recursive: true });

    expect(() => writeSpecSnapshot({
      repoRoot: root2,
      specsDir: SPECS_DIR,
      issue: issueOf(),
      refresh: false,
    })).toThrow(/is not a file/u);
    rmSync(root2, { recursive: true, force: true });
  });

  it('writes under an absolute specs.dir as it does under a relative one', () => {
    // Deliberate custom-directory fixture: passes absolute custom `specs.dir` path to verify correct handling.
    const absolute = join(root, 'elsewhere', 'specs');

    const written = writeSpecSnapshot({
      repoRoot: root,
      specsDir: absolute,
      issue: issueOf({ body: '# Spec\n' }),
      refresh: false,
    });

    expect(written.absolute).toBe(join(absolute, `${STUB}.md`));
    expect(written.absolute.startsWith(root)).toBe(true);
    expect(readFileSync(written.absolute, 'utf8')).toBe('# Spec\n');
  });
});

describe('readLocalNotes', () => {
  it('answers null when there is no notes file, and the text when there is', () => {
    expect(readLocalNotes(root, SPECS_DIR, 99)).toBeNull();

    plantFile(notesPath(SPECS_DIR, 99), 'The host is behind the VPN.\n');

    expect(readLocalNotes(root, SPECS_DIR, 99)).toBe('The host is behind the VPN.\n');
  });

  it('reads the notes beside the spec, under the project root it is given', () => {
    expect(readLocalNotes(root, SPECS_DIR, 98)).toBeNull();

    const file = plantFile(notesPath(SPECS_DIR, 98), 'Local only.\n');

    expect(file).toBe(join(root, SPECS_DIR, 'rafa-98-notes.md'));
    expect(readLocalNotes(root, SPECS_DIR, 98)).toBe('Local only.\n');
  });
});
