/**
 * The roster's identity: each module `src/commands/index.ts` imports by
 * name default-exports the very object `CORE_COMMANDS` holds, each
 * feature and each feature subject it imports by name, from a
 * `declarations.ts` or `index.ts` or from a feature package's facade,
 * is the one `BUNDLED_FEATURES` and `ROSTER_SUBJECTS` hold, and `rafa describe`
 * lists the subjects of `ROSTER_SUBJECTS` in its order and the command
 * names it listed at `origin/stretch/102`, with `docs plan` registered
 * since after `bug codes`, `config show` since after `config set`,
 * `release list` since after `release tag`, `release publish` since
 * between those two, `release workflows` since between `release
 * publish` and `release list` and `release fragment` since between
 * `release workflows` and `release list`, and `bug recheck` since after
 * `bug codes`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { expectExit } from '../tests/cli-capture.js';
import { SWEEP_TIMEOUT } from '../tests/sweep-timeout.js';

import { BUNDLED_FEATURES, CORE_COMMANDS, ROSTER_SUBJECTS } from './index.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DEFAULT_IMPORT = /^import (\w+) from '(\.\/[^']+)\.js';$/gm;
const NAMED_IMPORT = /^import \{ (\w+) \} from '(\.\/[^']+\/(?:declarations|index))\.js';$/gm;
/** A feature package's facade import, its bindings on one line, as `board`'s features and subjects come (#808). */
const FACADE_IMPORT = /^import \{ ([\w, ]+) \} from '(@open-tomato\/rafa-[a-z]+)';$/gm;

/** Command names `bun src/rafa.ts describe` listed at `origin/stretch/102`, `docs plan`, `config show`, `release list`, `release publish`, `release workflows`, `release fragment` and `bug recheck` added: `<subject> <action>`, then top-level names. */
const BASE_NAMES: readonly string[] = [
  'plan create',
  'plan list',
  'plan show',
  'plan validate',
  'plan risk',
  'plan needs',
  'loop start',
  'loop stop',
  'loop pause',
  'loop resume',
  'loop status',
  'loop list',
  'loop wait',
  'issue list',
  'issue show',
  'issue create',
  'issue comment',
  'issue move',
  'issue ready',
  'issue unblock',
  'issue check',
  'issue edit',
  'pr current',
  'pr show',
  'pr view',
  'pr open',
  'pr retarget',
  'pr close',
  'pr list',
  'pr wait',
  'pr merge',
  'pr triage',
  'effort collect',
  'effort report',
  'effort dashboard',
  'effort fix-schema',
  'effort copy',
  'effort schema',
  'effort migrate',
  'effort merge',
  'effort import',
  'effort move',
  'module list',
  'module exec',
  'agent vendor',
  'agent list',
  'agent show',
  'agent search',
  'skill check',
  'skill list',
  'skill show',
  'skill search',
  'skill demote',
  'skill backfill',
  'instinct check',
  'instinct list',
  'instinct show',
  'instinct flag',
  'instinct promote',
  'release status',
  'release settle',
  'release tag',
  'release publish',
  'release workflows',
  'release fragment',
  'release list',
  'board list',
  'board sync',
  'epic show',
  'epic new',
  'epic defer',
  'epic promote',
  'epic move',
  'epic close',
  'epic cancel',
  'claim release',
  'claim hand',
  'claim accept',
  'claim take',
  'update current',
  'update self',
  'update project',
  'update board',
  'update next',
  'update latest',
  'config set',
  'config show',
  'ci status',
  'stretch start',
  'stretch item',
  'stretch end',
  'bug codes',
  'bug recheck',
  'docs plan',
  'status',
  'next',
  'roadmap',
  'switch',
  'init',
  'doctor',
  'cleanup',
  'self-update',
  'describe',
];

interface DescribeDocument {
  subjects: { name: string; actions: { name: string }[] }[];
  commands: { name: string }[];
}

function readNames(document: DescribeDocument): string[] {
  return [
    ...document.subjects.flatMap((subject) => subject.actions.map((action) => `${subject.name} ${action.name}`)),
    ...document.commands.map((command) => command.name),
  ];
}

describe('the commands roster', () => {
  it('holds, for each module it imports, the object that module default-exports', async () => {
    // Arrange
    const source = readFileSync(resolve(HERE, 'index.ts'), 'utf8');
    const imports = [...source.matchAll(DEFAULT_IMPORT)].map((match) => ({ local: match[1], path: match[2] }));

    // Act
    const modules = await Promise.all(imports.map(async ({ path }) => (await import(`${path}.js`)).default as unknown));

    // Assert
    expect(imports.length).toBeGreaterThan(60);
    modules.forEach((exported, position) => {
      expect(CORE_COMMANDS.includes(exported as (typeof CORE_COMMANDS)[number]), imports[position]?.path).toBe(true);
    });
    expect(new Set(modules).size).toBe(modules.length);
    expect(CORE_COMMANDS.length).toBe(modules.length);
  });

  it('holds, for each feature and feature subject it imports by name, the object BUNDLED_FEATURES or ROSTER_SUBJECTS holds', async () => {
    // Arrange
    const source = readFileSync(resolve(HERE, 'index.ts'), 'utf8');
    const imports = [
      ...[...source.matchAll(NAMED_IMPORT)].map((match) => ({ local: match[1] ?? '', specifier: `${match[2] ?? ''}.js` })),
      ...[...source.matchAll(FACADE_IMPORT)].flatMap((match) => (match[1] ?? '')
        .split(', ')
        .filter((local) => /_(?:FEATURE|SUBJECT)$/.test(local))
        .map((local) => ({ local, specifier: match[2] ?? '' }))),
    ];
    const held: readonly unknown[] = [...BUNDLED_FEATURES, ...ROSTER_SUBJECTS];

    // Act
    const values = await Promise.all(imports.map(async ({ local, specifier }) => (await import(specifier) as Record<string, unknown>)[local]));

    // Assert
    expect(imports.map(({ local }) => local).filter((local) => local.endsWith('_FEATURE'))).toHaveLength(BUNDLED_FEATURES.length);
    expect(imports.map(({ local }) => local).filter((local) => local.endsWith('_SUBJECT'))).toHaveLength(6);
    values.forEach((value, position) => {
      expect(held.includes(value), imports[position]?.local).toBe(true);
    });
  });

  it('lists through `rafa describe` the same command names as at origin/stretch/102, docs plan, config show, release list, release publish, release workflows, release fragment and bug recheck added', () => {
    // Arrange
    const spawned = Bun.spawnSync(['bun', 'src/rafa.ts', 'describe'], { cwd: REPO_ROOT, stderr: 'pipe' });

    // Act
    const document = JSON.parse(spawned.stdout.toString()) as DescribeDocument;

    // Assert
    expectExit({ exitCode: spawned.exitCode, stdout: spawned.stdout.toString(), stderr: spawned.stderr.toString() }, 0);
    expect(document.subjects.map((subject) => subject.name)).toEqual(ROSTER_SUBJECTS.map((subject) => subject.name));
    expect(readNames(document)).toEqual([...BASE_NAMES]);
  });
});
