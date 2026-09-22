/**
 * The one spec a `plan create` run plans from, whichever of the three
 * flags named it: `--spec=<file>`, `--issue=<n>` or `--next`.
 *
 * `plan create` ends in a planner session that reads a FILE
 * (`.rafa/specs/rafa-20-pr-commands.md`), and the three flags are three ways
 * of naming one. This module is the funnel: it reads the words off the
 * command line, refuses a line naming more than one of them, and
 * answers a spec path with the issue it came from, so everything after
 * it — the stub, the prompt, the session, the stamp and the classifier
 * keys — is what `--spec` already produced.
 *
 * The routes converge rather than branching:
 *
 * ```text
 * --spec=<file>   findSpec(value)                          ─┐
 * --issue=<n>     read n  → checks → snapshot under specs.dir ├→ one spec path
 * --next[=<r>]    pick n  → read n → checks → snapshot      ─┘
 * ```
 *
 * `--next` is `--issue` with the number read off the roadmap rather
 * than typed, which is why the two share every line below the pick.
 *
 * Nothing here spawns and nothing here reads a flag it was not handed.
 * The issue arrives through `./issue.ts`'s {@link SpecIssueReader}, the
 * roadmap through `./roadmap.ts`'s seams and git through the
 * {@link GitRunner} declared in `src/pr/git.ts`, so every case in
 * `./spec-source.test.ts` drives fakes of its own and writes in its own
 * temporary directory: none reaches GitHub, spawns `gh` or `git`, or
 * touches a real home.
 *
 * ## Mutual exclusion, and what it costs to get wrong
 *
 * The three flags are mutually exclusive
 * (`.rafa/specs/rafa-20-pr-commands.md`). A line naming two is REFUSED
 * ({@link severalSourcesMessage}) rather than resolved by ranking one
 * over the others, because both readings of `--issue=20 --next` are
 * plausible — plan issue 20, or plan whatever is next — and a run that
 * quietly picks the other one snapshots a body the operator did not
 * ask for and starts a session on it.
 *
 * The refusals here exit {@link SOURCE_REFUSAL_EXIT}, 1, and not the 2
 * the board's own refusals carry (`./issue.ts`, `./roadmap.ts`): these
 * are about the WORDS TYPED, which is what `plan create` already exits
 * 1 for (`context/cli.md`), while a closed issue or a missing roadmap
 * is about the board's state.
 *
 * ## Where the checks go
 *
 * The readiness gate's cheap checks — trust, the `spec:ready` label,
 * the leak refusal and the completeness gaps — run BETWEEN the issue
 * being read and its body being snapshotted (`./issue.ts`), and they
 * are the caller's to compose: which of them a route runs, and what it
 * publishes on a refusal, is `plan create`'s policy. So this module
 * takes them as ONE seam, {@link SpecSourceOptions.inspect}, called
 * with the issue as read, after {@link requireSpecIssue} and before a
 * byte is written.
 *
 * A seam is what the ordering demands: a caller that wanted to run its
 * own checks would otherwise need the read and the write as two calls,
 * and this module exists precisely to hand back one path.
 *
 * That placement is also what makes `--next` STOP at a line that is not
 * ready rather than skip past it, which the spec asks for in so many
 * words: `inspect` throws, the throw leaves the walk finished, and
 * nothing here catches it to try the line below. Skipping ahead would
 * reorder the roadmap with nobody saying so.
 *
 * ## The one line the walk moves past, and what moves it
 *
 * A BLOCKED pick is the exception, and it is one because an operator
 * said yes to it. A line whose issue carries `spec:blocked` with a
 * blocker still open is work that cannot start whatever anyone types,
 * so the run neither plans it nor stops silently: it names what the
 * line waits on ({@link blockedPickLine}, `#57 is blocked by #24
 * (open)`), walks on for the first line under it that is ready, not
 * blocked and not taken (`./blocked-line.ts`), names that one by number
 * and asks. Only a yes plans it; no answer, no alternative on the
 * roadmap and no terminal to ask on each end the run with a sentence
 * saying which, and all three stop at {@link SpecSourceStop} `blocked`.
 *
 * So the rule above holds where it is about the roadmap's order: the
 * walk reorders nothing by itself, and the only thing that moves past a
 * line is an answer. A run handed no offer
 * ({@link RoadmapSeams.offerAlternative}) plans nothing at all, which is
 * what a `--dry-run` run and a run with no terminal both get
 * (`./plan-spec.ts`).
 *
 * The blocked reading costs NO command of its own: the label and the
 * `Blocked by:` line are read off the issue the walk already read to
 * ask whether it was closed, and each blocker's state goes through the
 * same memoised reader.
 *
 * It runs BEFORE {@link SpecSourceOptions.inspect}, so a blocked pick is
 * never offered the `spec:ready` label on its way past: that offer is a
 * question about whether the spec may be planned, and this line is not
 * about to be planned whatever the answer. The line the offer names goes
 * through `inspect` in full, exactly as a typed `--issue=<n>` would.
 *
 * ## The roadmap's own body, and why it has a seam of its own
 *
 * `inspect` runs on the line the walk PICKS. The roadmap is a second
 * body the `--next` route reads, and it is board text as much as the
 * spec is: what its lines decide is the ORDER, so whoever can write it
 * can point the next session at an issue of their choosing.
 *
 * It goes through {@link RoadmapSeams.inspectRoadmap} rather than
 * through `inspect`, because the two bodies are asked different
 * questions. The roadmap carries no `spec:ready` label, fills no spec
 * template and is never snapshotted, so the checks `inspect` composes
 * would refuse every roadmap there is; what is left to ask about it is
 * its AUTHOR, and that is the caller's to compose too
 * (`./plan-spec.ts`).
 *
 * It is called on the issue as READ and before a line is parsed out of
 * it, which is also before the branch scan and the pull request list
 * are spent: a roadmap whose author the caller refuses costs the read
 * that found the author and nothing else, and no line of it reaches
 * the walk, the output or a snapshot.
 *
 * ## One read per issue
 *
 * The `--next` walk asks `isClosed` about every line it passes and
 * about the line it picks, and the pick is then read AGAIN for its
 * title and body. That is one `gh issue view` per issue too many, so
 * the reader is memoised for the length of one resolution
 * ({@link memoiseIssues}) and the walk and the snapshot share the
 * answer. `./spec-source.test.ts` counts the reads rather than assuming
 * it: a memo that stopped working costs a call per line and changes no
 * answer, so nothing but a count can see it.
 *
 * The memo lives for one call. An issue edited mid-run is not a case
 * worth a second read, and a memo held across runs would serve a stale
 * body to the next one.
 *
 * ## What `--dry-run` does, and does not
 *
 * It does every READ and every REFUSAL, and stops before the first
 * WRITE: no snapshot, no session, and no question about a saved copy
 * the issue has changed since (below). The spec asks for it on `--next`
 * ("prints the pick and stops"), and it behaves the same on the other
 * two, because a flag that works on one route and is ignored on the
 * others is a flag an operator has to remember the shape of.
 *
 * Running the refusals under it is the point rather than a side
 * effect: `plan create --next --dry-run` is how a person asks "what
 * would this run do", and "it would refuse, because issue #33 is not
 * labelled spec:ready" is the useful half of that answer.
 *
 * ## A saved copy the issue no longer matches
 *
 * The snapshot is written by `settleSpecSnapshot` (`./snapshot-settle.ts`)
 * rather than by the bare `writeSpecSnapshot`, and at the same place the
 * bare write stood: after {@link requireSpecIssue}, after
 * {@link SpecSourceOptions.inspect} and after the `--dry-run` stop. So
 * every check reads the body as it reads NOW before a saved copy is
 * compared or a question asked, and a yes skips none of them.
 *
 * A copy that differs has its difference lines printed first. A
 * notes-only change is rebuilt without asking; a body change is rebuilt
 * under `--refresh`, handed to {@link SpecSourceOptions.offerRefresh}
 * otherwise, and refused with `snapshotDiffersMessage` on a no, an ended
 * input or no offer at all — the refusal a changed body always met. The
 * offer is a seam this module only passes on; `./plan-spec.ts` hands
 * none under `--dry-run`, and this module never reaches it there.
 *
 * ## The branch scan's problems are printed, never swallowed
 *
 * `scanClaimBranches` carries a failed remote read out as sentences
 * rather than throwing, because "nothing is taken" read off a check
 * that never ran is how two people end up on one spec
 * (`./roadmap.ts`). This module is the caller that decides what to do
 * with them, and the policy is: WARN each one and carry on. The walk
 * still has the local half, the operator is told which half is
 * missing, and a laptop with no network still plans.
 */
import type { AlternativeOffer, BlockedLine, PassedLine, PlannableReadings } from './blocked-line.js';
import type { SpecIssue, SpecIssueReader, SpecSnapshot } from './issue.js';
import type {
  OpenPullRequestLister,
  RoadmapLine,
  RoadmapReadings,
  RoadmapSearch,
  RoadmapSkip,
} from './roadmap.js';
import type { RefreshOffer } from './snapshot-settle.js';
import type { Output } from '../ports/index.js';
import type { GitRunner } from '../pr/git.js';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';

import {
  blockedLineSentence,
  blockerStatesOf,
  declinedMessage,
  noAlternativeMessage,
  pickPlannableLine,
  plannableReadings,
  readBlockedLine,
  unaskedMessage,
} from './blocked-line.js';
import {
  DRY_RUN_FLAG,
  ISSUE_FLAG,
  NEXT_FLAG,
  REFRESH_FLAG,
  SPEC_FLAG,
} from './flags.js';
import { requireSpecIssue } from './issue.js';
import {
  createRoadmapReadings,
  exhaustedMessage,
  parseRoadmapBody,
  pickNextRoadmapLine,
  resolveRoadmapIssue,
  scanClaimBranches,
  skipSentence,
} from './roadmap.js';
import { settleSpecSnapshot } from './snapshot-settle.js';

/** What every refusal and every failure this module raises opens with. */
const PREFIX = 'board spec source';

/**
 * The four flags this module reads, re-exported: the readings and the
 * refusals are this module's, and the words are `./flags.js`'s, which
 * records why they sit there. `--refresh` is read here too and stays
 * `./issue.ts`'s to re-export, since the rule it changes is that
 * module's.
 */
export { DRY_RUN_FLAG, ISSUE_FLAG, NEXT_FLAG, SPEC_FLAG };

/** The three flags, in the order a refusal names them. */
export const SOURCE_FLAGS: readonly string[] = [SPEC_FLAG, ISSUE_FLAG, NEXT_FLAG];

/** The exit code a command line naming no source, or several, ends with. */
export const SOURCE_REFUSAL_EXIT = 1;

/** Which of the three flags named the spec. */
export type SpecSourceKind = 'spec' | 'issue' | 'next';

/** The source one command line named. */
export type SpecSourceRequest =
  | { readonly kind: 'spec'; readonly spec: string }
  | { readonly kind: 'issue'; readonly issue: number }
  | { readonly kind: 'next'; readonly roadmap: number | null };

/** What the command line said about where the spec comes from. */
export interface SpecSourceFlags {
  /** The source named, or null when the line named none. */
  readonly request: SpecSourceRequest | null;
  /** True under `--refresh`: a snapshot that differs is rewritten. */
  readonly refresh: boolean;
  /** True under `--dry-run`: everything is read, nothing is written. */
  readonly dryRun: boolean;
}

/** The sentence a line naming more than one source is refused with. */
export function severalSourcesMessage(given: readonly string[]): string {
  const named = given.join(' and ');
  return `${named} each name a spec, and a run plans from one; drop all but one of them`;
}

/** The sentence a line naming no source at all is refused with. */
export function noSourceMessage(specsDir: string): string {
  return `no spec was named: pass ${SPEC_FLAG}=<file>.md, read against the project root`
    + ` or under specs.dir (${specsDir}), ${ISSUE_FLAG}=<n> to plan from an issue,`
    + ` or ${NEXT_FLAG} to take the first undone line of the roadmap`;
}

/** The sentence a flag given without its value is refused with. */
export function missingValueMessage(flag: string, wants: string): string {
  return `${flag} was given no value; write ${flag}=${wants}`;
}

/** The sentence a flag given something that is not an issue number is refused with. */
export function notAnIssueMessage(flag: string, value: string): string {
  return `${flag}=${value} does not name an issue; write ${flag}=<n> with a positive whole number`;
}

/** What a command line said about one flag. */
interface FlagWord {
  /** True when the flag appears at all, bare or with a value. */
  readonly given: boolean;
  /** What followed its `=`, or null when nothing did. */
  readonly value: string | null;
}

/**
 * What `args` says about `flag`. The FIRST occurrence wins, as
 * `src/plan.ts` has always read its own flags, so a line repeating one
 * reads the same here as it does there.
 */
function readFlagWord(args: readonly string[], flag: string): FlagWord {
  const valued = args.find((word) => word.startsWith(`${flag}=`));
  if (valued !== undefined) return { given: true, value: valued.slice(flag.length + 1) };
  return { given: args.includes(flag), value: null };
}

/** The issue number `word` spells, refused when it is not one. */
function issueNumberOf(word: string, flag: string): number {
  const trimmed = word.trim();
  const issue = Number.parseInt(trimmed, 10);
  if (!/^\d+$/u.test(trimmed) || !Number.isSafeInteger(issue) || issue < 1) {
    throw new CommandExit(SOURCE_REFUSAL_EXIT, notAnIssueMessage(flag, word));
  }
  return issue;
}

/** The request one given flag makes, its value checked. */
function requestOf(flag: string, word: FlagWord): SpecSourceRequest {
  if (flag === NEXT_FLAG) {
    if (word.value === null) return { kind: 'next', roadmap: null };
    if (word.value.trim() === '') {
      throw new CommandExit(SOURCE_REFUSAL_EXIT, missingValueMessage(NEXT_FLAG, '<roadmap-issue>'));
    }
    return { kind: 'next', roadmap: issueNumberOf(word.value, NEXT_FLAG) };
  }

  if (word.value === null || word.value.trim() === '') {
    const wants = flag === SPEC_FLAG
      ? '<file>.md'
      : '<n>';
    throw new CommandExit(SOURCE_REFUSAL_EXIT, missingValueMessage(flag, wants));
  }

  return flag === SPEC_FLAG
    ? { kind: 'spec', spec: word.value }
    : { kind: 'issue', issue: issueNumberOf(word.value, ISSUE_FLAG) };
}

/**
 * The source, the refresh and the dry run `args` name.
 *
 * Throws `CommandExit({@link SOURCE_REFUSAL_EXIT}, ...)` when more than
 * one of the three is given, when one of them is given without the
 * value it needs, and when `--issue` or `--next` is given something
 * that is not an issue number.
 *
 * A line naming NONE of them answers a null request rather than
 * throwing: what a command with no source says is that command's usage,
 * and {@link noSourceMessage} is here for it to say.
 */
export function readSpecSourceFlags(args: readonly string[]): SpecSourceFlags {
  const words = SOURCE_FLAGS.map((flag) => ({ flag, word: readFlagWord(args, flag) }));
  const given = words.filter((entry) => entry.word.given);
  if (given.length > 1) {
    throw new CommandExit(
      SOURCE_REFUSAL_EXIT,
      severalSourcesMessage(given.map((entry) => entry.flag)),
    );
  }

  const [only] = given;
  return Object.freeze({
    request: only === undefined
      ? null
      : requestOf(only.flag, only.word),
    refresh: args.includes(REFRESH_FLAG),
    dryRun: args.includes(DRY_RUN_FLAG),
  });
}

/** What `--next` reads the roadmap through; only that route needs it. */
export interface RoadmapSeams {
  /** `roadmap.issue` as config resolved it, or null for the titled issue. */
  readonly configured: number | null;
  /** Finds the issue titled `Roadmap` when nothing names one. */
  readonly search: RoadmapSearch;
  /** Runs the two branch reads the taken reading is taken from. */
  readonly git: GitRunner;
  /** The remote the pushed half of the scan asks; `origin` when left out. */
  readonly remote?: string;
  /** Lists the open pull requests the other taken reading is read from. */
  readonly pullRequests: OpenPullRequestLister;
  /** The checks that run on the roadmap issue as read, before a line is parsed out of it. */
  readonly inspectRoadmap?: (issue: SpecIssue) => Promise<void>;
  /**
   * Asks whether to plan the line offered in place of a blocked one;
   * left out for a run with nobody to ask, which plans nothing and says
   * so ({@link unaskedMessage}). See the blocked-line note below.
   */
  readonly offerAlternative?: AlternativeOffer;
}

/** What {@link resolveSpecSource} is asked. */
export interface SpecSourceOptions {
  /** The source the command line named, as {@link readSpecSourceFlags} read it. */
  readonly request: SpecSourceRequest;
  /** True under `--refresh`. */
  readonly refresh: boolean;
  /** True under `--dry-run`. */
  readonly dryRun: boolean;
  /** The project root every path is resolved under. */
  readonly repoRoot: string;
  /** Where snapshots live, as `specs.dir` resolved it. */
  readonly specsDir: string;
  /** Where `--spec` looks for its file; `src/commands/plan/spec-route.ts`'s own candidate rule. */
  readonly findSpec: (spec: string) => string;
  /** Reads one issue by number; memoised for the length of the call. */
  readonly issues: SpecIssueReader;
  /** The checks that run after the issue is read and before it is written. */
  readonly inspect?: (issue: SpecIssue) => Promise<void>;
  /**
   * Asks whether to plan from an issue whose body changed since its
   * saved copy; null, or left out, for a run that refuses one as it
   * always did. Never reached under `--dry-run`. See the saved-copy note.
   */
  readonly offerRefresh?: RefreshOffer | null;
  /** What `--next` needs; a `--next` resolution without it is a defect. */
  readonly roadmap?: RoadmapSeams;
  /** Where the lines go; the active output when left out. */
  readonly output?: Output;
}

/** The one spec a run plans from, and where it came from. */
export interface ResolvedSpec {
  /** The spec as the planner is handed it: against the project root, or absolute. */
  readonly path: string;
  /** Which flag named it. */
  readonly kind: SpecSourceKind;
  /** What a refusal calls it: `issue #20`, or the path. */
  readonly source: string;
  /** The issue it was read off, or null under `--spec`. */
  readonly issue: number | null;
  /** The issue as read, or null under `--spec`. */
  readonly read: SpecIssue | null;
  /** The snapshot written, or null under `--spec`. */
  readonly snapshot: SpecSnapshot | null;
}

/** Why a resolution stopped without a spec. */
export type SpecSourceStop = 'dry-run' | 'exhausted' | 'blocked';

/** What a resolution answers: one spec, or a reason it stopped. */
export type SpecSourceResolution =
  | { readonly outcome: 'spec'; readonly spec: ResolvedSpec }
  | { readonly outcome: 'stopped'; readonly reason: SpecSourceStop };

/** The line a `--next` walk opens with, naming the roadmap it is reading. */
export function roadmapHeaderLine(roadmap: number): string {
  return `🗺  Reading the roadmap, issue #${String(roadmap)}, for the next spec...`;
}

/** The line one skipped roadmap line prints; `./roadmap.ts` spells the sentence. */
export function skipLine(skip: RoadmapSkip): string {
  return `   ⏭  ${skipSentence(skip)}`;
}

/** The line the pick prints, with the roadmap's own one-line why when it has one. */
export function pickLine(line: RoadmapLine): string {
  const id = `▶ Next on the roadmap: issue #${String(line.issue)}`;
  return line.why === ''
    ? id
    : `${id} — ${line.why}`;
}

/** The line a blocked pick prints, naming what it waits on. */
export function blockedPickLine(blocked: BlockedLine): string {
  return `   🚧 ${blockedLineSentence(blocked)}`;
}

/** The line one line passed on the way to the alternative prints. */
export function passedLine(passed: PassedLine): string {
  return `   ⏭  ${passed.sentence}`;
}

/** The line naming what a run would plan in place of the blocked one. */
export function alternativeLine(line: RoadmapLine): string {
  const id = `▶ Ready instead: issue #${String(line.issue)}`;
  return line.why === ''
    ? id
    : `${id} — ${line.why}`;
}

/** What the dry-run line calls an issue: its number and its title. */
export function describeIssue(issue: SpecIssue): string {
  return `issue #${String(issue.number)} "${issue.title}"`;
}

/** The line `--dry-run` stops on, naming what a real run would have planned from. */
export function dryRunLine(what: string): string {
  return `🔎 ${DRY_RUN_FLAG}: would plan from ${what}. Nothing was written.`;
}

/** A resolution that answers no spec. */
function stopped(reason: SpecSourceStop): SpecSourceResolution {
  return Object.freeze({ outcome: 'stopped' as const, reason });
}

/**
 * `issues` reading each number at most once. The module note holds why
 * the memo is taken and why it does not outlive the call.
 */
function memoiseIssues(issues: SpecIssueReader): SpecIssueReader {
  const read = new Map<number, Promise<SpecIssue>>();
  return (issue: number): Promise<SpecIssue> => {
    const taken = read.get(issue) ?? issues(issue);
    read.set(issue, taken);
    return taken;
  };
}

/** What a `--next` walk came to: the issue to plan from, or why the run stops. */
type RoadmapOutcome =
  | { readonly issue: number }
  | { readonly stop: SpecSourceStop };

/** What {@link settleBlockedPick} is handed, everything the walk already read. */
interface BlockedPickOptions {
  /** Why the line the walk picked cannot be planned. */
  readonly blocked: BlockedLine;
  /** Every line of the roadmap, in order. */
  readonly lines: readonly RoadmapLine[];
  /** The blocked line itself; the walk for an alternative resumes under it. */
  readonly line: RoadmapLine;
  /** The three readings the alternative is looked for through. */
  readonly readings: PlannableReadings;
  /** Asks whether to plan the alternative, or undefined for a run with nobody to ask. */
  readonly offer: AlternativeOffer | undefined;
  /** Where the lines go. */
  readonly output: Output;
}

/**
 * What a walk whose pick is BLOCKED comes to: the blocker named, the
 * first line under it that is ready, not blocked and not taken offered
 * by number, and the issue to plan only where the answer was yes.
 *
 * Three of the four endings plan nothing and each says which it is — no
 * alternative on the roadmap at all, nobody to ask, and an answer that
 * was not yes — because a `--next` run that printed one blocked line and
 * stopped would read as a command that did nothing. The module note
 * holds why the offer is the only thing that reorders the roadmap.
 */
async function settleBlockedPick(options: BlockedPickOptions): Promise<RoadmapOutcome> {
  const { blocked, output } = options;
  output.info(blockedPickLine(blocked));

  const plannable = await pickPlannableLine(options.lines, options.line, options.readings);
  plannable.passed.forEach((passed) => output.info(passedLine(passed)));
  if (plannable.line === null) {
    output.info(noAlternativeMessage(blocked.issue));
    return { stop: 'blocked' };
  }

  output.info(alternativeLine(plannable.line));
  const { offer } = options;
  if (offer === undefined) {
    output.info(unaskedMessage(blocked.issue, plannable.line.issue));
    return { stop: 'blocked' };
  }
  if (!await offer({ blocked, line: plannable.line })) {
    output.info(declinedMessage(plannable.line.issue));
    return { stop: 'blocked' };
  }
  return { issue: plannable.line.issue };
}

/** What the `--next` walk answers: the issue to plan from, or why it stops. */
async function pickRoadmapIssue(
  request: { readonly roadmap: number | null },
  options: SpecSourceOptions,
  issues: SpecIssueReader,
  output: Output,
): Promise<RoadmapOutcome> {
  const seams = options.roadmap;
  if (seams === undefined) {
    throw new TypeError(`${PREFIX}: ${NEXT_FLAG} was resolved with no roadmap seams`);
  }

  const roadmap = await resolveRoadmapIssue({
    configured: request.roadmap ?? seams.configured,
    search: seams.search,
  });
  output.info(roadmapHeaderLine(roadmap));

  // The roadmap as read, checked before a line is parsed out of it and
  // before either taken reading is spent. See the module note.
  const read = await issues(roadmap);
  await seams.inspectRoadmap?.(read);

  const branches = scanClaimBranches(seams.git, seams.remote);
  branches.problems.forEach((problem) => output.warn(problem));

  const readings = createRoadmapReadings({
    issues,
    branches,
    pullRequests: seams.pullRequests,
  });
  const lines = parseRoadmapBody(read.body);
  const pick = await pickNextRoadmapLine(lines, readings);
  pick.skipped.forEach((skip) => output.info(skipLine(skip)));

  if (pick.line === null) {
    output.info(exhaustedMessage(roadmap, pick.skipped));
    return { stop: 'exhausted' };
  }

  output.info(pickLine(pick.line));
  return settlePick(pick.line, { lines, issues, readings, seams, output });
}

/** What {@link settlePick} reads the picked line through. */
interface PickSettlement {
  readonly lines: readonly RoadmapLine[];
  readonly issues: SpecIssueReader;
  readonly readings: RoadmapReadings;
  readonly seams: RoadmapSeams;
  readonly output: Output;
}

/**
 * The picked line as it stands, or the blocked reading of it settled.
 *
 * The issue is read off the memoised reader the walk has been using, so
 * the label and the `Blocked by:` line cost no `gh issue view` of their
 * own: the walk read that issue to ask whether it was closed.
 */
async function settlePick(line: RoadmapLine, settlement: PickSettlement): Promise<RoadmapOutcome> {
  const { issues } = settlement;
  const blocked = await readBlockedLine(await issues(line.issue), blockerStatesOf(issues));
  if (blocked === null) return { issue: line.issue };

  return settleBlockedPick({
    blocked,
    lines: settlement.lines,
    line,
    readings: plannableReadings({ issues, readings: settlement.readings }),
    offer: settlement.seams.offerAlternative,
    output: settlement.output,
  });
}

/**
 * The spec a run plans from, whichever flag named it, or the reason the
 * run stops without one.
 *
 * `--spec` answers the file {@link SpecSourceOptions.findSpec} found.
 * `--issue` and `--next` read the issue, refuse the ones no plan may be
 * written from (`./issue.ts`), run
 * {@link SpecSourceOptions.inspect}, and snapshot the body under
 * `specs.dir` through `settleSpecSnapshot`, answering that file; a saved
 * copy whose body changed is rebuilt only under `--refresh` or on a yes
 * from {@link SpecSourceOptions.offerRefresh}. `--next` reads the number off the
 * roadmap first and prints what it skipped to reach it.
 *
 * Throws `CommandExit` for every refusal the routes carry: this
 * module's own exit {@link SOURCE_REFUSAL_EXIT}, and the board's exit 2
 * from `./issue.ts`, `./roadmap.ts` and `./snapshot-settle.ts` unchanged.
 */
export async function resolveSpecSource(options: SpecSourceOptions): Promise<SpecSourceResolution> {
  const { request, repoRoot, specsDir, refresh, dryRun } = options;
  const output = options.output ?? activeOutput();

  if (request.kind === 'spec') {
    const path = options.findSpec(request.spec);
    if (dryRun) {
      output.info(dryRunLine(path));
      return stopped('dry-run');
    }
    return Object.freeze({
      outcome: 'spec' as const,
      spec: Object.freeze({
        path,
        kind: 'spec' as const,
        source: path,
        issue: null,
        read: null,
        snapshot: null,
      }),
    });
  }

  const issues = memoiseIssues(options.issues);
  const picked: RoadmapOutcome = request.kind === 'issue'
    ? { issue: request.issue }
    : await pickRoadmapIssue(request, options, issues, output);
  if ('stop' in picked) return stopped(picked.stop);
  const number = picked.issue;

  const read = await issues(number);
  requireSpecIssue(read);
  await options.inspect?.(read);

  if (dryRun) {
    output.info(dryRunLine(describeIssue(read)));
    return stopped('dry-run');
  }

  const snapshot = await settleSpecSnapshot({
    repoRoot,
    specsDir,
    issue: read,
    refresh,
    offerRefresh: options.offerRefresh ?? null,
    output,
  });
  return Object.freeze({
    outcome: 'spec' as const,
    spec: Object.freeze({
      path: snapshot.path,
      kind: request.kind,
      source: `issue #${String(number)}`,
      issue: number,
      read,
      snapshot,
    }),
  });
}
