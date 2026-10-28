/**
 * Tests for the disk half of the config: reading one YAML file, and
 * loading each scope's two files through the home seam, its YAML file
 * read over its module file (`rafa.config.ts`, `rafa.config.mjs`) as the
 * local layer, and reading the project's two files alone
 * (`readProjectScope`).
 *
 * Every case plants its project root and its home side by side under
 * this file's temporary root, and none reads the real home: `loadConfig`
 * takes no default home, and a case that resolves the user file holds
 * its path to sit under that root. Most machines have no `~/.rafa/`
 * config, so a case that read the real one would pass on them and fail
 * only where one exists; the containment assertion fails here.
 *
 * Precedence over every setting at once is `config.test.ts`'s, driven
 * through the pure `resolveConfig`. What is pinned here is the wiring:
 * which files each scope is read from, which layer each lands in, the
 * order the four are judged in, and that a root that is the home is
 * read once. Each layering case plants values that DIFFER between the
 * files and the default, so a loader that swapped two files, or dropped
 * one, answers something else.
 *
 * Every refusal and every exclusion is paired with the acceptance that
 * makes it a reading: the user file judged first beside the same
 * project file refused alone, a refused home beside the same project
 * warning under a usable one, a missing home beside the same root
 * resolving with one, a home read once beside the same text read from
 * two directories, a `flows` refused in the user layer beside the same
 * key warned about in the project's, a value import refused beside the
 * same file importing types alone, a YAML file's key outranking a
 * module file's beside the same module file answering it alone, a
 * module file judged before its YAML file beside the same YAML file
 * refused under a usable module file, a duplicate refused at `error`
 * beside the same file warning at the default, and `readProjectScope`
 * calling no hook beside `loadConfig` calling it over the same root.
 *
 * Module files are planted at a path no other case uses: `import()`
 * keeps a module per path and content, so a case reusing a path would
 * read what an earlier case planted unless the loader reloads it, which
 * the reload case holds on its own.
 *
 * Eighteen mutations of `config-load.ts` were driven against this file,
 * one at a time, each an exact string found once, with the module
 * restored sha256-identical after, while each scope was read from one
 * file. Seventeen reddened at least one case:
 * no `false` set back, no later entry wiping it, every `false` at a map
 * id set back, none set back, the user file's
 * duplicate level over the project's, `flows` let into the user layer,
 * no shadowed file, its warning dropped, no entry recorded, the missing
 * module unmatched, the user scope looked up at `.rafa/.rafa/`, no
 * reload, no refusal of a directory at a lookup name, no cause read for
 * an unreadable file, `error` ignored, the project scope judged first,
 * and a YAML file read as merged entries. The green one turns off the
 * refusal on a schema issue, which no file reaches; the module note of
 * `config-load.ts` argues it. The two on the shadowed file struck code
 * since retired, and the four on `false` and the entry recorded strike
 * `config-load-module.ts` now.
 *
 * Seven more were driven the same way when each scope came to be read
 * from two places, against this file and `config-load-templates.test.ts`
 * together, and all seven reddened at least one case: the project's two
 * files handed to `resolveConfig` swapped, its YAML file dropped, the
 * user scope's YAML file dropped, a scope's YAML file judged before its
 * module file, the project's module file's `merge.duplicates` over its
 * YAML file's, and `readProjectScope` skipping the duplicate level or
 * answering its two files swapped.
 *
 * The settings are the sections `src/config-registry.ts` registers when
 * it is imported, as this file imports it. That import also sets the
 * load hook `loadConfig` hands every resolved config to; the cases on
 * the hook set one of their own, or clear it, and put the one they
 * found back in a `finally`.
 *
 * The defaults are read off `CONFIG_DEFAULTS` here, because
 * `config.test.ts` spells them and holds the module to them. Files are
 * planted at LITERAL paths: `.rafa/config.yaml` and `rafa.config.ts`
 * under the root, `config.yaml` and `rafa.config.ts` under the home's
 * `.rafa/`.
 */
import type { ConfigSetting, ConfigSource } from '@open-tomato/rafa/core/config/config';
import type { ConfigRoots } from '@open-tomato/rafa/core/config/config-load';

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
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test';

import { activeLoggerSettings, setActiveLoggerSettings } from '@open-tomato/rafa/adapters/logger/settings';
import { ConfigError } from '@open-tomato/rafa/core/config/config';
import { loadConfig, readConfigFile, readProjectScope } from '@open-tomato/rafa/core/config/config-load';
import { activeConfigLoadHook, setConfigLoadHook } from '@open-tomato/rafa/core/config/section';
import { setActiveOutput } from '@open-tomato/rafa/core/output/active';
import { activeStoreSettings, setActiveStoreSettings } from '@open-tomato/rafa/store/settings';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';

import { CONFIG_DEFAULTS } from '../../../../config-registry.js';

/** Chmod cannot deny a read to root; see the unreadable-file cases. */
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

/** The literal path of a module file under a project root. */
function projectModulePath(root: string, name = 'rafa.config.ts'): string {
  return join(root, name);
}

/** The literal path of a module file in the user scope under a home. */
function userModulePath(home: string, name = 'rafa.config.ts'): string {
  return join(home, '.rafa', name);
}

/** Writes `text` at `path`, creating its directory, and answers `path`. */
function write(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** Plants `text` at `.rafa/config.yaml` under `dir`, and answers `dir`. */
function plant(dir: string, text: string): string {
  write(literalPath(dir), text);
  return dir;
}

/** A module file's text: `export default` of `entries` as JSON. */
function moduleText(entries: unknown): string {
  return `export default ${JSON.stringify(entries)};\n`;
}

/** A project root and a home side by side, each holding its YAML text if given. */
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

/** The {@link ConfigError} `run` rejects with. Fails when it settles otherwise. */
async function refusal(run: () => Promise<unknown>): Promise<ConfigError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and the load resolved');
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
function warningAbout(key: string, path: string): string {
  return `rafa config: unknown key "${key}" in ${path} has no effect`;
}

/** The lines of `lines` about a key set twice in one file. */
function duplicateLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.includes('is set more than once'));
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

    expect(() => readConfigFile(dir)).toThrow(ConfigError);
    try {
      readConfigFile(dir);
    } catch (error) {
      expect((error as ConfigError).problems).toHaveLength(1);
      expect((error as ConfigError).problems[0]).toStartWith(`${literalPath(dir)}: cannot be read (`);
    }
  });

  it('characterizes Bun.file().exists() as false for a directory', async () => {
    const dir = freshDir('exists');
    mkdirSync(literalPath(dir), { recursive: true });

    expect(existsSync(literalPath(dir))).toBe(true);
    expect(await Bun.file(literalPath(dir)).exists()).toBe(false);
  });

  it.skipIf(isRoot)('refuses a config file it cannot read', async () => {
    const dir = plant(freshDir('unreadable'), 'store: ndjson\n');
    chmodSync(literalPath(dir), 0o000);
    const error = await refusal(async () => readConfigFile(dir));

    expect(error.problems[0]).toStartWith(`${literalPath(dir)}: cannot be read (`);
    expect(error.cause).toMatchObject({ code: 'EACCES' });
  });

  it('passes the parser refusals through', async () => {
    const dir = plant(freshDir('refused'), 'store: postgres\n');

    expect((await refusal(async () => readConfigFile(dir))).problems).toEqual([
      `${literalPath(dir)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });
});

describe('loadConfig over YAML files', () => {
  it('hands the load hook the config it resolved, before printing a warning', async () => {
    const held = activeConfigLoadHook();
    const events: unknown[] = [];
    try {
      setConfigLoadHook((config) => events.push(['hook', config.store]));
      const resolved = await loadConfig(scopes('store: ndjson\nnonesuch: 1\n', null), {}, () => events.push('warn'));

      expect(events).toEqual([['hook', 'ndjson'], 'warn']);
      expect(resolved.config.store).toBe('ndjson');
    } finally {
      setConfigLoadHook(held);
    }
  });

  it('hands the logger its settings through the hook the registry set, and leaves them with no hook set', async () => {
    const held = activeConfigLoadHook();
    try {
      await loadConfig(scopes('logger:\n  level: error\n', null), {}, quiet);
      const throughHook = activeLoggerSettings().level;
      setActiveLoggerSettings(null);
      setConfigLoadHook(null);
      await loadConfig(scopes('logger:\n  level: error\n', null), {}, quiet);

      expect([throughHook, activeLoggerSettings().level]).toEqual(['error', 'warn']);
    } finally {
      setConfigLoadHook(held);
      setActiveLoggerSettings(null);
    }
  });

  it('resolves the defaults silently when neither directory holds a config, creating nothing', async () => {
    const roots = scopes(null, null);
    const { lines, warn } = sink();
    const resolved = await loadConfig(roots, {}, warn);

    expect(resolved.config).toEqual({ ...CONFIG_DEFAULTS });
    expect(resolved.sources).toEqual(sourcesWith({}));
    expect(Object.values(resolved.provenance).every((origin) => origin === null)).toBe(true);
    expect([resolved.path, resolved.localPath, resolved.userPath, resolved.userLocalPath]).toEqual([null, null, null, null]);
    expect(lines).toEqual([]);
    expect([readdirSync(roots.root), readdirSync(roots.home)]).toEqual([[], []]);
  });

  it('hands the effort store the busy timeout it resolved, the user file answering where the project file is silent', async () => {
    try {
      await loadConfig(scopes('store: ndjson\n', 'effort:\n  busyTimeoutMs: 250\n'), {}, quiet);
      const fromUser = activeStoreSettings().busyTimeoutMs;
      await loadConfig(scopes('effort:\n  busyTimeoutMs: 60000\n', 'effort:\n  busyTimeoutMs: 250\n'), {}, quiet);
      const fromProject = activeStoreSettings().busyTimeoutMs;
      await loadConfig(scopes(null, null), {}, quiet);

      expect([fromUser, fromProject, activeStoreSettings().busyTimeoutMs]).toEqual([250, 60_000, 5000]);
    } finally {
      setActiveStoreSettings(null);
    }
  });

  it('resolves effort.sync from the user file where the project file leaves it out, '
    + 'and lets a project value outrank a user one', async () => {
    const omitting = await loadConfig(
      scopes('effort:\n  busyTimeoutMs: 250\n', 'effort:\n  sync: file\n'),
      {},
      quiet,
    );
    const naming = await loadConfig(
      scopes('effort:\n  sync: local\n', 'effort:\n  sync: file\n'),
      {},
      quiet,
    );

    expect([omitting.config.effortSync, omitting.sources.effortSync]).toEqual(['file', 'user']);
    expect([naming.config.effortSync, naming.sources.effortSync]).toEqual(['local', 'local']);
  });

  it('leaves the store settings as they were when it refuses a file', async () => {
    try {
      setActiveStoreSettings({ busyTimeoutMs: 250 });
      const roots = scopes('effort:\n  busyTimeoutMs: 0\n', null);

      expect((await refusal(() => loadConfig(roots, {}, quiet))).problems).toEqual([
        `${literalPath(roots.root)}: effort.busyTimeoutMs is 0, `
          + 'expected a lock wait in milliseconds, a whole number from 1 to 60000',
      ]);
      expect(activeStoreSettings().busyTimeoutMs).toBe(250);
    } finally {
      setActiveStoreSettings(null);
    }
  });

  it('reads the project file and lets the command line outrank it, naming entry 0 of the file', async () => {
    const roots = scopes('store: ndjson\nplan:\n  inject: full\nloop:\n  settingSources: user\n', null);
    const resolved = await loadConfig(roots, { inject: 'task' }, quiet);

    expect(resolved.config).toEqual({
      ...CONFIG_DEFAULTS,
      store: 'ndjson',
      inject: 'task',
      settingSources: ['user'],
    });
    expect(resolved.sources).toEqual(sourcesWith({
      store: 'local',
      inject: 'cli',
      settingSources: 'local',
    }));
    expect([resolved.localPath, resolved.path]).toEqual([literalPath(roots.root), null]);
    expect([resolved.provenance.store, resolved.provenance.inject, resolved.provenance.planDir])
      .toEqual([{ file: literalPath(roots.root), entry: 0 }, null, null]);
  });

  it('reads the user file under the home it is handed, a path under this file temporary root', async () => {
    const roots = scopes(null, 'store: ndjson\n');
    const resolved = await loadConfig(roots, {}, quiet);

    expect(resolved.config).toEqual({ ...CONFIG_DEFAULTS, store: 'ndjson' });
    expect(resolved.sources).toEqual(sourcesWith({ store: 'user' }));
    expect([resolved.userLocalPath, resolved.userPath]).toEqual([literalPath(roots.home), null]);
    expect(resolved.userLocalPath?.startsWith(`${tempRoot}/`)).toBe(true);
    expect(resolved.provenance.store).toEqual({ file: literalPath(roots.home), entry: 0 });
    expect([resolved.localPath, resolved.path]).toEqual([null, null]);

    // The control: the same root under another home answers the default,
    // so it was the home handed in that answered above.
    const elsewhere = await loadConfig({ root: roots.root, home: freshDir('other-home') }, {}, quiet);
    expect(elsewhere.config.store).toBe(CONFIG_DEFAULTS.store);
    expect(elsewhere.sources.store).toBe('default');
  });

  it('reads the user file for a project root that does not exist', async () => {
    const home = plant(freshDir('home'), 'store: ndjson\n');
    const root = freshPath('missing-root');
    const resolved = await loadConfig({ root, home }, {}, quiet);

    expect(existsSync(root)).toBe(false);
    expect(resolved.sources.store).toBe('user');
    expect(resolved.userLocalPath).toBe(literalPath(home));
  });

  it('lets the project file outrank the user file key by key, each over the default', async () => {
    const roots = scopes(
      'plan:\n  inject: task\n',
      'store: ndjson\nplan:\n  inject: full\n  dir: user-plans\n',
    );
    const resolved = await loadConfig(roots, {}, quiet);

    expect(resolved.config).toEqual({
      ...CONFIG_DEFAULTS,
      store: 'ndjson',
      inject: 'task',
      planDir: 'user-plans',
    });
    expect(resolved.sources).toEqual(sourcesWith({
      store: 'user',
      inject: 'local',
      planDir: 'user',
    }));
    expect([resolved.localPath, resolved.userLocalPath])
      .toEqual([literalPath(roots.root), literalPath(roots.home)]);
  });

  it('lets the command line outrank both files', async () => {
    const roots = scopes('plan:\n  dir: project-plans\n', 'plan:\n  dir: user-plans\n');
    const flagged = await loadConfig(roots, { planDir: 'cli-plans' }, quiet);
    const unflagged = await loadConfig(roots, {}, quiet);

    expect(flagged.config.planDir).toBe('cli-plans');
    expect(flagged.sources.planDir).toBe('cli');
    expect(unflagged.config.planDir).toBe('project-plans');
    expect(unflagged.sources.planDir).toBe('local');
  });

  it('keeps a false as a value, where the merge would remove the key', async () => {
    const roots = scopes('status:\n  notice: false\n', null);
    const resolved = await loadConfig(roots, {}, quiet);

    expect(CONFIG_DEFAULTS.statusNotice).toBe(true);
    expect([resolved.config.statusNotice, resolved.sources.statusNotice]).toEqual([false, 'local']);
  });

  it('warns about the user file unknown keys before the project file, naming each file', async () => {
    const roots = scopes('plan:\n  depth: 3\n', 'nonesuch: a\nstore: ndjson\n');
    const { lines, warn } = sink();
    const resolved = await loadConfig(roots, {}, warn);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith(warningAbout('nonesuch', literalPath(roots.home)));
    expect(lines[1]).toStartWith(warningAbout('plan.depth', literalPath(roots.root)));
    expect(resolved.userLocalExtras).toEqual([{ key: 'nonesuch', value: 'a' }]);
    expect(resolved.localExtras).toEqual([{ key: 'plan.depth', value: 3 }]);
  });

  it('writes through the active output warn by default, and nothing through console.warn', async () => {
    const roots = scopes('nonesuch: linear\n', null);
    const routed: string[] = [];
    const consoleWarned: unknown[][] = [];
    spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      consoleWarned.push(args);
    });
    setActiveOutput(sinkOutput({
      warn: (message) => {
        routed.push(message);
      },
    }));

    try {
      await loadConfig(roots);
    } finally {
      setActiveOutput(null);
      mock.restore();
    }

    expect(routed).toHaveLength(1);
    expect(routed[0]).toContain('unknown key "nonesuch"');
    expect(consoleWarned).toEqual([]);
  });

  it('judges the files before it looks at the command line', async () => {
    const roots = scopes('store: postgres\n', null);
    const error = await refusal(() => loadConfig(roots, { inject: 'bogus' }, quiet));

    expect(error.problems).toEqual([
      `${literalPath(roots.root)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });

  it('judges the user file before the project file', async () => {
    const project = 'plan:\n  inject: bogus\n';
    const roots = scopes(project, 'store: postgres\n');
    const error = await refusal(() => loadConfig(roots, {}, quiet));

    expect(error.problems).toEqual([
      `${literalPath(roots.home)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);

    // The control: the same project file under a usable home is refused
    // on its own, so its problem was there to be named above.
    const alone = scopes(project, 'store: sqlite\n');
    expect((await refusal(() => loadConfig(alone, {}, quiet))).problems).toEqual([
      `${literalPath(alone.root)}: plan.inject is "bogus", expected one of: full, stage, task`,
    ]);
  });

  it('refuses an unusable user value even where the project file outranks it', async () => {
    const roots = scopes('store: ndjson\n', 'store: postgres\n');

    expect((await refusal(() => loadConfig(roots, {}, quiet))).problems).toEqual([
      `${literalPath(roots.home)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);

    // The control: a usable user value under the same project file is
    // outranked by it, and the run resolves.
    const usable = scopes('store: ndjson\n', 'store: sqlite\n');
    expect((await loadConfig(usable, {}, quiet)).sources.store).toBe('local');
  });

  it('refuses a line indented with a tab before the parser reads it', async () => {
    const roots = scopes('plan:\n\tinject: full\n', null);

    expect((await refusal(() => loadConfig(roots, {}, quiet))).problems).toEqual([
      `${literalPath(roots.root)}: line 2 is indented with a tab; YAML indents with spaces only`,
    ]);
  });

  it('refuses a stream of two documents as a list, not as two entries', async () => {
    const roots = scopes('store: ndjson\n---\nstore: sqlite\n', null);

    expect((await refusal(() => loadConfig(roots, {}, quiet))).problems).toEqual([
      `${literalPath(roots.root)}: expected a mapping at the top level, found a list`,
    ]);
  });

  it('refuses a directory at the project config path rather than reading it as absent', async () => {
    const root = freshDir('directory-root');
    mkdirSync(literalPath(root), { recursive: true });
    const error = await refusal(() => loadConfig({ root, home: freshDir('home') }, {}, quiet));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toStartWith(`${literalPath(root)}: cannot be read (`);
  });

  it.skipIf(isRoot)('refuses a user config file it cannot read, naming why', async () => {
    const roots = scopes(null, 'store: ndjson\n');
    chmodSync(literalPath(roots.home), 0o000);
    const error = await refusal(() => loadConfig(roots, {}, quiet));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toStartWith(`${literalPath(roots.home)}: cannot be read (`);
    expect(error.cause).toMatchObject({ code: 'EACCES' });
  });

  it.each([
    ['a relative home', 'rel/home', '"rel/home"'],
    ['an empty home', '', '""'],
  ])('refuses %s, printing nothing', async (_label, home, quoted) => {
    const root = plant(freshDir('project'), 'nonesuch: a\n');
    const { lines, warn } = sink();

    expect((await refusal(() => loadConfig({ root, home }, {}, warn))).problems).toEqual([
      `home directory is ${quoted}, expected an absolute path`,
    ]);
    expect(lines).toEqual([]);

    // The control: the same root under an absolute home warns about the
    // project file, so a run that got past the home would have printed.
    await loadConfig({ root, home: freshDir('home') }, {}, warn);
    expect(lines).toHaveLength(1);
  });

  it('rejects rather than reading any home when none is given', async () => {
    const roots = scopes('store: ndjson\n', null);
    const noHome = { root: roots.root } as unknown as ConfigRoots;

    await expect(loadConfig(noHome, {}, quiet)).rejects.toThrow(TypeError);
    // The control: the same root with a home resolves.
    expect((await loadConfig(roots, {}, quiet)).config.store).toBe('ndjson');
  });

  it('reads a root that is the home once, as the project file', async () => {
    const text = 'store: ndjson\nnonesuch: a\n';
    const dir = plant(freshDir('home-is-root'), text);
    const once = sink();
    const resolved = await loadConfig({ root: dir, home: dir }, {}, once.warn);

    expect(resolved.sources.store).toBe('local');
    expect([resolved.localPath, resolved.userLocalPath]).toEqual([literalPath(dir), null]);
    expect(once.lines).toHaveLength(1);

    // The control: the same text in two directories is read twice.
    const twice = sink();
    const both = await loadConfig(scopes(text, text), {}, twice.warn);
    expect(both.sources.store).toBe('local');
    expect(both.userLocalPath).not.toBeNull();
    expect(twice.lines).toHaveLength(2);
  });

  it('reads a root reached through a symlink to the home once', async () => {
    const home = plant(freshDir('linked-home'), 'nonesuch: a\n');
    const root = freshPath('link');
    symlinkSync(home, root);
    const { lines, warn } = sink();
    const resolved = await loadConfig({ root, home }, {}, warn);

    expect(resolved.userLocalPath).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(warningAbout('nonesuch', literalPath(root)));
  });
});

describe('loadConfig over module files', () => {
  it('reads a project rafa.config.ts, naming the file and the entry of each setting it answers', async () => {
    const root = freshDir('ts-project');
    const path = write(projectModulePath(root), moduleText([{ store: 'ndjson' }, { pr: { base: 'trunk' } }]));
    const resolved = await loadConfig({ root, home: freshDir('home') }, {}, quiet);

    expect([resolved.config.store, resolved.config.prBase]).toEqual(['ndjson', 'trunk']);
    expect(resolved.sources).toEqual(sourcesWith({ store: 'file', prBase: 'file' }));
    expect(resolved.path).toBe(path);
    expect([resolved.provenance.store, resolved.provenance.prBase, resolved.provenance.inject])
      .toEqual([{ file: path, entry: 0 }, { file: path, entry: 1 }, null]);
  });

  it('reads one entry exported on its own as a list of one', async () => {
    const root = freshDir('ts-one-entry');
    write(projectModulePath(root), 'export default { store: \'ndjson\' };\n');

    expect((await loadConfig({ root, home: freshDir('home') }, {}, quiet)).config.store).toBe('ndjson');
  });

  it('reads a file holding import type and satisfies alone, with nothing installed beside it', async () => {
    const root = freshDir('ts-types-only');
    write(projectModulePath(root), 'import type { Config } from \'@open-tomato/rafa/config\';\n'
      + 'export default [{ pr: { base: \'trunk\' } }] satisfies Config;\n');

    expect(() => Bun.resolveSync('@open-tomato/rafa/config', root)).toThrow();
    expect((await loadConfig({ root, home: freshDir('home') }, {}, quiet)).config.prBase).toBe('trunk');
  });

  it('reads rafa.config.mjs where no rafa.config.ts stands, and rafa.config.ts ahead of it', async () => {
    const mjsOnly = freshDir('mjs-only');
    write(projectModulePath(mjsOnly, 'rafa.config.mjs'), moduleText([{ store: 'ndjson' }]));
    const both = freshDir('ts-and-mjs');
    write(projectModulePath(both, 'rafa.config.mjs'), moduleText([{ store: 'ndjson' }]));
    const ts = write(projectModulePath(both), moduleText([{ plan: { dir: 'ts-plans' } }]));

    const fromMjs = await loadConfig({ root: mjsOnly, home: freshDir('home') }, {}, quiet);
    const fromTs = await loadConfig({ root: both, home: freshDir('home') }, {}, quiet);

    expect([fromMjs.config.store, fromMjs.path]).toEqual(['ndjson', projectModulePath(mjsOnly, 'rafa.config.mjs')]);
    expect([fromTs.config.store, fromTs.config.planDir, fromTs.path]).toEqual([CONFIG_DEFAULTS.store, 'ts-plans', ts]);
  });

  it('reads the user scope module file under the home .rafa/, ranked under the project file key by key', async () => {
    const roots = scopes('plan:\n  dir: project-plans\n', null);
    const userPath = write(userModulePath(roots.home), moduleText([{ store: 'ndjson', plan: { dir: 'user-plans' } }]));
    const resolved = await loadConfig(roots, {}, quiet);

    expect([resolved.config.store, resolved.config.planDir]).toEqual(['ndjson', 'project-plans']);
    expect([resolved.sources.store, resolved.sources.planDir]).toEqual(['user', 'local']);
    expect(resolved.userPath).toBe(userPath);
    expect(resolved.provenance.store).toEqual({ file: userPath, entry: 0 });
  });

  it('lets a later entry of one file win, and names it', async () => {
    const root = freshDir('ts-later-wins');
    const path = write(projectModulePath(root), moduleText([
      { store: 'ndjson', plan: { dir: 'first' } },
      { merge: { duplicates: 'allow' } },
      { plan: { dir: 'second' } },
    ]));
    const resolved = await loadConfig({ root, home: freshDir('home') }, {}, quiet);

    expect(resolved.config.planDir).toBe('second');
    expect(resolved.provenance.planDir).toEqual({ file: path, entry: 2 });
  });

  it('sets back a false the merge removes, unless a later entry replaced the mapping above it', async () => {
    const kept = freshDir('ts-false');
    write(projectModulePath(kept), moduleText([{ status: { notice: false } }]));
    const overwritten = freshDir('ts-false-then-true');
    write(projectModulePath(overwritten), moduleText([
      { merge: { duplicates: 'allow' } },
      { status: { notice: false } },
      { status: { notice: true } },
    ]));
    const replaced = freshDir('ts-false-then-replaced');
    write(projectModulePath(replaced), moduleText([{ status: { notice: false } }, { status: { $replace: true } }]));
    const home = freshDir('home');

    const readings = await Promise.all([kept, overwritten, replaced].map(async (root) => {
      const { config, sources } = await loadConfig({ root, home }, {}, quiet);
      return [config.statusNotice, sources.statusNotice];
    }));

    expect(CONFIG_DEFAULTS.statusNotice).toBe(true);
    expect(readings).toEqual([[false, 'file'], [true, 'file'], [true, 'default']]);
  });

  it('sets back a false at a routing row, shadowing the default row as a YAML file does', async () => {
    const root = freshDir('ts-routing-false');
    write(projectModulePath(root), moduleText([{ routing: { prose: false } }]));
    const resolved = await loadConfig({ root, home: freshDir('home') }, {}, quiet);

    expect(CONFIG_DEFAULTS.routing.get('prose')).toBe('doc-updater');
    expect([resolved.config.routing.get('prose'), resolved.config.routing.get('tests')]).toEqual([false, 'tdd-guide']);
  });

  it('drops a logger.modules id a later entry sets to false, the removal its reader refuses as a value', async () => {
    const dropped = freshDir('ts-module-false');
    write(projectModulePath(dropped), moduleText([
      { merge: { duplicates: 'allow' } },
      { logger: { modules: { board: { level: 'debug' }, triage: { level: 'error' } } } },
      { logger: { modules: { board: false } } },
    ]));
    const kept = freshDir('ts-module-kept');
    write(projectModulePath(kept), moduleText([{ logger: { modules: { board: { level: 'debug' } } } }]));
    const home = freshDir('home');

    const fromDropped = await loadConfig({ root: dropped, home }, {}, quiet);
    const fromKept = await loadConfig({ root: kept, home }, {}, quiet);

    expect([...fromDropped.config.loggerModules]).toEqual([['triage', 'error']]);
    expect([...fromKept.config.loggerModules]).toEqual([['board', 'debug']]);
  });

  it('refuses a value a reader refuses, naming the file as a YAML file is named', async () => {
    const root = freshDir('ts-refused');
    const path = write(projectModulePath(root), moduleText([{ store: 'postgres' }]));

    expect((await refusal(() => loadConfig({ root, home: freshDir('home') }, {}, quiet))).problems).toEqual([
      `${path}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });

  it('warns about an unknown key of a module file, naming the file', async () => {
    const root = freshDir('ts-unknown');
    const path = write(projectModulePath(root), moduleText([{ nonesuch: 1 }]));
    const { lines, warn } = sink();
    await loadConfig({ root, home: freshDir('home') }, {}, warn);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(warningAbout('nonesuch', path));
  });

  it('sees an edit to a module file in a later load of the same process', async () => {
    const root = freshDir('ts-reload');
    write(projectModulePath(root), moduleText([{ plan: { dir: 'before' } }]));
    const home = freshDir('home');
    const before = await loadConfig({ root, home }, {}, quiet);
    write(projectModulePath(root), moduleText([{ plan: { dir: 'after' } }]));
    const after = await loadConfig({ root, home }, {}, quiet);

    expect([before.config.planDir, after.config.planDir]).toEqual(['before', 'after']);
  });
});

describe('loadConfig with a scope holding both files', () => {
  it('reads the YAML file over the module file key by key, naming the YAML file at entry 0 and warning about neither', async () => {
    const roots = scopes('store: ndjson\npr:\n  base: yaml-base\n', null);
    const yaml = literalPath(roots.root);
    const ts = write(projectModulePath(roots.root), moduleText([{ plan: { dir: 'ts-plans' } }, { pr: { base: 'ts-base' } }]));
    const { lines, warn } = sink();
    const resolved = await loadConfig(roots, {}, warn);

    expect([resolved.config.prBase, resolved.sources.prBase, resolved.provenance.prBase])
      .toEqual(['yaml-base', 'local', { file: yaml, entry: 0 }]);
    expect([resolved.config.store, resolved.sources.store]).toEqual(['ndjson', 'local']);
    expect([resolved.config.planDir, resolved.sources.planDir, resolved.provenance.planDir])
      .toEqual(['ts-plans', 'file', { file: ts, entry: 0 }]);
    expect([resolved.localPath, resolved.path]).toEqual([yaml, ts]);
    expect(lines).toEqual([]);
    expect(resolved.warnings).toEqual([]);

    // The control: the same module file with no YAML file beside it
    // answers its own pr.base, so the YAML file's outranked it above.
    const alone = freshDir('ts-alone');
    const aloneTs = write(projectModulePath(alone), moduleText([{ plan: { dir: 'ts-plans' } }, { pr: { base: 'ts-base' } }]));
    const fromModule = await loadConfig({ root: alone, home: freshDir('home') }, {}, quiet);
    expect([fromModule.config.prBase, fromModule.sources.prBase, fromModule.provenance.prBase])
      .toEqual(['ts-base', 'file', { file: aloneTs, entry: 1 }]);
  });

  it('reads a user scope YAML file over a user module file, both reporting user and each naming its own file', async () => {
    const roots = scopes(null, 'store: ndjson\nplan:\n  dir: yaml-plans\n');
    const yaml = literalPath(roots.home);
    const mjs = write(userModulePath(roots.home, 'rafa.config.mjs'), moduleText([{ plan: { dir: 'user-plans' }, pr: { base: 'mjs-base' } }]));
    const { lines, warn } = sink();
    const resolved = await loadConfig(roots, {}, warn);

    expect([resolved.config.planDir, resolved.sources.planDir, resolved.provenance.planDir])
      .toEqual(['yaml-plans', 'user', { file: yaml, entry: 0 }]);
    expect([resolved.config.prBase, resolved.sources.prBase, resolved.provenance.prBase])
      .toEqual(['mjs-base', 'user', { file: mjs, entry: 0 }]);
    expect([resolved.config.store, resolved.sources.store]).toEqual(['ndjson', 'user']);
    expect([resolved.userLocalPath, resolved.userPath]).toEqual([yaml, mjs]);
    expect(lines).toEqual([]);
  });

  it('judges the module file before the YAML file of its scope', async () => {
    const roots = scopes('plan:\n  inject: bogus\n', null);
    const ts = write(projectModulePath(roots.root), moduleText([{ store: 'postgres' }]));

    expect((await refusal(() => loadConfig(roots, {}, quiet))).problems).toEqual([
      `${ts}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);

    // The control: the same YAML file beside a usable module file is
    // refused on its own, so its problem was there to be named above.
    const usable = scopes('plan:\n  inject: bogus\n', null);
    write(projectModulePath(usable.root), moduleText([{ store: 'ndjson' }]));
    expect((await refusal(() => loadConfig(usable, {}, quiet))).problems).toEqual([
      `${literalPath(usable.root)}: plan.inject is "bogus", expected one of: full, stage, task`,
    ]);
  });

  it('lets the YAML file\'s merge.duplicates outrank the module file\'s', async () => {
    const roots = scopes('merge:\n  duplicates: allow\n', null);
    write(projectModulePath(roots.root), moduleText([
      { merge: { duplicates: 'error' } },
      { pr: { base: 'first' } },
      { pr: { base: 'second' } },
    ]));
    const { lines, warn } = sink();
    const resolved = await loadConfig(roots, {}, warn);

    expect(resolved.config.prBase).toBe('second');
    expect(duplicateLines(lines)).toEqual([]);

    // The control: the same module file alone refuses at its own level.
    const alone = freshDir('ts-duplicate-error');
    write(projectModulePath(alone), moduleText([
      { merge: { duplicates: 'error' } },
      { pr: { base: 'first' } },
      { pr: { base: 'second' } },
    ]));
    expect((await refusal(() => loadConfig({ root: alone, home: freshDir('home') }, {}, quiet))).problems).toHaveLength(1);
  });
});

describe('readProjectScope', () => {
  it('answers the project\'s two files, each with its templates laid under it, unranked', async () => {
    const roots = scopes('pr:\n  base: stretch/9\n', 'store: ndjson\n');
    const ts = write(projectModulePath(roots.root), moduleText([{ templates: ['escalation'], pr: { base: 'trunk' } }]));
    const { local, file } = await readProjectScope(roots.root);

    expect([local?.path, local?.values.prBase, local?.values.checksTask]).toEqual([literalPath(roots.root), 'stretch/9', undefined]);
    expect([file?.path, file?.values.prBase, file?.values.checksTask]).toEqual([ts, 'trunk', ['affected']]);
    expect(file?.templates?.get('checksTask')).toBe('escalation');
    // No user scope: the home's store is no file's value here.
    expect([local?.values.store, file?.values.store]).toEqual([undefined, undefined]);
  });

  it('answers null for each file a project root does not hold', async () => {
    const { root } = scopes(null, null);
    const yamlOnly = scopes('store: ndjson\n', null);

    expect(await readProjectScope(root)).toEqual({ local: null, file: null });
    const read = await readProjectScope(yamlOnly.root);
    expect([read.local?.values.store, read.file]).toEqual(['ndjson', null]);
  });

  it('calls no load hook, prints no warning and leaves the store settings as they were', async () => {
    const held = activeConfigLoadHook();
    const events: unknown[] = [];
    const routed: string[] = [];
    const roots = scopes('effort:\n  busyTimeoutMs: 250\nnonesuch: 1\n', null);
    try {
      setConfigLoadHook((config) => events.push(config.effortBusyTimeoutMs));
      setActiveOutput(sinkOutput({ warn: (message) => routed.push(message) }));
      setActiveStoreSettings({ busyTimeoutMs: 60_000 });
      const { local } = await readProjectScope(roots.root);

      expect([events, routed, activeStoreSettings().busyTimeoutMs]).toEqual([[], [], 60_000]);
      expect(local?.extras).toEqual([{ key: 'nonesuch', value: 1 }]);

      // The control: loadConfig over the same root calls the hook, warns
      // and hands the store its timeout, so each reading above could fail.
      await loadConfig(roots);
      expect([events, routed.length, activeStoreSettings().busyTimeoutMs]).toEqual([[250], 1, 250]);
    } finally {
      setConfigLoadHook(held);
      setActiveOutput(null);
      setActiveStoreSettings(null);
    }
  });

  it('refuses a file loadConfig refuses, naming it', async () => {
    const roots = scopes('store: postgres\n', null);

    expect((await refusal(() => readProjectScope(roots.root))).problems).toEqual([
      `${literalPath(roots.root)}: store is "postgres", expected one of: sqlite, ndjson`,
    ]);
  });

  it('refuses a key set twice in one file at merge.duplicates error, and reads it at the default', async () => {
    const entries = [{ pr: { base: 'first' } }, { pr: { base: 'second' } }];
    const refused = scopes('merge:\n  duplicates: error\n', null);
    const ts = write(projectModulePath(refused.root), moduleText(entries));
    const warned = freshDir('ts-duplicate-default');
    write(projectModulePath(warned), moduleText(entries));

    expect((await refusal(() => readProjectScope(refused.root))).problems).toEqual([
      `${ts}: pr.base is set more than once within one layer: layer "project" (entries 0, 1)`,
    ]);
    expect((await readProjectScope(warned)).file?.values.prBase).toBe('second');
  });
});

describe('loadConfig on a key two entries of one file set', () => {
  it('warns by default, naming the file and the key, and resolves to the later entry', async () => {
    const root = freshDir('ts-duplicate');
    const path = write(projectModulePath(root), moduleText([{ pr: { base: 'first' } }, { pr: { base: 'second' } }]));
    const { lines, warn } = sink();
    const resolved = await loadConfig({ root, home: freshDir('home') }, {}, warn);

    expect(resolved.config.prBase).toBe('second');
    expect(duplicateLines(lines)).toEqual([
      `rafa config: ${path}: pr.base is set more than once within one layer: layer "project" (entries 0, 1)`,
    ]);
  });

  it('refuses at merge.duplicates error, the user file deciding where the project file names none', async () => {
    const roots = scopes(null, 'merge:\n  duplicates: error\n');
    const path = write(projectModulePath(roots.root), moduleText([{ pr: { base: 'first' } }, { pr: { base: 'second' } }]));

    expect((await refusal(() => loadConfig(roots, {}, quiet))).problems).toEqual([
      `${path}: pr.base is set more than once within one layer: layer "project" (entries 0, 1)`,
    ]);
  });

  it('lets the project file level outrank the user file one', async () => {
    const roots = scopes(null, 'merge:\n  duplicates: error\n');
    write(projectModulePath(roots.root), moduleText([
      { merge: { duplicates: 'warn' } },
      { pr: { base: 'first' } },
      { pr: { base: 'second' } },
    ]));
    const { lines, warn } = sink();
    const resolved = await loadConfig(roots, {}, warn);

    expect(resolved.config.prBase).toBe('second');
    expect(duplicateLines(lines)).toHaveLength(1);
  });

  it('drops the warning at merge.duplicates allow', async () => {
    const root = freshDir('ts-duplicate-allowed');
    write(projectModulePath(root), moduleText([
      { merge: { duplicates: 'allow' } },
      { pr: { base: 'first' } },
      { pr: { base: 'second' } },
    ]));
    const { lines, warn } = sink();
    await loadConfig({ root, home: freshDir('home') }, {}, warn);

    expect(duplicateLines(lines)).toEqual([]);
  });
});

describe('loadConfig refusing a file', () => {
  it('refuses flows in a user module file, naming the layer and the file', async () => {
    const home = freshDir('home');
    const path = write(userModulePath(home), moduleText([{ flows: { next: {} } }]));

    expect((await refusal(() => loadConfig({ root: freshDir('project'), home }, {}, quiet))).problems).toEqual([
      `${path}: flows is refused in the user layer; flows are a project's decision and belong in the project's config file`,
    ]);

    // The control: the same entry in the project file is an unknown key,
    // warned about and not refused.
    const root = freshDir('project');
    const projectPath = write(projectModulePath(root), moduleText([{ flows: { next: {} } }]));
    const { lines, warn } = sink();
    await loadConfig({ root, home: freshDir('home') }, {}, warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(warningAbout('flows', projectPath));
  });

  it('refuses steps in a user YAML file before any of its keys is read', async () => {
    const roots = scopes(null, 'store: postgres\nsteps:\n  lint: {}\n');

    expect((await refusal(() => loadConfig(roots, {}, quiet))).problems).toEqual([
      `${literalPath(roots.home)}: steps is refused in the user layer; `
        + 'steps are a project\'s decision and belong in the project\'s config file',
    ]);
  });

  it('refuses a value import of rafa it cannot find, naming the file, the module and the install', async () => {
    const root = freshDir('ts-value-import');
    const path = write(projectModulePath(root), 'import { defineConfig } from \'@open-tomato/rafa/config\';\n'
      + 'export default defineConfig([{ pr: { base: \'trunk\' } }]);\n');

    expect(() => Bun.resolveSync('@open-tomato/rafa/config', root)).toThrow();
    expect((await refusal(() => loadConfig({ root, home: freshDir('home') }, {}, quiet))).problems).toEqual([
      `${path}: imports @open-tomato/rafa/config, which cannot be found from this file; `
        + 'install @open-tomato/rafa in the project (bun add -d @open-tomato/rafa), '
        + 'or import its types alone (import type { Config } from \'@open-tomato/rafa/config\'), which need nothing at run time',
    ]);
  });

  it('names a missing relative module without an install', async () => {
    const root = freshDir('ts-relative-import');
    const path = write(projectModulePath(root), 'import { entries } from \'./nonesuch.js\';\nexport default entries;\n');

    expect((await refusal(() => loadConfig({ root, home: freshDir('home') }, {}, quiet))).problems).toEqual([
      `${path}: imports ./nonesuch.js, which cannot be found from this file`,
    ]);
  });

  it('refuses a module file that throws as it loads, naming it', async () => {
    const root = freshDir('ts-throws');
    const path = write(projectModulePath(root), 'throw new Error(\'planted\');\n');
    const error = await refusal(() => loadConfig({ root, home: freshDir('home') }, {}, quiet));

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toStartWith(`${path}: cannot be loaded (`);
    expect(error.problems[0]).toContain('planted');
  });
});
