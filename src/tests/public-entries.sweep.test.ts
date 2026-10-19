/**
 * The public-entries sweep: holds every bare `@open-tomato` specifier that
 * enters a workspace member from outside it to that member's public
 * entries, the keys of the `exports` of its `package.json`.
 *
 * The members are read at load through `readMembers` of
 * `scripts/survey/package-entries.ts`, from the root `package.json`'s
 * `workspaces` globs; no member, key or target is listed here. A specifier
 * is matched to a member by where it lands, resolved as `bunResolver` of
 * `scripts/survey/import-graph.ts` resolves it, since code reaches core as
 * `@open-tomato/rafa/<entry>` while core's manifest is named
 * `@open-tomato/rafa-core`. A specifier that lands outside this checkout or
 * nowhere is matched by its package name to the member whose manifest
 * carries that name, when one does: a worktree with no `node_modules` of
 * its own resolves a workspace link through the main checkout's, so a
 * landing alone would miss it.
 *
 * Three failures, each with a planted control:
 *
 *   - `no-exports`: the member names no `exports`, so it has no public
 *     entry and no bare specifier may name it (the hub, the sync service);
 *   - `not-exported`: the specifier's subpath matches no `exports` key of
 *     the member it lands in, as `isPublicEntry` reads it;
 *   - `off-target`: the subpath matches a key, and the file it lands on is
 *     not the one the key's target names (the `paths` map of
 *     `tsconfig.packages.json` and core's `exports` disagree).
 *
 * The importer's own member is the one its folder is in, except that a
 * file `isCoreRead` of `scripts/survey/core-moves.ts` holds is core's: the
 * tests parked under `CORE_PARKED_TESTS` import core by deep subpaths and
 * are read as core's own files, as the barrels sweep reads them, so their
 * specifiers into core are set aside and counted. A file is never held to
 * its own member's entries.
 *
 * It reads the files `git add -A` would commit and prints its counts at
 * load, so an empty read cannot pass.
 */
import type { WorkspaceMember } from '../../scripts/survey/package-entries.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';

import { isCodeFile } from '../../scripts/survey/core-barrels.js';
import { CORE_PACKAGE, isCoreRead } from '../../scripts/survey/core-moves.js';
import { bunResolver, textImports } from '../../scripts/survey/import-graph.js';
import { isPublicEntry, memberOf, readMembers } from '../../scripts/survey/package-entries.js';

import { SWEEP_TIMEOUT } from './sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The scope whose bare specifiers the sweep holds. */
const SCOPE = '@open-tomato/';

/** The keys of an `exports` condition object read as a file path, in order. */
const TARGET_CONDITIONS: readonly string[] = ['bun', 'import', 'default'];

/** What a specifier breaks. */
type Breach = 'no-exports' | 'not-exported' | 'off-target';

/** One specifier that breaks the rule. */
interface Violation {
  readonly breach: Breach;
  readonly from: string;
  readonly landed: string;
  readonly member: string;
  readonly specifier: string;
}

/** What one reading of a file set found. */
interface Reading {
  /** The code files read. */
  readonly filesRead: number;
  /** The specifiers held to a member's entries. */
  readonly held: number;
  /** Of {@link held}, those landing outside the checkout, matched by name. */
  readonly heldByName: number;
  /** The specifiers of a file `isCoreRead` holds into core, set aside. */
  readonly parkedSetAside: number;
  readonly violations: readonly Violation[];
}

/** One member with the targets of its `exports` keys. */
interface MemberEntries {
  readonly member: WorkspaceMember;
  /** The file each key names, relative to the repository root; `undefined` when it names none. */
  readonly targets: ReadonlyMap<string, string | undefined>;
}

/** The inputs of {@link readPublicEntries}. */
interface ReadInput {
  readonly files: readonly string[];
  /** The member `isCoreRead` files belong to. */
  readonly coreFolder: string;
  readonly isCoreRead: (path: string) => boolean;
  readonly members: readonly MemberEntries[];
  readonly resolve: (specifier: string, from: string) => string | undefined;
  readonly sources: ReadonlyMap<string, string>;
}

/**
 * The code files a commit of the working tree would hold: tracked or
 * untracked and not ignored, and present on disk.
 *
 * @returns Their repository-relative paths, in git's order.
 * @throws When `git ls-files` exits non-zero.
 */
function committableCodeFiles(): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${REPO_ROOT} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => path !== '' && isCodeFile(path) && existsSync(join(REPO_ROOT, path)));
}

/**
 * The file one `exports` target names: a string, or the first string of
 * the conditions {@link TARGET_CONDITIONS} names.
 *
 * @param target - The value of one `exports` key.
 * @returns The target path as the manifest spells it, or `undefined`.
 */
function targetPath(target: unknown): string | undefined {
  if (typeof target === 'string') {
    return target;
  }
  if (typeof target !== 'object' || target === null || Array.isArray(target)) {
    return undefined;
  }
  const conditions = target as Record<string, unknown>;
  const named = TARGET_CONDITIONS.map((condition) => conditions[condition]).find((value) => typeof value === 'string');
  return typeof named === 'string'
    ? named
    : undefined;
}

/**
 * Reads the targets of a member's `exports` keys from its manifest, under
 * the keys `readMembers` answered: a string or condition `exports` is the
 * target of `.`.
 *
 * @param root - The repository root.
 * @param member - The member, as `readMembers` lists it.
 * @returns The member with each key's target, relative to `root`.
 */
function entriesOf(root: string, member: WorkspaceMember): MemberEntries {
  const manifest = JSON.parse(readFileSync(join(root, member.folder, 'package.json'), 'utf8')) as { exports?: unknown };
  const exports = manifest.exports;
  const isMap = typeof exports === 'object' && exports !== null && !Array.isArray(exports)
    && Object.keys(exports).some((key) => key.startsWith('.'));
  const targets = new Map<string, string | undefined>();
  for (const key of member.exports) {
    const target = isMap
      ? targetPath((exports as Record<string, unknown>)[key])
      : targetPath(exports);
    targets.set(key, target === undefined
      ? undefined
      : posix.join(member.folder, target));
  }
  return { member, targets };
}

/**
 * The package name and the subpath of a bare scoped specifier, the subpath
 * spelled as an `exports` key spells it.
 *
 * @param specifier - An import specifier.
 * @returns Both, or `undefined` for a specifier that is not bare or not of the scope.
 */
function splitSpecifier(specifier: string): { readonly name: string; readonly subpath: string } | undefined {
  if (!specifier.startsWith(SCOPE)) {
    return undefined;
  }
  const [name, ...rest] = specifier.slice(SCOPE.length).split('/');
  if (name === undefined || name === '') {
    return undefined;
  }
  return {
    name: `${SCOPE}${name}`,
    subpath: rest.length === 0
      ? '.'
      : `./${rest.join('/')}`,
  };
}

/**
 * The file the `exports` key matching a subpath names, as Node picks the
 * key: an exact key first, then the wildcard key with the longest prefix,
 * its `*` in the target replaced by what the subpath holds in its place.
 *
 * @param subpath - The subpath, as {@link splitSpecifier} spells it.
 * @param entries - The member's keys and targets.
 * @returns The target file, or `undefined` when no key matches or the key names no file.
 */
function expectedLanding(subpath: string, entries: MemberEntries): string | undefined {
  if (entries.targets.has(subpath)) {
    return entries.targets.get(subpath);
  }
  let best: { readonly prefix: string; readonly stem: string; readonly target: string | undefined } | undefined;
  for (const [key, target] of entries.targets) {
    const star = key.indexOf('*');
    if (star === -1) {
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    const fits = subpath.length > prefix.length + suffix.length && subpath.startsWith(prefix) && subpath.endsWith(suffix);
    if (fits && prefix.length > (best?.prefix.length ?? -1)) {
      best = { prefix, stem: subpath.slice(prefix.length, subpath.length - suffix.length), target };
    }
  }
  return best?.target?.replace('*', best.stem);
}

/**
 * Whether a resolved location is outside the checkout: a builtin, or an
 * absolute path the resolver did not bring under the root.
 *
 * @param landed - What the resolver answered.
 * @returns `true` when it is not a path of the checkout.
 */
function isOutsideCheckout(landed: string): boolean {
  return landed.startsWith('/') || /^[a-z]+:/.test(landed);
}

/**
 * Whether a landing is the expected file: the same path, or, for a landing
 * outside the checkout matched by name, the same path under another
 * checkout of the repository.
 *
 * @param landed - Where the specifier landed.
 * @param expected - The file the key's target names.
 * @returns `true` when they are one file of the member.
 */
function landsOn(landed: string, expected: string): boolean {
  return landed === expected || (landed.startsWith('/') && landed.endsWith(`/${expected}`));
}

/**
 * Reads a file set and holds every bare scoped specifier that enters a
 * member from outside it. Pure over its input.
 *
 * @param input - The files, their texts, the members and a resolver.
 * @returns The counts and the violations, sorted by importer then specifier.
 */
function readPublicEntries(input: ReadInput): Reading {
  const members = input.members.map((entries) => entries.member);
  const byFolder = new Map(input.members.map((entries) => [entries.member.folder, entries]));
  const byName = new Map(input.members.map((entries) => [entries.member.name, entries]));
  const violations: Violation[] = [];
  let filesRead = 0;
  let held = 0;
  let heldByName = 0;
  let parkedSetAside = 0;
  for (const from of [...new Set(input.files)].sort()) {
    const text = input.sources.get(from);
    if (text === undefined) {
      continue;
    }
    filesRead += 1;
    const parked = input.isCoreRead(from);
    const own = parked
      ? input.coreFolder
      : memberOf(from, members)?.folder;
    for (const specifier of textImports(text)) {
      const split = splitSpecifier(specifier);
      if (split === undefined) {
        continue;
      }
      const resolved = input.resolve(specifier, from);
      const inside = resolved !== undefined && !isOutsideCheckout(resolved);
      const landedFolder = inside
        ? memberOf(resolved, members)?.folder
        : undefined;
      const byLanding = landedFolder === undefined
        ? undefined
        : byFolder.get(landedFolder);
      const entries = inside
        ? byLanding
        : byName.get(split.name);
      if (entries === undefined) {
        continue;
      }
      if (entries.member.folder === own) {
        if (parked && !memberOf(from, members)) {
          parkedSetAside += 1;
        }
        continue;
      }
      held += 1;
      if (!inside) {
        heldByName += 1;
      }
      const landed = resolved ?? '(nothing)';
      const base = { from, landed, member: entries.member.folder, specifier };
      if (entries.member.exports.length === 0) {
        violations.push({ ...base, breach: 'no-exports' });
      } else if (!isPublicEntry(specifier, entries.member)) {
        violations.push({ ...base, breach: 'not-exported' });
      } else {
        const expected = expectedLanding(split.subpath, entries);
        if (expected === undefined || !landsOn(landed, expected)) {
          violations.push({ ...base, breach: 'off-target' });
        }
      }
    }
  }
  return { filesRead, held, heldByName, parkedSetAside, violations };
}

/**
 * One violation as a line: breach, importer, specifier, member, landing.
 *
 * @param violation - The violation.
 * @returns The line.
 */
function violationLine(violation: Violation): string {
  return `${violation.breach}: ${violation.from} imports '${violation.specifier}' into ${violation.member}, `
    + `which lands on ${violation.landed}`;
}

const liveMembers = readMembers(REPO_ROOT).map((member) => entriesOf(REPO_ROOT, member));
const files = committableCodeFiles();
const sources = new Map<string, string>();
for (const path of files) {
  sources.set(path, readFileSync(join(REPO_ROOT, path), 'utf8'));
}

const live = readPublicEntries({
  coreFolder: CORE_PACKAGE,
  files,
  isCoreRead: (path) => isCoreRead(path),
  members: liveMembers,
  resolve: bunResolver(REPO_ROOT),
  sources,
});

console.log(
  `public-entries: read ${liveMembers.length} member(s) (${liveMembers.filter((entries) => entries.member.exports.length > 0).length} with exports) `
  + `and ${live.filesRead} code file(s); held ${live.held} '${SCOPE}' specifier(s) to a member's entries `
  + `(${live.heldByName} landing outside the checkout, matched by name), set aside ${live.parkedSetAside} from parked tests; `
  + `${live.violations.length} violation(s)`,
);

const planted: string[] = [];

/** The planted core's folder and the folders `isCoreRead` holds in a planted tree. */
const PLANTED_CORE = 'packages/core/';

/**
 * Plants a repository with two members, `packages/core/` (exports `./a`,
 * `./b` and `./w/*`) and `packages/closed/` (no exports), whose subpaths
 * resolve by a `paths` map, and reads it. `@open-tomato/planted/b` is
 * mapped onto `a.ts`, off the target its key names.
 *
 * @param tree - File text by path under the tree, beside the members.
 * @returns The reading.
 */
function readPlanted(tree: Readonly<Record<string, string>>): Reading {
  const root = mkdtempSync(join(tmpdir(), 'public-entries-sweep-'));
  planted.push(root);
  const written = new Map<string, string>();
  for (const [path, text] of Object.entries({
    'package.json': JSON.stringify({ name: 'planted-root', workspaces: ['packages/*'] }),
    'packages/closed/package.json': JSON.stringify({ name: '@open-tomato/planted-closed' }),
    'packages/closed/src/c.ts': 'export const c = 1;\n',
    'packages/core/package.json': JSON.stringify({
      exports: { './a': './src/a.ts', './b': './src/b.ts', './w/*': './src/w/*.ts' },
      name: '@open-tomato/planted-core',
    }),
    'packages/core/src/a.ts': 'export const a = 1;\n',
    'packages/core/src/b.ts': 'export const b = 1;\n',
    'packages/core/src/deep.ts': 'export const deep = 1;\n',
    'packages/core/src/w/x.ts': 'export const x = 1;\n',
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@open-tomato/planted-closed/*': ['./packages/closed/src/*'],
          '@open-tomato/planted/*': ['./packages/core/src/*'],
          '@open-tomato/planted/b': ['./packages/core/src/a.ts'],
        },
      },
    }),
    ...tree,
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    written.set(path, text);
  }
  return readPublicEntries({
    coreFolder: PLANTED_CORE,
    files: [...written.keys()].filter(isCodeFile),
    isCoreRead: (path) => isCoreRead(path, [`${PLANTED_CORE}src/`], []),
    members: readMembers(root).map((member) => entriesOf(root, member)),
    resolve: bunResolver(root),
    sources: written,
  });
}

afterAll(() => {
  for (const root of planted) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('the public-entries sweep', () => {
  it('reads members with exports and specifiers held to them, proving the scan is not vacuous', () => {
    expect(liveMembers.some((entries) => entries.member.exports.length > 0)).toBe(true);
    expect(live.filesRead).toBeGreaterThan(0);
    expect(live.held).toBeGreaterThan(0);
  });

  it('enters every member through one of its public entries, landing on the file the key names', () => {
    const lines = live.violations.map((violation) => violationLine(violation));
    expect(lines, `bare specifier(s) that enter a member through no public entry:\n${lines.join('\n')}`).toEqual([]);
  });
});

describe('the planted-tree controls', () => {
  it('passes exact and wildcard entries landing on their targets', () => {
    const reading = readPlanted({
      'app/main.ts': 'import { a } from \'@open-tomato/planted/a\';\nimport { x } from \'@open-tomato/planted/w/x\';\n',
    });
    expect(reading.violations).toEqual([]);
    expect(reading.held).toBe(2);
  });

  it('fails a subpath no exports key names', () => {
    const reading = readPlanted({
      'app/main.ts': 'import { deep } from \'@open-tomato/planted/deep\';\n',
    });
    expect(reading.violations).toEqual([{
      breach: 'not-exported',
      from: 'app/main.ts',
      landed: 'packages/core/src/deep.ts',
      member: PLANTED_CORE,
      specifier: '@open-tomato/planted/deep',
    }]);
  });

  it('fails an exported subpath that lands off the file its key\'s target names', () => {
    const reading = readPlanted({
      'app/main.ts': 'import { b } from \'@open-tomato/planted/b\';\n',
    });
    expect(reading.violations).toEqual([{
      breach: 'off-target',
      from: 'app/main.ts',
      landed: 'packages/core/src/a.ts',
      member: PLANTED_CORE,
      specifier: '@open-tomato/planted/b',
    }]);
  });

  it('fails a bare specifier landing in a member with no exports', () => {
    const reading = readPlanted({
      'app/main.ts': 'import { c } from \'@open-tomato/planted-closed/c\';\n',
    });
    expect(reading.violations.map((violation) => [violation.breach, violation.landed])).toEqual([
      ['no-exports', 'packages/closed/src/c.ts'],
    ]);
  });

  it('fails a bare specifier naming a member with no exports by its name when it lands nowhere', () => {
    const reading = readPlanted({
      'app/main.ts': 'import { c } from \'@open-tomato/planted-closed\';\n',
    });
    expect(reading.violations.map((violation) => [violation.breach, violation.landed])).toEqual([
      ['no-exports', '(nothing)'],
    ]);
  });

  it('holds a file of another member, and never a file to its own member', () => {
    const reading = readPlanted({
      'packages/closed/src/d.ts': 'import { deep } from \'@open-tomato/planted/deep\';\n',
      'packages/core/src/e.ts': 'import { deep } from \'@open-tomato/planted/deep\';\n',
    });
    expect(reading.violations.map((violation) => violation.from)).toEqual(['packages/closed/src/d.ts']);
  });

  it('sets aside a parked test\'s deep import into core, and fails the same import from outside', () => {
    const text = 'import { deep } from \'@open-tomato/planted/deep\';\n';
    const reading = readPlanted({ 'app/main.test.ts': text, 'src/tests/core-coupled/core/deep.test.ts': text });
    expect(reading.parkedSetAside).toBe(1);
    expect(reading.violations.map((violation) => violation.from)).toEqual(['app/main.test.ts']);
  });
});
