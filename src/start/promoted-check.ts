/**
 * Checking the wrap-up session's `rafa:promoted` answer once the session
 * has returned.
 *
 * The wrap-up prompt lists the lessons `promotable` named
 * (`start/wrap-up.ts`) and asks for one `rafa:promoted` line per lesson,
 * which `start/promoted.ts` reads. This module checks what that reading
 * claims against the repository, records what it confirms, and reports
 * what it does not. It never throws and never stops the wrap-up: the
 * spec's "a missing answer is reported in the PR body. It does not block
 * the PR".
 *
 * ## What each listed lesson comes to
 *
 * {@link checkPromoted} settles every LISTED lesson one way, in the
 * order the list gave:
 *
 *   - **promoted**: the block names a path, and that path is one git
 *     reports changed since the HEAD read before the session.
 *   - **skipped**: the block says `skipped:` and why. The session was
 *     asked for exactly that, so a skip is an answer, not a gap.
 *   - **unanswered**: the block holds no line for its id, including when
 *     there is no block at all or it was never closed.
 *   - **unchanged**: the block names a path git does not report changed.
 *   - **unchecked**: the block names a path, but the changes could not
 *     be read, because the pre-session HEAD or the diff failed. It is not
 *     read as a change, so the lesson is not marked promoted, and the PR
 *     line says the check failed rather than that the path is unchanged.
 *
 * An answer for an id the list did not hold is left out of all five
 * and reported as a warning, as each unreadable line is.
 *
 * ## Which paths count as changed
 *
 * The changes are `git diff --name-only -z <head>`: the commit read
 * before the session against the WORKING TREE, which is what the spec's
 * "every named path must have changed in the working tree" asks for.
 * Measured on a scratch repository (2026-09-25), that lists a file
 * changed in a commit made since `<head>`, a tracked file edited and not
 * committed, and a new file that was staged, all relative to the
 * repository root even when git runs in a subdirectory. It does not list
 * an untracked file, so a page the session wrote and never added
 * does not count. Such a page is not in the pull request, and only a
 * tracked page carries a lesson out of `.rafa/`, which is gitignored.
 * `-z` is what keeps a path whole: without it git quoted `ctx/é.md` as
 * `"ctx/\303\251.md"`.
 *
 * A named path is compared after {@link repoPath} reads it as git
 * spells one: `./` and `a/../` are dropped, and an absolute path inside
 * the repository becomes relative to its root. The path recorded is
 * git's own spelling, which is the repo-relative form
 * `schema/instinct.ts` accepts for `promoted_to`.
 *
 * ## How `promoted_to` is set
 *
 * The Learning port has no call that sets one field, and the check does
 * not add one. {@link recordPromotions} pushes the blessed record back
 * with `promoted_to` set, from a source the record already holds (its
 * first `sources` entry, or its own `id` when it has none). `merge`
 * collapses that push into the held record as `same-action`. The source
 * union does not grow, so `usage_count` and confidence stay as they
 * were, and the merged record takes the first `promoted_to` it holds.
 * Measured through the `local` adapter (2026-09-25), a lesson at three
 * sources and 0.8 read back as three sources and 0.8, with
 * `promoted_to` written to its `.md` file. The blessed set went from one
 * record to none, since `bless` leaves a promoted record out. That is
 * the spec's "leaves injection, because the page now carries it". A
 * record with no `sources` counts as one source named by its id, so
 * such a record comes back with `usage_count` 1. Only a hand-planted or
 * demoted record can lack sources.
 *
 * Each lesson is its own push, so one refusal costs one lesson and
 * not the rest. A record from the user scope is refused, because its
 * trigger has no held member in the project to take a description from,
 * and the user scope is never written. The refusal is a warning, and
 * the page still carries the lesson.
 *
 * ## The pull request line
 *
 * Every unanswered, unchanged or unchecked lesson is named on ONE line,
 * which {@link unpromotedLine} writes, appended to the open pull
 * request's body as its own paragraph through `gh pr edit`
 * (`PullRequests.editBody`). The body is read first and written whole,
 * because the provider cannot append. A body that already carries the
 * line is left alone, so a second check over the same answer writes
 * nothing. With no open pull request, or a provider that refuses, the
 * line goes to the operator as a warning instead.
 */
import type { PromotedReading, SkippedWithReason } from './promoted.js';
import type { InstinctRecord } from '../learning/index.js';
import type { Learning } from '../ports/index.js';
import type { GitResult, GitRunner, PullRequests } from '../pr/index.js';

import { isAbsolute, posix, relative } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/index.js';

import { parsePromoted } from './promoted.js';
import { bodyWithSentence } from './release-stage.js';

/** A listed lesson the block promoted to a path git reports changed. */
export interface ConfirmedPromotion {
  readonly lesson: InstinctRecord;
  /** The path as git spells it, which `promoted_to` is set to. */
  readonly path: string;
}

/** A listed lesson the pull request does not carry, and why. */
export type UnpromotedLesson =
  | { readonly kind: 'unanswered'; readonly id: string }
  | { readonly kind: 'unchanged'; readonly id: string; readonly path: string }
  | { readonly kind: 'unchecked'; readonly id: string; readonly path: string; readonly reason: string };

/** What the answer comes to, lesson by lesson; see the module note. */
export interface PromotedCheck {
  readonly promoted: readonly ConfirmedPromotion[];
  readonly skipped: readonly SkippedWithReason[];
  readonly unpromoted: readonly UnpromotedLesson[];
  /** Ids the block answered that the list did not hold, in block order. */
  readonly unlisted: readonly string[];
}

/** The paths changed since the pre-session HEAD, or why they could not be read. */
export type ChangedPaths =
  | { readonly ok: true; readonly head: string; readonly paths: ReadonlySet<string> }
  | { readonly ok: false; readonly reason: string };

/** What git said on a failure, as one clause: its first line. */
function saidClause(result: GitResult): string {
  const said = gitSaid(result).split('\n')[0] ?? '';
  return said === ''
    ? 'and git wrote nothing'
    : `git said: ${said}`;
}

/**
 * The commit HEAD names now, or null when git could not answer one. The
 * wrap-up reads it just before the session is spawned.
 */
export function readHead(git: GitRunner): string | null {
  const result = git(['rev-parse', '--verify', 'HEAD']);
  const head = result.stdout.trim();
  return result.ok && head !== ''
    ? head
    : null;
}

/**
 * Every path `git diff --name-only -z <head>` reports: changed since
 * `head`, in a commit or in the working tree. A null `head`, or a diff
 * git refuses, answers why instead.
 */
export function changedSince(git: GitRunner, head: string | null): ChangedPaths {
  if (head === null) return { ok: false, reason: 'the HEAD before the session could not be read' };
  const result = git(['diff', '--name-only', '-z', head, '--']);
  if (!result.ok) {
    return { ok: false, reason: `the changes since ${head.slice(0, 7)} could not be read, ${saidClause(result)}` };
  }
  const paths = result.stdout.split('\0').filter((path) => path !== '');
  return { ok: true, head, paths: new Set(paths) };
}

/**
 * `path` as git spells a path of the repository at `repoRoot`, or null
 * when it names no path inside it.
 */
export function repoPath(path: string, repoRoot: string): string | null {
  const inside = isAbsolute(path)
    ? relative(repoRoot, path)
    : path;
  const normal = posix.normalize(inside.replaceAll('\\', '/'));
  if (normal === '.' || normal === '..' || normal.startsWith('../') || isAbsolute(normal)) return null;
  return normal.replace(/^(\.\/)+/, '');
}

/** What one listed lesson's promoted answer comes to. */
function promotedOutcome(
  lesson: InstinctRecord,
  named: string,
  changed: ChangedPaths,
  repoRoot: string,
): ConfirmedPromotion | UnpromotedLesson {
  if (!changed.ok) return { kind: 'unchecked', id: lesson.id, path: named, reason: changed.reason };
  const path = repoPath(named, repoRoot);
  return path !== null && changed.paths.has(path)
    ? { lesson, path }
    : { kind: 'unchanged', id: lesson.id, path: named };
}

/**
 * Settles every listed lesson against the block's answers and the
 * changed paths; see the module note. Pure: it reads nothing and
 * changes no value passed in.
 */
export function checkPromoted(
  lessons: readonly InstinctRecord[],
  reading: PromotedReading,
  changed: ChangedPaths,
  repoRoot: string,
): PromotedCheck {
  const answers = new Map(reading.answers.map((answer) => [answer.id, answer]));
  const listed = new Set(lessons.map((lesson) => lesson.id));
  const promoted: ConfirmedPromotion[] = [];
  const skipped: SkippedWithReason[] = [];
  const unpromoted: UnpromotedLesson[] = [];
  for (const lesson of lessons) {
    const answer = answers.get(lesson.id);
    if (answer === undefined) {
      unpromoted.push({ kind: 'unanswered', id: lesson.id });
    } else if (answer.kind === 'skipped') {
      skipped.push(answer);
    } else {
      const outcome = promotedOutcome(lesson, answer.path, changed, repoRoot);
      if ('lesson' in outcome) promoted.push(outcome);
      else unpromoted.push(outcome);
    }
  }
  const unlisted = reading.answers.map((answer) => answer.id).filter((id) => !listed.has(id));
  return { promoted, skipped, unpromoted, unlisted };
}

/** One lesson as the pull request line names it. */
function unpromotedPhrase(lesson: UnpromotedLesson, head: string | null): string {
  if (lesson.kind === 'unanswered') return `\`${lesson.id}\` (no answer in the \`rafa:promoted\` block)`;
  if (lesson.kind === 'unchecked') return `\`${lesson.id}\` (names \`${lesson.path}\`, which could not be checked: ${lesson.reason})`;
  const since = head === null
    ? 'before the session'
    : head.slice(0, 7);
  return `\`${lesson.id}\` (names \`${lesson.path}\`, which has not changed since ${since})`;
}

/**
 * The one pull request line naming every lesson the pull request does
 * not carry, or null when there is none. `head` is the pre-session
 * commit the unchanged paths were compared against.
 */
export function unpromotedLine(check: PromotedCheck, head: string | null): string | null {
  if (check.unpromoted.length === 0) return null;
  const named = check.unpromoted.map((lesson) => unpromotedPhrase(lesson, head)).join('; ');
  return `Lessons listed for promotion that this pull request does not carry: ${named}.`;
}

/**
 * Sets `promoted_to` on each confirmed lesson by pushing it back from a
 * source it already holds; see the module note. Answers one problem per
 * lesson whose push was refused, and never throws.
 */
export async function recordPromotions(
  learning: Learning,
  promoted: readonly ConfirmedPromotion[],
): Promise<readonly string[]> {
  const problems: string[] = [];
  for (const { lesson, path } of promoted) {
    const sourceId = lesson.sources?.[0] ?? lesson.id;
    try {
      await learning.push({ source_id: sourceId, instincts: [{ ...lesson, promoted_to: path }] });
    } catch (error) {
      problems.push(`\`${lesson.id}\` is in ${path}, but its promoted_to could not be recorded: ${messageOf(error)}`);
    }
  }
  return problems;
}

/** Where the line went: the pull request it is now in, or why none. */
export type UnpromotedReport =
  | { readonly written: true; readonly number: number; readonly already: boolean }
  | { readonly written: false; readonly problem: string };

/**
 * Appends `line` to the body of the open pull request of `branch` with
 * `gh pr edit`, unless the body already carries it. Never throws.
 */
export async function reportUnpromoted(
  pulls: PullRequests,
  branch: string,
  line: string,
): Promise<UnpromotedReport> {
  try {
    const found = await pulls.findOpen(branch);
    if (found === null) return { written: false, problem: `no open pull request was found for ${branch}` };
    const detail = await pulls.get(found.number);
    if (detail === null) return { written: false, problem: `pull request #${found.number} could not be read back` };
    if (detail.body.includes(line)) return { written: true, number: found.number, already: true };
    await pulls.editBody(found.number, bodyWithSentence(detail.body, line));
    return { written: true, number: found.number, already: false };
  } catch (error) {
    return { written: false, problem: `the pull request body could not be written: ${messageOf(error)}` };
  }
}

/** What {@link checkWrapUpAnswer} is handed. */
export interface WrapUpAnswerInput {
  /** The lessons the prompt listed, in its order. */
  readonly lessons: readonly InstinctRecord[];
  /** The session's captured output, which holds the block. */
  readonly output: string;
  /** The commit HEAD named before the session, or null when unread. */
  readonly head: string | null;
  /** The repository root the named paths are relative to. */
  readonly repoRoot: string;
  /** The branch whose pull request carries the line. */
  readonly branch: string;
  /** Git, run at `repoRoot`. */
  readonly git: GitRunner;
  /** The pull request provider the line is written through. */
  readonly pulls: PullRequests;
  /** Makes the adapter `promoted_to` is pushed to. May throw. */
  readonly learning: () => Learning;
}

/** Warns about every line of the block that settled no listed lesson. */
function warnAboutBlock(reading: PromotedReading, check: PromotedCheck): void {
  const out = activeOutput();
  if (reading.status === 'absent') out.warn('   The wrap-up session wrote no `rafa:promoted` block.');
  if (reading.status === 'unclosed') out.warn('   The wrap-up session\'s `rafa:promoted` block is never closed, so none of it was read.');
  for (const line of reading.unreadable) out.warn(`   \`rafa:promoted\` line ${line.line} was not read: ${line.reason}.`);
  for (const id of check.unlisted) out.warn(`   The \`rafa:promoted\` block answers \`${id}\`, which the wrap-up did not list.`);
}

/** Pushes `promoted_to` for every confirmed promotion, warning on each refusal. */
async function recordConfirmed(input: WrapUpAnswerInput, check: PromotedCheck): Promise<void> {
  const out = activeOutput();
  if (check.promoted.length === 0) return;
  let learning: Learning;
  try {
    learning = input.learning();
  } catch (error) {
    out.warn(`   No lesson's promoted_to was recorded: the learning adapter could not be made: ${messageOf(error)}`);
    return;
  }
  for (const problem of await recordPromotions(learning, check.promoted)) out.warn(`   ${problem}`);
  for (const { lesson, path } of check.promoted) out.info(`   Lesson \`${lesson.id}\` promoted to ${path}.`);
}

/**
 * Reads the block out of the session's output, checks it, records every
 * confirmed promotion and puts the line in the pull request body.
 * Answers the check. Never throws; see the module note.
 */
export async function checkWrapUpAnswer(input: WrapUpAnswerInput): Promise<PromotedCheck> {
  const out = activeOutput();
  const reading = parsePromoted(input.output);
  const changed = changedSince(input.git, input.head);
  const check = checkPromoted(input.lessons, reading, changed, input.repoRoot);
  warnAboutBlock(reading, check);
  if (!changed.ok && reading.answers.some((answer) => answer.kind === 'promoted')) {
    out.warn(`   No promoted path could be checked: ${changed.reason}.`);
  }
  await recordConfirmed(input, check);

  const line = unpromotedLine(check, input.head);
  if (line === null) return check;
  const report = await reportUnpromoted(input.pulls, input.branch, line);
  if (!report.written) {
    out.warn(`   This line is not in the pull request body, as ${report.problem}: ${line}`);
  } else if (report.already) {
    out.info(`   Pull request #${report.number} already names the lessons it does not carry.`);
  } else {
    out.info(`   Pull request #${report.number} now names the lessons it does not carry.`);
  }
  return check;
}
