/**
 * rafa's core roster: the subjects and commands `src/rafa.ts` dispatches
 * through, as one static list, and the registry built from it.
 *
 * ## Why a static list
 *
 * The CLI ships as one bundle, `dist/cli.js`, and `bun build` bundles
 * what static imports reach. So a core command is imported here by name,
 * never found on disk at run time. The run-time imports are the module
 * command entries, which live outside the bundle (`src/cli/modules.ts`).
 *
 * ## The layout
 *
 * An action of a subject sits at `src/commands/<subject>/<action>.ts`,
 * and a top-level command at `src/commands/<name>.ts`. The default export
 * of each is its command. Five of the fifty-seven registered so far wrap a
 * phase 0 command (`wrap.ts`), which keeps its own parser and its own
 * writes. `describe` wraps none: it builds its document from the registry
 * its context carries. Nor do `plan list`, `plan show`,
 * `plan validate`, `plan risk` and `plan needs`, which read plan files
 * with `parsePlan` and share `plan/plan-files.ts`, nor `loop stop`, `pause`, `resume`, `status` and
 * `list`, which act on a run through its session record and share
 * `loop/loop-sessions.ts`, nor `init`, which sets up a project through
 * `src/project/`, nor `doctor`, which checks the preflight through
 * `src/preflight/` and starts no run, nor the eight `issue` actions,
 * five of which act on the tracker the chain resolves while `ready` and
 * `unblock` read and label issues on the GitHub board and `check` reads
 * the references of a spec's saved copy, all eight sharing
 * `issue/issue-tracker.ts`, nor `roadmap`, which runs `issue list`'s own
 * run with `--roadmap` set, nor `self-update`, which installs the
 * checkout through `src/runtime/install.ts`, nor `module list` and
 * `module exec`, which read the modules `src/modules/load.ts` loads and
 * the mounts the dispatcher made, nor `agent vendor`, which copies agent
 * definitions through `src/agents/roster.ts`, nor `agent list`, which
 * lists the agents `buildInventory` (`src/inventory/`) reads, nor
 * `agent show`, which shows one of them through `src/inventory/show.ts`,
 * nor `agent search` and `skill search`, which find the items that
 * answer a question through `src/inventory/search/`, the agent one
 * built by `skill/search.ts`,
 * nor `skill check` and `instinct check`, which run the five checks
 * through `src/check/run.ts` and share `commands/check-report.ts`, nor
 * `skill list`, which lists the skills `buildInventory`
 * (`src/inventory/`) reads from every source, nor `skill show`, which
 * shows one of them through `src/inventory/show.ts`, nor `skill demote` and
 * `skill backfill`, which run the demotion pass of `src/demote/` and the
 * backfill of `src/backfill/` over one skills directory, nor
 * `instinct list` and `instinct show`, which read the records the two
 * instinct scopes hold through `commands/instinct/instinct-records.ts`, nor
 * `instinct flag` and `instinct promote`, which call the Learning adapter
 * `learning.adapter` names, `list --blessed` making it as `promote` does, nor
 * the seven `pr` actions, which read, wait on, merge and triage one
 * repository's pull requests through the PullRequests port and share
 * `pr/pr-context.ts`, nor `release status` and `release tag`, which
 * read the version file, the changelog and the repository's tags
 * through `src/release/` and share `release/status.ts`'s readers, nor
 * `next`, which reads where the project stands through `src/next/` and
 * runs each action it proposes by calling the registered command that
 * does it, nor `cleanup`, which reads the branches and worktrees through
 * `src/cleanup/` and removes the ticked ones through its steps, nor
 * `status`, which reads the five sections through `src/status/`.
 *
 * ## What is registered
 *
 *   - `plan create`, aliased `plan`, so `rafa plan --spec=<file>` still
 *     runs it.
 *   - `plan list`, `plan show <stub> [--tracker]`,
 *     `plan validate <file>`, `plan risk [<plan>] [--strict]` and
 *     `plan needs [<plan> | --spec=<file> | --issue=<n>] [--missing]
 *     [--source=<source>]`, which start no session: `plan risk` reads, in
 *     code, what a run of the plan may do on this machine and under the
 *     person's accounts, and `plan needs` the agents, skills, MCP servers
 *     and programs a plan or spec needs from it.
 *   - `loop start`, aliased `start`, declaring `-d|--detached` and
 *     refusing it until phase 6, and `--runtime=<path|version>`, which
 *     runs the loop from that installed rafa.
 *   - `loop stop`, `loop pause`, `loop resume` and `loop status`, each
 *     `[-s|--session-id=<id>]`, and `loop list`, over the session records
 *     under `.rafa/runs/`.
 *   - `issue list`, `issue show <id>`, `issue create --title=<text>`,
 *     `issue comment <id> --body=<text>` and `issue move <id> <state>`,
 *     over the Tracker port, on the tracker `tracker.default` and
 *     `tracker.fallback` resolve to through the chain.
 *   - `issue ready <n> [--no-hint]`, an issue marked `spec:ready` once
 *     its author and its body check out, and
 *     `issue unblock [<n>] [--all]`, `spec:blocked` taken off an issue
 *     whose `Blocked by:` line names only closed issues. Both read the
 *     GitHub board rather than the tracker chain, and both always ask.
 *   - `issue check <n> [--stamp]`, the references issue `<n>`'s saved
 *     copy names, each with its state, re-stamped under `--stamp`; it
 *     exits 0 whatever the states are and plans nothing.
 *   - `pr current`, the open pull request of the branch checked out at the
 *     project root on one line; `pr show [<n>]`, that pull request in full
 *     with its checks and its last triage; `pr view [<n>]`, it opened in
 *     the browser; `pr list`, the open pull requests as rows;
 *     `pr wait [<n>] [--timeout=<minutes>]`, its checks polled until
 *     they settle or the deadline passes with nothing written, exiting 0
 *     green, 1 red and on no checks at all, and 3 at the deadline; and
 *     `pr merge [<n>] [--yes] [--skip-checks] [--method=squash|merge|rebase]`,
 *     one merged and both branches cleaned up after it; and
 *     `pr triage [<n>] [--no-comment] [--max-attempts=<count>]`, one
 *     assessed in code into a class with its evidence and a follow-up
 *     prompt, the reading left as one comment per pull request. Each
 *     refuses with exit code 2 where `pr.provider` is not `gh`.
 *   - `effort collect` and `effort report`, whose spelling is phase 0's.
 *   - `module list`, every module the config gives a source for and what
 *     it came to, and `module exec <module> <action>`, the `exec` action a
 *     module's mounted commands are reached through.
 *   - `agent vendor <name>... [--force]`, each named rafa-tier or
 *     `~/.claude/agents` definition copied into the project with a source
 *     header, naming the tier it came from, and
 *     `agent list [--source=<source>] [--state=<state>]
 *     [--hidden-from-loop] [-i]`, every agent definition the inventory
 *     holds with its source, its state and whether the loop sees it,
 *     browsed in the terminal under `-i`, and
 *     `agent show <name> [--full]`, the agent definition a name resolves
 *     to, shown as `skill show` shows a skill, and
 *     `agent search "<question>" [--all] [--no-model]`, found as
 *     `skill search` finds skills.
 *   - `skill check <dir> [--fix] [--project=<root>]` and
 *     `instinct check <dir>`, the checker over one tier, each exiting
 *     with the number of its failing files and running outside a
 *     project, since `--project` is its only project seam.
 *   - `skill list [--source=<source>] [--state=<state>]
 *     [--hidden-from-loop] [-i]`, every skill the inventory holds with
 *     its source, its state and whether the loop sees it, browsed in the
 *     terminal under `-i`, and `instinct list` and
 *     `instinct show <id>`, the records the project and user instinct
 *     scopes hold, each listing exiting 0 whatever its rows say.
 *   - `instinct flag <id> <reason>`, one held lesson flagged through the
 *     Learning adapter so no later bundle blesses it, refusing an id no
 *     held record carries, and `instinct promote`, the lessons that
 *     recurred enough to promote under `learning.promote.*`, writing
 *     nothing.
 *   - `skill show <name> [--full]`, the skill a name resolves to: its
 *     record, its frontmatter, every other holder of the name and its
 *     headings, or its whole file under `--full`, refusing a name no
 *     skill holds.
 *   - `skill search "<question>" [--all] [--no-model]`, the skills that
 *     answer a question: the inventory ranked by its words, one `haiku`
 *     session over the top twelve, and each match kept on a quote found
 *     in its file, or the ranking alone under `--no-model`, which starts
 *     no session; `--all` searches agent definitions too.
 *   - `skill demote <dir> [--apply]`, the demotion pass over one skills
 *     directory: the report written with nothing moved, and a report the
 *     review marked `reviewed` applied, exiting with the rows it refused.
 *   - `skill backfill <dir> [--propose|--apply] [--project=<root>]`, the
 *     backfill over one skills directory: what the derivation would
 *     write, the draft proposals one session per twenty files answers,
 *     and the reviewed rows written and derived over, exiting with the
 *     rows and files it refused.
 *   - `release status [--plan=<stub>]`, the version the version file
 *     declares, the latest release tag by semantic version precedence,
 *     the versions the changelog calls released that carry no tag, and
 *     the change notes pending for the current plan, writing nothing;
 *     and `release tag`, the one write of the subject, which puts
 *     `v<version>` on the release branch's HEAD and prints the push and
 *     publish lines rather than running them, refusing on another
 *     branch, on a tag already there, and where the two release files
 *     disagree.
 *   - `status`, top-level: where the project stands in five sections,
 *     branch and plan, loops, pull request, board and housekeeping, a
 *     section that cannot be read one warning; exit code 1 only for a
 *     config that cannot be used. It starts no session.
 *   - `next [--dry-run] [--yes[=<action ids>]]`, top-level: where the
 *     project stands on one line, the one thing to do about it on the
 *     next, that action run on a yes through the command that does it,
 *     and then the same again for what follows.
 *   - `roadmap [--all] [--type=<type>] [--module=<name>]
 *     [--search=<text>] [--limit=<n>]`, top-level: the Roadmap issue's
 *     lines in its order as a table, `issue list --roadmap` under a word
 *     of its own. Not an alias, since an alias prints a deprecation line.
 *   - `init [--root=<path>] [--yes]`, top-level: the project root, its
 *     `.rafa/` scope and `.gitignore` entry, and the user scope.
 *   - `doctor [--plan=<file>]`, top-level: the preflight `loop start`
 *     checks, checked and printed with no run started, beside two
 *     warnings about the install.
 *   - `cleanup [--dry-run]`, top-level: the local branches and
 *     worktrees that have piled up, in four groups, and the ones ticked
 *     removed after one question; listed only, removing nothing, without
 *     a terminal or with `--output=json`. It starts no session.
 *   - `self-update [--force]`, top-level: builds the rafa checkout and
 *     installs it as `~/.rafa/bin/rafa`, refusing while a tracker in
 *     `plan.dir` holds a task and while this version's runtime directory
 *     is already there, which `--force` replaces whole.
 *   - `usage`, top-level.
 *   - `describe`, top-level: the schema 2 roster of the registry the line
 *     was routed through.
 *
 * Typing an alias prints one deprecation line on stderr before the
 * command runs (`src/cli/dispatch.ts`).
 *
 * The subjects are the ten with an action registered: a subject with
 * none would show in every roster and dispatch nothing. `skill index` is
 * in the command tree and is not registered, because nothing dispatches
 * it yet.
 */
import type { RafaCommand } from '../cli/command.js';
import type { SubjectSpec } from '../cli/registry.js';

import { createCommandRegistry } from '../cli/registry.js';

import agentList from './agent/list.js';
import agentSearch from './agent/search.js';
import agentShow from './agent/show.js';
import agentVendor from './agent/vendor.js';
import cleanup from './cleanup.js';
import describe from './describe.js';
import doctor from './doctor.js';
import effortCollect from './effort/collect.js';
import effortReport from './effort/report.js';
import init from './init.js';
import instinctCheck from './instinct/check.js';
import instinctFlag from './instinct/flag.js';
import instinctList from './instinct/list.js';
import instinctPromote from './instinct/promote.js';
import instinctShow from './instinct/show.js';
import issueCheck from './issue/check.js';
import issueComment from './issue/comment.js';
import issueCreate from './issue/create.js';
import issueList from './issue/list.js';
import issueMove from './issue/move.js';
import issueReady from './issue/ready.js';
import issueShow from './issue/show.js';
import issueUnblock from './issue/unblock.js';
import loopList from './loop/list.js';
import loopPause from './loop/pause.js';
import loopResume from './loop/resume.js';
import loopStart from './loop/start.js';
import loopStatus from './loop/status.js';
import loopStop from './loop/stop.js';
import moduleExec from './module/exec.js';
import moduleList from './module/list.js';
import next from './next.js';
import planCreate from './plan/create.js';
import planList from './plan/list.js';
import planNeeds from './plan/needs.js';
import planRisk from './plan/risk.js';
import planShow from './plan/show.js';
import planValidate from './plan/validate.js';
import prCurrent from './pr/current.js';
import prList from './pr/list.js';
import prMerge from './pr/merge.js';
import prShow from './pr/show.js';
import prTriage from './pr/triage.js';
import prView from './pr/view.js';
import prWait from './pr/wait.js';
import releaseStatus from './release/status.js';
import releaseTag from './release/tag.js';
import roadmap from './roadmap.js';
import selfUpdate from './self-update.js';
import skillBackfill from './skill/backfill.js';
import skillCheck from './skill/check.js';
import skillDemote from './skill/demote.js';
import skillList from './skill/list.js';
import skillSearch from './skill/search.js';
import skillShow from './skill/show.js';
import status from './status.js';
import usage from './usage.js';

/** The core subjects, in roster order. */
export const CORE_SUBJECTS: readonly SubjectSpec[] = Object.freeze([
  { name: 'plan', summary: 'create plans from specs; list, show and validate them; read their risk and needs' },
  { name: 'loop', summary: 'start a plan; stop, pause, resume, show and list its sessions' },
  { name: 'issue', summary: 'the tracker: list, show, create, comment on and move issues; mark one ready, unblock it and check its references' },
  { name: 'pr', summary: 'the pull request of a branch: one line, in full or in the browser; list, wait on, merge and triage them' },
  { name: 'effort', summary: 'collect session and commit rows; report per plan' },
  { name: 'module', summary: 'list the configured modules; run an action a module provides' },
  { name: 'agent', summary: 'copy an agent definition into the project; list what a session sees' },
  { name: 'skill', summary: 'check a skills directory; list each tier; demote and backfill it' },
  { name: 'instinct', summary: 'check an instincts directory; list and show its records' },
  { name: 'release', summary: 'read the release state of the project; tag the release branch\'s HEAD' },
]);

/** The core commands, in roster order. */
export const CORE_COMMANDS: readonly RafaCommand[] = Object.freeze([
  planCreate,
  planList,
  planShow,
  planValidate,
  planRisk,
  planNeeds,
  loopStart,
  loopStop,
  loopPause,
  loopResume,
  loopStatus,
  loopList,
  issueList,
  issueShow,
  issueCreate,
  issueComment,
  issueMove,
  issueReady,
  issueUnblock,
  issueCheck,
  prCurrent,
  prShow,
  prView,
  prList,
  prWait,
  prMerge,
  prTriage,
  effortCollect,
  effortReport,
  moduleList,
  moduleExec,
  agentVendor,
  agentList,
  agentShow,
  agentSearch,
  skillCheck,
  skillList,
  skillShow,
  skillSearch,
  skillDemote,
  skillBackfill,
  instinctCheck,
  instinctList,
  instinctShow,
  instinctFlag,
  instinctPromote,
  releaseStatus,
  releaseTag,
  status,
  next,
  roadmap,
  init,
  doctor,
  cleanup,
  selfUpdate,
  usage,
  describe,
]);

/** The registry `src/rafa.ts` dispatches through. */
export const CORE_REGISTRY = createCommandRegistry({ subjects: CORE_SUBJECTS, commands: CORE_COMMANDS });
