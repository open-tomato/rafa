/**
 * What `rafa issue list`, `show`, `create`, `comment` and `move` share:
 * the tracker each acts on, resolved through the chain, the ref an id
 * names there, the words and flags each reads off its line, and the
 * refusal of an adapter call that rejects.
 *
 * `issue unblock` and `issue ready` reach no tracker: the board is
 * GitHub's own for both. `issue unblock` takes {@link lineRefusal}
 * alone, and `issue ready` takes it beside the project the dispatcher
 * resolved ({@link issueProject}) and the config reader
 * ({@link issueSubjectConfig}), which is where its
 * `board.trustedAuthors` comes from.
 *
 * ## The tracker, through the chain
 *
 * An action reads its line first. Then it resolves the config as
 * `loop start` does (`config-load.ts`): the project's
 * `.rafa/config.yaml` over the user scope's, over the defaults. It hands
 * `tracker.default` and `tracker.fallback` to `resolveTracker`
 * (`adapters/tracker/resolve.ts`), the chain `loop start`'s triage files
 * through, with the project root as the repository. The chain tries
 * `tracker.default`, then each fallback kind in the order written, each
 * kind once, and lands on the first whose preflight passes. So a line
 * refused for its words reads no config and resolves nothing: no
 * preflight runs for it, and no `gh`.
 *
 * Each kind passed over is written through the command's output as
 * `tracker chain: <kind> unavailable: <reason>`, a `warn` line in text
 * mode and a `warn` `log` event in json mode, before the action acts. A
 * chain landing nowhere is refused with its own message.
 *
 * ## An id names an issue on the tracker landed on
 *
 * An id is the issue's `externalId` there: a GitHub issue number, or the
 * number the `local` adapter gave a file under `.rafa/issues/`. The ref
 * an action hands the tracker carries that id, the tracker's kind,
 * `opt: 0`, since rafa keeps no OPT ledger and triage files with the
 * same (`triage/triage.ts`), and no URL. The id is not checked here,
 * because its shape is the adapter's: `local` and `github` each refuse
 * an id that is no issue number before reading anything, and an add-on
 * kind may number its issues otherwise.
 *
 * A degraded chain reads an id on the tracker it fell back to, which
 * numbers its issues on its own: `rafa issue show 3` under a `github`
 * default whose preflight failed reads `local` issue 3, not GitHub issue
 * 3. The chain's warning is written first, every line naming an issue
 * names its kind, and json mode gives the kind, whether the chain
 * degraded and why as the result's `tracker`.
 *
 * ## Refusals
 *
 * Each is a `CommandExit` with exit code 1, its message opening `❌ `:
 *
 *   - a line handing an action the wrong number of words, and a flag
 *     typed with no value, holding a value outside its set or nothing but
 *     whitespace, or left out where it is required, each naming the
 *     action's usage line;
 *   - a config `loadConfig` refuses, one line per problem;
 *   - a chain landing nowhere, with the chain's message, which names every
 *     kind tried and why each failed;
 *   - an adapter call that rejects, naming what was being done, the kind
 *     and the adapter's message.
 *
 * ## Seams
 *
 * {@link IssueSeams}: the registry each kind's adapter is resolved
 * through, and the `gh` runner the `github` adapter is made with. Left
 * out, they are the chain's own: `CORE_ADAPTER_REGISTRY`, and a runner
 * spawning `gh` in the project root.
 *
 * `issue list --roadmap` reaches no tracker either (`./list.ts`), and
 * takes three seams more: the `git` its branch scan runs, spawning `git`
 * in the project root when left out; what reads the plan dir's file
 * names, `createPlanDirNames` (`board/roadmap-rows.ts`) when left out;
 * and the terminal's width, `process.stdout.columns` when left out. The
 * same `gh` runner reads the Roadmap and the board.
 */
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { TrackerResolution } from '../../adapters/tracker/resolve.js';
import type { PlanNames } from '../../board/roadmap-rows.js';
import type { RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { IssueRef, Tracker, TrackerKind } from '../../ports/index.js';
import type { GitRunner } from '../../pr/git.js';
import type { ProjectFound } from '../../project/scope.js';

import { resolveTracker } from '../../adapters/tracker/resolve.js';
import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { messageOf } from '../../config-sections.js';
import { ConfigError } from '../../config.js';

/** How the chain is resolved; see the module note. Each left out is the chain's own. */
export interface IssueSeams {
  /** Where each kind's adapter is resolved. `CORE_ADAPTER_REGISTRY` when left out. */
  readonly registry?: AdapterRegistry;
  /** What the `github` adapter runs `gh` through. A runner spawning `gh` in the project root when left out. */
  readonly gh?: GhRunner;
  /** What `issue list --roadmap`'s branch scan runs `git` through. A runner spawning `git` in the project root when left out. */
  readonly git?: GitRunner;
  /** What reads the file names in the plan dir `issue list --roadmap` resolved. `createPlanDirNames` when left out. */
  readonly planNames?: (dir: string) => PlanNames;
  /** The terminal's width in columns, or undefined for none. `process.stdout.columns` when left out. */
  readonly terminalWidth?: () => number | undefined;
}

/** The seams the registered commands run with: the chain's own, every one. */
export const DEFAULT_ISSUE_SEAMS: IssueSeams = Object.freeze({});

/** The tracker an action acted on, as json mode gives it. */
export interface IssueTrackerData {
  readonly kind: TrackerKind;
  /** True when the chain landed past the first kind it tried. */
  readonly degraded: boolean;
  /** Why each kind ahead of it was passed over, as the chain joins them, or null when none was. */
  readonly fallbackReason: string | null;
}

/** The tracker the chain landed on, and what json mode says of it. */
export interface IssueTracker {
  readonly tracker: Tracker;
  readonly data: IssueTrackerData;
}

/** The flags of a line, as a command's context holds them. */
export type LineFlags = RafaContext['flags'];

/** A refusal of the line with exit code 1: the problem, then the usage line. */
export function lineRefusal(problem: string, usage: string): CommandExit {
  return new CommandExit(1, `❌ ${problem}\nUsage: ${usage}`);
}

/**
 * The two arguments a line hands an action reading two, or a refusal
 * with exit code 1 naming what the line handed and the usage.
 */
export function expectTwoArguments(args: readonly string[], usage: string): readonly [string, string] {
  const [first, second] = args;
  if (args.length === 2 && first !== undefined && second !== undefined) return [first, second];
  const got = args.length === 0
    ? 'none'
    : `${args.length}: ${args.join(' ')}`;
  throw lineRefusal(`Expected two arguments, got ${got}`, usage);
}

/**
 * A flag's value as typed, or undefined when the line leaves it out. A
 * flag typed bare or as `--no-<name>` is refused: `parseArgs` reads it as
 * a boolean, and every flag of these actions takes a value.
 */
export function readTextFlag(flags: LineFlags, name: string, usage: string): string | undefined {
  const value = flags[name];
  if (value === undefined || typeof value === 'string') return value;
  throw lineRefusal(`--${name} needs a value: --${name}=<value>`, usage);
}

/** A flag's value, or undefined when the line leaves it out; a value holding nothing but whitespace is refused. */
export function readNonBlankFlag(flags: LineFlags, name: string, usage: string): string | undefined {
  const value = readTextFlag(flags, name, usage);
  if (value === undefined || value.trim() !== '') return value;
  throw lineRefusal(`--${name} cannot be blank: --${name}=<value>`, usage);
}

/** A flag's value, refusing one left out, typed with no value or holding nothing but whitespace. */
export function readRequiredFlag(flags: LineFlags, name: string, usage: string): string {
  const value = readNonBlankFlag(flags, name, usage);
  if (value !== undefined) return value;
  throw lineRefusal(`--${name} is required: --${name}=<value>`, usage);
}

/** `value` when it is one of `members`, or a refusal naming `what`, the value and the members. */
export function readChoice<T extends string>(value: string, what: string, members: readonly T[], usage: string): T {
  const member = members.find((held) => held === value);
  if (member !== undefined) return member;
  throw lineRefusal(`${what} is "${value}", expected one of: ${members.join(', ')}`, usage);
}

/** A flag's value when it is one of `members`, or undefined when the line leaves it out; any other is refused. */
export function readChoiceFlag<T extends string>(
  flags: LineFlags,
  name: string,
  members: readonly T[],
  usage: string,
): T | undefined {
  const value = readTextFlag(flags, name, usage);
  return value === undefined
    ? undefined
    : readChoice(value, `--${name}`, members, usage);
}

/** The project the dispatcher resolved, which it resolves for every action of the subject. */
export function issueProject(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa issue runs inside a project, and was handed none');
  return context.project;
}

/**
 * The config as it resolves for the project, refusing one `loadConfig`
 * refuses with exit code 1 and one line per problem, and writing every
 * warning it raises through `warn`.
 *
 * The whole config and not the chain's two settings, because the
 * subject's actions read different keys off it: the five tracker
 * actions take `tracker.default` and `tracker.fallback`, and
 * `./ready.ts` takes `board.trustedAuthors`. One reader is what keeps
 * the refusal spelled once for the subject.
 */
export function issueSubjectConfig(project: ProjectFound, warn: (message: string) => void): RafaConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, ['❌ The config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'));
  }
}

/**
 * The tracker an action acts on, resolved through the chain with the
 * command's output taking every warning; a refusal with exit code 1 for
 * a config refused and a chain landing nowhere. See the module note.
 */
export async function resolveIssueTracker(context: RafaContext, seams: IssueSeams): Promise<IssueTracker> {
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);

  let resolution: TrackerResolution;
  try {
    resolution = await resolveTracker({
      config,
      context: { repoRoot: project.root, gh: seams.gh },
      registry: seams.registry,
      log: warn,
    });
  } catch (error) {
    throw new CommandExit(1, `❌ ${messageOf(error)}`);
  }

  const { tracker, degraded, fallbackReason } = resolution;
  return { tracker, data: { kind: tracker.kind, degraded, fallbackReason } };
}

/** The ref an id names on `tracker`; see the module note. */
export function issueRef(tracker: Pick<Tracker, 'kind'>, id: string): IssueRef {
  return { opt: 0, kind: tracker.kind, externalId: id, url: null };
}

/** How a line names an issue: `local issue 3`. */
export function issueName(ref: Pick<IssueRef, 'kind' | 'externalId'>): string {
  return `${ref.kind} issue ${ref.externalId}`;
}

/** The line giving an issue's URL, or none when the tracker gave it none. */
export function urlLines(ref: Pick<IssueRef, 'url'>): string[] {
  return ref.url === null
    ? []
    : [`URL: ${ref.url}`];
}

/**
 * What `call` answers, or, when it rejects, a refusal with exit code 1
 * naming what was being done, the tracker's kind and the adapter's
 * message.
 */
export async function onTracker<T>(tracker: Pick<Tracker, 'kind'>, doing: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new CommandExit(1, `❌ Could not ${doing} on the ${tracker.kind} tracker: ${messageOf(error)}`);
  }
}
