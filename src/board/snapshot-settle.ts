/**
 * What `plan create --issue` and `--next` do with a saved copy of an
 * issue that no longer matches it: say what differs, then rebuild it,
 * ask, or refuse, depending on which part changed.
 *
 * `./issue.ts` holds the reading ({@link readSnapshotChange}) and the
 * write ({@link writeSpecSnapshot}, which moves the old copy to
 * `previous/` before any rewrite). Neither prints or asks. This module
 * is the step between them that does, run by `./spec-source.ts` where
 * the bare write used to run: AFTER `requireSpecIssue`, the trust
 * check, the readiness checks and the leak refusal, and after the
 * `--dry-run` stop. So everything that refuses an issue has already read
 * the body as it reads now before any copy is compared or any question
 * asked, and a yes here skips no check.
 *
 * ## The paths
 *
 * ```text
 * change   --refresh  offer                what happens
 * none     any        any                  written or left alone, nothing printed
 * notes    any        any                  rebuilt, notes line and info line, no question
 * body     yes        any                  rebuilt, body line, no question
 * body     no         answers yes          body line, question, rebuilt
 * body     no         no, or input ended   body line, question, refused
 * body     no         none                 body line, refused
 * ```
 *
 * `both` — the body and the notes changed — takes the `body` rows and
 * prints both lines. The difference lines are printed through the run's
 * output BEFORE whatever follows, under `--refresh` and with no offer
 * too, so a refused run still says what it was refused over.
 *
 * The notes-only rebuild asks nothing because the notes file is the
 * operator's own, on this machine ({@link notesRebuiltLine} names where
 * the old copy went). A body change is somebody else's edit on the
 * board, so it is asked about: {@link refreshQuestion} names the issue
 * and the date the saved copy was taken, which is its modification time
 * in UTC — a saved copy is never rewritten while it matches, so that
 * time is when its text was read.
 *
 * The refusal is {@link snapshotDiffersMessage} with exit
 * {@link ISSUE_REFUSAL_EXIT}, byte for byte the one a changed body met
 * before there was a question, and it touches nothing: the saved copy
 * stays and `previous/` is not written.
 *
 * ## The offer is a seam
 *
 * Nothing here opens a terminal. {@link RefreshOffer} is filled by
 * `src/commands/plan/refresh-offer.ts`, which answers null where there
 * is no terminal; a run handed no offer refuses as it did before. An
 * input that ended before an answer is the offer's to read, and it reads
 * as no, so it reaches this module as `false` and refuses the same way.
 * An offer that throws is thrown on, with nothing written.
 *
 * The filesystem is reached only under the `repoRoot` a caller names,
 * so every case in `./snapshot-settle.test.ts` writes in its own
 * temporary directory.
 */
import type { SnapshotChange, SpecIssue, SpecSnapshot } from './issue.js';
import type { Output } from '../ports/index.js';

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';

import {
  ISSUE_REFUSAL_EXIT,
  readLocalNotes,
  readSnapshotChange,
  snapshotDiffersMessage,
  writeSpecSnapshot,
} from './issue.js';
import { notesPath, specPath } from './naming.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board snapshot settle';

/** The length of `YYYY-MM-DD` at the head of an ISO timestamp. */
const DATE_LENGTH = 10;

/** What a {@link RefreshOffer} is handed: the issue, and the saved copy it changed since. */
export interface RefreshOfferRequest {
  /** The issue whose body changed. */
  readonly issue: number;
  /** The saved copy, under `specs.dir` as configured. */
  readonly path: string;
  /** The saved copy's modification time: when its text was taken. */
  readonly savedAt: Date;
}

/**
 * Asks whether to plan from an issue whose body changed since its saved
 * copy, and answers whether the answer was yes. An input that ended is
 * a no.
 *
 * Filled by `src/commands/plan/refresh-offer.ts`, which is where the
 * terminal and the prompter live; nothing in this module asks anything.
 */
export type RefreshOffer = (request: RefreshOfferRequest) => Promise<boolean>;

/** `savedAt` as `YYYY-MM-DD` in UTC, as the question names it. */
export function savedCopyDate(savedAt: Date): string {
  return savedAt.toISOString().slice(0, DATE_LENGTH);
}

/** The question a changed body is asked about, with the date its saved copy was taken. */
export function refreshQuestion(issue: number, savedAt: Date): string {
  return `Issue #${String(issue)} changed since the saved copy of ${savedCopyDate(savedAt)}.`
    + ' Plan from it as it reads now? [y/N] ';
}

/** The line a notes-only rebuild prints, naming where the old copy went. */
export function notesRebuiltLine(path: string, issue: number, previous: string): string {
  return `local notes changed; rebuilt ${path} from issue #${String(issue)} and the notes,`
    + ` the old copy is at ${previous}`;
}

/** What {@link settleSpecSnapshot} is asked. */
export interface SettleSnapshotOptions {
  /** The project root the paths are resolved against. */
  readonly repoRoot: string;
  /** Where saved copies live, as `specs.dir` resolved it. */
  readonly specsDir: string;
  /** The issue read, every check already run on it. */
  readonly issue: SpecIssue;
  /** True under `--refresh`: a changed body is rebuilt without asking. */
  readonly refresh: boolean;
  /** Asks about a changed body; null or left out where there is nobody to ask. */
  readonly offerRefresh?: RefreshOffer | null;
  /** Where the difference lines and the info line go. */
  readonly output: Output;
}

/** A saved copy as read: its text and when it was taken. */
interface SavedCopy {
  readonly text: string;
  readonly savedAt: Date;
}

/**
 * The saved copy at `absolute`, or null when there is no FILE there.
 * Something else at the path is left to `writeSpecSnapshot`, which
 * refuses it in its own words.
 */
function readSavedCopy(absolute: string, path: string): SavedCopy | null {
  if (!existsSync(absolute)) return null;
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) return null;
    return { text: readFileSync(absolute, 'utf8'), savedAt: stat.mtime };
  } catch (error) {
    throw new Error(`${PREFIX}: the saved copy ${path} could not be read: ${messageOf(error)}`, { cause: error });
  }
}

/** Prints each line of `change` that is not null, the body line first. */
function printChange(change: SnapshotChange, output: Output): void {
  for (const line of [change.bodyLine, change.notesLine]) {
    if (line !== null) output.info(line);
  }
}

/**
 * Writes the saved copy of `options.issue`, settling a copy that no
 * longer matches the issue as the module note's table says, and answers
 * what `writeSpecSnapshot` left behind.
 *
 * Prints the body line and the notes line of a copy that differs before
 * anything else; prints {@link notesRebuiltLine} after a notes-only
 * rebuild; hands a changed body to `options.offerRefresh` unless
 * `options.refresh` is set.
 *
 * Throws `CommandExit({@link ISSUE_REFUSAL_EXIT},
 * {@link snapshotDiffersMessage})` when the body changed, `--refresh`
 * was not given, and the offer answered no or there was none, with the
 * saved copy and `previous/` left as they were. Every refusal and
 * failure `writeSpecSnapshot` raises — the notes collision, a path that
 * is not a file, a move or a write that failed — is thrown on unchanged,
 * and so is anything the offer throws.
 */
export async function settleSpecSnapshot(options: SettleSnapshotOptions): Promise<SpecSnapshot> {
  const { repoRoot, specsDir, issue, refresh, output } = options;
  const write = (rewrite: boolean): SpecSnapshot => writeSpecSnapshot({ repoRoot, specsDir, issue, refresh: rewrite });
  const path = specPath(specsDir, issue.number, issue.title);
  const notes = notesPath(specsDir, issue.number);
  // The collision is `writeSpecSnapshot`'s refusal; reading the notes
  // file as a saved copy first would only say something else.
  if (path === notes) return write(refresh);

  const saved = readSavedCopy(resolve(repoRoot, path), path);
  if (saved === null) return write(refresh);

  const change = readSnapshotChange({
    saved: saved.text,
    body: issue.body,
    notes: readLocalNotes(repoRoot, specsDir, issue.number),
    notesPath: notes,
  });
  if (change.kind === 'unchanged') return write(refresh);

  printChange(change, output);
  if (change.kind === 'notes') {
    const rebuilt = write(refresh);
    if (rebuilt.previous !== null) output.info(notesRebuiltLine(rebuilt.path, issue.number, rebuilt.previous));
    return rebuilt;
  }

  if (refresh) return write(true);
  const offer = options.offerRefresh ?? null;
  const accepted = offer !== null
    && await offer({ issue: issue.number, path, savedAt: saved.savedAt });
  if (!accepted) throw new CommandExit(ISSUE_REFUSAL_EXIT, snapshotDiffersMessage(path, issue.number));
  return write(true);
}
