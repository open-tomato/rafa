/**
 * Tests for the disk half of the config: reading one config file, and
 * loading the project's and the user scope's through the home seam.
 *
 * Every case plants its project root and its home side by side under
 * this file's temporary root, and none reads the real home: `loadConfig`
 * takes no default home, and a case that resolves the user file holds
 * its path to sit under that root. Most machines have no
 * `~/.rafa/config.yaml`, so a case that read the real one would pass on
 * them and fail only where one exists; the containment assertion fails
 * here.
 *
 * Precedence over every setting at once is `config.test.ts`'s, driven
 * through the pure `resolveConfig`. What is pinned here is the wiring:
 * which directory each file is read from, which layer it lands in, the
 * order the two are judged in, and that a root that is the home is read
 * once. Each layering case plants values that DIFFER between the user
 * file, the project file and the default, so a loader that swapped the
 * two files, or dropped one, answers something else.
 *
 * Every refusal and every exclusion is paired with the acceptance that
 * makes it a reading: the user file judged first beside the same
 * project file refused alone, a refused home beside the same project
 * warning under a usable one, a missing home beside the same root
 * resolving with one, and a home read once beside the same text read
 * from two directories.
 *
 * Twenty-one module mutations were driven against this file,
 * `config.test.ts` and `tests/plan-injection.test.ts` together, one at a
 * time, each an exact string found once, with `config.ts`,
 * `config-load.ts` and `start/run-config.ts` restored sha256-identical
 * after it. Twenty reddened at least one case on the first pass: the
 * user file ranked over the project's, dropped by the resolver, labelled
 * `file`, its warnings dropped or put after the project's, its path
 * taken from the project file, its extras dropped; the user file read
 * under the root, not handed on, swapped with the project's, or judged
 * second; a relative home accepted; the home never the root, or the two
 * compared as strings, in either of two places; a default home put
 * back; warnings never printed; the command line judged before the
 * files; and the user source labelled the default, or the project's
 * labelled with the user path. The one green, a path that does not
 * resolve read as the same directory, reddens the missing-root case,
 * which was added for it.
 *
 * The defaults are read off `CONFIG_DEFAULTS` here, because
 * `config.test.ts` spells them and holds the module to them. Files are
 * planted at the LITERAL `.rafa/config.yaml`.
 */
import type { ConfigRoots } from './config-load.js';
import type { ConfigSetting, ConfigSource } from './config.js';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test';

import { loadConfig, readConfigFile } from './config-load.js';
import { CONFIG_DEFAULTS, ConfigError } from './config.js';

/** Chmod cannot deny a read to root; see the unreadable-file case. */
const isRoot = process.getuid?.() === 0;

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-config-load-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A path of its own under this file's temporary root, not yet created. */
function freshPath(name: string): string {
  planted += 1;
  return join(tempRoot, `${planted}-${name}`);
}

/** A fresh, empty directory under this file's temporary root. */
function freshDir(name: string): string {
  const dir = freshPath(name);
  mkdirSync(dir);
  return dir;
}

/** The literal config path under a directory, spelled without the module. */
function literalPath(dir: string): string {
  return join(dir, '.rafa', 'config.yaml');
}

/** Plants `text` at `.rafa/config.yaml` under `dir`, and answers `dir`. */
function plant(dir: string, text: string): string {
  mkdirSync(join(dir, '.rafa'), { recursive: true });
  writeFileSync(literalPath(dir), text);
  return dir;
}

/** A project root and a home side by side, each holding its text if given. */
function scopes(project: string | null, user: string | null): ConfigRoots {
  const root = freshDir('project');
  const home = freshDir('home');
  if (project !== null) plant(root, project);
  if (user !== null) plant(home, user);
  return { root, home };
}

/** A warning sink, and every line it was handed. */
function sink(): { lines: string[]; warn: (line: string) => void } {
  const lines: string[] = [];
  return { lines, warn: (line) => lines.push(line) };
}

/** A warning sink that keeps nothing. */
function quiet(): void {}

/** The {@link ConfigError} `run` throws. Fails when it throws none. */
function refusal(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and nothing was thrown');
}

/** Every setting answered by `rest`, except those `named` answers. */
function sourcesWith(
  named: Partial<Record<ConfigSetting, ConfigSource>>,
  rest: ConfigSource = 'default',
): Record<ConfigSetting, ConfigSource> {
  const all = Object.fromEntries(Object.keys(CONFIG_DEFAULTS).map((setting) => [setting, rest]));
  return { ...all, ...named } as Record<ConfigSetting, ConfigSource>;
}

/** The opening of the warning about one unknown key in one file. */
function warningAbout(key: string, dir: string): string {
  return `rafa config: unknown key "${key}" in ${literalPath(dir)} has no effect`;
}

describe('readConfigFile', () => {
  it('answers null for a directory with no config, and creates nothing', () => {
    const dir = freshDir('empty');

    expect(readConfigFile(dir)).toBeNull();
    expect(existsSync(join(dir, '.rafa'))).toBe(false);
  });

  it('reads the file planted at .rafa/config.yaml', () => {
    const dir = plant(freshDir('planted'), 'store: ndjson\n');
    const file = readConfigFile(dir);

    expect(file?.values.store).toBe('ndjson');
    expect(file?.path).toBe(literalPath(dir));
  });

  it('refuses a directory at the config path rather than reading it as absent', () => {
    const dir = freshDir('directory');
    mkdirSync(literalPath(dir), { recursive: true });
    const error = refusal(() => readConfigFile(dir));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toStartWith(`${literalPath(dir)}: cannot be read (`);
  });

  it('characterizes Bun.file().exists() as false for a directory', async () => {
    const dir = freshDir('exists');
    mkdirSync(literalPath(dir), { recursive: true });

    expect(existsSync(literalPath(dir))).toBe(true);
    expect(await Bun.file(literalPath(dir)).exists()).toBe(false);
  });

  it.skipIf(isRoot)('refuses a config file it cannot read', () => {
    const dir = plant(freshDir('unreadable'), 'store: ndjson\n');
    chmodSync(literalPath(dir), 0o000);
    const error = refusal(() => readConfigFile(dir));

    expect(error.problems[0]).toStartWith(`${literalPath(dir)}: cannot be read (`);
    expect(error.cause).toMatchObject({ code: 'EACCES' });
  });

  it('passes the parser refusals through', () => {
    const dir = plant(freshDir('refused'), 'store: postgres\n');

    expect(refusal(() => readConfigFile(dir)).problems).toEqual([
      `${literalPath(dir)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });
});

describe('loadConfig', () => {
  it('resolves the defaults silently when neither directory holds a config, creating nothing', () => {
    const roots = scopes(null, null);
    const { lines, warn } = sink();
    const resolved = loadConfig(roots, {}, warn);

    expect(resolved.config).toEqual({ ...CONFIG_DEFAULTS });
    expect(resolved.sources).toEqual(sourcesWith({}));
    expect([resolved.path, resolved.userPath]).toEqual([null, null]);
    expect(lines).toEqual([]);
    expect([readdirSync(roots.root), readdirSync(roots.home)]).toEqual([[], []]);
  });

  it('reads the project file and lets the command line outrank it', () => {
    const roots = scopes('store: ndjson\nplan:\n  inject: full\nloop:\n  settingSources: user\n', null);
    const resolved = loadConfig(roots, { inject: 'task' }, quiet);

    expect(resolved.config).toEqual({
      ...CONFIG_DEFAULTS,
      store: 'ndjson',
      inject: 'task',
      settingSources: ['user'],
    });
    expect(resolved.sources).toEqual(sourcesWith({
      store: 'file',
      inject: 'cli',
      settingSources: 'file',
    }));
    expect(resolved.path).toBe(literalPath(roots.root));
  });

  it('reads the user file under the home it is handed, a path under this file temporary root', () => {
    const roots = scopes(null, 'store: ndjson\n');
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config).toEqual({ ...CONFIG_DEFAULTS, store: 'ndjson' });
    expect(resolved.sources).toEqual(sourcesWith({ store: 'user' }));
    expect(resolved.userPath).toBe(literalPath(roots.home));
    expect(resolved.userPath?.startsWith(`${tempRoot}/`)).toBe(true);
    expect(resolved.path).toBeNull();

    // The control: the same root under another home answers the default,
    // so it was the home handed in that answered above.
    const elsewhere = loadConfig({ root: roots.root, home: freshDir('other-home') }, {}, quiet);
    expect(elsewhere.config.store).toBe(CONFIG_DEFAULTS.store);
    expect(elsewhere.sources.store).toBe('default');
  });

  it('reads the user file for a project root that does not exist', () => {
    const home = plant(freshDir('home'), 'store: ndjson\n');
    const root = freshPath('missing-root');
    const resolved = loadConfig({ root, home }, {}, quiet);

    expect(existsSync(root)).toBe(false);
    expect(resolved.sources.store).toBe('user');
    expect(resolved.userPath).toBe(literalPath(home));
  });

  it('lets the project file outrank the user file key by key, each over the default', () => {
    const roots = scopes(
      'plan:\n  inject: task\n',
      'store: ndjson\nplan:\n  inject: full\n  dir: user-plans\n',
    );
    const resolved = loadConfig(roots, {}, quiet);

    expect(resolved.config).toEqual({
      ...CONFIG_DEFAULTS,
      store: 'ndjson',
      inject: 'task',
      planDir: 'user-plans',
    });
    expect(resolved.sources).toEqual(sourcesWith({
      store: 'user',
      inject: 'file',
      planDir: 'user',
    }));
    expect([resolved.path, resolved.userPath])
      .toEqual([literalPath(roots.root), literalPath(roots.home)]);
  });

  it('lets the command line outrank both files', () => {
    const roots = scopes('plan:\n  dir: project-plans\n', 'plan:\n  dir: user-plans\n');
    const flagged = loadConfig(roots, { planDir: 'cli-plans' }, quiet);
    const unflagged = loadConfig(roots, {}, quiet);

    expect(flagged.config.planDir).toBe('cli-plans');
    expect(flagged.sources.planDir).toBe('cli');
    expect(unflagged.config.planDir).toBe('project-plans');
    expect(unflagged.sources.planDir).toBe('file');
  });

  it('warns about the user file unknown keys before the project file, naming each file', () => {
    const roots = scopes('plan:\n  depth: 3\n', 'nonesuch: a\nstore: ndjson\n');
    const { lines, warn } = sink();
    const resolved = loadConfig(roots, {}, warn);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith(warningAbout('nonesuch', roots.home));
    expect(lines[1]).toStartWith(warningAbout('plan.depth', roots.root));
    expect(resolved.userExtras).toEqual([{ key: 'nonesuch', value: 'a' }]);
    expect(resolved.extras).toEqual([{ key: 'plan.depth', value: 3 }]);
  });

  it('prints through console.warn by default', () => {
    const roots = scopes('nonesuch: linear\n', null);
    const warned: unknown[][] = [];
    spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args);
    });

    try {
      loadConfig(roots);
    } finally {
      mock.restore();
    }

    expect(warned).toHaveLength(1);
    expect(String(warned[0]?.[0])).toContain('unknown key "nonesuch"');
  });

  it('judges the files before it looks at the command line', () => {
    const roots = scopes('store: postgres\n', null);
    const error = refusal(() => loadConfig(roots, { inject: 'bogus' }, quiet));

    expect(error.problems).toEqual([
      `${literalPath(roots.root)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });

  it('judges the user file before the project file', () => {
    const project = 'plan:\n  inject: bogus\n';
    const roots = scopes(project, 'store: postgres\n');
    const error = refusal(() => loadConfig(roots, {}, quiet));

    expect(error.problems).toEqual([
      `${literalPath(roots.home)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);

    // The control: the same project file under a usable home is refused
    // on its own, so its problem was there to be named above.
    const alone = scopes(project, 'store: sqlite\n');
    expect(refusal(() => loadConfig(alone, {}, quiet)).problems).toEqual([
      `${literalPath(alone.root)}: plan.inject is "bogus", expected one of: full, stage, task`,
    ]);
  });

  it('refuses an unusable user value even where the project file outranks it', () => {
    const roots = scopes('store: ndjson\n', 'store: postgres\n');

    expect(refusal(() => loadConfig(roots, {}, quiet)).problems).toEqual([
      `${literalPath(roots.home)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);

    // The control: a usable user value under the same project file is
    // outranked by it, and the run resolves.
    const usable = scopes('store: ndjson\n', 'store: sqlite\n');
    expect(loadConfig(usable, {}, quiet).sources.store).toBe('file');
  });

  it.each([
    ['a relative home', 'rel/home', '"rel/home"'],
    ['an empty home', '', '""'],
  ])('refuses %s, printing nothing', (_label, home, quoted) => {
    const root = plant(freshDir('project'), 'nonesuch: a\n');
    const { lines, warn } = sink();

    expect(refusal(() => loadConfig({ root, home }, {}, warn)).problems).toEqual([
      `home directory is ${quoted}, expected an absolute path`,
    ]);
    expect(lines).toEqual([]);

    // The control: the same root under an absolute home warns about the
    // project file, so a run that got past the home would have printed.
    loadConfig({ root, home: freshDir('home') }, {}, warn);
    expect(lines).toHaveLength(1);
  });

  it('throws rather than reading any home when none is given', () => {
    const roots = scopes('store: ndjson\n', null);
    const noHome = { root: roots.root } as unknown as ConfigRoots;

    expect(() => loadConfig(noHome, {}, quiet)).toThrow(TypeError);
    // The control: the same root with a home resolves.
    expect(loadConfig(roots, {}, quiet).config.store).toBe('ndjson');
  });

  it('reads a root that is the home once, as the project file', () => {
    const text = 'store: ndjson\nnonesuch: a\n';
    const dir = plant(freshDir('home-is-root'), text);
    const once = sink();
    const resolved = loadConfig({ root: dir, home: dir }, {}, once.warn);

    expect(resolved.sources.store).toBe('file');
    expect([resolved.path, resolved.userPath]).toEqual([literalPath(dir), null]);
    expect(once.lines).toHaveLength(1);

    // The control: the same text in two directories is read twice.
    const twice = sink();
    const both = loadConfig(scopes(text, text), {}, twice.warn);
    expect(both.sources.store).toBe('file');
    expect(both.userPath).not.toBeNull();
    expect(twice.lines).toHaveLength(2);
  });

  it('reads a root reached through a symlink to the home once', () => {
    const home = plant(freshDir('linked-home'), 'nonesuch: a\n');
    const root = freshPath('link');
    symlinkSync(home, root);
    const { lines, warn } = sink();
    const resolved = loadConfig({ root, home }, {}, warn);

    expect(resolved.userPath).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(warningAbout('nonesuch', root));
  });
});
