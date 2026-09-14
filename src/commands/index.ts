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
 * of each is its command. Five of the nine registered so far wrap a
 * phase 0 command (`wrap.ts`), which keeps its own parser and its own
 * writes. `describe` wraps none: it builds its document from the registry
 * its context carries. Nor do `plan list`, `plan show` and
 * `plan validate`, which read plan files with `parsePlan` and share
 * `plan/plan-files.ts`.
 *
 * ## What is registered
 *
 *   - `plan create`, aliased `plan`, so `rafa plan --spec=<file>` still
 *     runs it.
 *   - `plan list`, `plan show <stub> [--tracker]` and
 *     `plan validate <file>`, which start no session.
 *   - `loop start`, aliased `start`.
 *   - `effort collect` and `effort report`, whose spelling is phase 0's.
 *   - `usage`, top-level.
 *   - `describe`, top-level: the schema 2 roster of the registry the line
 *     was routed through.
 *
 * Typing an alias prints one deprecation line on stderr before the
 * command runs (`src/cli/dispatch.ts`).
 *
 * The subjects are the three with an action registered: a subject with
 * none would show in every roster and dispatch nothing. `issue` and
 * `module` join with their first action, as `init`, `doctor` and
 * `self-update` join with the tasks that bring them.
 */
import type { RafaCommand } from '../cli/command.js';
import type { SubjectSpec } from '../cli/registry.js';

import { createCommandRegistry } from '../cli/registry.js';

import describe from './describe.js';
import effortCollect from './effort/collect.js';
import effortReport from './effort/report.js';
import loopStart from './loop/start.js';
import planCreate from './plan/create.js';
import planList from './plan/list.js';
import planShow from './plan/show.js';
import planValidate from './plan/validate.js';
import usage from './usage.js';

/** The core subjects, in roster order. */
export const CORE_SUBJECTS: readonly SubjectSpec[] = Object.freeze([
  { name: 'plan', summary: 'create a plan from a spec; list, show and validate plans' },
  { name: 'loop', summary: 'start a plan through the loop, one task per session' },
  { name: 'effort', summary: 'collect session and commit rows; report per plan' },
]);

/** The core commands, in roster order. */
export const CORE_COMMANDS: readonly RafaCommand[] = Object.freeze([
  planCreate,
  planList,
  planShow,
  planValidate,
  loopStart,
  effortCollect,
  effortReport,
  usage,
  describe,
]);

/** The registry `src/rafa.ts` dispatches through. */
export const CORE_REGISTRY = createCommandRegistry({ subjects: CORE_SUBJECTS, commands: CORE_COMMANDS });
