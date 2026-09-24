/**
 * The standing notices: what a person should know before rafa spends a
 * session on their machine, and how they stop being told.
 *
 * Two notices exist, and both are about consent rather than about a
 * fault:
 *
 *  - `alpha`: the package is alpha software. It says so once, with the
 *    place feedback goes, so an unfinished edge reads as expected.
 *  - `danger`: every session rafa spawns runs with
 *    `--dangerously-skip-permissions` (`src/utils/claude.ts`), which is
 *    what lets a run go unattended and is also what lets a task edit,
 *    delete and run anything the user's account can. A run also pushes
 *    branches, opens pull requests and may file issues under that
 *    account. The README says it; this says it where it happens.
 *
 * ## The shape
 *
 * ```text
 * readDismissed(home)            → the ids a person asked not to see again
 * pendingNotices(dismissed)      → the notices still owed
 * noticeLines(notice, version)   → the text, one array per notice
 * readNoticeAnswer(answer)       → continue | cancel | dismiss
 * offerNotices(request, seams)   → 'continue' | 'cancelled'
 * ```
 *
 * Everything above `offerNotices` is pure or reads one file, so
 * `./notices.test.ts` drives it from literals and a temporary home.
 *
 * ## With a terminal and without
 *
 * On a terminal the pending notices are printed and ONE question
 * follows: continue, cancel, or continue and do not show them again.
 * Anything that is not a yes or a dismissal is a cancel, the same rule
 * `[y/N]` follows everywhere else: an ended input or an empty line
 * never starts a run.
 *
 * Without a terminal nothing can be asked, and a loop is usually started
 * that way on purpose (a schedule, a detached run). The notices are
 * printed as warnings and the run continues: refusing would break every
 * unattended run on the day this shipped, and staying silent would
 * remove the one place the danger is stated at the moment it applies.
 *
 * ## Where the dismissal lives
 *
 * `<home>/.rafa/notices.json`, `{"dismissed": ["alpha", "danger"]}`. It
 * is the user's and not the project's: the notices are about the
 * machine and the account, which a second project on the same machine
 * shares. A file that cannot be read or parsed dismisses nothing, so a
 * damaged file errs toward telling. A write that fails is reported and
 * the run continues, since the person did answer yes.
 */
import type { Prompter } from '../cli/prompt/confirm.js';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { messageOf } from '../config-sections.js';

/** The notices rafa can owe a person, in the order they are printed. */
export const NOTICE_IDS = Object.freeze(['alpha', 'danger'] as const);

/** One notice's id. */
export type NoticeId = typeof NOTICE_IDS[number];

/** Where feedback and bug reports go. */
export const FEEDBACK_URL = 'https://github.com/open-tomato/rafa/issues/new/choose';

/** Where the roadmap is kept. */
export const ROADMAP_URL = 'https://github.com/open-tomato/rafa/issues/31';

/** The dismissal file, under the user scope. */
export function noticesPath(home: string): string {
  return join(home, '.rafa', 'notices.json');
}

/** Whether `value` is a notice id this build knows. */
function isNoticeId(value: unknown): value is NoticeId {
  return typeof value === 'string' && (NOTICE_IDS as readonly string[]).includes(value);
}

/**
 * The ids dismissed under `home`. A missing, unreadable or malformed
 * file dismisses nothing; an id this build does not know is dropped.
 */
export function readDismissed(home: string): readonly NoticeId[] {
  let raw: string;
  try {
    raw = readFileSync(noticesPath(home), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const dismissed: unknown = (parsed as { dismissed?: unknown }).dismissed;
    if (!Array.isArray(dismissed)) return [];
    return NOTICE_IDS.filter((id) => dismissed.some((entry) => isNoticeId(entry) && entry === id));
  } catch {
    return [];
  }
}

/** Records `ids` as dismissed under `home`, beside any already there. */
export function writeDismissed(home: string, ids: readonly NoticeId[]): void {
  const all = NOTICE_IDS.filter((id) => ids.includes(id) || readDismissed(home).includes(id));
  const path = noticesPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ dismissed: all }, null, 2)}\n`);
}

/** The notices still owed, in {@link NOTICE_IDS} order. */
export function pendingNotices(dismissed: readonly NoticeId[]): readonly NoticeId[] {
  return NOTICE_IDS.filter((id) => !dismissed.includes(id));
}

/** The lines one notice prints. `version` is the running build's. */
export function noticeLines(notice: NoticeId, version: string): readonly string[] {
  if (notice === 'alpha') {
    return [
      `⚠️  rafa ${version} is alpha software: commands, files and defaults still change between versions.`,
      `   Feedback and bugs: ${FEEDBACK_URL}`,
      `   What is planned:   ${ROADMAP_URL}`,
    ];
  }
  return [
    '⚠️  Every Claude Code session rafa starts runs with --dangerously-skip-permissions.',
    '   A task can edit, delete and run anything your account can, with no question asked.',
    '   A run also commits, pushes its branch, opens a pull request and may file issues under',
    '   your GitHub account. Run it in a repository and on a machine where that is acceptable.',
  ];
}

/** What a person answered to the one question. */
export type NoticeAnswer = 'continue' | 'cancel' | 'dismiss';

/** The question asked once the pending notices are printed. */
export const NOTICE_QUESTION = 'Continue? [y] yes  [d] yes, and do not show this again  [N] cancel: ';

/**
 * Reads an answer. `y` and `yes` continue, `d` and `dismiss` continue
 * and dismiss; anything else, an empty line and an ended input cancel.
 */
export function readNoticeAnswer(answer: string | null): NoticeAnswer {
  const said = (answer ?? '').trim().toLowerCase();
  if (said === 'y' || said === 'yes') return 'continue';
  if (said === 'd' || said === 'dismiss') return 'dismiss';
  return 'cancel';
}

/** What {@link offerNotices} needs to know. */
export interface NoticeRequest {
  /** The user's home, where the dismissal file lives. */
  readonly home: string;
  /** The running build's version, for the alpha line. */
  readonly version: string;
}

/** The outside of {@link offerNotices}; every member has a default. */
export interface NoticeSeams {
  /** Whether a question can be asked. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the question is asked through. */
  readonly openPrompter: () => Prompter;
  /** Prints a line when nothing can be asked. */
  readonly warn: (line: string) => void;
}

/** Whether the run goes on. */
export type NoticeOutcome = 'continue' | 'cancelled';

/**
 * Prints the pending notices and, on a terminal, asks the one question.
 * See the module note for the two modes.
 */
export async function offerNotices(request: NoticeRequest, seams: NoticeSeams): Promise<NoticeOutcome> {
  const pending = pendingNotices(readDismissed(request.home));
  if (pending.length === 0) return 'continue';
  const lines = pending.flatMap((notice) => [...noticeLines(notice, request.version), '']);

  if (!seams.isTerminal()) {
    for (const line of lines) seams.warn(line);
    return 'continue';
  }

  const prompter = seams.openPrompter();
  try {
    prompter.say(lines.join('\n'));
    const answer = readNoticeAnswer(await prompter.ask(NOTICE_QUESTION));
    if (answer === 'cancel') return 'cancelled';
    if (answer === 'dismiss') {
      try {
        writeDismissed(request.home, pending);
      } catch (error) {
        prompter.say(`   Could not record that in ${noticesPath(request.home)}: ${messageOf(error)}`);
      }
    }
    return 'continue';
  } finally {
    prompter.close();
  }
}
