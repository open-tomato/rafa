/**
 * Attributes one session to the plan it was run for, to the issue it
 * was run for, and to the task text it was dispatched with.
 *
 * Every mapping is DERIVED rather than inferred. The reference
 * implementation this collector is modelled on reaches a per-issue
 * attribution by text-matching prompt content and walking merge
 * commits — four functions and a cache. Neither is needed here: every
 * record in these logs carries a top-level `gitBranch`, and this
 * repo's task prompt is assembled by `start/dispatch.ts` from a single
 * tracker line, so each mapping is read out of a string the log
 * already holds.
 *
 * Measured over the live tree at the time of writing — 897 loose
 * session logs, 18 distinct branch values — 889 sessions carried
 * exactly ONE branch, 8 carried several and NONE carried zero. The
 * eight are long-running desktop sessions that outlived a checkout,
 * one of them spanning fifteen branches. So a session's branch is a
 * HISTOGRAM and not a field, and {@link dominantBranch} takes the
 * modal entry rather than assuming there is one. The zero-branch case
 * is handled anyway: `queue-operation` and `last-prompt` records carry
 * no branch, so a session that never ran a turn legitimately has an
 * empty histogram, and that is null rather than a fault.
 *
 * The branch-to-stub step is a SLASH SPLIT and deliberately not a list
 * of recognised branch types. `main` and `pw-align` are the two
 * measured values with no stub, and both fall out of the split for the
 * same reason — no type segment at all — where a type list would have
 * to be maintained and would silently drop attribution for the first
 * branch type nobody had added to it yet.
 *
 * A branch stub is NOT a plan stub, and that is the finding the rest of
 * this module is shaped by. Six of the eleven plan-driven branches name
 * their plan exactly (`feat/q15-ui-pages` against `PLAN-q15-ui-pages.md`);
 * the other five do not, and not by a prefix relation either —
 * `feat/q09-ingest-capture-score` was planned as
 * `q09-port-phase-5-ingest-capture-score`, and `feat/q17-dynamic-forms`
 * as `q17-dynamic-form-provider-v1`. What both halves do share is the
 * leading QUEUE ID, so {@link resolvePlanStub} tries an exact match
 * first and a unique queue-id match second, and answers `none` rather
 * than guessing. `q16` and `q16a` are distinct ids and do not match,
 * which is why the id is matched whole and never as a prefix.
 * Ambiguity is reported with its candidates instead of being settled by
 * an ordering nobody chose.
 *
 * The two stubs stay SEPARATE fields on the row. A report grouping by
 * plan wants the resolved one and has to decide for itself what to do
 * with a branch that resolved to nothing; folding the branch stub in as
 * a fallback here would make those two cases indistinguishable
 * downstream.
 *
 * The issue identifier is read from the same two names, the branch and
 * the plan, and from nothing else. The reference searches prompt text,
 * message bodies, session titles, touched paths, task summaries and
 * commit subjects for one; a derivation over names needs none of that,
 * for the reason the plan is not text-matched either.
 *
 * An identifier is a tracker TEAM KEY, a hyphen and digits, matched
 * whole-word without regard to case and answered upper-cased: the
 * reference's own grammar, with its one hard-coded key lifted into
 * {@link ISSUE_TEAM_KEYS}. The key list is what keeps a plan stub from
 * reading as an issue, and that is measured rather than feared. Over
 * the eighteen branch values measured above plus this repo's own
 * `feat/phase-0-package-parity-cutover`, a pattern taking ANY run of
 * letters as a key reads `PHASE-3`, `PHASE-2`, `PHASE-1` and `PHASE-0`
 * out of four of them, where the keyed one reads nothing. Ignoring case
 * is not optional either: both issue branches the open-tomato repo
 * carried are lower-case, `feat/opt-407-control-byte-gate` and
 * `opt-363-e2e-harness`.
 *
 * The second of those has no slash, so {@link attributeBranch} gives it
 * no stub, and that is why the identifier is searched for in the WHOLE
 * branch name and never in the branch stub.
 *
 * The plan outranks the branch, for the reason the stamp does in
 * {@link resolveSessionPlan}: a declared `issue:` is written by the
 * planner and a plan stub names what was dispatched, while a branch is
 * a naming habit, and only the modal one for a session that outlived
 * its checkout. A disagreement is settled by that rank and stays
 * visible in the candidates. One name carrying two DISTINCT
 * identifiers is not settled at all — the reference takes the first —
 * and answers nothing from that name.
 *
 * Nothing falls back. A session whose branch and plan carry no
 * identifier answers null, never its branch stub, for the reason the
 * plan stub does not: an issue column holding stubs would make an
 * unlinked session indistinguishable from a linked one downstream.
 *
 * The task text is the FIRST LINE of the prompt with the shape's own
 * prefix removed, and that is exact rather than approximate:
 * `findNextTask` captures a task line with `(.+)`, which cannot cross a
 * newline, so the text `start/dispatch.ts` interpolates is single-line
 * by construction and the line after it is the loop's own boilerplate.
 * The prefix is read off {@link PROMPT_SHAPES} rather than retyped,
 * which puts this module behind the classifier's existing drift guard
 * instead of adding a second copy of a literal authored somewhere else.
 *
 * A task line carrying a trailing declaration block is deliberately out
 * of scope. Until the declaration stripper lands the block reaches the
 * prompt verbatim and IS part of the dispatched text; once it lands the
 * prompt no longer carries it. This reader wants no change either way,
 * and parsing the block here would be a second implementation of a
 * grammar that gets its own module.
 *
 * Nothing beyond that one line reaches a row. The task text is the
 * task's own sentence, which the plan file already holds in the clear;
 * no other prompt content, tool output or message body is carried.
 */
import type { SessionKind } from './classify.js';
import type { SessionStats } from './session-log.js';

import { planStubFromPrompt } from '../utils/plan-stamp.js';

import {
  classifyPromptContent,
  matchesShape,
  PROMPT_SHAPES,
} from './classify.js';

/** One branch name split into the two parts attribution reads. */
export interface BranchAttribution {
  /** The branch as recorded, trimmed, or null when there was none. */
  branch: string | null;
  /** The segment before the first slash, or null when there is none. */
  type: string | null;
  /** The segment after it, or null when the branch carries no stub. */
  stub: string | null;
}

/**
 * How a session was matched to a plan.
 *
 * `stamped` is the only member that does not come from a branch name:
 * the loop writes the stub into every prompt it dispatches, so it is
 * read back directly and outranks the branch. The rest describe the
 * branch-stub path, which is the fallback for a session recorded
 * before stamping existed, or one the loop did not dispatch.
 */
export type PlanStubMatch =
  | 'stamped'
  | 'exact'
  | 'queue-id'
  | 'none'
  | 'ambiguous';

/** The plan a branch stub resolved to, and how it got there. */
export interface PlanStubResolution {
  /** The resolved plan stub, or null unless the match is decisive. */
  stub: string | null;
  match: PlanStubMatch;
  /**
   * Every plan stub the queue id reached. One member on a `queue-id`
   * match, the branch stub itself on an `exact` one, and the whole
   * contested set on an `ambiguous` one — which is what makes an
   * ambiguity reportable rather than merely refused.
   */
  candidates: readonly string[];
}

/** The modal branch of a session, with the spread it was chosen from. */
export interface DominantBranch {
  /** The branch the most records carried, or null for none at all. */
  branch: string | null;
  /** Records carrying it; 0 when there is no branch. */
  recordCount: number;
  /** Distinct branches seen; above 1 outlived a checkout. */
  distinctCount: number;
}

/**
 * Where a session's issue identifier was read from, highest rank first.
 *
 * `plan-issue` is the plan's own declared `issue:` value, `plan-stub`
 * the name of the plan the session resolved to, and `branch` the whole
 * branch name. `none` means no source carried exactly one identifier.
 */
export type IssueIdentifierSource =
  | 'plan-issue'
  | 'plan-stub'
  | 'branch'
  | 'none';

/** The names an issue identifier may be read out of. */
export interface IssueIdentifierSources {
  /** The branch name, whole — not its stub; see the module note. */
  branch: string | null | undefined;
  /** The plan stub the session RESOLVED to, not a stamp nobody knows. */
  planStub: string | null | undefined;
  /**
   * The plan's declared issue, when the caller has read one: the
   * `issue:` field of its `rafa:plan` header. Taken as a value rather
   * than parsed here, for the reason the module note gives for the
   * declaration block: parsing it here would be a second implementation
   * of a grammar that gets its own module.
   */
  planIssue?: string | null | undefined;
}

/** The issue a session resolved to, and where it was read. */
export interface IssueIdentifierResolution {
  /** The upper-cased identifier, or null — never a stub standing in. */
  identifier: string | null;
  source: IssueIdentifierSource;
  /**
   * Every distinct identifier any source carried, highest rank first.
   * More than one member means the sources disagreed, with each other
   * or within one name, which is what keeps a disagreement reportable
   * after the rank has settled it.
   */
  candidates: readonly string[];
}

/** One session's attribution row. Carries no transcript content. */
export interface SessionAttribution {
  sessionId: string;
  /** The modal branch; see {@link dominantBranch} for the tie rule. */
  branch: string | null;
  branchRecordCount: number;
  distinctBranchCount: number;
  branchType: string | null;
  branchStub: string | null;
  /** The resolved plan, or null — never the branch stub as a fallback. */
  planStub: string | null;
  planStubMatch: PlanStubMatch;
  /** The resolved issue, or null — never the branch stub as a fallback. */
  issueIdentifier: string | null;
  issueIdentifierSource: IssueIdentifierSource;
  kind: SessionKind;
  /** The dispatched task sentence, or null for every other kind. */
  taskText: string | null;
}

/**
 * A plan file, as `plan.ts` writes it: `PLAN-<stub>.md`.
 *
 * Anchored at both ends so the two siblings sharing the directory are
 * excluded by construction rather than by a filter — `PREREQUISITES-`
 * fails at the front, and `PLAN_TRACKER-` fails on the underscore that
 * a looser `^PLAN` would have let through.
 */
const PLAN_FILE_NAME = /^PLAN-(.+)\.md$/;

/**
 * A leading queue id: `q` then digits then an optional letter, ending
 * at a hyphen or at the end of the stub.
 *
 * The terminator is what keeps `q16` and `q16a` distinct. Matching the
 * id as a bare prefix would fold a `q16` branch onto a `q16a` plan and
 * report it as a decisive match.
 */
const QUEUE_ID = /^(q\d+[a-z]?)(?:-|$)/;

/**
 * The tracker team keys an issue identifier may open with.
 *
 * One key, `OPT`: the one the open-tomato collector hard-codes, and the
 * only one on either issue branch that repo carries. No branch the
 * sibling recorded carries an identifier at all. No config key holds a
 * team list in this phase, so {@link resolveIssueIdentifier} and
 * {@link issueIdentifiersIn} take one and default to this, while
 * {@link attributeSession}, the collector's entry, uses this. A key
 * missing from the list reads as no identifier — an unlinked session,
 * never a misattributed one.
 */
export const ISSUE_TEAM_KEYS: readonly string[] = ['OPT'];

/**
 * A usable team key: a letter, then letters or digits.
 *
 * Checked before a key is joined into a pattern, so a key can never
 * carry pattern syntax, and so an empty key cannot turn `-123` alone
 * into an identifier.
 */
const TEAM_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

/** The task shape, looked up once; see the module note on drift. */
const TASK_SHAPE = PROMPT_SHAPES.find((shape) => shape.kind === 'task');

/** The content up to its first line break, or all of it if there is none. */
function firstLineOf(content: string): string {
  const breakAt = content.indexOf('\n');
  return breakAt === -1
    ? content
    : content.slice(0, breakAt);
}

/**
 * Splits a branch name into its type prefix and its plan stub.
 *
 * A name with no slash has no stub — that is the `main` and `pw-align`
 * case and it is the expected answer, not a degraded one. A stub that
 * would itself contain a slash is refused for a narrower reason: no
 * plan file can be named after it, `plan.ts` writing
 * `PLAN-<stub>.md` into one flat directory.
 */
export function attributeBranch(
  branch: string | null | undefined,
): BranchAttribution {
  const name = typeof branch === 'string'
    ? branch.trim()
    : '';
  if (name.length === 0) return { branch: null, type: null, stub: null };

  const slashAt = name.indexOf('/');
  if (slashAt <= 0) return { branch: name, type: null, stub: null };

  const type = name.slice(0, slashAt);
  const stub = name.slice(slashAt + 1);
  return stub.length === 0 || stub.includes('/')
    ? { branch: name, type, stub: null }
    : { branch: name, type, stub };
}

/**
 * Reads plan stubs out of a directory listing.
 *
 * Takes names rather than a directory so the naming convention lives in
 * one place while the read stays with the caller — the plans directory,
 * `plan.dir`, is untracked by default and can be absent entirely, which
 * is the caller's problem to report and not this module's to guess at.
 *
 * Duplicates are collapsed: two listings concatenated would otherwise
 * make every queue-id match ambiguous against a stub and itself.
 */
export function planStubsFromFileNames(
  fileNames: readonly string[],
): string[] {
  const stubs = new Set<string>();

  for (const fileName of fileNames) {
    const match = PLAN_FILE_NAME.exec(fileName);
    if (match === null) continue;

    const stub = match[1];
    if (stub === undefined || stub.length === 0) continue;
    stubs.add(stub);
  }
  return [...stubs];
}

/** The leading queue id of a stub, or null when it carries none. */
export function queueIdOf(stub: string | null | undefined): string | null {
  if (typeof stub !== 'string') return null;

  const match = QUEUE_ID.exec(stub);
  return match === null
    ? null
    : match[1] ?? null;
}

/**
 * Resolves a branch stub against the known plan stubs.
 *
 * Exact first, then a queue id that reaches exactly one plan. Anything
 * else answers `none` or `ambiguous` with its candidates — a report
 * would rather show an unattributed bucket than attribute a plan's
 * spend to the wrong plan.
 */
export function resolvePlanStub(
  branchStub: string | null | undefined,
  planStubs: readonly string[],
): PlanStubResolution {
  if (typeof branchStub !== 'string' || branchStub.length === 0) {
    return { stub: null, match: 'none', candidates: [] };
  }
  if (planStubs.includes(branchStub)) {
    return { stub: branchStub, match: 'exact', candidates: [branchStub] };
  }

  const queueId = queueIdOf(branchStub);
  if (queueId === null) return { stub: null, match: 'none', candidates: [] };

  const candidates = planStubs.filter((stub) => queueIdOf(stub) === queueId);
  if (candidates.length === 1) {
    return { stub: candidates[0] ?? null, match: 'queue-id', candidates };
  }
  return candidates.length === 0
    ? { stub: null, match: 'none', candidates }
    : { stub: null, match: 'ambiguous', candidates };
}

/**
 * Extracts the task sentence the loop dispatched, or null.
 *
 * Null for every prompt shape that is not a task, for content that is
 * not a string, and for a prefix followed by nothing — an empty task
 * text is no task text. The shape test is {@link matchesShape} rather
 * than a bare `startsWith`, so a shape that later grows a first-line
 * infix is honoured here without a second edit.
 */
export function taskTextFromPrompt(
  content: string | null | undefined,
): string | null {
  if (TASK_SHAPE === undefined) return null;
  if (typeof content !== 'string') return null;
  if (!matchesShape(content, TASK_SHAPE)) return null;

  const text = firstLineOf(content)
    .slice(TASK_SHAPE.prefix.length)
    .trim();
  return text.length === 0
    ? null
    : text;
}

/**
 * Picks the branch the most records carried.
 *
 * Ties go to the lexically smallest name. Object key order would
 * otherwise decide it, which is insertion order — stable in practice
 * and a property of how the histogram happened to be built rather than
 * of the session, so two readers folding the same records in different
 * orders could disagree. A non-positive count is not a sighting.
 */
export function dominantBranch(
  counts: Readonly<Record<string, number>>,
): DominantBranch {
  const entries = Object.entries(counts);
  let branch: string | null = null;
  let recordCount = 0;

  for (const [name, count] of entries) {
    if (count <= 0) continue;

    const wins = count > recordCount
      || (count === recordCount && branch !== null && name < branch);
    if (!wins) continue;

    branch = name;
    recordCount = count;
  }
  return { branch, recordCount, distinctCount: entries.length };
}

/**
 * Resolves a session's plan, stamp first and branch second.
 *
 * A stamp naming a plan the store does not know does NOT win. It is
 * ignored and the branch answers instead, because a stub nobody can
 * corroborate is a guess wearing a derivation's clothes — a renamed
 * or deleted plan would otherwise mint a group of one that no plan
 * file backs.
 */
export function resolveSessionPlan(
  enqueueContent: string | null,
  branchStub: string | null | undefined,
  planStubs: readonly string[],
): PlanStubResolution {
  const stamped = planStubFromPrompt(enqueueContent);
  if (stamped !== null && planStubs.includes(stamped)) {
    return { stub: stamped, match: 'stamped', candidates: [stamped] };
  }
  return resolvePlanStub(branchStub, planStubs);
}

/**
 * Joins the team keys into a pattern alternation, or null for none.
 *
 * Throws on an unusable key rather than skipping it: a key list is
 * written by a caller, not read from a log, so a bad key is a mistake
 * to report and not a record to tolerate. An empty list is legitimate
 * — no tracker — and answers null, which every reader here takes as
 * "no identifier".
 */
function teamKeyAlternation(teamKeys: readonly string[]): string | null {
  for (const key of teamKeys) {
    if (!TEAM_KEY.test(key)) {
      throw new Error(
        `effort attribution: unusable issue team key ${JSON.stringify(key)}`,
      );
    }
  }
  return teamKeys.length === 0
    ? null
    : teamKeys.join('|');
}

/**
 * Every distinct issue identifier a name carries, upper-cased, in order.
 *
 * A word-bounded SEARCH, for names that hold an identifier among other
 * words: `feat/opt-407-control-byte-gate` answers `OPT-407`, while
 * `xopt-407` and `opt-407a` answer nothing. One identifier named twice
 * is one; two distinct ones are both answered, and what that means is
 * {@link resolveIssueIdentifier}'s call.
 */
export function issueIdentifiersIn(
  name: string | null | undefined,
  teamKeys: readonly string[] = ISSUE_TEAM_KEYS,
): string[] {
  const keys = teamKeyAlternation(teamKeys);
  if (keys === null || typeof name !== 'string') return [];

  const pattern = new RegExp(`\\b(?:${keys})-\\d+\\b`, 'gi');
  const found = new Set<string>();
  for (const match of name.matchAll(pattern)) {
    found.add(match[0].toUpperCase());
  }
  return [...found];
}

/**
 * The identifier a declared value IS, upper-cased, or null.
 *
 * Anchored where {@link issueIdentifiersIn} searches: a declaration
 * names an issue and nothing else, so `see OPT-9` or `OPT-9 and OPT-10`
 * is a malformed declaration, passed over as a stamp naming an unknown
 * plan is, rather than a name with an identifier somewhere in it.
 */
function declaredIssueIdentifier(
  value: string | null | undefined,
  teamKeys: readonly string[],
): string | null {
  const keys = teamKeyAlternation(teamKeys);
  if (keys === null || typeof value !== 'string') return null;

  const match = new RegExp(`^(?:${keys})-\\d+$`, 'i').exec(value.trim());
  return match === null
    ? null
    : match[0].toUpperCase();
}

/** What one source carried, in rank order. */
interface IssueReading {
  source: Exclude<IssueIdentifierSource, 'none'>;
  identifiers: readonly string[];
}

/**
 * Resolves a session's issue identifier from its plan and its branch.
 *
 * Rank order is the plan's declared issue, then the plan stub, then
 * the whole branch name, and the first source carrying exactly ONE
 * identifier answers. A source carrying two distinct ones answers
 * nothing and the next rank is asked. When no source answers, the
 * identifier is null and the source `none`: the branch stub is never
 * offered in its place.
 */
export function resolveIssueIdentifier(
  sources: IssueIdentifierSources,
  teamKeys: readonly string[] = ISSUE_TEAM_KEYS,
): IssueIdentifierResolution {
  const declared = declaredIssueIdentifier(sources.planIssue, teamKeys);
  const readings: readonly IssueReading[] = [
    {
      source: 'plan-issue',
      identifiers: declared === null
        ? []
        : [declared],
    },
    {
      source: 'plan-stub',
      identifiers: issueIdentifiersIn(sources.planStub, teamKeys),
    },
    {
      source: 'branch',
      identifiers: issueIdentifiersIn(sources.branch, teamKeys),
    },
  ];
  const candidates = [
    ...new Set(readings.flatMap((reading) => reading.identifiers)),
  ];

  for (const reading of readings) {
    if (reading.identifiers.length === 1) {
      return {
        identifier: reading.identifiers[0] ?? null,
        source: reading.source,
        candidates,
      };
    }
  }
  return { identifier: null, source: 'none', candidates };
}

/**
 * Builds one attribution row from a stats row and its enqueue content.
 *
 * Takes the two fields it reads rather than the whole
 * {@link SessionStats}, which keeps the coupling visible and lets a
 * caller holding only a histogram use it. The roster is required rather
 * than defaulted: an empty one is a legitimate answer — no plans
 * directory — and a caller that forgot to pass one would otherwise get
 * the identical all-`none` result with nothing saying which it was.
 *
 * The issue identifier reads the dominant branch WHOLE and the RESOLVED
 * plan stub, so a stamp naming a plan nobody knows lends it nothing
 * either. The collector reads no plan file, so no declared `issue:`
 * reaches this entry.
 */
export function attributeSession(
  stats: Pick<SessionStats, 'sessionId' | 'gitBranchCounts'>,
  enqueueContent: string | null,
  planStubs: readonly string[],
): SessionAttribution {
  const dominant = dominantBranch(stats.gitBranchCounts);
  const branch = attributeBranch(dominant.branch);
  const plan = resolveSessionPlan(enqueueContent, branch.stub, planStubs);
  const issue = resolveIssueIdentifier({
    branch: branch.branch,
    planStub: plan.stub,
  });

  return {
    sessionId: stats.sessionId,
    branch: branch.branch,
    branchRecordCount: dominant.recordCount,
    distinctBranchCount: dominant.distinctCount,
    branchType: branch.type,
    branchStub: branch.stub,
    planStub: plan.stub,
    planStubMatch: plan.match,
    issueIdentifier: issue.identifier,
    issueIdentifierSource: issue.source,
    kind: classifyPromptContent(enqueueContent),
    taskText: taskTextFromPrompt(enqueueContent),
  };
}
