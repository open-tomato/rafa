/**
 * Tests for the pull request port (`src/pr/types.ts`).
 *
 * The port is almost all types, and a type-level claim made with a test
 * assertion would prove nothing here: the root tsconfig excludes every
 * test file, so `check-types` never reads this one, and
 * `bun:test`'s `expectTypeOf` checks nothing when the suite runs. Each
 * type claim is COMPILED instead, through the TypeScript compiler API,
 * under the options the root tsconfig gives `check-types`, exactly as
 * `src/cli/core/types.test.ts` does. The probes are written to a
 * temporary directory outside the repository and import the port by
 * absolute path, so no gate ever reads one.
 *
 * The conforming probe holds a whole adapter against {@link PullRequests}
 * and must compile with no diagnostic; it is what keeps the refusals from
 * passing vacuously, since a probe that failed to resolve the module
 * would "refuse" everything. Every refusal probe changes ONE thing and is
 * held to exactly one diagnostic, its code and a message naming the
 * change, so a probe failing for another reason does not pass as the
 * refusal.
 *
 * The bivariance control is the reading that matters most. The narrowed
 * `merge` is refused against the port's function-typed properties
 * (TS2322) and ACCEPTED by a probe that respells the same members as
 * method signatures — so the refusal is the property spelling's doing and
 * not something the adapter breaks either way.
 *
 * Measured 2026-09-18 on typescript 5.9.3, 22 pass either side, with the
 * module restored byte-identical (`shasum -a 256 -c`) after each run.
 * Five mutations of `types.ts` were driven against this file, one run
 * each, and every one reddened at least one case:
 *
 *   - `merge` respelled as a METHOD signature: the narrowed-merge
 *     refusal alone, which is the reading the property spelling exists
 *     for.
 *   - `MergeMethod` widened to `string`: the adapter probe and the
 *     `ff` refusal. NOT the runtime guard, which reads
 *     {@link MERGE_METHODS} and not the type — the type claim and the
 *     guard are separate readings, and each is held here.
 *   - `PullRequestState` widened to `string`: the adapter probe and the
 *     draft-state refusal.
 *   - `readonly` dropped from `PullRequestSummary.number`: the
 *     read-only refusal alone.
 *   - `failedLog` dropped from the port: both omission refusals, and
 *     the adapter probe, whose literal then carries a member the port
 *     does not declare.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { MERGE_METHODS, isMergeMethod } from './types.js';

/** The `src/` directory the probes import from. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The repository root, whose tsconfig the probes compile under. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The port, as a quoted absolute specifier. */
const PORT = JSON.stringify(join(SRC_DIR, 'pr', 'types.js'));

/** A probe's source: the port imported as `T`, then the lines given. */
function probeSource(...lines: string[]): string {
  return [`import type * as T from ${PORT};`, ...lines, ''].join('\n');
}

/** One member of an adapter, as its object literal spells it. */
interface Member {
  readonly name: string;
  readonly lines: readonly string[];
}

/**
 * Every member a conforming adapter holds, each answering the shape the
 * port asks for. A refusal probe drops or rewrites exactly one of them.
 */
const MEMBERS: readonly Member[] = [
  { name: 'kind', lines: ['  kind: "gh",'] },
  { name: 'findOpen', lines: ['  findOpen: async (branch: string) => (branch === "" ? null : summary),'] },
  { name: 'list', lines: ['  list: async () => [summary],'] },
  { name: 'get', lines: ['  get: async (n: number) => (n === 0 ? null : detail),'] },
  {
    name: 'checks',
    lines: ['  checks: async (_n: number) => ({ rows: [], verdict: "none" as const }),'],
  },
  { name: 'browse', lines: ['  browse: async (_n: number) => {},'] },
  {
    name: 'merge',
    lines: [
      '  merge: async (_n: number, method: T.MergeMethod) => ({',
      '    merged: method !== "rebase",',
      '    detail: "merged by " + method,',
      '  }),',
    ],
  },
  { name: 'comments', lines: ['  comments: async (_n: number) => [comment],'] },
  { name: 'comment', lines: ['  comment: async (_n: number, _body: string) => comment,'] },
  { name: 'editComment', lines: ['  editComment: async (_id: string, _body: string) => comment,'] },
  { name: 'failedLog', lines: ['  failedLog: async (_runId: string) => "",'] },
];

/** The records every adapter probe is built out of. */
const RECORDS = [
  'const author: T.PullRequestAuthor = { login: "marcos", isBot: false };',
  'const summary: T.PullRequestSummary = {',
  '  number: 33, title: "rafa-20: pull request commands",',
  '  url: "https://github.com/open-tomato/rafa/pull/33", state: "open",',
  '  headRefName: "feat/rafa-20-pr-commands", baseRefName: "main",',
  '  author, isCrossRepository: false, updatedAt: "2026-09-18T10:00:00Z",',
  '};',
  'const detail: T.PullRequestDetail = {',
  '  ...summary, body: "Closes #20", headRefOid: "deadbeef",',
  '  mergeable: "mergeable", mergeStateStatus: "CLEAN", labels: ["type:spec"],',
  '};',
  'const comment: T.PullRequestComment = {',
  '  id: "IC_1", author, body: "<!-- rafa:pr-triage v1 -->",',
  '  updatedAt: "2026-09-18T10:00:00Z", url: "https://github.com/o/r/pull/33#issuecomment-1",',
  '};',
];

/**
 * An adapter literal typed against `T.PullRequests`, with one member
 * dropped or rewritten. Named `adapter`, and exported so `noUnusedLocals`
 * has nothing to say about it.
 */
function adapterSource(options: {
  readonly omit?: string;
  readonly rewrite?: Member;
} = {}): string[] {
  const members = MEMBERS
    .filter((member) => member.name !== options.omit)
    .map((member) => (member.name === options.rewrite?.name
      ? options.rewrite
      : member));

  return [
    ...RECORDS,
    'export const adapter: T.PullRequests = {',
    ...members.flatMap((member) => member.lines),
    '};',
  ];
}

/** `Equals` holds when two types are the same type, aliases resolved. */
const EQUALS = [
  'type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2)',
  '  ? true',
  '  : false;',
];

/** A `merge` that takes one method only — the contravariance case. */
const NARROWED_MERGE: Member = {
  name: 'merge',
  lines: [
    '  merge: async (_n: number, method: "squash") => ({ merged: true, detail: method }),',
  ],
};

/** The probe holding every claim, which must compile clean. */
const CONFORMING_PROBE = probeSource(
  ...EQUALS,
  ...adapterSource(),
  'export const methodsAreExact: Equals<T.MergeMethod, "squash" | "merge" | "rebase"> = true;',
  'export const methodIsNotString: Equals<T.MergeMethod, string> = false;',
  'export const statesAreExact: Equals<T.PullRequestState, "open" | "closed" | "merged"> = true;',
  'export const mergeableIsExact: Equals<T.Mergeability, "mergeable" | "conflicting" | "unknown"> = true;',
  'export const kindIsExact: Equals<T.PullRequests["kind"], "gh"> = true;',
  'export const detailIsASummary: T.PullRequestSummary = detail;',
  'export const rowsAreTheCheckRows: Equals<T.ChecksReading["rows"], readonly T.CheckRow[]> = true;',
  'export async function verdictOfPr(pr: T.PullRequests): Promise<T.ChecksVerdict> {',
  '  return (await pr.checks(33)).verdict;',
  '}',
);

/**
 * The control for the narrowed `merge`: the same members respelled as
 * METHOD signatures, which TypeScript compares bivariantly, accept the
 * adapter the port refuses. It must compile clean.
 */
const BIVARIANCE_CONTROL = probeSource(
  ...RECORDS,
  'interface MethodSpelled {',
  '  merge(number: number, method: T.MergeMethod): Promise<T.MergeOutcome>;',
  '}',
  'export const bivariant: MethodSpelled = {',
  '  merge: async (_n: number, method: "squash") => ({ merged: true, detail: method }),',
  '};',
  'export const used = [author, summary, detail, comment];',
);

/** One probe changing one thing, and the one diagnostic it must draw. */
interface Refusal {
  /** What the probe changed, as the case title reads it. */
  readonly title: string;
  /** The probe's file name, unique among the probes. */
  readonly file: string;
  readonly source: string;
  /** The diagnostic's code. */
  readonly code: number;
  /** Text the diagnostic's message must hold, naming the change. */
  readonly names: string;
}

const REFUSALS: readonly Refusal[] = [
  {
    title: 'an adapter with no merge',
    file: 'omits-merge.ts',
    source: probeSource(...adapterSource({ omit: 'merge' })),
    code: 2741,
    names: '\'merge\'',
  },
  {
    title: 'an adapter with no failedLog',
    file: 'omits-failed-log.ts',
    source: probeSource(...adapterSource({ omit: 'failedLog' })),
    code: 2741,
    names: '\'failedLog\'',
  },
  {
    title: 'an adapter whose merge takes one method only',
    file: 'merge-narrowed.ts',
    source: probeSource(...adapterSource({ rewrite: NARROWED_MERGE })),
    code: 2322,
    names: 'merge',
  },
  {
    title: 'a merge method GitHub has no flag for',
    file: 'method-ff.ts',
    source: probeSource('export const method: T.MergeMethod = "ff";'),
    code: 2322,
    names: 'Type \'"ff"\' is not assignable',
  },
  {
    title: 'a pull request state outside the three',
    file: 'state-draft.ts',
    source: probeSource(
      'declare const summary: T.PullRequestSummary;',
      'export const state: T.PullRequestState = "draft";',
      'export const used = summary;',
    ),
    code: 2322,
    names: 'Type \'"draft"\' is not assignable',
  },
  {
    title: 'a write to a record field',
    file: 'writes-number.ts',
    source: probeSource(
      'export function renumber(summary: T.PullRequestSummary): void {',
      '  summary.number = 34;',
      '}',
    ),
    code: 2540,
    names: 'read-only property',
  },
];

/** One diagnostic of one probe. */
interface Reading {
  readonly code: number;
  readonly message: string;
}

/** The compile every case reads. */
interface Compiled {
  readonly program: ts.Program;
  readonly configErrors: readonly ts.Diagnostic[];
}

let tempDir = '';
let compiled: Compiled | null = null;

/** The compile, once `beforeAll` has made it. */
function compiledProbes(): Compiled {
  if (compiled === null) throw new Error('the probes were never compiled');
  return compiled;
}

/** Every diagnostic the compile holds against one probe. */
function readingsOf(file: string): Reading[] {
  const { program } = compiledProbes();
  const source = program.getSourceFile(join(tempDir, file));
  if (source === undefined) throw new Error(`the probe ${file} is not in the compile`);
  return ts.getPreEmitDiagnostics(program, source).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-pr-types-'));

  const probes: [string, string][] = [
    ['adapter.ts', CONFORMING_PROBE],
    ['bivariance.ts', BIVARIANCE_CONTROL],
    ...REFUSALS.map((refusal): [string, string] => [refusal.file, refusal.source]),
  ];
  for (const [file, source] of probes) writeFileSync(join(tempDir, file), source);

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT, undefined, configPath);

  compiled = {
    program: ts.createProgram({
      rootNames: probes.map(([file]) => join(tempDir, file)),
      options: parsed.options,
    }),
    configErrors: [...config.error === undefined
      ? []
      : [config.error], ...parsed.errors],
  };
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('the pull request port, compiled', () => {
  it('reads the root tsconfig with no error', () => {
    expect(compiledProbes().configErrors.map((error) => error.code)).toEqual([]);
  });

  it('compiles an adapter holding every member with no diagnostic', () => {
    expect(readingsOf('adapter.ts')).toEqual([]);
  });

  it('accepts the narrowed merge when the same members are methods', () => {
    // The control for the narrowed-merge refusal below: bivariance is
    // what the port gives up by spelling its members as properties.
    expect(readingsOf('bivariance.ts')).toEqual([]);
  });

  for (const refusal of REFUSALS) {
    it(`refuses ${refusal.title} with one diagnostic naming it`, () => {
      const readings = readingsOf(refusal.file);

      expect(readings.map((reading) => reading.code)).toEqual([refusal.code]);
      expect(readings[0]?.message).toContain(refusal.names);
    });
  }
});

describe('MERGE_METHODS', () => {
  it('holds GitHub three merge flags, in the order a refusal lists them', () => {
    expect(MERGE_METHODS).toEqual(['squash', 'merge', 'rebase']);
  });

  it('is frozen, so a caller cannot change what is accepted', () => {
    expect(Object.isFrozen(MERGE_METHODS)).toBe(true);
  });
});

describe('isMergeMethod', () => {
  it.each([...MERGE_METHODS])('accepts %s', (method) => {
    expect(isMergeMethod(method)).toBe(true);
  });

  it.each([
    ['a method GitHub has no flag for', 'ff'],
    ['another case of one it has', 'Squash'],
    ['an empty string', ''],
    ['a string with space around a method', ' squash '],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
    ['an array holding a method', ['squash']],
  ])('refuses %s', (_label, value) => {
    expect(isMergeMethod(value)).toBe(false);
  });
});
