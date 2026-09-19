/**
 * Tests for the ports entry: that it holds types and nothing else, that
 * `./ports` resolves to it from `src/`, and that each port refuses what
 * its module note says it refuses.
 *
 * `check-types` skips this file, and bun runs a test without checking
 * a type, so no case written in TypeScript alone can hold a type-level
 * claim. The type cases compile probe files with the TypeScript
 * compiler API instead, under the options the root tsconfig gives
 * `check-types`, and read each probe's diagnostics. The probes are
 * written to a temporary directory outside the repository and import the
 * entry by absolute path, so no gate ever reads one.
 *
 * One probe implements all five ports, its tracker under a kind an
 * add-on brings, assigns both store backends to `Store`, states every
 * port version, and compiles clean. Every other probe changes one thing
 * against one port and is held to exactly one diagnostic: its code, and
 * message text naming what the probe changed, so a probe failing for
 * some other reason does not pass as the refusal it is there to show.
 * The clean probe keeps the refusals from passing vacuously, and each
 * refusal is the control that the compile can fail.
 *
 * The export names are read off the compiler's symbol for the entry and
 * held to the list spelled here, so a name added to the entry or
 * dropped from it reds a case instead of agreeing with itself.
 *
 * The resolution cases pin that `./ports` and `./ports/index.js` both
 * reach the entry from `src/`. Measured on bun 1.3.14 before the entry
 * existed, both threw `Cannot find module`, the control that the case
 * can fail.
 *
 * Measured once outside the suite, because it reads another repository:
 * open-tomato's own `Tracker`, at the source commit the module note
 * records, and the `github`, `linear` and `local` adapters built against
 * it were each assignable to the copy, and the copy to the source's
 * `Tracker`, with no diagnostic, while the copy's `TrackerKind` was
 * still closed. A `Tracker` assigned to `Planner` in the same program
 * failed with TS2322. A `transition` taking only `done` compiled against
 * the source's method signatures and failed with TS2322 against the
 * copy's property signatures, which is the module note's claim.
 *
 * Re-measured on 2026-09-14 once `TrackerKind` was opened, the source
 * still at that commit: each `Tracker` assigned to the other now fails
 * with TS2322 on `kind`. The copy's is refused by the source's at `kind`
 * itself. The source's is refused by the copy's through `get`, whose
 * `ref` may carry a kind the source's `IssueRef` does not admit. An
 * adapter typed against the source is retyped against the copy when it
 * is ported.
 *
 * Twelve mutations of the entry were driven against this file while
 * `TrackerKind` was closed and before the port versions existed, one run
 * each, with the unmutated entry green before them and restored
 * byte-identical after, and every one reddened at least one case.
 * `Planner` left unexported reddened the name list, the clean probe and
 * the planner refusal; a runtime value exported reddened the runtime case
 * and the name list; `Store` aliasing `EffortKeyProjections` reddened the
 * clean probe and the store refusal; a `LedgerEntry` exported reddened
 * the name list and its refusal. Eight reddened their own refusal alone:
 * `transition` made optional, `transition` spelled as a method,
 * `TrackerKind`, `signal` and `MergeRule` each widened to `string`, `push`
 * allowed to answer synchronously, `CliEvent` opened to any `type`, and
 * `prerequisitesPath` made optional. The `TrackerKind` refusal then was
 * of `obsidian`, which the entry now accepts.
 *
 * Five more were driven the same way on 2026-09-14, once the versions
 * were added and `TrackerKind` opened, with the suite at 20 pass before
 * and after. `TrackerKind` closed again reddened the clean probe and the
 * named-kinds case. `TrackerKind` opened with a plain `| string`
 * reddened the named-kinds case and the non-string kind refusal.
 * `PortType` widened to `string` reddened its own refusal alone.
 * `TrackerPortVersion` widened to `number` reddened the drifted version
 * refusal, and `PortVersions` without `planner` the clean probe; each
 * also reddened the registry suite's literal case.
 *
 * `GeneratedPlan.review` arrived on 2026-09-19 with the conforming
 * probe's second planner, which carries a reading `parseSpecReview`
 * built, and the refusal of a `review` that is a string. Two mutations
 * of the entry were driven that day against this file, restored from a
 * scratch copy and verified with `shasum -c`, at 21 pass and 0 fail
 * either side. `review` made REQUIRED reddened the clean probe, whose
 * first planner carries none, which is the one thing the field's
 * optionality buys: a planner that reads no session output still
 * satisfies the port. `review` widened to `unknown` reddened 2 — its
 * own refusal, which then compiles clean, and the entry's own
 * diagnostics, since the type import it no longer names is an unused
 * local under the root tsconfig.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as planEntry from '../plan/index.js';

import * as ports from './index.js';

/** The `src/` directory, which `./ports` is resolved from. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The repository root, whose tsconfig the probes compile under. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The entry under test, as the compiler holds it. */
const ENTRY_FILE = join(SRC_DIR, 'ports', 'index.ts');

/** The type names the entry exports, sorted as `sort` sorts them. */
const TYPE_EXPORTS = [
  'AppendResult',
  'BlessedBundle',
  'CliEvent',
  'CliEventLog',
  'CliEventResult',
  'CliEventStart',
  'CliEventStep',
  'CommitEffortRow',
  'EffortKeyProjections',
  'EffortRow',
  'EffortRowByKind',
  'EffortRowKind',
  'GeneratedPlan',
  'InstinctRecord',
  'Issue',
  'IssueDraft',
  'IssuePriority',
  'IssueQuery',
  'IssueRef',
  'IssueState',
  'IssueType',
  'Learning',
  'LearningPortVersion',
  'MergeDecision',
  'MergeResult',
  'MergeRule',
  'Output',
  'OutputPortVersion',
  'PlanRequest',
  'Planner',
  'PlannerPortVersion',
  'PortType',
  'PortVersions',
  'PreflightResult',
  'SessionEffortRow',
  'SessionMode',
  'Store',
  'StorePortVersion',
  'SyncPayload',
  'Tracker',
  'TrackerCapabilities',
  'TrackerKind',
  'TrackerPortVersion',
  'TransitionResult',
];

/** The members of `TrackerKind`, as the checker prints each, sorted. */
const TRACKER_KIND_MEMBERS = ['"github"', '"linear"', '"local"', 'string & {}'];

/** A module a probe imports, as a quoted absolute specifier. */
function specifierOf(...segments: string[]): string {
  return JSON.stringify(join(SRC_DIR, ...segments));
}

/** A probe's source: the entry imported as `P`, then the lines given. */
function probeSource(...lines: string[]): string {
  return [
    `import type * as P from ${specifierOf('ports', 'index.js')};`,
    ...lines,
    '',
  ].join('\n');
}

/** A tracker literal: `kind` and `transition` as given, the rest conforming. */
function trackerLiteral(kind: string, transition: string | null): string[] {
  return [
    'export const tracker: P.Tracker = {',
    `  kind: ${kind},`,
    '  capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),',
    '  preflight: async () => ({ ok: true }),',
    '  find: async () => [],',
    '  get: async () => { throw new Error("unused"); },',
    '  create: async () => { throw new Error("unused"); },',
    '  comment: async () => {},',
    ...transition === null
      ? []
      : [`  transition: ${transition},`],
    '};',
  ];
}

/** An instinct literal carrying the signal given. */
function instinctLiteral(signal: string): string {
  return [
    '{ id: "i", trigger: "t", action: "a", action_hash: "h",',
    `confidence: 0.5, usage_count: 1, signal: ${signal}, status: "active",`,
    'created_at: "", updated_at: "" }',
  ].join(' ');
}

/** The probe implementing every port, which must compile clean. */
const CONFORMING_PROBE = probeSource(
  `import { openNdjsonStore } from ${specifierOf('effort', 'store', 'ndjson.js')};`,
  `import { openSqliteStore } from ${specifierOf('effort', 'store', 'sqlite.js')};`,
  `import { parseSpecReview } from ${specifierOf('board', 'spec-review.js')};`,
  ...trackerLiteral('"obsidian"', 'async () => ({})'),
  'export const ndjson: P.Store = openNdjsonStore("/nonexistent");',
  'export const sqlite: P.Store = openSqliteStore("/nonexistent");',
  `export const instinct: P.InstinctRecord = ${instinctLiteral('"silent"')};`,
  'export const learning: P.Learning = {',
  '  push: async (payload) => ({',
  '    decisions: payload.instincts.map((incoming): P.MergeDecision => ({',
  '      incoming, rule: "new-trigger", produced: [incoming],',
  '    })),',
  '    discarded: [],',
  '  }),',
  '  pullBlessed: async () => ({ version: "0", instincts: [instinct] }),',
  '  flag: async () => {},',
  '};',
  'export const output: P.Output = {',
  '  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},',
  '  emit: () => {}, result: () => {},',
  '};',
  'export function fail(out: P.Output): void {',
  '  out.emit({ type: "result", ok: false, error: { code: "E", message: "m" }, ts: "" });',
  '}',
  'export const planner: P.Planner = {',
  '  create: async (request) => ({',
  '    planPath: ".plans/PLAN-" + request.stub + ".md",',
  '    prerequisitesPath: null,',
  '  }),',
  '};',
  'export const reviewed: P.Planner = {',
  '  create: async (request) => ({',
  '    planPath: ".plans/PLAN-" + request.stub + ".md",',
  '    prerequisitesPath: null,',
  '    review: parseSpecReview("nothing to read"),',
  '  }),',
  '};',
  'export const versions: P.PortVersions = {',
  '  tracker: 1, store: 1, learning: 1, output: 1, planner: 1,',
  '};',
  'export const port: P.PortType = "planner";',
);

/** One probe changing one thing, and the one diagnostic it must draw. */
interface Refusal {
  /** What the probe changed, as the case title reads it. */
  title: string;
  /** The probe's file name, unique among the probes. */
  file: string;
  source: string;
  /** The diagnostic's code. */
  code: number;
  /** Text the diagnostic's message must hold, naming the change. */
  names: string;
}

const REFUSALS: readonly Refusal[] = [
  {
    title: 'a name the Tracker copy leaves out',
    file: 'left-out-ledger.ts',
    source: probeSource('export type Ledger = P.LedgerEntry;'),
    code: 2694,
    names: 'LedgerEntry',
  },
  {
    title: 'a tracker with no transition',
    file: 'tracker-missing-transition.ts',
    source: probeSource(...trackerLiteral('"local"', null)),
    code: 2741,
    names: '\'transition\'',
  },
  {
    title: 'a tracker whose transition accepts less than the port hands it',
    file: 'tracker-narrow-transition.ts',
    source: probeSource(
      ...trackerLiteral('"local"', 'async (_ref: P.IssueRef, _state: "done") => ({})'),
    ),
    code: 2322,
    names: '_state: "done"',
  },
  {
    title: 'a tracker kind that is not a string',
    file: 'tracker-number-kind.ts',
    source: probeSource(...trackerLiteral('42', 'async () => ({})')),
    code: 2322,
    names: 'Type \'number\' is not assignable to type \'TrackerKind\'',
  },
  {
    title: 'a store whose keys accepts one kind only',
    file: 'store-one-kind-keys.ts',
    source: probeSource(
      'export const store: P.Store = {',
      '  append: () => ({ path: "", appended: 0, skipped: 0 }),',
      '  keys: (_kind: "sessions") => new Set<string>(),',
      '  read: () => [],',
      '};',
    ),
    code: 2322,
    names: '_kind: "sessions"',
  },
  {
    title: 'a learning push that answers without a promise',
    file: 'learning-sync-push.ts',
    source: probeSource(
      'export const learning: P.Learning = {',
      '  push: () => ({ decisions: [], discarded: [] }),',
      '  pullBlessed: async () => ({ version: "0", instincts: [] }),',
      '  flag: async () => {},',
      '};',
    ),
    code: 2739,
    names: 'Promise<MergeResult>',
  },
  {
    title: 'a merge rule the port does not name',
    file: 'merge-unnamed-rule.ts',
    source: probeSource(
      'export function decide(incoming: P.InstinctRecord): P.MergeDecision {',
      '  return { incoming, rule: "replaced", produced: [] };',
      '}',
    ),
    code: 2322,
    names: '"replaced"',
  },
  {
    title: 'an instinct signal outside loud and silent',
    file: 'instinct-quiet-signal.ts',
    source: probeSource(`export const instinct: P.InstinctRecord = ${instinctLiteral('"quiet"')};`),
    code: 2322,
    names: '"quiet"',
  },
  {
    title: 'an output event of a kind the union does not hold',
    file: 'output-unknown-event.ts',
    source: probeSource(
      'export function progress(out: P.Output): void {',
      '  out.emit({ type: "progress", ts: "" });',
      '}',
    ),
    code: 2322,
    names: '"progress"',
  },
  {
    title: 'a generated plan with no prerequisites path',
    file: 'planner-no-prerequisites.ts',
    source: probeSource(
      'export const planner: P.Planner = {',
      '  create: async (request) => ({ planPath: request.stub }),',
      '};',
    ),
    code: 2322,
    names: 'prerequisitesPath',
  },
  {
    title: 'a generated plan whose review is not a review reading',
    file: 'planner-string-review.ts',
    source: probeSource(
      'export const planner: P.Planner = {',
      '  create: async (request) => ({',
      '    planPath: request.stub, prerequisitesPath: null, review: "ready",',
      '  }),',
      '};',
    ),
    code: 2322,
    names: 'review',
  },
  {
    title: 'a port version other than the one its port declares',
    file: 'port-version-drifted.ts',
    source: probeSource(
      'export const versions: P.PortVersions = {',
      '  tracker: 2, store: 1, learning: 1, output: 1, planner: 1,',
      '};',
    ),
    code: 2322,
    names: 'Type \'2\' is not assignable to type \'1\'',
  },
  {
    title: 'a port type the entry does not declare',
    file: 'port-type-unknown.ts',
    source: probeSource('export const port: P.PortType = "storage";'),
    code: 2820,
    names: '"storage"',
  },
];

/** One diagnostic, as a case reads it. */
interface Reading {
  code: number;
  message: string;
}

/** What compiling the probes answered. */
interface Compiled {
  program: ts.Program;
  /** The files the root tsconfig names, which must include the entry. */
  configFiles: string[];
  configErrors: readonly ts.Diagnostic[];
}

let tempDir = '';
let compiled: Compiled | null = null;

/** The compile, once `beforeAll` has made it. */
function compiledProbes(): Compiled {
  if (compiled === null) throw new Error('the probes were never compiled');
  return compiled;
}

/** The diagnostics the compiler holds for one file. */
function readingsOf(file: string): Reading[] {
  const { program } = compiledProbes();
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`the program holds no ${file}`);
  return ts.getPreEmitDiagnostics(program, source).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

/** The symbols the entry exports, as the compiler holds them. */
function entryExports(): ts.Symbol[] {
  const { program } = compiledProbes();
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(ENTRY_FILE);
  const symbol = source === undefined
    ? undefined
    : checker.getSymbolAtLocation(source);
  if (symbol === undefined) throw new Error('the compiler holds no symbol for the entry');
  return checker.getExportsOfModule(symbol);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-ports-'));

  const probes: [string, string][] = [
    ['every-port.ts', CONFORMING_PROBE],
    ...REFUSALS.map((refusal): [string, string] => [refusal.file, refusal.source]),
  ];
  for (const [file, source] of probes) writeFileSync(join(tempDir, file), source);

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    REPO_ROOT,
    undefined,
    configPath,
  );

  compiled = {
    program: ts.createProgram({
      rootNames: probes.map(([file]) => join(tempDir, file)),
      options: parsed.options,
    }),
    configFiles: parsed.fileNames,
    configErrors: [...config.error === undefined
      ? []
      : [config.error], ...parsed.errors],
  };
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('the ports entry at runtime', () => {
  it('exports no runtime value', () => {
    expect(Object.keys(ports)).toEqual([]);
  });

  it('is told apart from an entry that exports values', () => {
    expect(Object.keys(planEntry).length).toBeGreaterThan(0);
  });

  it.each(['./ports', './ports/index.js'])('resolves %s from src/ to the entry', (specifier) => {
    expect(Bun.resolveSync(specifier, SRC_DIR)).toBe(ENTRY_FILE);
  });
});

describe('the ports entry as the compiler reads it', () => {
  it('compiles under the root tsconfig, which names the entry', () => {
    const { program, configFiles, configErrors } = compiledProbes();

    expect(configErrors).toEqual([]);
    expect(configFiles).toContain(ENTRY_FILE);
    expect(program.getOptionsDiagnostics()).toEqual([]);
    expect(program.getGlobalDiagnostics()).toEqual([]);
    expect(readingsOf(ENTRY_FILE)).toEqual([]);
  });

  it('exports exactly the type names it declares', () => {
    const names = entryExports()
      .map((exported) => exported.name)
      .sort();

    expect(names).toEqual(TYPE_EXPORTS);
  });

  it('keeps the three named tracker kinds in a union that admits any other', () => {
    const checker = compiledProbes().program.getTypeChecker();
    const kind = entryExports().find((exported) => exported.name === 'TrackerKind');
    if (kind === undefined) throw new Error('the entry exports no TrackerKind');
    const type = checker.getDeclaredTypeOfSymbol(kind);
    const members = type.isUnion()
      ? type.types
      : [type];

    expect(members.map((member) => checker.typeToString(member)).sort())
      .toEqual(TRACKER_KIND_MEMBERS);
  });

  it('accepts an implementation of every port, and both store backends as Store', () => {
    expect(readingsOf(join(tempDir, 'every-port.ts'))).toEqual([]);
  });

  for (const refusal of REFUSALS) {
    it(`refuses ${refusal.title}`, () => {
      const readings = readingsOf(join(tempDir, refusal.file));

      expect(readings.map((reading) => reading.code)).toEqual([refusal.code]);
      expect(readings[0]?.message ?? '').toContain(refusal.names);
    });
  }
});
