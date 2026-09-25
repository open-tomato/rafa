/**
 * The value readers behind `config.ts`: one per shape a setting takes,
 * the closed lists of values a setting accepts, and the two item shapes
 * the schema's lists hold.
 *
 * `config.ts` owns the file: its sections, its keys, the layers and how
 * they rank. For each setting it asks this module one question: is this
 * raw value one the setting accepts, and if so, what is it? Every rule
 * about a VALUE lives here, apart from the rules about KEYS, and
 * `config.ts` stays under the size cap.
 *
 * The file is `config-sections.ts` and not `config/index.ts` on purpose.
 * From `src/`, `./config.js` resolves to `src/config.ts`, and a
 * `src/config/` directory beside it would set the trap
 * `context/source.md` records for `./plan`.
 *
 * ## What a reader answers
 *
 * A {@link Reader} takes the raw value, as the YAML parser returned it
 * or as a command line passed it, and a {@link ValueAt} saying where
 * that value sits. It answers a {@link Reading}: the value, or undefined
 * with every problem named, plus any unknown key an item carried. A
 * reader never throws and never prints, because `config.ts` collects the
 * problems of every setting before it refuses, so one run names all of
 * them.
 *
 * A problem is one sentence opening with the label it was handed, so
 * one reader serves the file (`/repo/.rafa/config.yaml: tracker.default`)
 * and the command line (`command line: trackerDefault`). A list item's
 * label and key gain its index: `prerequisites.required[1]`.
 *
 * ## Rules every reader keeps
 *
 *   - Nothing is coerced. `tracker.fallback: local` is not read as
 *     `[local]`, and `tracking.all: "true"` is not read as `true`.
 *     Guessing what the operator meant is the silent choice `config.ts`
 *     refuses.
 *   - A string names something only when it holds a character other
 *     than whitespace. It is kept as written, never trimmed.
 *   - A key an item carries is matched against a list with `===`,
 *     never with `in` or an object index. The parser keeps a key spelled
 *     `toString`, `constructor` or `__proto__` as an ordinary own key,
 *     and `'toString' in item` is true for every mapping. Measured on
 *     bun 1.3.14: an item carrying `__proto__: x` beside `tool: bun`
 *     holds both as own keys, and its prototype stays `Object.prototype`.
 *   - Every list a reader answers is frozen, and so is every item in
 *     it. A value one caller holds cannot be edited for the next.
 *   - A null optional key in an item (`probe:` above a commented-out
 *     command) says nothing, as a null setting says nothing in
 *     `config.ts`. A null kind key (`- tool:`) names no tool and is
 *     refused.
 *   - A key an item does not read is retained as a {@link ConfigExtra}
 *     under its path (`prerequisites.optional[0].timeout`), for
 *     `config.ts` to warn about, never refused. That is the rule
 *     `config.ts` keeps for unknown keys, applied one level down.
 *
 * ## The item shapes
 *
 * A prerequisite item names exactly one of `tool`, `env`, `service` or
 * `lsp`, may carry a `probe`, and on the optional tier a `reason`. That
 * is the shape of the block under "Config schema" in
 * `.rafa/specs/phase-1-installable.md`. A `reason` on a required item is a
 * key that tier does not read, so it is retained and warned about.
 *
 * A module source names exactly one of `npm`, `github` or `path`, and a
 * `github` source may carry a `ref`: the source shapes of the registry
 * example in `.rafa/specs/modules-and-addons.md`, which `modules:` lists
 * "by source". This module accepts all three. Whether a source kind can
 * be loaded is the module loader's answer, not the config's.
 *
 * ## The `dangerous` section
 *
 * A setting under `dangerous:` turns a refusal off on every run, so it
 * is read as strictly as any: `dangerous.acceptStaleRefs` goes through
 * {@link flag}, the reader every `tracking` key takes, and no reader of
 * its own. That is on purpose. A reader that took `yes`, `"true"` or
 * `1` as true would let a spelling nobody meant as an answer switch
 * check 4 of the readiness gate off, which is the one reading this
 * section must never make by guessing. The section holds no closed
 * list and no item shape, so nothing else here names it.
 *
 * ## The `tiers` section
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` spells `tiers.rafa` as `on` or
 * `off`, and `tiers.skills` and `tiers.agents` as maps of a name to
 * `false` or a tier. {@link tierSwitch} reads the first and
 * {@link tierPin} one value of the other two; the map around it is
 * `config-readers.ts`'s `mapOf`, because what that reader rules on is a
 * key. Three readings are this module's:
 *
 *   - `tiers.rafa` takes the WORDS `on` and `off`, as the spec writes
 *     them, and not the booleans. `Bun.YAML.parse` answers both words
 *     as strings (see {@link ReleaseEnabled}), so a file spelling
 *     `rafa: off` reaches the reader as `off`, and `rafa: false` is
 *     refused and told what to write, since nothing is coerced.
 *   - A pin is the boolean `false`, which turns the item off in every
 *     tier, or one of the three tiers, which names the holder that
 *     serves it. `true` is refused: an item is on unless something
 *     turns it off, so `true` would say nothing, and a value that says
 *     nothing is not one a person meant to write.
 *   - A null pin, a name written with nothing after it, is refused and
 *     not read as silence. It is the `- tool:` of a map: a name that
 *     pins nothing, where silence is the name left out.
 *
 * ## The `routing` setting
 *
 * The spec spells `routing` as a map of a task shape to an agent.
 * {@link routeTarget} reads one value; the map around it is `mapOf`
 * again, and the defaults are `tiers/routing.ts`'s. Two readings are
 * this module's:
 *
 *   - A value is an agent name, any non-empty string, or `false`, a
 *     shape routed nowhere, as `false` turns an item off in
 *     `tiers.skills`. Whether the name is an agent anything defines is
 *     a question for the tier resolver the spec plans, never for a
 *     reader. So a quoted `"false"` is read as a name and not coerced
 *     to `false`.
 *   - `true` and null are refused, as for a pin: `true` names no agent,
 *     and a shape with nothing after it routes nothing, where silence
 *     is the shape left out.
 *
 * ## The `task` section
 *
 * `task.skills` names the resolver that picks a task's skills at
 * dispatch, and `task.lessons` whether blessed lessons join its prompt.
 * {@link skillResolverName} reads the first and {@link lessonSwitch}
 * the second, each a closed list declared here. Two readings are this
 * module's:
 *
 *   - `task.skills` takes `planner`, `tag` or `none` and nothing else.
 *     Which resolver runs under each name is `task/resolve-skills.ts`'s
 *     to say. A name outside the list, `model` included, is refused
 *     here, where a person can still fix the file, and not left for
 *     dispatch to find.
 *   - `task.lessons` takes the WORDS `on` and `off`, as `tiers.rafa`
 *     does and for the same reason: `Bun.YAML.parse` answers both as
 *     strings, so `lessons: false` is refused and told what to write.
 *     It has a list of its own rather than {@link TIER_SWITCHES},
 *     since the two settings share a spelling and not a meaning.
 *
 * ## The lists this module does not own
 *
 * Every other closed list here is declared here. Three are not, and
 * neither is one range, because another module is already their
 * authority and a second spelling could disagree with it:
 *
 *   - The three tiers a pin names are `schema/tiers.ts`'s
 *     {@link SKILL_TIERS}, the order a listing reads them in. That
 *     module imports `node:fs` and `node:path` alone, so reaching it
 *     here is no cycle.
 *   - {@link MergeMethod} and the three methods behind
 *     {@link mergeMethod} are the pull request port's
 *     (`pr/types.ts`), which spells them to match what `gh pr merge`
 *     takes. The type is re-exported so `config-schema.ts` names a
 *     field with it without reaching past this module, and nothing
 *     more: a caller acting on a merge reads the port.
 *   - The shape {@link usdAmount} accepts is `parseBudgetUsd`'s
 *     (`utils/declaration.ts`), which is what a plan's `budget=` goes
 *     through and therefore what `--max-budget-usd` has been measured
 *     against. The reader asks it about `String(raw)`, so a config
 *     value is accepted only when the number the loop would pass on
 *     survives that round trip: `.inf`, `.nan`, `1e21` and `1e-7` are
 *     each a number the parser returns and `String` writes as something
 *     the flag never takes.
 *   - The range {@link confidence} accepts, 0.3 to 0.9, is the learning
 *     library's {@link CONFIDENCE_MIN} and {@link CONFIDENCE_MAX}
 *     (`learning/identity.ts`), the range every lesson's confidence is
 *     clamped to. A threshold outside it is one no lesson can meet, or
 *     one every lesson meets, so the reader asks the library's bounds
 *     rather than spell its own.
 *
 * `learning/identity.ts` imports `node:crypto` alone, and neither of the
 * other two imports is a cycle. `pr/types.ts` imports
 * types alone and `utils/declaration.ts` imports nothing, so this
 * module reaches both without either reaching back. The port is reached at `./pr/types.js`
 * and not through the `./pr/index.js` barrel a caller outside `src/pr/`
 * would normally use, because the barrel carries `pr/gh.ts`, which
 * imports THIS module and the `gh` spawner behind it: importing it here
 * would make the graph cyclic and put the CLI adapter behind every
 * config read. That cycle was measured, not assumed, and it does not
 * break: with the barrel imported instead, on bun 1.3.14, `MERGE_METHODS`
 * read as its three values and `CONFIG_DEFAULTS.prMergeMethod` as
 * `squash` with `config.js`, `pr/index.js` and `pr/gh.js` each imported
 * first, and the config and `src/pr/` suites passed. The narrower import
 * is the graph this module wants, not a fix for an observed failure.
 */
import type { MergeMethod } from './pr/types.js';
import type { SkillTier } from './schema/tiers.js';

import { CONFIDENCE_MAX, CONFIDENCE_MIN } from './learning/identity.js';
import { MERGE_METHODS } from './pr/types.js';
import { SKILL_TIERS } from './schema/tiers.js';
import { parseBudgetUsd } from './utils/declaration.js';

export type { MergeMethod } from './pr/types.js';

/** One key a file carried that names nothing this version reads. */
export interface ConfigExtra {
  /**
   * Its path from the top of the file: `nonesuch`, `plan.depth`,
   * `prerequisites.required[0].timeout`.
   */
  key: string;
  /**
   * The value exactly as the parser returned it. Never serialised
   * here: a YAML alias can make it cyclic.
   */
  value: unknown;
}

/** Where a value sits, as a problem and an extra name it. */
export interface ValueAt {
  /** What a problem opens with: `<file>: tracker.default`. */
  label: string;
  /** The path an unknown key inside the value is retained under. */
  key: string;
}

/** What a reader made of one raw value. */
export interface Reading<T> {
  /** The value read, or undefined when a problem refused it. */
  value: T | undefined;
  /** One sentence per problem, each opening with the label. */
  problems: readonly string[];
  /** Keys inside the value that name nothing, retained. */
  extras: readonly ConfigExtra[];
}

/** Reads one raw value; see the module note. */
export type Reader<T> = (raw: unknown, at: ValueAt) => Reading<T>;

/** A plain mapping, as the parser returns one. */
export type Mapping = Readonly<Record<string, unknown>>;

/** True for a mapping; false for a list, a scalar or null. */
export function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value as a refusal quotes it. Never serialises a collection. */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return String(value);
}

/** The message of whatever was thrown, for a refusal to quote. */
export function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** The schema versions `config.ts` reads. */
export const CONFIG_VERSIONS = [1] as const;

/** One schema version `config.ts` reads. */
export type ConfigVersion = (typeof CONFIG_VERSIONS)[number];

/** Backends the effort store can be selected as. */
export const STORE_BACKENDS = ['sqlite', 'ndjson'] as const;

/** One of the two effort-store backends. */
export type StoreBackend = (typeof STORE_BACKENDS)[number];

/** How much of the plan a task session is handed, widest first. */
export const INJECT_MODES = ['full', 'stage', 'task'] as const;

/** One of the three injection modes. */
export type InjectMode = (typeof INJECT_MODES)[number];

/** How a command writes what it has to say. */
export const OUTPUT_MODES = ['text', 'json'] as const;

/** One of the two output modes. */
export type OutputMode = (typeof OUTPUT_MODES)[number];

/** The sources Claude Code's `--setting-sources` takes a subset of. */
export const CLAUDE_SETTING_SOURCES = ['user', 'project', 'local'] as const;

/** One of Claude Code's three setting sources. */
export type ClaudeSettingSource = (typeof CLAUDE_SETTING_SOURCES)[number];

/**
 * The pull request providers a file may name: the GitHub CLI, and none.
 *
 * `none` is a provider and not an absence: under it the loop pushes the
 * branch, prints the compare URL and skips the CI wait, which is a
 * behaviour an operator chooses, where a setting left unnamed is one
 * `pr/provider.ts` resolves off the `origin` remote.
 */
export const PR_PROVIDERS = ['gh', 'none'] as const;

/** One of the two pull request providers. */
export type PrProvider = (typeof PR_PROVIDERS)[number];

/**
 * What `release.enabled` takes: a YAML boolean, or `auto`.
 *
 * `auto` is a third value and not a spelling of either boolean. It
 * means "on when both configured files exist", a reading only
 * `release/enabled.ts` can make, because only it looks at a disk.
 *
 * The two explicit answers are the BOOLEANS `true` and `false`, and
 * not the words `on` and `off`: nothing here is coerced, so a file
 * spelling `enabled: on` is refused and told what to write instead.
 * Measured on bun 1.3.14, `Bun.YAML.parse` reads `on`, `off`, `yes`
 * and `no` as strings and `true`, `True` and `TRUE` as the boolean, so
 * `on` reaches the reader as the string and never as true.
 */
export type ReleaseEnabled = boolean | 'auto';

/** The value of `release.enabled` that defers to the two files. */
export const RELEASE_AUTO = 'auto';

/** What `tiers.rafa` takes: the words, not the booleans. */
export const TIER_SWITCHES = ['on', 'off'] as const;

/** One of {@link TIER_SWITCHES}. */
export type TierSwitch = (typeof TIER_SWITCHES)[number];

/**
 * One value of `tiers.skills` or `tiers.agents`: `false` to turn the
 * item off in every tier, or the tier whose holder serves it.
 */
export type TierPin = false | SkillTier;

/**
 * One value of `routing`: the agent a task of that shape goes to, or
 * `false` for a shape routed nowhere.
 */
export type RouteTarget = false | string;

/** The skill resolvers `task.skills` may name; see "The `task` section". */
export const SKILL_RESOLVERS = ['planner', 'tag', 'none'] as const;

/** One of {@link SKILL_RESOLVERS}. */
export type SkillResolverName = (typeof SKILL_RESOLVERS)[number];

/** What `task.lessons` takes: the words, not the booleans. */
export const LESSON_SWITCHES = ['on', 'off'] as const;

/** One of {@link LESSON_SWITCHES}. */
export type LessonSwitch = (typeof LESSON_SWITCHES)[number];

/** A reading of `value` with nothing wrong. */
function accepted<T>(value: T): Reading<T> {
  return { value, problems: [], extras: [] };
}

/** A reading refusing `raw`, saying what was expected instead. */
function refused<T>(at: ValueAt, raw: unknown, expected: string): Reading<T> {
  const problem = `${at.label} is ${describeValue(raw)}, expected ${expected}`;
  return { value: undefined, problems: [problem], extras: [] };
}

/** A reading carrying `problems` alone. */
function refusedWith<T>(problems: readonly string[]): Reading<T> {
  return { value: undefined, problems, extras: [] };
}

/** `reading` with its value, when it has one, passed through `map`. */
function mapReading<T, U>(reading: Reading<T>, map: (value: T) => U): Reading<U> {
  return reading.value === undefined
    ? { ...reading, value: undefined }
    : { ...reading, value: map(reading.value) };
}

/** `at` one step down: an index (`[1]`) or a key (`.probe`). */
function below(at: ValueAt, step: string): ValueAt {
  return { label: `${at.label}${step}`, key: `${at.key}${step}` };
}

/** Accepts exactly one of `values`, compared with `===`. */
export function oneOf<T>(values: readonly T[]): Reader<T> {
  const expected = `one of: ${values.join(', ')}`;
  return (raw, at) => {
    const hit = values.find((value) => value === raw);
    return hit === undefined
      ? refused(at, raw, expected)
      : accepted(hit);
  };
}

/**
 * Accepts a string holding a character other than whitespace, kept as
 * written. `expected` names what the string is for, in a refusal.
 */
export function text(expected: string): Reader<string> {
  return (raw, at) => typeof raw === 'string' && raw.trim() !== ''
    ? accepted(raw)
    : refused(at, raw, expected);
}

/** Accepts a YAML boolean, and nothing spelled like one. */
export const flag: Reader<boolean> = (raw, at) => typeof raw === 'boolean'
  ? accepted(raw)
  : refused(at, raw, 'true or false');

/**
 * Accepts one of the pull request port's three merge methods. The list
 * is the port's, for the reason in the module note.
 */
export const mergeMethod: Reader<MergeMethod> = oneOf(MERGE_METHODS);

/**
 * Accepts a number of US dollars a session can be handed as a budget:
 * above zero, at most six digits either side of the point, and no
 * string spelled like one. What it accepts is `parseBudgetUsd`'s shape,
 * asked about `String(raw)`; the module note says why.
 */
export const usdAmount: Reader<number> = (raw, at) => {
  const usd = typeof raw === 'number'
    ? parseBudgetUsd(String(raw))
    : null;
  return usd === null
    ? refused(at, raw, 'a number of US dollars above zero, at most six digits either side of the point')
    : accepted(usd);
};

/**
 * Accepts an issue number as the board spells one: a whole number above
 * zero, and no string spelled like one.
 *
 * The bound matches `src/board/naming.ts`, which refuses anything else
 * with a `RangeError` rather than spelling `rafa-0` into a path. A
 * setting read here is handed straight to `gh issue view <n>`, so `0`,
 * `-1` and `2.5` are refused where the person can still fix the file,
 * and not where a command has already been sent.
 *
 * `Bun.YAML.parse` reads `31`, `0x1f` and `3.1e1` all as the number 31,
 * so the three spellings are one value here. A QUOTED `"31"` is refused,
 * as every other reader refuses a string spelled like its type.
 */
export const issueNumber: Reader<number> = (raw, at) => typeof raw === 'number'
  && Number.isSafeInteger(raw)
  && raw > 0
  ? accepted(raw)
  : refused(at, raw, 'an issue number, a whole number above zero');

/**
 * Accepts a number of days as the `cleanup` thresholds take one: a
 * whole number above zero, and no string spelled like one.
 *
 * Zero is refused and not read as "off": a zero-day threshold would put
 * every branch under Stale and every worktree under idle, which is a
 * listing nobody asks for by writing a number. A fraction is refused
 * as `issueNumber` refuses one: the setting counts whole days, and
 * `2.5` would be a precision nobody has said the reading keeps.
 */
export const dayCount: Reader<number> = (raw, at) => typeof raw === 'number'
  && Number.isSafeInteger(raw)
  && raw > 0
  ? accepted(raw)
  : refused(at, raw, 'a number of days, a whole number above zero');

/**
 * Accepts a lesson confidence as the `learning` thresholds take one: a
 * number from {@link CONFIDENCE_MIN} to {@link CONFIDENCE_MAX}, both
 * included, and no string spelled like one.
 *
 * A bound is compared after rounding to two decimals, as the library
 * compares confidences, so `0.9000000000000001` reads as 0.9. The value
 * is kept as written. A quoted `"0.5"` is refused, as every reader here
 * refuses a string spelled like its type.
 */
export const confidence: Reader<number> = (raw, at) => typeof raw === 'number'
  && Number.isFinite(raw)
  && toHundredths(raw) >= toHundredths(CONFIDENCE_MIN)
  && toHundredths(raw) <= toHundredths(CONFIDENCE_MAX)
  ? accepted(raw)
  : refused(at, raw, `a confidence from ${String(CONFIDENCE_MIN)} to ${String(CONFIDENCE_MAX)}`);

/** `value` in whole hundredths, the precision confidences are compared at. */
function toHundredths(value: number): number {
  return Math.round(value * 100);
}

/**
 * Accepts how many times a lesson must recur as `learning.promote.after`
 * counts it: a whole number of 1 or more, and no string spelled like one.
 *
 * Zero is refused and not read as "off": every held lesson was
 * confirmed by at least one source, so 0 would promote exactly what 1
 * does, and a second spelling of one threshold is a value nobody can
 * tell was meant. A fraction is refused as {@link dayCount} refuses one:
 * the setting counts distinct sources, which come whole.
 */
export const recurrenceCount: Reader<number> = (raw, at) => typeof raw === 'number'
  && Number.isSafeInteger(raw)
  && raw >= 1
  ? accepted(raw)
  : refused(at, raw, 'a count, a whole number of 1 or more');

/**
 * Accepts `true`, `false` or `auto`, each as itself. A string spelled
 * like a boolean is refused; see {@link ReleaseEnabled}.
 */
export const releaseEnabled: Reader<ReleaseEnabled> = (raw, at) => typeof raw === 'boolean'
  || raw === RELEASE_AUTO
  ? accepted(raw)
  : refused(at, raw, `true, false or ${RELEASE_AUTO}`);

/** Accepts `on` or `off`, as words; see "The `tiers` section". */
export const tierSwitch: Reader<TierSwitch> = oneOf(TIER_SWITCHES);

/**
 * Accepts `false` or one of the three tiers, each as itself; see "The
 * `tiers` section" for why `true` and null are refused.
 */
export const tierPin: Reader<TierPin> = (raw, at) => {
  if (raw === false) return accepted(false);
  const tier = SKILL_TIERS.find((name) => name === raw);
  return tier === undefined
    ? refused(at, raw, `false or one of: ${SKILL_TIERS.join(', ')}`)
    : accepted(tier);
};

/**
 * Accepts `false` or an agent name, each as itself; see "The `routing`
 * setting" for why `true` and null are refused.
 */
export const routeTarget: Reader<RouteTarget> = (raw, at) => raw === false
  || (typeof raw === 'string' && raw.trim() !== '')
  ? accepted(raw)
  : refused(at, raw, 'false or an agent name');

/** Accepts one of {@link SKILL_RESOLVERS}; see "The `task` section". */
export const skillResolverName: Reader<SkillResolverName> = oneOf(SKILL_RESOLVERS);

/** Accepts `on` or `off`, as words; see "The `task` section". */
export const lessonSwitch: Reader<LessonSwitch> = oneOf(LESSON_SWITCHES);

/**
 * A GitHub account login as the collaborators endpoint takes one in a
 * path: alphanumerics and hyphens opening with an alphanumeric, with the
 * `[bot]` suffix a bot account carries.
 *
 * The shape is narrow on purpose. A login read from this setting is put
 * into `repos/{owner}/{repo}/collaborators/<login>/permission` by
 * `src/board/trust.ts`, so anything carrying `/`, `.`, `%`, whitespace
 * or a leading `-` would either move that path or arrive at `gh` where a
 * flag goes. It refuses the `app/<name>` spelling `gh --json author`
 * writes for an app account for the same reason: that is `gh`'s
 * rendering of a bot and not a login the endpoint resolves.
 */
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?$/;

/** True for a string shaped like a GitHub login; see {@link GITHUB_LOGIN}. */
export function isGitHubLogin(value: unknown): value is string {
  return typeof value === 'string' && GITHUB_LOGIN.test(value);
}

/** Accepts a GitHub account login, kept as written; see {@link GITHUB_LOGIN}. */
export const githubLogin: Reader<string> = (raw, at) => isGitHubLogin(raw)
  ? accepted(raw)
  : refused(at, raw, 'a GitHub login');

/**
 * Accepts a list whose every entry `item` accepts, answered frozen.
 * Every entry is read, so a list with two unusable entries names both.
 * `expected` names the entries, in the refusal of a value that is not a
 * list.
 */
export function listOf<T>(item: Reader<T>, expected: string): Reader<readonly T[]> {
  return (raw, at) => {
    if (!Array.isArray(raw)) return refused(at, raw, `a list of ${expected}`);

    const readings = raw.map((entry: unknown, index) => item(entry, below(at, `[${index}]`)));
    const problems = readings.flatMap((reading) => reading.problems);
    const extras = readings.flatMap((reading) => reading.extras);
    if (problems.length > 0) return { value: undefined, problems, extras };

    const values = readings.flatMap((reading) => reading.value === undefined
      ? []
      : [reading.value]);
    return { value: Object.freeze(values), problems, extras };
  };
}

/**
 * Accepts a comma-separated subset of `values`, answered as a frozen
 * list in the order written. Space around a comma is allowed, since the
 * list, not the string, is what a caller acts on. An empty value, an
 * empty entry, an entry naming nothing in `values` and an entry given
 * twice are each refused: none of them is a subset spelled out.
 */
export function subsetOf<T extends string>(values: readonly T[]): Reader<readonly T[]> {
  const expected = `a comma-separated subset of: ${values.join(', ')}`;
  return (raw, at) => {
    if (typeof raw !== 'string') return refused(at, raw, expected);

    const named: T[] = [];
    for (const entry of raw.split(',')) {
      const hit = values.find((value) => value === entry.trim());
      if (hit === undefined || named.includes(hit)) return refused(at, raw, expected);
      named.push(hit);
    }
    return accepted(Object.freeze(named));
  };
}

/** What an item of one of the two list shapes may carry. */
interface ItemShape<K extends string> {
  /** The keys one of which, and only one, names the item. */
  kinds: readonly K[];
  /** The optional keys an item of `kind` reads beside its kind key. */
  optionalFor: (kind: K) => readonly string[];
}

/** An item read against its shape, before it takes its own type. */
interface KeyedItem<K extends string> {
  kind: K;
  /** What the kind key named. */
  named: string;
  /** Each optional key given a usable, non-null value. */
  optional: ReadonlyMap<string, string>;
}

/** The reader every string inside an item goes through. */
const itemText = text('a non-empty string');

/** Reads one item against `shape`; see the module note. */
function readKeyedItem<K extends string>(
  shape: ItemShape<K>,
  raw: unknown,
  at: ValueAt,
): Reading<KeyedItem<K>> {
  const choices = shape.kinds.join(', ');
  if (!isMapping(raw)) return refused(at, raw, `a mapping naming one of: ${choices}`);

  const entries = Object.entries(raw);
  const kinds = shape.kinds.filter((kind) => entries.some(([name]) => name === kind));
  const [kind] = kinds;
  if (kind === undefined) return refusedWith([`${at.label} names none of: ${choices}`]);
  if (kinds.length > 1) {
    const named = kinds.join(' and ');
    return refusedWith([`${at.label} names ${named}, expected exactly one of: ${choices}`]);
  }

  const optionalKeys = shape.optionalFor(kind);
  const problems: string[] = [];
  const extras: ConfigExtra[] = [];
  const optional = new Map<string, string>();
  let named: string | undefined;

  for (const [name, value] of entries) {
    if (name !== kind && !optionalKeys.includes(name)) {
      extras.push({ key: `${at.key}.${name}`, value });
      continue;
    }
    if (name !== kind && value === null) continue;

    const reading = itemText(value, below(at, `.${name}`));
    problems.push(...reading.problems);
    if (reading.value === undefined) continue;
    if (name === kind) named = reading.value;
    else optional.set(name, reading.value);
  }

  return problems.length > 0 || named === undefined
    ? { value: undefined, problems, extras }
    : { value: { kind, named, optional }, problems, extras };
}

/** The keys one of which names a prerequisite item. */
export const PREREQUISITE_KINDS = ['tool', 'env', 'service', 'lsp'] as const;

/** One of the four prerequisite kinds. */
export type PrerequisiteKind = (typeof PREREQUISITE_KINDS)[number];

/** One item of `prerequisites.required`. */
export interface PrerequisiteItem {
  /** Which of the four keys named it. */
  kind: PrerequisiteKind;
  /** What that key named: `bun`, `GITHUB_TOKEN`, a URL, `typescript`. */
  name: string;
  /** The command that proves it, or null to check presence alone. */
  probe: string | null;
}

/** One item of `prerequisites.optional`. */
export interface OptionalPrerequisiteItem extends PrerequisiteItem {
  /** Why the item helps, for the line naming it missing; or null. */
  reason: string | null;
}

/** The keys a required prerequisite item reads. */
export const REQUIRED_ITEM_KEYS: readonly string[] = [...PREREQUISITE_KINDS, 'probe'];

/** The keys an optional prerequisite item reads. */
export const OPTIONAL_ITEM_KEYS: readonly string[] = [...REQUIRED_ITEM_KEYS, 'reason'];

/** Reads one `prerequisites.required` item. */
export const requiredPrerequisite: Reader<PrerequisiteItem> = (raw, at) => {
  const shape = { kinds: PREREQUISITE_KINDS, optionalFor: () => ['probe'] };
  return mapReading(readKeyedItem(shape, raw, at), (item) => Object.freeze({
    kind: item.kind,
    name: item.named,
    probe: item.optional.get('probe') ?? null,
  }));
};

/** Reads one `prerequisites.optional` item. */
export const optionalPrerequisite: Reader<OptionalPrerequisiteItem> = (raw, at) => {
  const shape = { kinds: PREREQUISITE_KINDS, optionalFor: () => ['probe', 'reason'] };
  return mapReading(readKeyedItem(shape, raw, at), (item) => Object.freeze({
    kind: item.kind,
    name: item.named,
    probe: item.optional.get('probe') ?? null,
    reason: item.optional.get('reason') ?? null,
  }));
};

/** The keys one of which names a module source. */
export const MODULE_SOURCE_KINDS = ['npm', 'github', 'path'] as const;

/** One of the three module source kinds. */
export type ModuleSourceKind = (typeof MODULE_SOURCE_KINDS)[number];

/** One entry of `modules:`: where a module is installed from. */
export interface ModuleSource {
  /** Which of the three keys named it. */
  kind: ModuleSourceKind;
  /** What that key named: a package name, an `owner/repo`, a path. */
  location: string;
  /** The git ref beside a `github` source; null for every other. */
  ref: string | null;
}

/** The keys a module source reads, `ref` on a `github` one alone. */
export const MODULE_SOURCE_KEYS: readonly string[] = [...MODULE_SOURCE_KINDS, 'ref'];

/** Reads one `modules:` entry. */
export const moduleSource: Reader<ModuleSource> = (raw, at) => {
  const shape = {
    kinds: MODULE_SOURCE_KINDS,
    optionalFor: (kind: ModuleSourceKind) => kind === 'github'
      ? ['ref']
      : [],
  };
  return mapReading(readKeyedItem(shape, raw, at), (item) => Object.freeze({
    kind: item.kind,
    location: item.named,
    ref: item.optional.get('ref') ?? null,
  }));
};
