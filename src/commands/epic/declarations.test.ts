/**
 * The `epic` declarations: `declarations.ts` imports no module under
 * `src/`, only the core entries; the values it copies from outside
 * `src/commands/` stay equal to their sources; the lasting alias of
 * `epic show` and the `spends` of `epic close` sit on their
 * declarations; and each of the seven modules exports a command that is
 * its declaration plus a `run`.
 *
 * The import reading takes every module specifier `ts.preProcessFile`
 * finds, `import type`, `export … from` and dynamic `import()` among
 * them, and resolves each from the file's own folder. A control runs the
 * same reading over a planted text naming two modules under `src/`, so a
 * reader that matched nothing could not pass for the real file.
 */
import type { CommandDeclaration, RafaCommand } from '@open-tomato/rafa/core/command';

import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { REASON_FLAG } from '../../board/epic-trail.js';
import { HORIZONS } from '../../board/roadmap-epic-rows.js';

import epicCancel from './cancel.js';
import epicClose from './close.js';
import {
  DEFAULT_HORIZON,
  DEFER_TARGETS,
  EPIC_CANCEL_DECLARATION,
  EPIC_CLOSE_DECLARATION,
  EPIC_DEFER_DECLARATION,
  EPIC_HORIZON_WORDS,
  EPIC_MOVE_DECLARATION,
  EPIC_NEW_DECLARATION,
  EPIC_PROMOTE_DECLARATION,
  EPIC_REASON_FLAG,
  EPIC_SHOW_DECLARATION,
  EPIC_SUBJECT,
  PROMOTE_TARGETS,
} from './declarations.js';
import epicDefer from './defer.js';
import { DEFER_ACTION, PROMOTE_ACTION } from './horizon-change.js';
import epicMove from './move.js';
import epicNew from './new.js';
import epicPromote from './promote.js';
import epicShow from './show.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATIONS_PATH = join(HERE, 'declarations.ts');
const SRC_DIR = join(HERE, '..', '..') + sep;

/** The prefix every specifier of a declaration module starts with. */
const CORE_PREFIX = '@open-tomato/rafa/core/';

/** One import a file holds: what it names, and the file it resolves to. */
interface ReadImport {
  readonly specifier: string;
  readonly resolved: string;
}

/**
 * Every module a source text imports, resolved from `from`.
 *
 * @param text - The source text.
 * @param from - The folder its relative specifiers resolve from.
 * @returns Each specifier with the file it resolves to.
 */
function readImports(text: string, from: string): readonly ReadImport[] {
  return ts.preProcessFile(text, true, true).importedFiles.map(({ fileName }) => ({
    specifier: fileName,
    resolved: Bun.resolveSync(fileName, from),
  }));
}

/**
 * The imports of `imports` that land under `src/`.
 *
 * @param imports - What a file imports.
 * @returns The specifiers resolving to a file under `src/`.
 */
function underSrc(imports: readonly ReadImport[]): readonly string[] {
  return imports.filter(({ resolved }) => resolved.startsWith(SRC_DIR)).map(({ specifier }) => specifier);
}

/**
 * A command less its `run`: the fields its declaration carries.
 *
 * @param command - A command a module exports.
 * @returns Every field but `run`.
 */
function lessRun(command: RafaCommand): object {
  return Object.fromEntries(Object.entries(command).filter(([field]) => field !== 'run'));
}

describe('what declarations.ts imports', () => {
  const imports = readImports(readFileSync(DECLARATIONS_PATH, 'utf8'), HERE);

  it('imports no module under src/', () => {
    expect(imports.length).toBeGreaterThan(0);
    expect(underSrc(imports)).toEqual([]);
  });

  it('imports from the core entries alone', () => {
    expect(imports.map(({ specifier }) => specifier).filter((specifier) => !specifier.startsWith(CORE_PREFIX)))
      .toEqual([]);
  });

  it('reads a planted import of a module under src/ as one, the control', () => {
    const planted = [
      'import type { RafaCommand } from \'@open-tomato/rafa/core/command\';',
      'import type { EpicHorizonSeams } from \'./horizon-change.js\';',
      'import { HORIZONS } from \'../../board/roadmap-epic-rows.js\';',
    ].join('\n');

    expect(underSrc(readImports(planted, HERE))).toEqual(['./horizon-change.js', '../../board/roadmap-epic-rows.js']);
  });
});

describe('the values declarations.ts copies and owns', () => {
  it('spells the reason flag and the horizons as their sources do', () => {
    expect(EPIC_REASON_FLAG).toBe(REASON_FLAG);
    expect(EPIC_HORIZON_WORDS).toEqual(HORIZONS);
  });

  it('gives the defer and promote actions their targets, each a horizon in horizon order', () => {
    expect(DEFER_ACTION.targets).toBe(DEFER_TARGETS);
    expect(PROMOTE_ACTION.targets).toBe(PROMOTE_TARGETS);
    for (const targets of [DEFER_TARGETS, PROMOTE_TARGETS]) {
      expect(HORIZONS.filter((horizon) => (targets as readonly string[]).includes(horizon))).toEqual([...targets]);
    }
    expect(HORIZONS).toContain(DEFAULT_HORIZON);
  });
});

describe('the epic declarations', () => {
  /** Each module's default command beside the declaration it spreads, in roster order. */
  const PAIRS: readonly (readonly [string, RafaCommand, CommandDeclaration])[] = [
    ['epic show', epicShow, EPIC_SHOW_DECLARATION],
    ['epic new', epicNew, EPIC_NEW_DECLARATION],
    ['epic defer', epicDefer, EPIC_DEFER_DECLARATION],
    ['epic promote', epicPromote, EPIC_PROMOTE_DECLARATION],
    ['epic move', epicMove, EPIC_MOVE_DECLARATION],
    ['epic close', epicClose, EPIC_CLOSE_DECLARATION],
    ['epic cancel', epicCancel, EPIC_CANCEL_DECLARATION],
  ];

  it.each(PAIRS)('exports %s as its declaration plus a run', (name, command, declaration) => {
    expect(declaration.name).toBe(name);
    expect(declaration.subject).toBe(EPIC_SUBJECT.name);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(lessRun(command)).toEqual({ ...declaration });
    expect(typeof command.run).toBe('function');
  });

  it('declares epic as the lasting alias of epic show, and on no other', () => {
    expect(EPIC_SHOW_DECLARATION.aliases).toEqual(['epic']);
    expect(EPIC_SHOW_DECLARATION.lastingAliases).toEqual(['epic']);
    expect(PAIRS.filter(([, , declaration]) => declaration.lastingAliases !== undefined).map(([name]) => name))
      .toEqual(['epic show']);
  });

  it('declares spends on epic close alone', () => {
    expect(EPIC_CLOSE_DECLARATION.spends?.when).toBe('always');
    expect(PAIRS.filter(([, , declaration]) => declaration.spends !== undefined).map(([name]) => name))
      .toEqual(['epic close']);
  });

  it('names the epic subject', () => {
    expect(EPIC_SUBJECT.name).toBe('epic');
    expect(Object.isFrozen(EPIC_SUBJECT)).toBe(true);
  });
});
