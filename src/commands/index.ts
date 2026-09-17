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
 * of each is its command. Five of the twenty-four registered so far wrap a
 * phase 0 command (`wrap.ts`), which keeps its own parser and its own
 * writes. `describe` wraps none: it builds its document from the registry
 * its context carries. Nor do `plan list`, `plan show` and
 * `plan validate`, which read plan files with `parsePlan` and share
 * `plan/plan-files.ts`, nor `loop stop`, `pause`, `resume`, `status` and
 * `list`, which act on a run through its session record and share
 * `loop/loop-sessions.ts`, nor `init`, which sets up a project through
 * `src/project/`, nor `doctor`, which checks the preflight through
 * `src/preflight/` and starts no run, nor the five `issue` actions, which
 * act on the tracker the chain resolves and share
 * `issue/issue-tracker.ts`, nor `self-update`, which installs the
 * checkout through `src/runtime/install.ts`, nor `module list` and
 * `module exec`, which read the modules `src/modules/load.ts` loads and
 * the mounts the dispatcher made.
 *
 * ## What is registered
 *
 *   - `plan create`, aliased `plan`, so `rafa plan --spec=<file>` still
 *     runs it.
 *   - `plan list`, `plan show <stub> [--tracker]` and
 *     `plan validate <file>`, which start no session.
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
 *   - `effort collect` and `effort report`, whose spelling is phase 0's.
 *   - `module list`, every module the config gives a source for and what
 *     it came to, and `module exec <module> <action>`, the `exec` action a
 *     module's mounted commands are reached through.
 *   - `init [--root=<path>] [--yes]`, top-level: the project root, its
 *     `.rafa/` scope and `.gitignore` entry, and the user scope.
 *   - `doctor [--plan=<file>]`, top-level: the preflight `loop start`
 *     checks, checked and printed with no run started, beside two
 *     warnings about the install.
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
 * The subjects are the five with an action registered: a subject with
 * none would show in every roster and dispatch nothing.
 */
import type { RafaCommand } from '../cli/command.js';
import type { SubjectSpec } from '../cli/registry.js';

import { createCommandRegistry } from '../cli/registry.js';

import describe from './describe.js';
import doctor from './doctor.js';
import effortCollect from './effort/collect.js';
import effortReport from './effort/report.js';
import init from './init.js';
import issueComment from './issue/comment.js';
import issueCreate from './issue/create.js';
import issueList from './issue/list.js';
import issueMove from './issue/move.js';
import issueShow from './issue/show.js';
import loopList from './loop/list.js';
import loopPause from './loop/pause.js';
import loopResume from './loop/resume.js';
import loopStart from './loop/start.js';
import loopStatus from './loop/status.js';
import loopStop from './loop/stop.js';
import moduleExec from './module/exec.js';
import moduleList from './module/list.js';
import planCreate from './plan/create.js';
import planList from './plan/list.js';
import planShow from './plan/show.js';
import planValidate from './plan/validate.js';
import selfUpdate from './self-update.js';
import usage from './usage.js';

/** The core subjects, in roster order. */
export const CORE_SUBJECTS: readonly SubjectSpec[] = Object.freeze([
  { name: 'plan', summary: 'create a plan from a spec; list, show and validate plans' },
  { name: 'loop', summary: 'start a plan; stop, pause, resume, show and list its sessions' },
  { name: 'issue', summary: 'the tracker: list, show, create, comment on and move issues' },
  { name: 'effort', summary: 'collect session and commit rows; report per plan' },
  { name: 'module', summary: 'list the configured modules; run an action a module provides' },
]);

/** The core commands, in roster order. */
export const CORE_COMMANDS: readonly RafaCommand[] = Object.freeze([
  planCreate,
  planList,
  planShow,
  planValidate,
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
  effortCollect,
  effortReport,
  moduleList,
  moduleExec,
  init,
  doctor,
  selfUpdate,
  usage,
  describe,
]);

/** The registry `src/rafa.ts` dispatches through. */
export const CORE_REGISTRY = createCommandRegistry({ subjects: CORE_SUBJECTS, commands: CORE_COMMANDS });
