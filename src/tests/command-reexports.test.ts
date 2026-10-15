import type { CliCommand, CliContext, FlagSpec } from '../cli/core/types.js';
import type { CommandRegistry } from '../cli/registry.js';
import type {
  CliCommand as CoreCliCommand,
  CliContext as CoreCliContext,
  CommandRegistry as CoreCommandRegistry,
  FlagSpec as CoreFlagSpec,
} from '../core/command/index.js';
import type {
  ProjectFound as CoreProjectFound,
  Scope as CoreScope,
} from '../core/config/index.js';
import type { Scope, ProjectFound } from '../project/scope.js';

import { describe, expect, test } from 'bun:test';

import * as running from '../cli/running.js';
import * as spends from '../cli/spends.js';
import * as commandBarrel from '../core/command/index.js';
import * as configBarrel from '../core/config/index.js';
import * as scope from '../project/scope.js';

/** Compile-time proof that two types are one: a mismatch is a type error. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameTypes: readonly true[] = [
  true as Same<CliCommand, CoreCliCommand>,
  true as Same<CliContext, CoreCliContext>,
  true as Same<FlagSpec, CoreFlagSpec>,
  true as Same<CommandRegistry, CoreCommandRegistry>,
  true as Same<Scope, CoreScope>,
  true as Same<ProjectFound, CoreProjectFound>,
];

interface CutTable {
  readonly packages: readonly {
    readonly name?: string;
    readonly edges: readonly { readonly fromPackage: string; readonly to: string }[];
  }[];
}

const SPEND_NAMES = ['SPENDS_GLYPH', 'SPENDS_WHEN', 'spendsCondition', 'spendsMark', 'spendsProblem'] as const;
const RUNNING_NAMES = ['restoreRunningCommand', 'runAsRunningCommand', 'runningCommand', 'setRunningCommand'] as const;

describe('command re-exports', () => {
  test('type bindings agree with the barrels', () => {
    expect(sameTypes).toHaveLength(6);
  });

  test('spends names are the command barrel bindings', () => {
    const old: Record<string, unknown> = spends;
    const core: Record<string, unknown> = commandBarrel;
    for (const name of SPEND_NAMES) {
      expect(old[name]).toBe(core[name]);
    }
  });

  test('running names are the command barrel bindings', () => {
    const old: Record<string, unknown> = running;
    const core: Record<string, unknown> = commandBarrel;
    for (const name of RUNNING_NAMES) {
      expect(old[name]).toBe(core[name]);
    }
  });

  test('scopeAt is the config barrel binding', () => {
    expect(scope.scopeAt).toBe(configBarrel.scopeAt);
  });
});

describe('cut table', () => {
  test('core has no edge into src/cli/ or src/project/', async () => {
    const table = (await Bun.file('docs/survey/cut-table.json').json()) as CutTable;
    const edges = table.packages.flatMap((entry) => entry.edges).filter(
      (edge) => edge.fromPackage === '@open-tomato/rafa',
    );
    expect(table.packages.some((entry) => entry.edges.length > 0)).toBe(true);
    const upward = edges.filter((edge) => edge.to.startsWith('src/cli/') || edge.to.startsWith('src/project/'));
    expect(upward).toEqual([]);
  });
});
