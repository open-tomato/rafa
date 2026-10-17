/**
 * The `tests` section of the config schema: the three settings the
 * runner reads when it chooses which tests a recorded step runs, the one
 * that names the contract tests, and the one that says whether a step reruns a newly red file alone, each one's
 * field, its default, its spec and its reader. {@link TESTS_SECTION}
 * hands them to core as one `ConfigSection`, package `tests`, and the
 * `declare module` below adds {@link TestsSettings} to `RafaConfig`.
 * {@link TestsShape} holds the keys a file writes, which
 * `src/config/shape.ts` composes into `ConfigShape`, the nested file shape.
 * `config-registry.ts`'s `CONFIG_DEFAULTS` and `SETTINGS`
 * spread the objects below last, after the `task` section, so the order
 * settings are reported in holds the section.
 *
 * The section has its own module, as `config-schema-release.ts` does,
 * because `config-sections.ts` stood at 699 lines, measured with
 * `wc -l`, when these keys were added, and takes nothing new under the
 * 800-line cap of `context/source.md`. The one reader the four glob keys
 * share, {@link globList}, is a rule about a VALUE and sits here all the
 * same, for that reason. `config-registry.ts` imports this file to spread
 * it; a caller reads these settings off the resolved `RafaConfig`.
 *
 * ## The four glob keys
 *
 * `.rafa/plans/PLAN-rafa-479-loop-task-sessions-run.md` names the first
 * two, the plan `rafa-683-content-sweeps-lint-run` the third, and the
 * plan `rafa-807-spec-monorepo-bootstrap-turbo` the fourth. Each
 * is a list of glob patterns, matched against a path relative to the
 * repository root, the form `git diff --name-only` answers with:
 *
 *   - `tests.fullSuiteTriggers` names the files a task's diff runs the
 *     full suite for, however the task line scoped its tests. Its
 *     default is empty. The `escalation` template
 *     (`src/config/templates.ts`) names the five files whose change can
 *     move a test no import graph reaches: `bunfig.toml`,
 *     `tsconfig*.json`, `package.json`, `bun.lock` and `bun.lockb`. The
 *     runner adds the preload files `bunfig.toml`'s `[test] preload`
 *     names to whatever list resolves, empty included, and those are in
 *     no list here: which files a project preloads is a question about
 *     its disk, answered at run time by the reader of the scope.
 *   - `tests.integration` names the test files a stage step runs beside
 *     the tests under the folders the stage touched, because they drive
 *     the whole CLI rather than one folder's modules. Its default is
 *     empty. The `escalation` template names the four spellings this
 *     repository gives such a file, in any folder: a name ending
 *     `-integration.test.ts` or `.integration.test.ts`, one holding
 *     `-spawned` and ending `.test.ts`, and one ending `-cli.test.ts`.
 *     Each of its patterns opens with the any-folder prefix, two stars
 *     and a slash, which this note cannot spell because it would close
 *     the comment.
 *   - `tests.contract` names the contract tests. A contract test checks
 *     the promise a package makes to others, with a fixture, and runs in
 *     that package's own `test` task in ring 1 of CI, where a use-case
 *     test matching `tests.integration` runs in ring 0's full run. Its
 *     default is empty. The `escalation` template names one pattern: a
 *     name ending `.contract.test.ts`, in any folder, under the same
 *     any-folder prefix. No step reads the key
 *     yet; its readers come with the CI rings that run each kind.
 *   - `tests.alwaysRun` names the test files a task's scoped run takes
 *     beside the ones `bun test --changed=<base>` selects. A content
 *     sweep, a test that imports no project file and reads the tree at
 *     run time, sits outside every import graph, so no changed file ever
 *     selects one. Its default is one pattern: any file under `src/`
 *     whose name ends `.sweep.test.ts`, the suffix this repository gives
 *     a content sweep. A pattern that matches no file today is accepted,
 *     since the sweeps it names may not have been written yet. The task
 *     prompt reads it (`start/task-gate-lines.ts`), naming the files it
 *     resolves to, and so does the runner's task step
 *     (`start/task-always-run.ts`), running those files beside a
 *     `module` or `affected` scope.
 *
 * An empty list is a value every glob key accepts, and means what it says:
 * no file triggers the full suite beyond the preload files, a stage
 * runs no integration file, no file is a contract test, or a task runs
 * no sweep beside its scoped tests. The first three default to it, so a
 * project that names no template runs no trigger, no integration file
 * and no contract file; one that writes `templates: [escalation]` takes
 * the template's lists under its own keys. A list written `[]` has been
 * said, and outranks the template's.
 *
 * ## The reader
 *
 * {@link globList} takes a list whose every entry is a non-empty
 * string, as `cleanup.keep` does, and refuses one more entry `text`
 * would take: an absolute path. The paths a pattern is matched against
 * are relative to the repository root, so a pattern opening with `/`
 * matches nothing, and a trigger that can never fire is the silent
 * failure this key exists to prevent. No other check is made on the
 * pattern: `Bun.Glob` builds a matcher from any string, so there is no
 * malformed glob to refuse.
 *
 * ## The switch
 *
 * `tests.retakeRedAlone` says whether a task, stage or pre-wrap-up step
 * that reads new failures reruns each newly red test file alone, once,
 * before it settles (`start/suite-retake-alone.ts`). A file green alone
 * was red only in the step's own file order, by state another test file
 * left in the shared process, and is reported as such rather than handed
 * to a repair task (issue 926: one run of 2026-10-10 inserted five repair
 * tasks for a file each repair session found green). Two readings:
 *
 *   - It defaults to `true`. The retake costs one `bun test <file>` per
 *     newly red file and only on a step already red, and what it saves is
 *     a repair session per order-dependent file. `false` switches the
 *     retake off and nothing else: every new failure blocks, and no file
 *     is run a second time. The error lines a step keeps for each failed
 *     case (`suite/failure-lines.ts`), on its record, in its output file
 *     and in its blocker, are kept either way; no key turns them off.
 *   - It is read through `flag` (`config-sections.ts`), a YAML boolean
 *     and nothing spelled like one, as `status.notice` is.
 *
 * No key here is a `CommandLineSetting`: four are lists, which the
 * command line has no spelling for, as `config-schema.ts` says, and the
 * switch is none for the reason the `pr` section gives
 * (`config-schema-readings.ts`): a global flag nobody typed would be one
 * this module invented.
 */
import type { ConfigSection, SettingSpec } from '@open-tomato/rafa/core/config';
import type { Reader } from '@open-tomato/rafa/core/config/sections';

import { isAbsolute } from 'node:path';

import { flag, listOf, refused, text } from '@open-tomato/rafa/core/config/sections';

declare module '@open-tomato/rafa/core/config/config-schema' {
  /** The `tests` section's fields, added to core's. */
  interface RafaConfig extends TestsSettings {}
}

/** The `tests` keys a file writes; `src/config/shape.ts` composes them into `ConfigShape`. */
export interface TestsShape {
  readonly tests: {
    readonly fullSuiteTriggers: readonly string[];
    readonly integration: readonly string[];
    readonly contract: readonly string[];
    readonly alwaysRun: readonly string[];
    readonly retakeRedAlone: boolean;
  };
}

/** The `tests` section's settings, resolved. */
export interface TestsSettings {
  /**
   * Globs naming the files whose change runs the full suite at a task
   * step, beside `bunfig.toml`'s preload files. `tests.fullSuiteTriggers`.
   */
  testsFullSuiteTriggers: readonly string[];
  /**
   * Globs naming the test files every stage step runs.
   * `tests.integration`.
   */
  testsIntegration: readonly string[];
  /**
   * Globs naming the contract tests, each checking the promise a package
   * makes to others. `tests.contract`.
   */
  testsContract: readonly string[];
  /**
   * Globs naming the test files a task's scoped run takes beside the
   * changed-file selection. `tests.alwaysRun`.
   */
  testsAlwaysRun: readonly string[];
  /**
   * Whether a step reading new failures reruns each newly red test file
   * alone, once, before it settles. `tests.retakeRedAlone`.
   */
  testsRetakeRedAlone: boolean;
}

/** What a glob-list entry is described as when it is refused. */
const GLOB_PATTERN = 'a glob pattern relative to the repository root';

/**
 * Accepts one glob pattern: a non-empty string that is not an absolute
 * path. The module note says why an absolute one is refused.
 */
const repoGlob: Reader<string> = (raw, at) => typeof raw === 'string' && isAbsolute(raw)
  ? refused(at, raw, GLOB_PATTERN)
  : text(GLOB_PATTERN)(raw, at);

/**
 * The reader the four glob settings share: a list of glob patterns, each
 * relative to the repository root, answered frozen in the order written.
 */
export const globList: Reader<readonly string[]> = listOf(repoGlob, 'glob patterns');

/** What every `tests` setting resolves to when no layer names it. */
export const TESTS_DEFAULTS: Readonly<TestsSettings> = Object.freeze({
  testsFullSuiteTriggers: Object.freeze([]),
  testsIntegration: Object.freeze([]),
  testsContract: Object.freeze([]),
  testsAlwaysRun: Object.freeze(['src/**/*.sweep.test.ts']),
  testsRetakeRedAlone: true,
});

/** The `tests` section's setting specs, in the order problems are reported. */
export const TESTS_SETTINGS: {
  readonly [K in keyof TestsSettings]: SettingSpec<K>;
} = {
  testsFullSuiteTriggers: {
    key: 'tests.fullSuiteTriggers',
    read: globList,
    cli: false,
  },
  testsIntegration: { key: 'tests.integration', read: globList, cli: false },
  testsContract: { key: 'tests.contract', read: globList, cli: false },
  testsAlwaysRun: { key: 'tests.alwaysRun', read: globList, cli: false },
  testsRetakeRedAlone: { key: 'tests.retakeRedAlone', read: flag, cli: false },
};

/** The `tests` section: the five `tests` keys, with their defaults and no check. */
export const TESTS_SECTION: ConfigSection = Object.freeze({
  package: 'tests',
  settings: Object.freeze(TESTS_SETTINGS),
  defaults: TESTS_DEFAULTS,
});
