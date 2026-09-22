/**
 * Tests for the step between reading how a saved copy differs and
 * writing it (`src/board/snapshot-settle.ts`): the difference lines, the
 * notes-only rebuild and its info line, the question on a changed body,
 * `--refresh`, and the refusal on a no, an ended input and no offer.
 *
 * No process and no terminal. The offer is a scripted function that
 * records what it was handed, and the ended input is driven through
 * `lazyPrompter` (`src/commands/issue/ready.ts`) over a prompter whose
 * input has ended — the composition `src/commands/plan/refresh-offer.ts`
 * is built on — so the `false` it reaches this module as is the real
 * one. Every file is written under a fresh temporary root per case, with
 * `specs.dir` a relative setting as a project configures it.
 *
 * ## What passes while wrong
 *
 * A refusal passes for the wrong reason when the module refuses every
 * difference, so each refusal sits beside the rebuild it must let
 * through over the same saved copy: the notes-only change, `--refresh`,
 * and a yes. A rebuild passes for the wrong reason when it never asked,
 * so the offer's calls are counted in every case, zero included, and the
 * order of lines and question is read off one shared log.
 *
 * ## Mutations driven
 *
 * Six mutations of `snapshot-settle.ts` were driven on 2026-09-22, one
 * at a time, over `env -u CLAUDECODE bun test
 * src/board/snapshot-settle.test.ts`, the module restored from a scratch
 * copy and checked with `shasum -c` after each. 15 pass unmutated, and
 * each count below is that run's own:
 *
 *  - the offer's answer ignored, so a changed body is rebuilt without
 *    asking: 7 fail — every case with a changed body but `--refresh`,
 *    since the yes cases read the question in the log too.
 *  - the notes-only change routed to the question: 1 fail, the notes
 *    case.
 *  - `--refresh` handed to the offer instead of rebuilding: 1 fail, the
 *    `--refresh` case.
 *  - the difference lines printed only after a yes: 7 fail, every case
 *    that reads a difference line.
 *  - the info line not printed: 1 fail, the notes case.
 *  - the question's date read in LOCAL time rather than UTC: 0 fail,
 *    because `bun test` runs under UTC when `TZ` is unset (measured:
 *    `process.env.TZ` undefined, offset 0, on a machine at +0200), so
 *    local time IS UTC inside the suite. Under
 *    `TZ=Europe/Madrid env -u CLAUDECODE bun test` the same mutation
 *    fails 1, the question case, and the unmutated module passes 15, so
 *    the case holds the rule only when run with a zone set.
 */
import type { SpecIssue } from './issue.js';
import type { RefreshOffer, RefreshOfferRequest } from './snapshot-settle.js';
import type { Prompter } from '../project/root-choice.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { lazyPrompter } from '../commands/issue/ready.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  ISSUE_REFUSAL_EXIT,
  notesCollisionMessage,
  snapshotDiffersMessage,
  snapshotText,
  SPEC_LABEL,
} from './issue.js';
import { notesPath, specPath } from './naming.js';
import { previousDir } from './previous-copy.js';
import {
  notesRebuiltLine,
  refreshQuestion,
  savedCopyDate,
  settleSpecSnapshot,
} from './snapshot-settle.js';

/** Where every file a case writes goes; fresh per case. */
let root = '';

/** Where `specs.dir` points: a relative setting, as configured. */
const SPECS_DIR = '.rafa/specs';

/** The title every case plans from. */
const TITLE = 'Plans from the board';

/** The body the saved copy was taken from. */
const OLD_BODY = '## What you get\n\nA plan from the board.\n\n## Design\n\nOne question.\n';

/** The body after somebody edited the issue: one line under `Design` changed. */
const NEW_BODY = '## What you get\n\nA plan from the board.\n\n## Design\n\nOne question, dated.\n';

/** When the saved copy was taken: late on the 21st in UTC, already the 22nd at UTC+2. */
const SAVED_AT = new Date('2026-09-21T23:30:00Z');

/** The saved copy's path, as the planner is handed it. */
const SAVED = specPath(SPECS_DIR, 20, TITLE);

/** The notes file's path. */
const NOTES = notesPath(SPECS_DIR, 20);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-snapshot-settle-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An issue as the read answers one. */
function issueOf(fields: Partial<SpecIssue> = {}): SpecIssue {
  return {
    number: 20,
    title: TITLE,
    body: NEW_BODY,
    state: 'OPEN',
    labels: [SPEC_LABEL],
    author: 'octocat',
    ...fields,
  };
}

/** Writes `text` at `path` under the root, making its directory. */
function plant(path: string, text: string): string {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** Plants the saved copy taken from `body` and `notes`, dated {@link SAVED_AT}. */
function plantSaved(body: string, notes: string | null = null): string {
  const file = plant(SAVED, snapshotText(body, notes));
  utimesSync(file, SAVED_AT, SAVED_AT);
  return file;
}

/** What the saved copy holds now. */
function savedText(): string {
  return readFileSync(join(root, SAVED), 'utf8');
}

/** The one log the printed lines and the questions asked are both written to, in order. */
interface Recording {
  readonly log: string[];
  readonly requests: RefreshOfferRequest[];
  readonly offer: (answer: boolean) => RefreshOffer;
}

/** A log, and offers that write their request into it and answer `answer`. */
function recording(): Recording {
  const log: string[] = [];
  const requests: RefreshOfferRequest[] = [];
  return {
    log,
    requests,
    offer: (answer) => (request) => {
      requests.push(request);
      log.push(`asked #${String(request.issue)}`);
      return Promise.resolve(answer);
    },
  };
}

/** Settles issue `issue` with every line written to `record.log`. */
function settle(record: Recording, fields: { refresh?: boolean; offer?: RefreshOffer | null; issue?: SpecIssue }) {
  return settleSpecSnapshot({
    repoRoot: root,
    specsDir: SPECS_DIR,
    issue: fields.issue ?? issueOf(),
    refresh: fields.refresh ?? false,
    offerRefresh: fields.offer,
    output: sinkOutput({ info: (line) => record.log.push(line) }),
  });
}

/** The refusal a changed body meets, as a `CommandExit` carries it. */
async function refusalOf(run: Promise<unknown>): Promise<CommandExit> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandExit);
    return error as CommandExit;
  }
  throw new Error('expected a refusal, and the settle resolved');
}

/** The body line the edit from `OLD_BODY` to `NEW_BODY` reads as. */
const BODY_LINE = 'issue body: +1 -1 lines; headings changed: Design';

/** The notes line for the one notes file. */
const NOTES_LINE = `local notes: ${NOTES} changed since the saved copy`;

describe('settleSpecSnapshot with nothing to settle', () => {
  it('writes a first copy, printing nothing and asking nothing', async () => {
    const record = recording();

    const snapshot = await settle(record, { offer: record.offer(true) });

    expect(snapshot.action).toBe('created');
    expect(savedText()).toBe(snapshotText(NEW_BODY, null));
    expect(record.log).toEqual([]);
    expect(existsSync(join(root, previousDir(SPECS_DIR)))).toBe(false);
  });

  it('leaves a matching copy alone, printing nothing and asking nothing', async () => {
    plantSaved(NEW_BODY);
    const record = recording();

    const snapshot = await settle(record, { offer: record.offer(true) });

    expect(snapshot.action).toBe('unchanged');
    expect(record.log).toEqual([]);
    expect(existsSync(join(root, previousDir(SPECS_DIR)))).toBe(false);
  });
});

describe('settleSpecSnapshot on a notes-only change', () => {
  it('rebuilds without asking, printing the notes line and then the info line', async () => {
    plantSaved(NEW_BODY, 'old notes');
    plant(NOTES, 'new notes\n');
    const record = recording();

    const snapshot = await settle(record, { offer: record.offer(false) });

    expect(snapshot.action).toBe('notes-rebuilt');
    expect(record.requests).toEqual([]);
    expect(snapshot.previous).not.toBeNull();
    expect(record.log).toEqual([NOTES_LINE, notesRebuiltLine(SAVED, 20, snapshot.previous ?? '')]);
    expect(savedText()).toBe(snapshotText(NEW_BODY, 'new notes'));
    expect(readFileSync(join(root, snapshot.previous ?? ''), 'utf8')).toBe(snapshotText(NEW_BODY, 'old notes'));
  });

  it('spells the info line as the plan does', () => {
    expect(notesRebuiltLine(SAVED, 20, '.rafa/specs/previous/x.md')).toBe(
      `local notes changed; rebuilt ${SAVED} from issue #20 and the notes,`
      + ' the old copy is at .rafa/specs/previous/x.md',
    );
  });
});

describe('settleSpecSnapshot on a changed body', () => {
  it('prints the body line, then asks, and rebuilds on a yes', async () => {
    plantSaved(OLD_BODY);
    const record = recording();

    const snapshot = await settle(record, { offer: record.offer(true) });

    expect(record.log).toEqual([BODY_LINE, 'asked #20']);
    expect(record.requests).toEqual([{ issue: 20, path: SAVED, savedAt: SAVED_AT }]);
    expect(snapshot.action).toBe('refreshed');
    expect(savedText()).toBe(snapshotText(NEW_BODY, null));
    expect(readFileSync(join(root, snapshot.previous ?? ''), 'utf8')).toBe(snapshotText(OLD_BODY, null));
  });

  it('rebuilds under --refresh without asking, the body line still printed', async () => {
    plantSaved(OLD_BODY);
    const record = recording();

    const snapshot = await settle(record, { refresh: true, offer: record.offer(false) });

    expect(record.requests).toEqual([]);
    expect(record.log).toEqual([BODY_LINE]);
    expect(snapshot.action).toBe('refreshed');
    expect(snapshot.previous).not.toBeNull();
  });

  it('refuses on a no, with the saved copy and previous/ untouched', async () => {
    plantSaved(OLD_BODY);
    const record = recording();

    const refusal = await refusalOf(settle(record, { offer: record.offer(false) }));

    expect(refusal.exitCode).toBe(ISSUE_REFUSAL_EXIT);
    expect(refusal.message).toBe(snapshotDiffersMessage(SAVED, 20));
    expect(record.log).toEqual([BODY_LINE, 'asked #20']);
    expect(savedText()).toBe(snapshotText(OLD_BODY, null));
    expect(existsSync(join(root, previousDir(SPECS_DIR)))).toBe(false);
  });

  it('refuses on an input that ended before an answer', async () => {
    plantSaved(OLD_BODY);
    const record = recording();
    let asked: string[] = [];
    const ended: Prompter = {
      say: () => undefined,
      ask: (question) => {
        asked = [...asked, question];
        return Promise.resolve(null);
      },
      close: () => undefined,
    };
    const offer: RefreshOffer = (request) => lazyPrompter(() => ended).ask(refreshQuestion(request.issue, request.savedAt));

    const refusal = await refusalOf(settle(record, { offer }));

    expect(asked).toEqual([refreshQuestion(20, SAVED_AT)]);
    expect(refusal.message).toBe(snapshotDiffersMessage(SAVED, 20));
    expect(savedText()).toBe(snapshotText(OLD_BODY, null));
    expect(existsSync(join(root, previousDir(SPECS_DIR)))).toBe(false);
  });

  it('refuses with no offer, whether null or left out, the body line still printed', async () => {
    for (const offer of [null, undefined]) {
      plantSaved(OLD_BODY);
      const record = recording();

      const refusal = await refusalOf(settle(record, { offer }));

      expect(refusal.exitCode).toBe(ISSUE_REFUSAL_EXIT);
      expect(refusal.message).toBe(snapshotDiffersMessage(SAVED, 20));
      expect(record.log).toEqual([BODY_LINE]);
      expect(existsSync(join(root, previousDir(SPECS_DIR)))).toBe(false);
    }
  });

  it('throws on what the offer throws, writing nothing', async () => {
    plantSaved(OLD_BODY);
    const record = recording();
    const offer: RefreshOffer = () => Promise.reject(new Error('the terminal went away'));

    await expect(settle(record, { offer })).rejects.toThrow('the terminal went away');
    expect(savedText()).toBe(snapshotText(OLD_BODY, null));
    expect(existsSync(join(root, previousDir(SPECS_DIR)))).toBe(false);
  });
});

describe('settleSpecSnapshot on a change to the body and the notes', () => {
  it('prints both lines and refuses with no offer', async () => {
    plantSaved(OLD_BODY, 'old notes');
    plant(NOTES, 'new notes\n');
    const record = recording();

    const refusal = await refusalOf(settle(record, { offer: null }));

    expect(refusal.message).toBe(snapshotDiffersMessage(SAVED, 20));
    expect(record.log).toEqual([BODY_LINE, NOTES_LINE]);
    expect(savedText()).toBe(snapshotText(OLD_BODY, 'old notes'));
  });

  it('asks, and rebuilds from the new body and the new notes on a yes', async () => {
    plantSaved(OLD_BODY, 'old notes');
    plant(NOTES, 'new notes\n');
    const record = recording();

    const snapshot = await settle(record, { offer: record.offer(true) });

    expect(record.log).toEqual([BODY_LINE, NOTES_LINE, 'asked #20']);
    expect(snapshot.action).toBe('refreshed');
    expect(savedText()).toBe(snapshotText(NEW_BODY, 'new notes'));
  });
});

describe('settleSpecSnapshot and the refusals writeSpecSnapshot owns', () => {
  it('refuses the notes collision before reading anything, asking nothing', async () => {
    const issue = issueOf({ title: 'Notes' });
    const path = specPath(SPECS_DIR, 20, 'Notes');
    plant(path, 'somebody\'s notes\n');
    const record = recording();

    const refusal = await refusalOf(settle(record, { issue, offer: record.offer(true) }));

    expect(refusal.message).toBe(notesCollisionMessage(path, 20));
    expect(record.log).toEqual([]);
    expect(readFileSync(join(root, path), 'utf8')).toBe('somebody\'s notes\n');
  });

  it('leaves a directory where the saved copy goes to writeSpecSnapshot\'s own refusal', async () => {
    mkdirSync(join(root, SAVED), { recursive: true });
    const record = recording();

    const refusal = await refusalOf(settle(record, { offer: record.offer(true) }));

    expect(refusal.message).toMatch(/is not a file, and a spec is one/u);
    expect(record.requests).toEqual([]);
  });
});

describe('the question', () => {
  it('names the issue and the saved copy\'s date in UTC', () => {
    expect(savedCopyDate(SAVED_AT)).toBe('2026-09-21');
    expect(refreshQuestion(20, SAVED_AT)).toBe(
      'Issue #20 changed since the saved copy of 2026-09-21. Plan from it as it reads now? [y/N] ',
    );
  });
});
