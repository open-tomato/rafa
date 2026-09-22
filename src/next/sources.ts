/**
 * What the state table is read over in a real project: the config, git,
 * the session records, the plans directory, the pull request provider
 * and the board, composed into the one {@link NextSources} value
 * `./readings.ts` declares.
 *
 * `./state.ts` decides and `./readings.ts` reads; this module is the
 * half that WIRES, and it is the only one of the three that knows a
 * `RafaContext`. So a caller — `rafa next`, and the ending hint of every
 * command in the cycle — composes the sources once and hands them on,
 * and every case of `./state.test.ts` and `./readings.test.ts` keeps
 * driving fakes with no context at all.
 *
 * ## What the config answers
 *
 * One `loadConfig` for the whole composition, which is what keeps the
 * four settings it reads on one reading of the file:
 *
 * | Setting | Field | What it answers |
 * | --- | --- | --- |
 * | `plan.dir` | `planDir` | the plans directory rows 3, 4 and 9 read |
 * | `pr.base` | `prBase` | the base rows 2 and 9 to 13 are read against |
 * | `pr.provider` | `prProvider` | whether this repository has a provider at all |
 * | `roadmap.issue` | `roadmapIssue` | the roadmap issue, when a layer named one |
 *
 * `pr.base` unset is {@link DEFAULT_BASE_BRANCH}: `main`, which is what
 * `release tag` resolves the same setting to and the first of the two
 * branches `src/start.ts` reads as a base. A project whose base is
 * `master` and whose config says nothing therefore reads as being off
 * its base, and every row that names the base stays quiet — the setting
 * is the one place that is fixed, and no probe here guesses at it.
 *
 * A config `loadConfig` refuses is refused with exit code 1 naming
 * `rafa next`, in the words `src/commands/plan/plan-files.ts` refuses
 * one with; the six other commands that read a config of their own
 * spell it the same way.
 *
 * ## The provider is required to be `gh`
 *
 * {@link openNextSources} resolves `pr.provider` through
 * `resolvePrProvider` at the project root and hands the reading to
 * `requireGhProvider`, so a repository that is no GitHub one is refused
 * with exit 2 and `PR_NEEDS_GH`, the constant every `pr` action refuses
 * with. The message opens with `rafa pr`, which is right here: every
 * action rows 5 to 8 propose IS a `pr` action, and a second wording
 * of one refusal is the smell `context/source.md` names.
 *
 * That check asks the config and `origin`, and it spawns no `gh`.
 * Whether the CLI is installed and authenticated is the preflight's
 * reading (`src/pr/preflight-items.ts`), and a `gh` that then cannot
 * answer is the `pulls-unusable` pre-condition of `./state.ts`, which
 * names `rafa doctor`.
 *
 * ## The board, and what it does NOT do
 *
 * {@link ghNextBoard} answers the three readings {@link NextBoard}
 * declares over one `gh` runner and one memoised issue reader, out of
 * the pieces `plan create --next` walks the roadmap with: the roadmap
 * issue resolved (`roadmap.issue`, else the one open issue titled
 * `Roadmap`), its body parsed, and the walk's own done and taken
 * readings. Nothing is composed here a second time.
 *
 * The memo lives for the length of one board, which is one `rafa next`
 * answer: the walk reads the picked line's issue to ask whether it is
 * closed, and `blocking` and `isReady` then read the LABELS and the
 * `Blocked by:` line off that same answer, so rows 10, 11 and 12 cost no
 * `gh issue view` of their own. `spec-source.ts` memoises for the same
 * reason and its suite counts the reads; `./sources.test.ts` counts them
 * here.
 *
 * It runs NO trust check. `src/board/trust.ts` is wired where board text
 * reaches a prompt or a snapshot — `plan create --issue`, `--next`,
 * the spec-review comment and `issue ready` — and nothing here reaches
 * either: the roadmap body is read for the ids of its unticked lines, a
 * body for its labels and its `Blocked by:` ids, and the numbers land in
 * a sentence a person reads. The action a row proposes runs the check
 * itself, because it is that command's own.
 *
 * A failed branch scan is carried out as {@link NextRoadmapReading}
 * `.problems` rather than thrown, which is `scanClaimBranches`'s own
 * shape and what `./readings.ts` carries into the answer. The scan is
 * taken here as well as by `./readings.ts`'s row 9, so an answer that
 * reaches both spends two `git for-each-ref` calls — both local, both
 * free of the network, and each memoised where it is taken.
 */
import type { NextBoard, NextRoadmapReading, NextSources } from './readings.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BlockedLine } from '../board/blocked-line.js';
import type { SpecIssue, SpecIssueReader } from '../board/issue.js';
import type { RafaContext } from '../cli/command.js';
import type { RafaConfig } from '../config.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { GitRunner, PullRequests } from '../pr/index.js';
import type { ProjectFound } from '../project/scope.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { blockerStatesOf, readBlockedLine } from '../board/blocked-line.js';
import { createGhSpecIssueReader } from '../board/issue.js';
import { hasSpecReadyLabel } from '../board/readiness.js';
import {
  createGhOpenPullRequests,
  createGhRoadmapSearch,
  createRoadmapReadings,
  parseRoadmapBody,
  pickNextRoadmapLine,
  resolveRoadmapIssue,
  scanClaimBranches,
} from '../board/roadmap.js';
import { CommandExit } from '../cli/command.js';
import { readRecords, resolveLoopSeams } from '../commands/loop/loop-sessions.js';
import { plansDirAt } from '../commands/plan/plan-files.js';
import { loadConfig } from '../config-load.js';
import { ConfigError } from '../config.js';
import { createGitRunner, ghPullRequestsIn, requireGhProvider, resolvePrProvider } from '../pr/index.js';

/** What a refusal and a defect here name, being the one command that composes these. */
const PREFIX = 'rafa next';

/** The base every row that names one is read against where `pr.base` names none. */
export const DEFAULT_BASE_BRANCH = 'main';

/** How the composition reaches git, `gh`, the provider, `origin` and the pids; each left out is the system's own. */
export interface NextSourceSeams {
  /** Opens the runner every `gh` command goes through. `gh` spawned at the project root when left out. */
  readonly openGh?: (root: string) => GhRunner;
  /** Opens the runner every git command goes through. `createGitRunner` when left out. */
  readonly openGit?: (root: string) => GitRunner;
  /** The provider for a repository. `ghPullRequestsIn` when left out. */
  readonly pullRequests?: (root: string) => PullRequests;
  /** The `origin` probe `resolvePrProvider` takes. `gitRemoteUrl` when left out. */
  readonly readRemote?: (dir: string) => string | null;
  /** Whether a pid is alive, as a session record's state is read. `isPidAlive` when left out. */
  readonly isAlive?: (pid: number) => boolean;
}

/** The seams a registered command runs with: the system's own, every one. */
export const DEFAULT_NEXT_SOURCE_SEAMS: NextSourceSeams = Object.freeze({});

/** What {@link ghNextBoard} reads the board through. */
export interface NextBoardOptions {
  /** Runs every `gh` command, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** Runs the two branch reads the taken reading is taken from. */
  readonly git: GitRunner;
  /** `roadmap.issue` as the config resolved it, or null for the titled issue. */
  readonly configured: number | null;
  /** The remote the pushed half of the branch scan asks; `origin` when left out. */
  readonly remote?: string;
}

/** The settings the composition reads off the config. */
type NextConfig = Pick<RafaConfig, 'planDir' | 'prBase' | 'prProvider' | 'roadmapIssue'>;

/** `read`, called at most once per issue; the module note holds how long the memo lives. */
function memoiseIssues(issues: SpecIssueReader): SpecIssueReader {
  const read = new Map<number, Promise<SpecIssue>>();
  return (issue: number): Promise<SpecIssue> => {
    const taken = read.get(issue) ?? issues(issue);
    read.set(issue, taken);
    return taken;
  };
}

/**
 * The board over one `gh` runner and one git runner: the roadmap walked
 * once, and the two readings over a line's issue. See the module note
 * for the memo, for what it does not do, and for the problems it
 * carries.
 */
export function ghNextBoard(options: NextBoardOptions): NextBoard {
  const { gh, git, configured, remote } = options;
  const issues = memoiseIssues(createGhSpecIssueReader({ gh }));

  return Object.freeze({
    next: async (): Promise<NextRoadmapReading> => {
      const roadmap = await resolveRoadmapIssue({ configured, search: createGhRoadmapSearch({ gh }) });
      const read = await issues(roadmap);
      const branches = scanClaimBranches(git, remote);
      const readings = createRoadmapReadings({
        issues,
        branches,
        pullRequests: createGhOpenPullRequests({ gh }),
      });
      const pick = await pickNextRoadmapLine(parseRoadmapBody(read.body), readings);
      return {
        roadmap,
        line: pick.line,
        passed: pick.skipped.length,
        problems: branches.problems,
      };
    },

    blocking: async (issue: number): Promise<BlockedLine | null> => readBlockedLine(
      await issues(issue),
      blockerStatesOf(issues),
    ),

    isReady: async (issue: number): Promise<boolean> => hasSpecReadyLabel((await issues(issue)).labels),
  });
}

/** The project the dispatcher resolved, which it resolves for every command declaring it needs one. */
function nextProject(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error(`${PREFIX} runs inside a project, and was handed none`);
  return context.project;
}

/** The four settings the composition reads, or the exit-1 refusal of a config that cannot be used. */
function nextConfig(project: ProjectFound, warn: (message: string) => void): NextConfig {
  try {
    return loadConfig({ root: project.root, home: project.home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(1, [
      `❌ ${PREFIX}: the config cannot be used:`,
      ...error.problems.map((problem) => `   ${problem}`),
    ].join('\n'));
  }
}

/**
 * The sources one answer is read over, composed for the project the
 * dispatcher resolved. Warnings the config raises are written through
 * the command's output.
 *
 * Throws `CommandExit(2, PR_NEEDS_GH)` where `pr.provider` is not `gh`,
 * and `CommandExit(1, ...)` for a config that cannot be used. Nothing is
 * read off git, the board or the provider here: every reading is a
 * function the table calls only where a row asks for it.
 */
/**
 * What {@link openNextSources} answers: the sources, and {@link
 * OpenedNextSources.answer} for the next one. Only `rafa next` holds
 * this type; every reading takes the plain {@link NextSources}, so a
 * test's double needs nothing new.
 */
export interface OpenedNextSources extends NextSources {
  /**
   * Sources for ONE answer, with a board of their own. The board memoises
   * the issue it reads so the rows over one answer cost one `gh issue
   * view` between them, and a memo held across a chain's turns is a
   * chain that cannot see what its own action changed: on 2026-09-23
   * `rafa next` marked #82 ready, read the labels it had cached before
   * that, proposed the same step again and stopped `unchanged`. So the
   * chain takes a new answer per turn.
   */
  readonly answer: () => NextSources;
}

export function openNextSources(
  context: RafaContext,
  seams: NextSourceSeams = DEFAULT_NEXT_SOURCE_SEAMS,
): OpenedNextSources {
  const project = nextProject(context);
  const config = nextConfig(project, (message: string) => {
    context.output.warn(message);
  });
  requireGhProvider(resolvePrProvider({
    configured: config.prProvider,
    dir: project.root,
    readRemote: seams.readRemote,
  }));

  const git = (seams.openGit ?? createGitRunner)(project.root);
  const gh = (seams.openGh ?? ((root: string): GhRunner => createGhRunner({ cwd: root })))(project.root);
  const loop = resolveLoopSeams({ isAlive: seams.isAlive });

  const board = (): NextBoard => ghNextBoard({ gh, git, configured: config.roadmapIssue });
  const held = {
    base: config.prBase ?? DEFAULT_BASE_BRANCH,
    plans: plansDirAt(project.root, config.planDir),
    runs: (): readonly SessionRecord[] => readRecords(project.root, loop),
    git,
    pulls: (seams.pullRequests ?? ghPullRequestsIn)(project.root),
  };

  return Object.freeze({
    ...held,
    board: board(),
    answer: () => Object.freeze({ ...held, board: board() }),
  });
}
