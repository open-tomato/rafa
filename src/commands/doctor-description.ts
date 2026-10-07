/**
 * The help description of `rafa doctor`, the paragraph `rafa doctor --help`
 * and `rafa describe` print under the command's summary.
 *
 * It moved out of `./doctor.ts` when the effort sync row and the release
 * row joined that module and took it past the 800-line cap of
 * `context/source.md`; the command still owns every other field of its
 * `RafaCommand`, and this module holds the text alone.
 */
import { PROBE_TIMEOUT_MS } from '../preflight/run.js';

/** What `rafa doctor` checks, reads and prints, and when it exits 1. */
export const DOCTOR_DESCRIPTION = 'Checks the prerequisites `rafa loop start` checks before its first session and prints each'
  + ' check, starting no run and storing nothing: the required and optional items of'
  + ' `.rafa/config.yaml`, with the `PREREQUISITES-<stub>.md` beside the plan merged in, and, when the'
  + ' repository resolves to `pr.provider: gh`, the two required items that provider adds ahead of them:'
  + ' `gh` on PATH and `gh auth status` for the remote\'s host. A plan\'s `[start]` items are checked'
  + ' after those and ahead of the configured tiers, on a first dispatch alone: a'
  + ' `PLAN_TRACKER-<stub>.md` beside the plan already holding a ticked task makes the next run a'
  + ' resume, which checks none of them and says in one line how many it passed over.'
  + ' The plan is the'
  + ' one `--plan=<file>` names, relative to the project root, or the default plan `rafa loop start`'
  + ` runs. Each probe runs in the project root with stdin closed and a ${String(PROBE_TIMEOUT_MS / 1000)}-second`
  + ' timeout. It exits 1 when a required item fails, naming the item, its probe and its exit code or'
  + ' first line of stderr, where `rafa loop start` would halt. It reads the effort store as'
  + ' `rafa effort schema --check` does, changing nothing, and prints its `effort store schema` row:'
  + ' it exits 1 where that check fails, naming the next safe step, and warns on a migration this rafa'
  + ' does not know that is additive and on one the project\'s own store logs as applied by a development'
  + ' build. It prints its `effort sync` row, the strategy `effort.sync` names (`local` when unset) and'
  + ' whether core or a loaded module serves it, and exits 1 when no adapter serves it, naming for'
  + ' `git`, `service` and `p2p` the `modules:` and `allowList:` lines that load a module providing it.'
  + ' It exits 0 otherwise. It warns when'
  + ' `.ralph/effort/` holds an effort store and `.rafa/effort/` holds none, and when `~/.rafa/bin` is'
  + ' not on PATH ahead of `~/.bun/bin`, and when `previous/` under `specs.dir` holds more than fifty'
  + ' previous copies of issue specs, which are safe to delete; a warning never changes the exit code. On a repository whose'
  + ' provider is `gh` it also reads the GitHub board `rafa init --board` sets up and prints one row per'
  + ' part — the seven labels, the spec issue template, the Roadmap issue and `roadmap.issue` — as present,'
  + ' missing, or unknown for a reading that failed, naming `rafa init --board` as the fix; it writes'
  + ' nothing to the board and a row never changes the exit code. It then names, under `Blocked'
  + ' issues:`, every open issue labelled `spec:blocked` whose `Blocked by:` line is missing, names no'
  + ' issue, names itself, or names an id the board has no issue for, with what an author does about'
  + ' it; that reading writes nothing and never changes the exit code either. It then names, under'
  + ' `Epic labels:`, every issue carrying two `epic:` labels and every `epic:` label no `type:epic` issue'
  + ' carries, read off one board listing, writing nothing and never changing the exit code. It then names, under'
  + ' `Boards:`, every type:roadmap board whose Owner: handle resolves to nobody GitHub shows, every open issue titled'
  + ' "Roadmap" without type:roadmap while labelled boards exist, and every slot of this checkout\'s position on a'
  + ' board or epic that is closed, unlabelled or gone, read off that same listing and printing nothing when there is'
  + ' none; it writes nothing and never changes the exit code. Where `board.project.number` is set, it then'
  + ' prints, under `GitHub project:`, the `project` scope, the project at that number and its five fields as'
  + ' present, missing or unknown, each one not present naming its fix and a project in place naming'
  + ' `rafa board sync --dry-run`; it reads no item and never changes the exit code. It then counts, without'
  + ' fetching, the branches and worktrees `rafa cleanup` would list, and prints them in one row naming'
  + ' `rafa cleanup` when any group holds one. It then counts the suspect, dangling and unknown references'
  + ' of every saved copy under `specs.dir`, writing nothing, and names `rafa issue check <n>` for each'
  + ' copy holding a suspect or dangling one. Where the release is on, it then prints one `Release:` row naming'
  + ' the version `origin/<pr.base>` declares as last fetched, the latest release tag, the version the changelog\'s'
  + ' top heading names and the change fragments waiting on the base, as a warning naming `rafa release settle`'
  + ' while any wait; it fetches nothing and never changes the exit code.'
  + ' It then prints, under `Skill tiers`, a warning per'
  + ' skill or agent name two tiers hold with different contents, per unreviewed third-party rafa or'
  + ' add-on item, and for an installed Claude Code other than the version skill serving was probed'
  + ' against, and a note per byte-identical copy that can be deleted and per user-tier item with no'
  + ' `provenance`; none changes the exit code. With `--output=json` the'
  + ' checks, both readings, those rows, those issues, those labels and those boards are the data of the terminal result event,'
  + ' unless a required item failed. A plan `--plan` names also gets the one-line risk total'
  + ' `rafa loop start` prints before its notices, which never changes the exit code. With `--deep` it'
  + ' also prints the machine as a loop session sees it, starting no session: the session\'s'
  + ' Environment and working directory against the shell\'s, the Settings each agent, skill and MCP'
  + ' server is read from and whether a session sees it, the Providers `gh` answers under the session\'s'
  + ' environment, and the Stack tools the project\'s stack needs, with Plan needs for a plan `--plan`'
  + ' names; each row is ok, warn or note with its fix, printed after the blocked issues and before a'
  + ' refusal, and none changes the exit code. With `--output=json` they are the `deep` of the data.';
