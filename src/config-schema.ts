/**
 * The schema half of rafa's settings: which settings exist, the file key
 * each is spelled with, the reader each value goes through, and what
 * each resolves to when no layer names it.
 *
 * This module answers questions about KEYS. `config.ts` ranks LAYERS —
 * text into a layer, layers into one resolution — and re-exports
 * {@link RafaConfig}, {@link CONFIG_DEFAULTS} and {@link CONFIG_FILE},
 * so nothing outside the pair imports this file. `config-sections.ts`
 * holds every rule about a VALUE: the readers, the closed lists, the
 * item shapes, and why nothing is coerced. The one reader here is
 * {@link mapOf}, because what it rules on is a KEY: the names a map
 * setting's file spells below its own key.
 *
 * The trio sits under the 800-line cap of `context/source.md`, which no
 * gate reads. Measured with `wc -l` at the commit that added the `pr`
 * section: `config-schema.ts` is 396 lines, `config.ts` 506 and
 * `config-sections.ts` 478.
 *
 * ## The schema
 *
 * The block under "Config schema" in `.rafa/specs/phase-1-installable.md` is
 * the schema and its defaults. Each {@link RafaConfig} field names the
 * file key it holds, and {@link CONFIG_DEFAULTS} spells each default.
 * A field joins section and key in camel case where the key needs its
 * section to say what it is: `plan.dir` is `planDir`. Two fields drop
 * the section, the key naming the setting by itself: `inject`, named in
 * phase 0 before any other plan key existed, and `settingSources`.
 *
 * Four readings the spec leaves to this module:
 *
 *   - `tracker.default`, `tracker.fallback` and `learning.adapter`
 *     accept any kind name. Whether a kind has an adapter is the adapter
 *     registry's answer at selection, since an add-on brings kinds core
 *     has never heard of (`linear`, `remote`). `output.mode` stays
 *     closed: the spec names `text` and `json` and no add-on mode.
 *   - Both prerequisite tiers default to EMPTY. The items in the spec's
 *     block show the shape and are not defaults. As defaults, a required
 *     `GITHUB_TOKEN` and `gh auth status` would halt every run on a
 *     machine without them, even one on the `local` tracker. They would
 *     also have every scratch run probe the real home, and would name
 *     `mgrep` known-missing in every prompt.
 *   - `version` accepts `1` alone. A later number says the keys were
 *     written for a schema whose meaning moved, which a warning cannot
 *     cover. The parser reads `1.0`, `01` and `0x1` as the number 1.
 *   - `loop.settingSources` is the key finding 3 of the spec names. It
 *     resolves to a list in the order written, because the list is what
 *     a caller asks (does it include `user`?) and rebuilds the flag from.
 *
 * ## The `pr` section
 *
 * `.rafa/specs/rafa-20-pr-commands.md` spells it `pr: { provider: gh | none,
 * mergeMethod: squash | merge | rebase, base: <default branch> }`, and
 * names `pr.resolveBudget` as what a `triage --resolve` session's
 * `--max-budget-usd` comes from. Four readings it leaves to this module:
 *
 *   - `pr.provider` and `pr.base` default to NULL, and null here means
 *     "nobody has said", not "off". The spec's default for the provider
 *     is `gh` when `origin` is a GitHub remote and `none` otherwise, and
 *     its default base is whatever the remote calls its default branch;
 *     neither is a value this module can spell, because both are read
 *     off the repository at use (`pr/provider.ts`). Writing either
 *     default as a literal would be the silent choice the config refuses
 *     everywhere else: `prBase: 'main'` would open a pull request into a
 *     branch that may not exist on a repository whose default is
 *     `master`. A file spelling `provider:` or `base:` with no value
 *     says nothing, as every null does, and resolves to the same null.
 *   - `pr.mergeMethod` defaults to `squash`, the first method the spec
 *     lists and the one the merge flow is written for: it deletes the
 *     local branch with `-D` because a squash leaves it unmerged in
 *     git's eyes.
 *   - `pr.resolveBudget` defaults to 2 US dollars, which the attempt
 *     guard's default of two attempts caps at 4 for one pull request.
 *     It is a number and not null: the spec has every resolve run carry
 *     `--max-budget-usd`, so a session with no budget is not a state
 *     this setting can be left in.
 *   - No `pr` setting is a {@link CommandLineSetting}. `pr merge` takes
 *     a `--method` flag, but that flag is the command's own argument for
 *     one merge, read by the command beside this setting, and not a
 *     layer over the config: a global `--merge-method` nobody typed
 *     would be a flag this module invented.
 *
 * ## The `board` section
 *
 * `.rafa/specs/rafa-20-pr-commands.md` names `board.trustedAuthors` as the
 * allow-list beside the permission reading `src/board/trust.ts` makes:
 * text off the board reaches an agent's prompt, so its author must hold
 * write access on the repository or be listed here. Two readings it
 * leaves to this module:
 *
 *   - It defaults to the EMPTY list, and empty is a working default
 *     rather than a placeholder: with nothing listed, the permission
 *     reading alone decides, which is the answer GitHub already holds
 *     for every member. A name here is for the author a permission
 *     lookup cannot speak for — a bot account, or a maintainer whose
 *     access is held through an organisation the endpoint does not
 *     report — and inventing one as a default would trust an account
 *     nobody named.
 *   - Each entry goes through `githubLogin` and not through `text`,
 *     because a login from this setting is spliced into the
 *     collaborators path; `config-sections.ts` records what that
 *     narrower shape refuses and why.
 *
 * ## The `roadmap` section
 *
 * `.rafa/specs/rafa-20-pr-commands.md` has `plan create --next` read its
 * order off "the roadmap issue named by `roadmap.issue` in config, else
 * the pinned issue titled Roadmap". Two readings it leaves here:
 *
 *   - It defaults to NULL, and null means "nobody has said" as it does
 *     for `pr.provider` and `pr.base`. The fallback the spec names — the
 *     issue titled `Roadmap` — is a number only a repository can answer,
 *     and `src/board/roadmap.ts` asks it at use. Writing a literal here
 *     would point every repository that has not run `rafa init --board`
 *     at one project's issue number.
 *   - It is a number and not a string. `gh issue view <n>` takes the
 *     number, `src/board/naming.ts` refuses anything that is not a
 *     positive whole one, and `issueNumber` refuses it here instead,
 *     where a person can still fix the file.
 *
 * ## The `release` section
 *
 * `.rafa/specs/rafa-21-changelog-and-release.md` spells it `release: {
 * enabled: auto, versionFile: package.json, changelog: CHANGELOG.md,
 * heading: "## {version} — {date}, {title}" }`, and those four values
 * are the defaults here. Four readings it leaves to this module:
 *
 *   - `release.enabled` is not a flag. `auto`, its default, is a third
 *     value meaning "on when both files below exist" — a reading
 *     `release/enabled.ts` makes against a disk, which no value here
 *     could stand for. What the reader takes beside it, and why `on`
 *     and `off` are refused, is `config-sections.ts`'s to say.
 *   - `release.versionFile` and `release.changelog` are paths relative
 *     to the repository root, and neither is null. Null elsewhere here
 *     means "nobody has said", and the spec has said: `package.json`
 *     and `CHANGELOG.md`. The absence the spec cares about is the
 *     FILE's — "a project with no version file gets the changelog
 *     entry under a date heading and no bump" — which is a question
 *     about a disk, answered at use and not spellable as a default.
 *   - `release.heading` is free text. The spec makes it a template so
 *     "a consumer's changelog has another shape" is an edit rather
 *     than a fork, and which placeholders it may carry, and what an
 *     unknown one renders to, is `release/changelog.ts`'s to say. So
 *     nothing here refuses a heading for the placeholders it spells.
 *   - No `release` setting is a {@link CommandLineSetting}, for the
 *     reason the `pr` section gives: the `release` commands read these
 *     settings beside their own arguments, and a global flag nobody
 *     typed would be one this module invented.
 *
 * ## The `cleanup` section
 *
 * The `rafa cleanup` command rafa-94 builds lists local branches and
 * worktrees for a person to delete, and these three settings shape what
 * it lists. Three readings are this module's:
 *
 *   - `cleanup.staleDays` defaults to 30 and `cleanup.worktreeIdleDays`
 *     to 7. Both are numbers and never null: each is a threshold the
 *     listing compares against, and a listing with no threshold is not
 *     a state either can be left in. Both go through `dayCount`, which
 *     refuses zero, a fraction and a quoted number.
 *   - `cleanup.keep` defaults to the EMPTY list, as
 *     `board.trustedAuthors` does: with nothing kept, no branch is
 *     spared by name, and inventing a pattern as a default would spare
 *     a branch nobody named. Each entry is a glob pattern kept as
 *     written, through `text`; what a pattern matches is
 *     the cleanup command's to say, so nothing here refuses one for its
 *     syntax.
 *   - No `cleanup` setting is a {@link CommandLineSetting}, for the
 *     reason the `pr` section gives.
 *
 * ## The `dangerous` section
 *
 * `.rafa/specs/rafa-151-references-specs-bugs-are.md` names
 * `dangerous.acceptStaleRefs` as the setting that has check 4 of the
 * readiness gate accept every dangling and suspect reference of a spec
 * on every run, where `--accept-refs` does it for one. The section is named for what
 * its settings waive: each turns a refusal off for every run, where a
 * flag turns it off for the one run a person typed it on. Three
 * readings are this module's:
 *
 *   - `dangerous.acceptStaleRefs` defaults to `false`, and a boolean
 *     rather than null: whether the gate refuses a dangling or suspect
 *     reference is a question with an answer on every run, and the
 *     answer nobody has overridden is that it does.
 *   - It goes through `flag`, so `"true"`, `yes` and `1` are refused
 *     and not read as true, as every `tracking` key refuses them. A
 *     setting that switches a refusal off is the last one a misread
 *     spelling should turn on.
 *   - It is not a {@link CommandLineSetting}. `--accept-refs` is
 *     `plan create`'s own argument for one run and not a layer over
 *     this key, for the reason the `pr` section gives.
 *
 * ## The `status` section
 *
 * `rafa status` prints where a project stands, and the since-last-command
 * notice is the one line on stderr, before a command that runs inside a
 * project, naming `rafa status` or `rafa cleanup` when something is new
 * since the last such command. `status.notice` turns that line off. Two
 * readings are this module's:
 *
 *   - It defaults to `true`, and a boolean rather than null: whether the
 *     line is printed is a question with an answer on every command, and
 *     the answer nobody has overridden is that it is.
 *   - It goes through `flag`, so `"false"`, `no` and `0` are refused and
 *     not read as false, as every `tracking` key refuses them, and it is
 *     not a {@link CommandLineSetting}, for the reason the `pr` section
 *     gives.
 *
 * ## The `tiers` section
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` names three keys that decide which
 * skills and agents a loop session is served: `tiers.rafa`, whether the
 * tier rafa ships is loaded at all, and `tiers.skills` and
 * `tiers.agents`, which turn one item off or pin the tier that serves
 * it. What each VALUE may be is `config-sections.ts`'s to say. Five
 * readings are this module's:
 *
 *   - `tiers.rafa` defaults to `on`: a project that has said nothing is
 *     served rafa's core roster, which is the point of shipping it.
 *   - Both maps default to EMPTY, as `board.trustedAuthors` does: with
 *     nothing pinned and nothing turned off, the fixed order project →
 *     rafa → user decides alone, and a pin as a default would override
 *     a holder nobody named.
 *   - Each map is read by {@link mapOf} whole, as one setting's value.
 *     `tiers` is a section and `tiers.skills` is not, so the names under
 *     `skills:` reach the reader rather than the unknown-key warning. A
 *     name spelled flat at the top level, `tiers.skills.tdd-guide:`, is
 *     not a setting's key and is retained as an unknown one.
 *   - The spec has maps merge by key across layers, a `false` removing
 *     the item. `resolveConfig` merges the three maps by key, the
 *     project over the user over the default, and keeps a `false` as
 *     the key's answer so it shadows a lower layer's entry.
 *   - No `tiers` setting is a {@link CommandLineSetting}, for the reason
 *     the `pr` section gives.
 *
 * ## The `routing` setting
 *
 * The same spec makes the routing table a setting: `routing`, a map of
 * a task shape to the agent that takes it, read by {@link mapOf} as the
 * `tiers` maps are. Three readings are this module's:
 *
 *   - It sits at the top level, like `modules`, so it opens no section
 *     and adds `routing` alone to the keys a warning lists. A shape
 *     spelled flat, `routing.prose:`, is an unknown top-level key.
 *   - Its default is NOT empty: it is `tiers/routing.ts`'s
 *     `DEFAULT_ROUTING`, the spec's five rows, so a project that has
 *     said nothing still routes every shape the planner uses.
 *   - Layers merge it by key over the defaults, so a file's one row
 *     changes that shape and leaves the other four; a `false` row
 *     routes its shape nowhere.
 *
 * ## The `learning` section
 *
 * `.rafa/specs/rafa-25-rafa-learns-own-runs.md` sets three floors beside
 * `learning.adapter`: numbers, never null, none a {@link CommandLineSetting}.
 * Why a confidence outside 0.3..0.9 and an `after` below 1 are refused
 * is `config-sections.ts`'s to say.
 *
 * ## The closed set
 *
 * {@link SETTINGS} is a mapped record over {@link ConfigSetting} rather
 * than a list, so the set is closed both ways: a field added to
 * {@link RafaConfig} without an entry there does not compile, and an
 * entry naming no field does not either. {@link SETTING_NAMES},
 * {@link SETTING_BY_KEY}, {@link SECTIONS} and the known-key index are
 * all read off it, so adding a setting is one field, one default, one
 * spec, its reader in `config-sections.ts`, one line in `config.ts`'s
 * layer literal and one commented line in `project/scaffold.ts`'s
 * template, which `scaffold.test.ts` holds it to, and nothing else.
 *
 * Keys are looked up in a `Map` and a `Set`, never with `in` or an
 * object index. `Bun.YAML.parse` returns a key spelled `constructor`,
 * `toString` or `__proto__` as an ordinary own key, and an object
 * lookup would match it against `Object.prototype` instead.
 *
 * ## Map settings
 *
 * A map setting holds names the schema cannot list — a skill, an agent,
 * a task shape — each with a value an inner reader checks, and
 * {@link mapOf} reads one. Three readings are this module's:
 *
 *   - A name is a key the FILE spells, not one the schema knows, so it
 *     is kept in a `Map` and never in a plain object: a skill named
 *     `constructor` or `__proto__` is an ordinary name, and an object
 *     would match it against `Object.prototype` or reset the
 *     prototype. A name, like any string that names something, holds a
 *     character other than whitespace, and is kept as written.
 *   - Every entry is read, so a map with two unusable values names both,
 *     as `listOf` does for a list. An entry's label and key gain its
 *     name, `tiers.skills.tdd-guide`. A null value is handed to the
 *     inner reader like any other, which is what a map whose values
 *     include `false` needs: whether `false`, or null, means anything is
 *     the inner reader's answer.
 *   - The answer is a fresh `Map` per read, typed as a `ReadonlyMap`. A
 *     `Map` cannot be frozen the way a list is — `Object.freeze` leaves
 *     `set` working — so the promise that no caller edits a value for
 *     the next is kept by building a new one each time.
 *
 * ## Defaults
 *
 * {@link CONFIG_DEFAULTS} spells every default once, frozen, with each
 * list in it frozen too. A map cannot be frozen, as "Map settings" says,
 * so each map default is one shared `Map` — the empty `tiers` maps and
 * the `routing` table alike — and the promise that no caller edits it
 * rests on its `ReadonlyMap` type. The cutover runs one plan under `full` and
 * again under `stage`; should that comparison argue for `full`, the
 * change is that one line.
 */
import type {
  ClaudeSettingSource,
  ConfigVersion,
  InjectMode,
  MergeMethod,
  ModuleSource,
  OptionalPrerequisiteItem,
  OutputMode,
  PrerequisiteItem,
  PrProvider,
  Reader,
  Reading,
  ReleaseEnabled,
  RouteTarget,
  StoreBackend,
  TierPin,
  TierSwitch,
} from './config-sections.js';

import { join } from 'node:path';

import {
  CLAUDE_SETTING_SOURCES,
  confidence,
  CONFIG_VERSIONS,
  dayCount,
  describeValue,
  flag,
  githubLogin,
  INJECT_MODES,
  isMapping,
  issueNumber,
  listOf,
  mergeMethod,
  MODULE_SOURCE_KEYS,
  moduleSource,
  OPTIONAL_ITEM_KEYS,
  oneOf,
  optionalPrerequisite,
  OUTPUT_MODES,
  PR_PROVIDERS,
  RELEASE_AUTO,
  releaseEnabled,
  recurrenceCount,
  REQUIRED_ITEM_KEYS,
  requiredPrerequisite,
  routeTarget,
  STORE_BACKENDS,
  subsetOf,
  text,
  tierPin,
  tierSwitch,
  usdAmount,
} from './config-sections.js';
import { DEFAULT_ROUTING } from './tiers/routing.js';

/**
 * The config file, relative to the directory it sits under: the project
 * root for the project's, the home directory for the user scope's.
 *
 * `join` rather than a literal, as `effort/store.ts` spells its own
 * directory, so a path built here compares equal to one a caller built
 * with `join` of its own.
 */
export const CONFIG_FILE = join('.rafa', 'config.yaml');

/**
 * Accepts a mapping of names to values `value` accepts, answered as a
 * fresh `Map` in the order written; see "Map settings" in the module
 * note. Every entry is read, so a map with two unusable entries names
 * both. `expected` names the values, in the refusal of a value that is
 * not a mapping.
 */
export function mapOf<T>(
  value: Reader<T>,
  expected: string,
): Reader<ReadonlyMap<string, T>> {
  return (raw, at) => {
    if (!isMapping(raw)) {
      const problem = `${at.label} is ${describeValue(raw)}, expected a mapping of names to ${expected}`;
      return { value: undefined, problems: [problem], extras: [] };
    }

    const readings = Object.entries(raw).map(([name, entry]): [string, Reading<T>] => [
      name,
      name.trim() === ''
        ? {
          value: undefined,
          problems: [`${at.label} names ${JSON.stringify(name)}, expected a non-empty name`],
          extras: [],
        }
        : value(entry, { label: `${at.label}.${name}`, key: `${at.key}.${name}` }),
    ]);
    const problems = readings.flatMap(([, reading]) => reading.problems);
    const extras = readings.flatMap(([, reading]) => reading.extras);
    if (problems.length > 0) return { value: undefined, problems, extras };

    const read = new Map<string, T>();
    for (const [name, reading] of readings) {
      if (reading.value !== undefined) read.set(name, reading.value);
    }
    return { value: read, problems, extras };
  };
}

/** Every setting, resolved. The module note maps each to its file key. */
export interface RafaConfig {
  /** The schema version the file was written for. `version`. */
  version: ConfigVersion;
  /** The backend the effort store writes through. `store`. */
  store: StoreBackend;
  /** How much of the plan a task prompt receives. `plan.inject`. */
  inject: InjectMode;
  /** Where plans are written and read. `plan.dir`. */
  planDir: string;
  /** Where specs are read. `specs.dir`. */
  specsDir: string;
  /** The tracker kind tried first. `tracker.default`. */
  trackerDefault: string;
  /** The tracker kinds tried next, in order. `tracker.fallback`. */
  trackerFallback: readonly string[];
  /** The learning adapter kind. `learning.adapter`. */
  learningAdapter: string;
  /** The least confidence a lesson tasks may use. `learning.bless.minConfidence`. */
  learningBlessMinConfidence: number;
  /** The distinct sources a lesson needs to be promotable. `learning.promote.after`. */
  learningPromoteAfter: number;
  /** The least confidence of a promotable lesson. `learning.promote.minConfidence`. */
  learningPromoteMinConfidence: number;
  /** How commands write their output. `output.mode`. */
  outputMode: OutputMode;
  /** Items whose failure halts a run. `prerequisites.required`. */
  prerequisitesRequired: readonly PrerequisiteItem[];
  /** Items whose failure is only named. `prerequisites.optional`. */
  prerequisitesOptional: readonly OptionalPrerequisiteItem[];
  /** Whether `.rafa/specs/` is tracked by git. `tracking.specs`. */
  trackingSpecs: boolean;
  /** Whether `.rafa/plans/` is tracked by git. `tracking.plans`. */
  trackingPlans: boolean;
  /** Whether all of `.rafa/` is tracked by git. `tracking.all`. */
  trackingAll: boolean;
  /** Where modules are installed from. `modules`. */
  modules: readonly ModuleSource[];
  /** The module names enabled. `allowList`. */
  allowList: readonly string[];
  /** What each spawned session loads settings from. `loop.settingSources`. */
  settingSources: readonly ClaudeSettingSource[];
  /**
   * The provider every `pr` action goes through, or null to read it off
   * the `origin` remote. `pr.provider`.
   */
  prProvider: PrProvider | null;
  /** How `pr merge` merges, unless `--method` names another. `pr.mergeMethod`. */
  prMergeMethod: MergeMethod;
  /**
   * The branch a pull request is opened into, or null for whatever the
   * remote calls its default branch. `pr.base`.
   */
  prBase: string | null;
  /**
   * The budget in US dollars each `pr triage --resolve` session is
   * spawned with. `pr.resolveBudget`.
   */
  prResolveBudget: number;
  /**
   * The logins trusted with board text besides the repository's own
   * write-holders. `board.trustedAuthors`.
   */
  boardTrustedAuthors: readonly string[];
  /**
   * The issue whose task list `plan create --next` reads its order off,
   * or null for the issue titled `Roadmap`. `roadmap.issue`.
   */
  roadmapIssue: number | null;
  /**
   * Whether a run bumps the version and writes a changelog entry, or
   * `auto` to decide it off the two files below. `release.enabled`.
   */
  releaseEnabled: ReleaseEnabled;
  /**
   * The manifest the version is read from and written back to, from
   * the repository root. `release.versionFile`.
   */
  releaseVersionFile: string;
  /**
   * The changelog an entry is inserted into, from the repository root.
   * `release.changelog`.
   */
  releaseChangelog: string;
  /** The template one entry's heading is rendered from. `release.heading`. */
  releaseHeading: string;
  /**
   * The age in days past which `rafa cleanup` lists a branch as Stale.
   * `cleanup.staleDays`.
   */
  cleanupStaleDays: number;
  /**
   * The idle days past which `rafa cleanup` lists a worktree.
   * `cleanup.worktreeIdleDays`.
   */
  cleanupWorktreeIdleDays: number;
  /** Glob patterns naming branches `rafa cleanup` never lists. `cleanup.keep`. */
  cleanupKeep: readonly string[];
  /**
   * Whether check 4 of the readiness gate accepts every dangling and
   * suspect reference of a spec on every run, as `--accept-refs` does
   * on one. `dangerous.acceptStaleRefs`.
   */
  dangerousAcceptStaleRefs: boolean;
  /**
   * Whether a command that runs inside a project prints the one-line
   * since-last-command notice on stderr. `status.notice`.
   */
  statusNotice: boolean;
  /** Whether the tier rafa ships is loaded. `tiers.rafa`. */
  tiersRafa: TierSwitch;
  /**
   * Skills turned off (`false`) or pinned to the tier that serves them,
   * by name. `tiers.skills`.
   */
  tiersSkills: ReadonlyMap<string, TierPin>;
  /**
   * Agents turned off (`false`) or pinned to the tier that serves them,
   * by name. `tiers.agents`.
   */
  tiersAgents: ReadonlyMap<string, TierPin>;
  /**
   * The agent each task shape is routed to, or `false` for a shape
   * routed nowhere. `routing`.
   */
  routing: ReadonlyMap<string, RouteTarget>;
}

/** The name of one setting, as a field of {@link RafaConfig}. */
export type ConfigSetting = keyof RafaConfig;

/**
 * The settings a command line can name. A flag parser hands over
 * strings, so these are the settings the file spells as one string: a
 * list, a boolean or a mapping has no command-line spelling this module
 * would have to invent.
 */
export type CommandLineSetting = 'store' | 'inject' | 'planDir' | 'specsDir'
  | 'trackerDefault' | 'learningAdapter' | 'outputMode' | 'settingSources';

/** What every setting resolves to when no layer names it. */
export const CONFIG_DEFAULTS: Readonly<RafaConfig> = Object.freeze({
  version: 1,
  store: 'sqlite',
  inject: 'stage',
  planDir: join('.rafa', 'plans'),
  specsDir: join('.rafa', 'specs'),
  trackerDefault: 'github',
  trackerFallback: Object.freeze(['local']),
  learningAdapter: 'local',
  learningBlessMinConfidence: 0.5,
  learningPromoteAfter: 3,
  learningPromoteMinConfidence: 0.7,
  outputMode: 'text',
  prerequisitesRequired: Object.freeze([]),
  prerequisitesOptional: Object.freeze([]),
  trackingSpecs: false,
  trackingPlans: false,
  trackingAll: false,
  modules: Object.freeze([]),
  allowList: Object.freeze([]),
  settingSources: Object.freeze<ClaudeSettingSource[]>(['project', 'local']),
  prProvider: null,
  prMergeMethod: 'squash',
  prBase: null,
  prResolveBudget: 2,
  boardTrustedAuthors: Object.freeze([]),
  roadmapIssue: null,
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseHeading: '## {version} — {date}, {title}',
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
  cleanupKeep: Object.freeze([]),
  dangerousAcceptStaleRefs: false,
  statusNotice: true,
  tiersRafa: 'on',
  tiersSkills: new Map<string, TierPin>(),
  tiersAgents: new Map<string, TierPin>(),
  routing: DEFAULT_ROUTING,
});

/** What the module knows about one setting. */
export interface SettingSpec<K extends ConfigSetting> {
  /** Where the file spells it, as a dotted path. */
  key: string;
  /** The reader deciding which raw values it accepts. */
  read: Reader<RafaConfig[K]>;
  /** Whether a command line can name it; checked against the type. */
  cli: K extends CommandLineSetting
    ? true
    : false;
  /** For a list of mappings, the keys each item reads. */
  itemKeys?: readonly string[];
}

/** The reader both directory settings share. */
const directory = text('a directory path');

/** The reader every tracker kind goes through. */
const trackerKind = text('a tracker kind name');

/** The reader both `release` file settings share. */
const releaseFile = text('a file path');

/** The reader both `tiers` maps share. */
const tierPins = mapOf(tierPin, 'false or a tier');

/**
 * Every setting, by name, in the order problems are reported.
 *
 * A mapped record rather than a list so the set is closed: a field
 * added to {@link RafaConfig} without an entry here does not compile.
 */
export const SETTINGS: { readonly [K in ConfigSetting]: SettingSpec<K> } = {
  version: { key: 'version', read: oneOf(CONFIG_VERSIONS), cli: false },
  store: { key: 'store', read: oneOf(STORE_BACKENDS), cli: true },
  inject: { key: 'plan.inject', read: oneOf(INJECT_MODES), cli: true },
  planDir: { key: 'plan.dir', read: directory, cli: true },
  specsDir: { key: 'specs.dir', read: directory, cli: true },
  trackerDefault: { key: 'tracker.default', read: trackerKind, cli: true },
  trackerFallback: {
    key: 'tracker.fallback',
    read: listOf(trackerKind, 'tracker kind names'),
    cli: false,
  },
  learningAdapter: {
    key: 'learning.adapter',
    read: text('a learning adapter name'),
    cli: true,
  },
  learningBlessMinConfidence: { key: 'learning.bless.minConfidence', read: confidence, cli: false },
  learningPromoteAfter: { key: 'learning.promote.after', read: recurrenceCount, cli: false },
  learningPromoteMinConfidence: { key: 'learning.promote.minConfidence', read: confidence, cli: false },
  outputMode: { key: 'output.mode', read: oneOf(OUTPUT_MODES), cli: true },
  prerequisitesRequired: {
    key: 'prerequisites.required',
    read: listOf(requiredPrerequisite, 'prerequisite items'),
    cli: false,
    itemKeys: REQUIRED_ITEM_KEYS,
  },
  prerequisitesOptional: {
    key: 'prerequisites.optional',
    read: listOf(optionalPrerequisite, 'prerequisite items'),
    cli: false,
    itemKeys: OPTIONAL_ITEM_KEYS,
  },
  trackingSpecs: { key: 'tracking.specs', read: flag, cli: false },
  trackingPlans: { key: 'tracking.plans', read: flag, cli: false },
  trackingAll: { key: 'tracking.all', read: flag, cli: false },
  modules: {
    key: 'modules',
    read: listOf(moduleSource, 'module sources'),
    cli: false,
    itemKeys: MODULE_SOURCE_KEYS,
  },
  allowList: {
    key: 'allowList',
    read: listOf(text('a module name'), 'module names'),
    cli: false,
  },
  settingSources: {
    key: 'loop.settingSources',
    read: subsetOf(CLAUDE_SETTING_SOURCES),
    cli: true,
  },
  prProvider: { key: 'pr.provider', read: oneOf(PR_PROVIDERS), cli: false },
  prMergeMethod: { key: 'pr.mergeMethod', read: mergeMethod, cli: false },
  prBase: { key: 'pr.base', read: text('a branch name'), cli: false },
  prResolveBudget: { key: 'pr.resolveBudget', read: usdAmount, cli: false },
  boardTrustedAuthors: {
    key: 'board.trustedAuthors',
    read: listOf(githubLogin, 'GitHub logins'),
    cli: false,
  },
  roadmapIssue: { key: 'roadmap.issue', read: issueNumber, cli: false },
  releaseEnabled: { key: 'release.enabled', read: releaseEnabled, cli: false },
  releaseVersionFile: {
    key: 'release.versionFile',
    read: releaseFile,
    cli: false,
  },
  releaseChangelog: { key: 'release.changelog', read: releaseFile, cli: false },
  releaseHeading: {
    key: 'release.heading',
    read: text('a changelog heading template'),
    cli: false,
  },
  cleanupStaleDays: { key: 'cleanup.staleDays', read: dayCount, cli: false },
  cleanupWorktreeIdleDays: {
    key: 'cleanup.worktreeIdleDays',
    read: dayCount,
    cli: false,
  },
  cleanupKeep: {
    key: 'cleanup.keep',
    read: listOf(text('a glob pattern'), 'glob patterns'),
    cli: false,
  },
  dangerousAcceptStaleRefs: {
    key: 'dangerous.acceptStaleRefs',
    read: flag,
    cli: false,
  },
  statusNotice: { key: 'status.notice', read: flag, cli: false },
  tiersRafa: { key: 'tiers.rafa', read: tierSwitch, cli: false },
  tiersSkills: { key: 'tiers.skills', read: tierPins, cli: false },
  tiersAgents: { key: 'tiers.agents', read: tierPins, cli: false },
  routing: {
    key: 'routing',
    read: mapOf(routeTarget, 'false or an agent name'),
    cli: false,
  },
};

/** Every setting name, read off the closed record above. */
export const SETTING_NAMES = Object.keys(SETTINGS) as ConfigSetting[];

/** Setting names by the dotted key the file spells them with. */
export const SETTING_BY_KEY: ReadonlyMap<string, ConfigSetting> = new Map(
  SETTING_NAMES.map((setting): [string, ConfigSetting] => [
    SETTINGS[setting].key,
    setting,
  ]),
);

/** True for a setting a command line can name. */
export function isCommandLineSetting(
  setting: ConfigSetting,
): setting is CommandLineSetting {
  return SETTINGS[setting].cli;
}

/** `plan.inject` → `['plan']`; `a.b.c` → `['a', 'a.b']`; `store` → `[]`. */
function sectionsOf(key: string): string[] {
  const parts = key.split('.');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('.'));
}

/** Every dotted prefix a setting sits under: the sections a file opens. */
export const SECTIONS: ReadonlySet<string> = new Set(
  [...SETTING_BY_KEY.keys()].flatMap(sectionsOf),
);

/** The path a key sits under: `plan` for `plan.depth`, `''` at the top. */
function parentOf(key: string): string {
  const cut = key.lastIndexOf('.');
  return cut < 0
    ? ''
    : key.slice(0, cut);
}

/** Matches a list index closing a path: `[0]` in `modules[0]`. */
const TRAILING_INDEX = /\[\d+\]$/;

/**
 * The keys known under each path, in schema order: `''` for the top
 * level, a section's path, and `<list>[]` for any item of a list of
 * mappings.
 */
const KNOWN_UNDER: ReadonlyMap<string, readonly string[]> = (() => {
  const known = new Map<string, string[]>();
  const add = (parent: string, name: string): void => {
    const names = known.get(parent) ?? [];
    if (!names.includes(name)) known.set(parent, [...names, name]);
  };
  for (const setting of SETTING_NAMES) {
    const { key, itemKeys } = SETTINGS[setting];
    const parts = key.split('.');
    parts.forEach((part, index) => add(parts.slice(0, index).join('.'), part));
    for (const name of itemKeys ?? []) add(`${key}[]`, name);
  }
  return known;
})();

/**
 * The nearest path above `key` with known keys, and those keys. An
 * item path such as `modules[0]` looks up `modules[]`.
 */
export function knownKeysAbove(key: string): [string, readonly string[]] {
  for (let parent = parentOf(key); parent !== ''; parent = parentOf(parent)) {
    const names = KNOWN_UNDER.get(parent.replace(TRAILING_INDEX, '[]'));
    if (names !== undefined) return [parent, names];
  }
  return ['', KNOWN_UNDER.get('') ?? []];
}
