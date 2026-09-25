/**
 * The files and directories `rafa init` writes for a project scope and a
 * user scope: step 4 of `rafa init` and the scope table under "Scope
 * resolution" in `.rafa/specs/phase-1-installable.md`.
 *
 * {@link writeProjectScope} writes `<root>/.rafa/`, its `config.yaml` and
 * the project tree, and {@link writeUserScope} writes `<home>/.rafa/`, its
 * `config.yaml` and `instincts/`. Each writes only what is missing and
 * answers one {@link ScopeWrite} per path, `created` or `unchanged`, so a
 * rerun over a scope already written changes no byte and says so.
 * {@link scaffoldConflicts} names every path either would fail on, for a
 * caller to refuse before it writes anything. The `.gitignore` entry is
 * `gitignore.ts`'s, and choosing the root is `roots.ts`'s and
 * `root-choice.ts`'s. This module prints nothing.
 *
 * ## The trees
 *
 * The project tree is the spec's table: `specs/`, `plans/`, `runs/`,
 * `effort/` and `instincts/` under `.rafa/`, each created empty. It is
 * that table and not `plan.dir` or `specs.dir` as the config resolves
 * them: the file written names neither, so both resolve to the
 * directories created here unless the user scope's file moves them, and
 * a directory a user scope names elsewhere is the command's to create
 * that writes into it. The user tree is `instincts/`; the shared skills
 * tier the table also lists arrives in phase 6.
 *
 * ## The config files
 *
 * Each file holds `version: 1` and every other setting commented out at
 * its default, {@link CONFIG_SETTINGS_LINES}, under a header naming what
 * outranks what. So a file `init` writes sets nothing but its version:
 * a project's file leaves every setting to the user scope's, and the
 * user scope's to the defaults, exactly as with no file at all. Written
 * out uncommented, the project file would pin every default and hide
 * each setting the user scope names. Uncommenting every setting line
 * parses to {@link CONFIG_DEFAULTS}, which the tests hold, so a setting
 * added to the schema without a line here is caught there.
 *
 * Two lines carry their key and no value, `pr.provider` and `pr.base`,
 * because each resolves to null and null is what a key with no value
 * parses to. Uncommented they are silent, so those two settings resolve
 * from the defaults layer where every other resolves from the file, and
 * the tests name both. The line is written anyway: it tells an operator
 * the key exists and what it takes, which is the whole point of a
 * template of commented settings.
 *
 * The `tiers`, `routing` and `task` sections close the template.
 * `tiers.skills` and `tiers.agents` are written as `{}`, their empty
 * default, and `routing` as one line per row of `tiers/routing.ts`'s
 * `DEFAULT_ROUTES`, so the template cannot drift from the defaults the
 * schema answers. `task.skills` and `task.lessons` are written from
 * `CONFIG_DEFAULTS`, at `planner` and `on`.
 *
 * A file is written only when nothing is at its path, with the `wx` flag,
 * so a file that appears between the check and the write is refused by
 * the system rather than overwritten. An existing file is never read,
 * rewritten or judged here: `loadConfig` judges it.
 *
 * ## Conflicts
 *
 * A directory the tree needs whose path holds anything but a directory,
 * a link to nothing included, is a conflict, and so is a config path
 * holding a link to nothing: `existsSync` answers false for one, so the
 * write would be attempted and fail. A config path holding a directory
 * is `loadConfig`'s refusal, which a caller meets before writing.
 */
import { existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { CONFIG_DEFAULTS, configFilePath } from '../config.js';
import { DEFAULT_ROUTES } from '../tiers/routing.js';

import { scopeAt } from './scope.js';

/** The directories of a project tree, under `<root>/.rafa/`, in the order they are written. */
export const PROJECT_TREE = Object.freeze(['specs', 'plans', 'runs', 'effort', 'instincts'] as const);

/** The directories of a user tree, under `<home>/.rafa/`. */
export const USER_TREE = Object.freeze(['instincts'] as const);

/**
 * Every setting of the schema but `version`, commented out at its
 * default, in the order of the spec's block. See the module note.
 */
export const CONFIG_SETTINGS_LINES = Object.freeze([
  `# store: ${CONFIG_DEFAULTS.store}                  # sqlite | ndjson`,
  '# plan:',
  `#   inject: ${CONFIG_DEFAULTS.inject}                # full | stage | task`,
  `#   dir: ${CONFIG_DEFAULTS.planDir}`,
  '# specs:',
  `#   dir: ${CONFIG_DEFAULTS.specsDir}`,
  '# tracker:',
  `#   default: ${CONFIG_DEFAULTS.trackerDefault}              # github | local, or a kind an add-on brings`,
  `#   fallback: [${CONFIG_DEFAULTS.trackerFallback.join(', ')}]`,
  '# learning:',
  `#   adapter: ${CONFIG_DEFAULTS.learningAdapter}`,
  '#   bless:',
  `#     minConfidence: ${String(CONFIG_DEFAULTS.learningBlessMinConfidence)}         # 0.3..0.9, the least confidence of a lesson tasks may use`,
  '#   promote:',
  `#     after: ${String(CONFIG_DEFAULTS.learningPromoteAfter)}                   # distinct sources a lesson needs before the wrap-up promotes it`,
  `#     minConfidence: ${String(CONFIG_DEFAULTS.learningPromoteMinConfidence)}         # 0.3..0.9, the least confidence of a lesson to promote`,
  '# output:',
  `#   mode: ${CONFIG_DEFAULTS.outputMode}                   # text | json`,
  '# prerequisites:',
  '#   required: []',
  '#   optional: []',
  '# tracking:',
  `#   specs: ${String(CONFIG_DEFAULTS.trackingSpecs)}                 # true tracks .rafa/specs/ in git`,
  `#   plans: ${String(CONFIG_DEFAULTS.trackingPlans)}                 # true tracks .rafa/plans/ in git`,
  `#   all: ${String(CONFIG_DEFAULTS.trackingAll)}                   # true tracks .rafa/ but its private triage`,
  '# modules: []',
  '# allowList: []',
  '# loop:',
  `#   settingSources: ${CONFIG_DEFAULTS.settingSources.join(',')}   # a comma-separated subset of user, project, local`,
  '# pr:',
  '#   provider:                    # gh | none; unset reads it off the origin remote',
  `#   mergeMethod: ${CONFIG_DEFAULTS.prMergeMethod}          # squash | merge | rebase`,
  '#   base:                        # the branch a PR opens into; unset is the remote default',
  `#   resolveBudget: ${String(CONFIG_DEFAULTS.prResolveBudget)}             # US dollars per pr triage --resolve session`,
  '# board:',
  '#   trustedAuthors: []           # logins trusted with board text besides the repo write-holders',
  '# roadmap:',
  '#   issue:                       # the issue plan create --next reads; unset is the one titled Roadmap',
  '# release:',
  `#   enabled: ${String(CONFIG_DEFAULTS.releaseEnabled)}               # true | false | auto, which is on when both files below exist`,
  `#   versionFile: ${CONFIG_DEFAULTS.releaseVersionFile}`,
  `#   changelog: ${CONFIG_DEFAULTS.releaseChangelog}`,
  `#   heading: "${CONFIG_DEFAULTS.releaseHeading}"`,
  '# cleanup:',
  `#   staleDays: ${String(CONFIG_DEFAULTS.cleanupStaleDays)}                # days before rafa cleanup lists a branch as Stale`,
  `#   worktreeIdleDays: ${String(CONFIG_DEFAULTS.cleanupWorktreeIdleDays)}          # days before rafa cleanup lists a worktree as idle`,
  '#   keep: []                     # glob patterns naming branches rafa cleanup never lists',
  '# dangerous:',
  `#   acceptStaleRefs: ${String(CONFIG_DEFAULTS.dangerousAcceptStaleRefs)}       # true plans past dangling and suspect spec references on every run`,
  '# status:',
  `#   notice: ${String(CONFIG_DEFAULTS.statusNotice)}                 # false drops the one-line notice of what is new since the last command`,
  '# tiers:',
  `#   rafa: ${CONFIG_DEFAULTS.tiersRafa}                     # on | off, whether the skills and agents rafa ships are served`,
  '#   skills: {}                   # name: false turns a skill off; name: project | rafa | user pins its tier',
  '#   agents: {}                   # name: false turns an agent off; name: project | rafa | user pins its tier',
  '# routing:',
  ...DEFAULT_ROUTES.map(([shape, agent]) => `#   ${shape}: ${agent}`),
  '# task:',
  `#   skills: ${CONFIG_DEFAULTS.taskSkills}                # planner | tag | none, the resolver that picks a task's skills`,
  `#   lessons: ${CONFIG_DEFAULTS.taskLessons}                    # on | off, whether blessed lessons join a task's prompt`,
]);

/** The line every file opens its settings with. */
const VERSION_LINE = `version: ${String(CONFIG_DEFAULTS.version)}`;

/** The header of the project scope's file. */
const PROJECT_HEADER = Object.freeze([
  '# rafa project config, written by rafa init and left as it is on a rerun.',
  '#',
  '# Every setting is commented out at its default. Uncomment one, with its',
  '# section line, to set it for this project. A setting set here outranks',
  '# the same one in the user scope, ~/.rafa/config.yaml, and a setting set',
  '# in neither takes the default shown.',
]);

/** The header of the user scope's file. */
const USER_HEADER = Object.freeze([
  '# rafa user config, read under every project on this machine, written by',
  '# rafa init when it was missing.',
  '#',
  '# Every setting is commented out at its default. Uncomment one, with its',
  '# section line, to set it for every project. A project\'s own',
  '# .rafa/config.yaml outranks it setting by setting.',
]);

/** A header, the version line and the settings, as one file's text. */
function configText(header: readonly string[]): string {
  return [...header, VERSION_LINE, ...CONFIG_SETTINGS_LINES, ''].join('\n');
}

/** The text `rafa init` writes to a project's `.rafa/config.yaml`. */
export function projectConfigText(): string {
  return configText(PROJECT_HEADER);
}

/** The text `rafa init` writes to `~/.rafa/config.yaml` when it is missing. */
export function userConfigText(): string {
  return configText(USER_HEADER);
}

/** What a path is. */
export type ScopeWriteKind = 'file' | 'directory';

/** How a write left its path. */
export type ScopeWriteChange = 'created' | 'updated' | 'unchanged';

/** One path a scope writer checked, and what it did there. */
export interface ScopeWrite {
  /** The path, absolute when the base was. */
  readonly path: string;
  readonly kind: ScopeWriteKind;
  readonly change: ScopeWriteChange;
}

/** A path the scope writer could not write. */
export class ScaffoldError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`rafa init: ${message}`, options);
    this.name = 'ScaffoldError';
  }
}

/** The directories and config file of the scope under `base`, directories in write order. */
interface ScopeLayout {
  readonly dirs: readonly string[];
  readonly configFile: string;
}

/** The layout of a scope under `base`, holding `tree` under its `.rafa/`. */
function layoutOf(base: string, tree: readonly string[]): ScopeLayout {
  const scope = scopeAt(base);
  return { dirs: [scope.dir, ...tree.map((name) => join(scope.dir, name))], configFile: configFilePath(base) };
}

/** True when anything is at `path`, a link to nothing included. */
function occupied(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

/** True when `path`, symlinks followed, is a directory. */
function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** The conflict at a directory path, or null when a directory is there or nothing is. */
function directoryConflict(dir: string): string | null {
  if (!occupied(dir) || isDirectory(dir)) return null;
  return existsSync(dir)
    ? `${dir} is not a directory`
    : `${dir} is a link to nothing`;
}

/**
 * The conflicts of one layout; see the module note. A scope directory in
 * conflict is the only one named, since nothing under a path that is no
 * directory can be read as a path of its own.
 */
function layoutConflicts(layout: ScopeLayout): readonly string[] {
  const [scopeDir, ...tree] = layout.dirs;
  const opening = scopeDir === undefined
    ? null
    : directoryConflict(scopeDir);
  if (opening !== null) return [opening];
  const dirs = tree.flatMap((dir) => directoryConflict(dir) ?? []);
  const file = occupied(layout.configFile) && !existsSync(layout.configFile)
    ? [`${layout.configFile} is a link to nothing`]
    : [];
  return [...dirs, ...file];
}

/**
 * One sentence per path the project scope under `root` or the user scope
 * under `home` could not be written at, or an empty list; see the module
 * note. A caller refuses on any before calling a writer.
 */
export function scaffoldConflicts(root: string, home: string): readonly string[] {
  return [...layoutConflicts(layoutOf(root, PROJECT_TREE)), ...layoutConflicts(layoutOf(home, USER_TREE))];
}

/** Runs `act`, turning what it throws into a {@link ScaffoldError} naming `path`. */
function attempt(path: string, failure: string, act: () => void): void {
  try {
    act();
  } catch (error) {
    throw new ScaffoldError(`${path} ${failure} (${messageOf(error)})`, { cause: error });
  }
}

/** Creates the directory at `path` when nothing is there. */
function ensureDirectory(path: string): ScopeWrite {
  if (existsSync(path)) return { path, kind: 'directory', change: 'unchanged' };
  attempt(path, 'cannot be created', () => {
    mkdirSync(path, { recursive: true });
  });
  return { path, kind: 'directory', change: 'created' };
}

/** Writes `text` to `path` when nothing is there, never over a file that appears meanwhile. */
function ensureFile(path: string, text: string): ScopeWrite {
  if (existsSync(path)) return { path, kind: 'file', change: 'unchanged' };
  attempt(path, 'cannot be written', () => {
    writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
  });
  return { path, kind: 'file', change: 'created' };
}

/** Writes a layout: its scope directory, its config file, then the rest of its tree. */
function writeLayout(layout: ScopeLayout, text: string): readonly ScopeWrite[] {
  const [scopeDir, ...tree] = layout.dirs;
  const opened = scopeDir === undefined
    ? []
    : [ensureDirectory(scopeDir)];
  return [...opened, ensureFile(layout.configFile, text), ...tree.map(ensureDirectory)];
}

/**
 * Writes what is missing of the project scope under `root`: `.rafa/`,
 * `.rafa/config.yaml` holding {@link projectConfigText}, then each
 * directory of {@link PROJECT_TREE}. Answers one write per path, in that
 * order. Throws a {@link ScaffoldError} for a path it cannot write.
 */
export function writeProjectScope(root: string): readonly ScopeWrite[] {
  return writeLayout(layoutOf(root, PROJECT_TREE), projectConfigText());
}

/**
 * Writes what is missing of the user scope under `home`: `.rafa/`,
 * `.rafa/config.yaml` holding {@link userConfigText}, then `instincts/`.
 * Answers one write per path, in that order. Throws a
 * {@link ScaffoldError} for a path it cannot write.
 */
export function writeUserScope(home: string): readonly ScopeWrite[] {
  return writeLayout(layoutOf(home, USER_TREE), userConfigText());
}
