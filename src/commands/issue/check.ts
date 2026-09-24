/**
 * `rafa issue check <n> [--stamp]`: the references issue `<n>`'s saved
 * copy names, each printed with its state, on demand and with no plan
 * written (`.rafa/specs/rafa-151-references-specs-bugs-are.md`). It is
 * the reading check 4 of the readiness gate refuses on, and it refuses
 * on none of it: the exit code is 0 whatever the states are. It starts
 * no Claude session, so it declares no `spends`.
 *
 * ## The saved copy
 *
 * The copy is found by number, not by title, so no board read is spent
 * on finding it: the one file under `specs.dir` (resolved against the
 * project root) named `rafa-<n>-<slug>.md`, the local notes file
 * `rafa-<n>-notes.md` aside. A copy is written by `plan create
 * --issue=<n>`, so none there is refused with exit code 1 and that
 * spelling. Two there — an issue retitled after its copy was written
 * leaves the old name beside the new — is refused with exit code 1
 * naming both, since reading either could read the copy the gate does
 * not.
 *
 * ## The reading
 *
 * Without `--stamp` it is `readCopyRefs` (`src/refs/reading.ts`): each
 * reference read against the stamp the copy keeps, and a reference it
 * keeps none for stamped on this read and reported `ok` — a copy
 * written before stamps existed reads all `ok` on its first check. That
 * first stamp is written back into the copy, which is the one write a
 * plain check makes.
 *
 * With `--stamp` every reference is re-stamped with its live
 * fingerprint (`restampCopyRefs`), `absent` for a missing target, so the
 * next check reads each `ok` but an `unknown` one. The rows it prints
 * are read against the stamps the copy held BEFORE, so what was
 * accepted is shown rather than hidden, and a line after them counts
 * what was re-stamped. The two readings share one memoised verifier
 * (`memoiseVerifier`), so a target is read once.
 *
 * The targets are read by the verifier `plan create`'s check 4 builds
 * (`createPlanRefsVerifier`, `gh`, `git`, `ts-symbols` and the core
 * roster at the project root), or by {@link IssueCheckSeams.verifier}.
 * A board issue `gh` could not read and a refs block the codec will not
 * read are refused with exit code 1 and the error's own words.
 *
 * ## What it writes
 *
 * Text mode: the copy's path, one line per reference, `<state> <kind>
 * <text> (line <n>)`, with the changed headings of a suspect or resolved
 * issue, a resolved one's `rafa issue unblock <n>` and why an unknown
 * one is not checked, then the count per state and, under `--stamp`,
 * the re-stamp line. Json mode: an {@link IssueCheckResult} as the
 * terminal result's `data`, each reference carrying `kind`, `text`,
 * `line`, `state`, `fingerprint` and `stamp` as one word each
 * (`fingerprintText`, `unreadable` for a target that could not be read).
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RefRow } from '../../refs/reading.js';
import type { LiveReading, RefState } from '../../refs/stamp.js';
import type { RefVerifier } from '../../refs/verify.js';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { boardId, notesFileName, SPEC_EXTENSION } from '../../board/naming.js';
import { memoiseVerifier } from '../../board/refs-gate.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { readCopyRefs, readRefsText, restampCopyRefs } from '../../refs/reading.js';
import { fingerprintText, RefsBlockError } from '../../refs/stamp.js';
import { RefVerifyError } from '../../refs/verify.js';
import { readSwitch } from '../plan/plan-files.js';
import { createPlanRefsVerifier } from '../plan/refs-check.js';

import { issueProject, issueSubjectConfig, lineRefusal } from './issue-tracker.js';

/** The usage line a refusal names. */
export const CHECK_USAGE = 'rafa issue check <n> [--stamp]';

/** The flag that re-stamps every reference. */
export const STAMP_FLAG = 'stamp';

/** A whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** The states in the order the count line names them. */
const STATE_ORDER: readonly RefState[] = ['ok', 'dangling', 'suspect', 'resolved', 'unknown'];

/** One reference as json mode gives it. */
export interface CheckedRef {
  readonly kind: RefRow['kind'];
  readonly text: string;
  readonly line: number;
  readonly state: RefState;
  /** The target as it reads now, as one word. */
  readonly fingerprint: string;
  /** The stamp the copy holds it to after this run, as one word, or null. */
  readonly stamp: string | null;
  readonly changedHeadings: readonly string[];
  readonly unblock: string | null;
}

/** What json mode gives as the terminal result's `data`. */
export interface IssueCheckResult {
  readonly issue: number;
  /** The saved copy, under `specs.dir` as configured. */
  readonly path: string;
  /** True under `--stamp`. */
  readonly stamped: boolean;
  readonly references: readonly CheckedRef[];
}

/** How the targets are read; each left out is the command's own. */
export interface IssueCheckSeams {
  /** Makes the verifier for a project root; `createPlanRefsVerifier` when left out. */
  readonly verifier?: (repoRoot: string) => RefVerifier;
}

/** The issue number a line names, or a refusal with exit code 1 naming the usage. */
export function readCheckIssue(args: readonly string[]): number {
  if (args.length > 1) {
    throw lineRefusal(`Expected one issue number, got ${String(args.length)}: ${args.join(' ')}`, CHECK_USAGE);
  }
  const word = args[0];
  if (word === undefined) throw lineRefusal('Name the issue number to check', CHECK_USAGE);
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no issue number, which is a whole number from 1`, CHECK_USAGE);
  }
  return Number(word);
}

/** The sentence a missing saved copy is refused with. */
export function missingCopyMessage(issue: number, specsDir: string): string {
  const n = String(issue);
  return `❌ Issue #${n} has no saved copy under ${specsDir}: rafa plan create --issue=${n} writes one.`;
}

/** The names under `dir` a saved copy of `issue` may carry; none when `dir` does not exist. */
function copyNames(dir: string, issue: number): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const prefix = `${boardId(issue)}-`;
  const notes = notesFileName(issue);
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith(SPEC_EXTENSION) && name !== notes)
    .filter((name) => name.length > prefix.length + SPEC_EXTENSION.length)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

/**
 * The saved copy of `issue` under `specsDir`, read against `root`: its
 * path as configured and resolved. Refuses none and two with exit code
 * 1; see the module note.
 */
export function findSavedCopy(root: string, specsDir: string, issue: number): { readonly path: string; readonly absolute: string } {
  const names = copyNames(resolve(root, specsDir), issue);
  const [only] = names;
  if (only === undefined) throw new CommandExit(1, missingCopyMessage(issue, specsDir));
  if (names.length > 1) {
    throw new CommandExit(1, [
      `❌ Issue #${String(issue)} has ${String(names.length)} saved copies under ${specsDir}; remove the stale one:`,
      ...names.map((name) => `   ${join(specsDir, name)}`),
    ].join('\n'));
  }
  const path = join(specsDir, only);
  return { path, absolute: resolve(root, path) };
}

/** A reading as one word. */
function liveText(live: LiveReading): string {
  return live.kind === 'unreadable'
    ? 'unreadable'
    : fingerprintText(live);
}

/** One row as json mode gives it, held to `stamp`. */
function checkedRef(row: RefRow, stamp: RefRow['stamp']): CheckedRef {
  return Object.freeze({
    kind: row.kind,
    text: row.text,
    line: row.line,
    state: row.state,
    fingerprint: liveText(row.fingerprint),
    stamp: stamp === null
      ? null
      : fingerprintText(stamp),
    changedHeadings: row.changedHeadings,
    unblock: row.unblock,
  });
}

/** What follows a row's text: its changed headings, its unblock command, or why it is not checked. */
function rowSuffix(ref: CheckedRef): string {
  const noun = ref.changedHeadings.length === 1
    ? 'heading'
    : 'headings';
  const headings = ref.changedHeadings.length === 0
    ? ''
    : `: ${noun} ${ref.changedHeadings.map((heading) => `"${heading}"`).join(', ')} changed`;
  const after = ref.unblock === null
    ? ''
    : ` — ${ref.unblock}`;
  const unknown = ref.state === 'unknown'
    ? ' — its repository could not be read, so it is not checked'
    : '';
  return `${headings} (line ${String(ref.line)})${after}${unknown}`;
}

/** The line text mode prints for one reference. */
export function checkedRefLine(ref: CheckedRef): string {
  return `${ref.state} ${ref.kind} ${ref.text}${rowSuffix(ref)}`;
}

/** The count line: `3 references: 2 ok, 1 suspect`. */
export function countLine(references: readonly CheckedRef[]): string {
  const noun = references.length === 1
    ? 'reference'
    : 'references';
  const counts = STATE_ORDER
    .map((state) => [state, references.filter((ref) => ref.state === state).length] as const)
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${String(count)} ${state}`);
  return counts.length === 0
    ? 'No references.'
    : `${String(references.length)} ${noun}: ${counts.join(', ')}`;
}

/** The lines text mode prints for a result. */
export function renderCheck(result: IssueCheckResult): string[] {
  const noun = result.references.length === 1
    ? 'reference'
    : 'references';
  const stamped = result.stamped
    ? [`🔖 Re-stamped ${String(result.references.length)} ${noun} of issue #${String(result.issue)}; the next check reads them against what they hold now.`]
    : [];
  return [
    `Issue #${String(result.issue)}: ${result.path}`,
    ...result.references.map(checkedRefLine),
    countLine(result.references),
    ...stamped,
  ];
}

/** The references of the copy at `absolute`, read, or read and re-stamped under `stamp`. */
async function readReferences(absolute: string, issue: number, verify: RefVerifier, stamp: boolean): Promise<readonly CheckedRef[]> {
  if (!stamp) {
    const { rows } = await readCopyRefs({ path: absolute, issue, verify });
    return rows.map((row) => checkedRef(row, row.stamp));
  }
  const once = memoiseVerifier(verify);
  const before = await readRefsText({ copy: readFileSync(absolute, 'utf8'), issue, verify: once });
  const after = await restampCopyRefs({ path: absolute, issue, verify: once });
  return before.rows.map((row, index) => checkedRef(row, after.rows[index]?.stamp ?? null));
}

/** Reads the references of the saved copy a line names; see the module note. */
export async function checkIssue(context: RafaContext, seams: IssueCheckSeams = {}): Promise<IssueCheckResult> {
  const stamp = readSwitch(STAMP_FLAG, context.flags[STAMP_FLAG], `Write it after the issue number: rafa issue check <n> --${STAMP_FLAG}.`);
  const issue = readCheckIssue(context.args);
  const project = issueProject(context);
  const config = issueSubjectConfig(project, (message) => {
    context.output.warn(message);
  });
  const copy = findSavedCopy(project.root, config.specsDir, issue);
  const verify = (seams.verifier ?? createPlanRefsVerifier)(project.root);
  try {
    const references = await readReferences(copy.absolute, issue, verify, stamp);
    return Object.freeze({ issue, path: copy.path, stamped: stamp, references: Object.freeze(references) });
  } catch (error) {
    if (error instanceof RefVerifyError || error instanceof RefsBlockError) {
      throw new CommandExit(1, `❌ The references of issue #${String(issue)} could not be read: ${messageOf(error)}`);
    }
    throw error;
  }
}

/** The command, reading the targets with `seams`; see the module note. */
export function createIssueCheckCommand(seams: IssueCheckSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'issue check',
    subject: 'issue',
    action: 'check',
    summary: 'read the references a spec\'s saved copy names, each with its state',
    description: 'Reads the saved copy of issue <n> under `specs.dir` and prints every reference it names — an'
      + ' issue, a file, an exported symbol, a command, a flag, a config key — with its state against the'
      + ' stamp the copy keeps: ok, dangling, suspect, resolved or unknown. A reference the copy keeps no'
      + ' stamp for is stamped on this read. Exits 0 whatever the states are, and plans nothing. A missing'
      + ' saved copy is refused, naming the `rafa plan create --issue=<n>` that writes one. With'
      + ' `--output=json` every reference, with its kind, line, state and fingerprint, is the data of the'
      + ' terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number on the GitHub board whose saved copy is read.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: STAMP_FLAG,
        description: 'Re-stamp every reference with what its target holds now, so the next check reads each one ok.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa issue check 151',
        note: 'Prints each reference the saved copy of #151 names with its state, and a count per state.',
      },
      {
        cmd: 'rafa issue check 151 --stamp',
        note: 'Prints the same reading, then re-stamps every reference as reviewed without planning.',
      },
      {
        cmd: 'rafa issue check 151 --output=json',
        note: 'Writes a start event, then a result event whose data lists every reference with its kind, line, state and fingerprint.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await checkIssue(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      for (const line of renderCheck(result)) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

export default createIssueCheckCommand();
