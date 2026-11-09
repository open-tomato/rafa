/**
 * The strict reader of `.rafa/d2c.yaml`, the add-on's one config file.
 *
 * Keys are matched against closed lists with `===`, and values taken
 * through `Object.entries`, as rafa's own manifest reader does, so a key
 * spelled `__proto__` is refused like any other unknown key. An unknown
 * key is a refusal, never a warning: the file is short, and a typo in
 * `store` would silently point the baselines somewhere else. Every
 * problem is collected in one pass and thrown together as a
 * {@link D2cConfigError}.
 *
 * Paths inside the project (`suite.package` and the suite's own paths)
 * are relative and never climb out with `..`, because `seed` moves the
 * folder they name. The store folder is absolute, and the set is one
 * plain path segment, so neither can reach the store's `.staging/`.
 */
import { isAbsolute } from 'node:path';

import { describeValue, isMapping } from '@open-tomato/rafa-core/core/config/sections';

/** The suite kinds this version reads. */
export const SUITE_KINDS = ['storybook-jest'] as const;

/** The runner kinds the config accepts; only `host` runs in this version. */
export const RUNNER_KINDS = ['host', 'container', 'remote'] as const;

/** The store kinds the config accepts; `same-repo` is served in a later cut. */
export const STORE_KINDS = ['local-dir', 'side-repo', 'same-repo'] as const;

/** Where the suite runs and what it writes, all relative to the project root or the package. */
export interface SuiteConfig {
  readonly kind: (typeof SUITE_KINDS)[number];
  /** The package folder the suite runs in, from the project root. */
  readonly package: string;
  /** The snapshot folder, from the package. */
  readonly snapshots: string;
  /** The diff folder, from the package. */
  readonly diffs: string;
  /** The jest JSON report of the final pass, from the package. */
  readonly report: string;
  /** The story index of the storybook build, from the package. */
  readonly index: string;
  /** The project's own command; rafa never edits it. */
  readonly command: string;
}

/** The runner: the host, a local container, or the person's remote. */
export type RunnerConfig =
  | { readonly kind: 'host' }
  | { readonly kind: 'container' }
  | { readonly kind: 'remote'; readonly host: string; readonly workdir: string; readonly command: string };

/** Where the baseline sets are kept. */
export type StoreConfig =
  | { readonly kind: 'local-dir' | 'side-repo'; readonly dir: string; readonly set: string }
  | { readonly kind: 'same-repo'; readonly set: string };

/** The whole file. */
export interface D2cConfig {
  readonly visual: {
    readonly suite: SuiteConfig;
    readonly runner: RunnerConfig;
    readonly store: StoreConfig;
  };
}

/** A refusal of the file, naming every problem found. */
export class D2cConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`d2c config: ${problems.join('; ')}`);
    this.name = 'D2cConfigError';
    this.problems = Object.freeze([...problems]);
  }
}

/** The suite path defaults, from the package. */
const SUITE_DEFAULTS = Object.freeze({
  snapshots: 'visual/__image_snapshots__',
  diffs: 'visual/__diff_output__',
  report: 'visual-report.json',
  index: 'storybook-static/index.json',
});

/** A set name: one plain path segment, not starting with a dot. */
const SET_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/** The problems of one read, gathered as it goes. */
type Problems = string[];

/** The value at each key of a mapping, refusing a key not in `keys`; null when `raw` is no mapping. */
function fieldsOf(raw: unknown, at: string, keys: readonly string[], problems: Problems): ReadonlyMap<string, unknown> | null {
  if (!isMapping(raw)) {
    problems.push(`${at} is ${describeValue(raw)}, expected a mapping`);
    return null;
  }
  const fields = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw)) {
    if (keys.some((known) => known === key)) fields.set(key, value);
    else problems.push(`${at}.${key} is not a key this file reads (expected one of: ${keys.join(', ')})`);
  }
  return fields;
}

/** A required non-empty string, or null with its problem noted. */
function textAt(fields: ReadonlyMap<string, unknown>, key: string, at: string, problems: Problems): string | null {
  if (!fields.has(key)) {
    problems.push(`${at}.${key} is missing`);
    return null;
  }
  const value = fields.get(key);
  if (typeof value === 'string' && value.trim() !== '') return value;
  problems.push(`${at}.${key} is ${describeValue(value)}, expected a non-empty string`);
  return null;
}

/** One of `kinds`, or null with its problem noted. */
function kindAt<K extends string>(fields: ReadonlyMap<string, unknown>, at: string, kinds: readonly K[], problems: Problems): K | null {
  const value = textAt(fields, 'kind', at, problems);
  if (value === null) return null;
  const kind = kinds.find((known) => known === value);
  if (kind === undefined) problems.push(`${at}.kind is ${describeValue(value)}, expected one of: ${kinds.join(', ')}`);
  return kind ?? null;
}

/** A path inside the project: relative, never climbing out. */
function insidePathAt(fields: ReadonlyMap<string, unknown>, key: string, at: string, problems: Problems, fallback?: string): string | null {
  if (!fields.has(key) && fallback !== undefined) return fallback;
  const value = textAt(fields, key, at, problems);
  if (value === null) return null;
  if (isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    problems.push(`${at}.${key} is ${describeValue(value)}, expected a relative path that stays inside the project`);
    return null;
  }
  return value;
}

/** Reads `visual.suite`. */
function readSuite(raw: unknown, problems: Problems): SuiteConfig | null {
  const at = 'visual.suite';
  const fields = fieldsOf(raw, at, ['kind', 'package', 'snapshots', 'diffs', 'report', 'index', 'command'], problems);
  if (fields === null) return null;
  const suite = {
    kind: kindAt(fields, at, SUITE_KINDS, problems),
    package: insidePathAt(fields, 'package', at, problems),
    snapshots: insidePathAt(fields, 'snapshots', at, problems, SUITE_DEFAULTS.snapshots),
    diffs: insidePathAt(fields, 'diffs', at, problems, SUITE_DEFAULTS.diffs),
    report: insidePathAt(fields, 'report', at, problems, SUITE_DEFAULTS.report),
    index: insidePathAt(fields, 'index', at, problems, SUITE_DEFAULTS.index),
    command: textAt(fields, 'command', at, problems),
  };
  return Object.values(suite).includes(null)
    ? null
    : (suite as SuiteConfig);
}

/** Reads `visual.runner`. */
function readRunner(raw: unknown, problems: Problems): RunnerConfig | null {
  const at = 'visual.runner';
  const kind = isMapping(raw)
    ? raw['kind']
    : undefined;
  const keys = kind === 'remote'
    ? ['kind', 'host', 'workdir', 'command']
    : ['kind'];
  const fields = fieldsOf(raw, at, keys, problems);
  if (fields === null) return null;
  const read = kindAt(fields, at, RUNNER_KINDS, problems);
  if (read !== 'remote') return read === null
    ? null
    : { kind: read };
  const host = textAt(fields, 'host', at, problems);
  const workdir = textAt(fields, 'workdir', at, problems);
  const command = textAt(fields, 'command', at, problems);
  return host === null || workdir === null || command === null
    ? null
    : { kind: 'remote', host, workdir, command };
}

/** Reads `visual.store`. */
function readStore(raw: unknown, problems: Problems): StoreConfig | null {
  const at = 'visual.store';
  const fields = fieldsOf(raw, at, ['kind', 'dir', 'set'], problems);
  if (fields === null) return null;
  const kind = kindAt(fields, at, STORE_KINDS, problems);
  const set = textAt(fields, 'set', at, problems);
  if (set !== null && !SET_NAME.test(set)) problems.push(`${at}.set is ${describeValue(set)}, expected one path segment of letters, digits, '.', '_' or '-', not starting with a dot`);
  const setOk = set !== null && SET_NAME.test(set)
    ? set
    : null;
  if (kind === 'same-repo') {
    if (fields.has('dir')) problems.push(`${at}.dir is not read for same-repo; the set lives in the project repository`);
    return setOk === null
      ? null
      : { kind, set: setOk };
  }
  const dir = textAt(fields, 'dir', at, problems);
  if (dir !== null && !isAbsolute(dir)) problems.push(`${at}.dir is ${describeValue(dir)}, expected an absolute path`);
  if (kind === null || dir === null || !isAbsolute(dir) || setOk === null) return null;
  return { kind, dir, set: setOk };
}

/**
 * Reads the parsed file. Throws a {@link D2cConfigError} naming every
 * problem when anything is wrong.
 */
export function readD2cConfig(raw: unknown): D2cConfig {
  if (!isMapping(raw)) throw new D2cConfigError([`the file is ${describeValue(raw)}, expected a mapping with a visual key`]);
  const problems: Problems = [];
  const top = fieldsOf(raw, 'the file', ['visual'], problems);
  const visual = top?.has('visual') === true
    ? fieldsOf(top.get('visual'), 'visual', ['suite', 'runner', 'store'], problems)
    : null;
  if (top !== null && !top.has('visual')) problems.push('visual is missing');
  const section = (key: string): unknown => {
    if (visual === null) return undefined;
    if (!visual.has(key)) problems.push(`visual.${key} is missing`);
    return visual.get(key);
  };
  const suiteRaw = section('suite');
  const runnerRaw = section('runner');
  const storeRaw = section('store');
  const suite = visual?.has('suite') === true
    ? readSuite(suiteRaw, problems)
    : null;
  const runner = visual?.has('runner') === true
    ? readRunner(runnerRaw, problems)
    : null;
  const store = visual?.has('store') === true
    ? readStore(storeRaw, problems)
    : null;
  if (problems.length > 0 || suite === null || runner === null || store === null) throw new D2cConfigError(problems);
  return Object.freeze({ visual: Object.freeze({ suite: Object.freeze(suite), runner: Object.freeze(runner), store: Object.freeze(store) }) });
}
