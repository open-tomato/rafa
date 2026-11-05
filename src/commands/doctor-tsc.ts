/**
 * The `tsc` row of `rafa doctor` (#1033): whether the `tsc` the runner's
 * type step spawns can start under the environment `doctor` was handed.
 *
 * ```text
 * tsc: ok, Version 5.9.3 (<root>/node_modules/.bin/tsc)
 * tsc: fail, <root>/node_modules/.bin/tsc exited 127 (env: 'node': No such file or directory)
 *   tsc runs under node, which its first line names: put node on the PATH the loop runs under.
 * ```
 *
 * ## When it reads at all
 *
 * Only a project root holding a `tsconfig.json` is read, as only such a
 * checkout gets a type step (`packages/rafa-run/src/start/type-step.ts`).
 * A project without one gets no row and no spawn.
 *
 * ## What it runs
 *
 * `<root>/node_modules/.bin/tsc --version`, in the project root with
 * stdin closed and the environment `doctor` was handed (`context.env`),
 * so the `PATH` the shebang's `env` searches is the invocation's.
 * Measured on bun 1.3.14 and tsc 5.9.3 (2026-11-04): spawned with a
 * `PATH` holding a link to `bun` alone, it prints `env: 'node': No such
 * file or directory` and exits 127; with the shell's `PATH` it prints
 * `Version 5.9.3` and exits 0.
 *
 * ## The outcomes
 *
 * | Reading | Row | Exit code |
 * |---|---|---|
 * | no `tsconfig.json` | none | unchanged |
 * | no `node_modules/.bin/tsc` under the root | `warn` | unchanged |
 * | exit 0 | `ok`, the first line tsc printed | unchanged |
 * | exit 126 or 127 (`CANNOT_START_CODES`) | `fail`, naming the interpreter | 1 |
 * | any other exit | `warn`, the exit and the first line | unchanged |
 * | the spawn throws | `warn`, the error | unchanged |
 *
 * An exit of 126 or 127 is the type step's `cannot start`, which halts
 * the loop on a task's first changed test file, so the row fails and
 * `doctor` exits 1 with {@link tscRefusal}. Its fix names the
 * interpreter read off the first line of the script (`scriptInterpreter`,
 * `node` for `#!/usr/bin/env node`) and says to put it on the PATH the
 * loop runs under. A spawn that throws (`ENOENT`, `EACCES`) is a warning
 * here, as the type step warns and runs nothing on it.
 *
 * ## What it prints
 *
 * An `ok` row is one `info` line in text mode and nothing in json mode;
 * a `warn` or `fail` row is a warning in both modes, a `log` event in
 * json mode, with the fix on an indented second line for `fail`.
 * {@link writeDoctorTsc} reads and writes the row in one call and
 * answers the refusal, so `./doctor.ts` wires it with that call.
 */
import type { RafaContext } from '@open-tomato/rafa/core/command';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CANNOT_START_CODES, scriptInterpreter } from '@open-tomato/rafa-run';

import { messageOf } from '@open-tomato/rafa/core/config/sections';

/** What every row opens with, and the refusal names the row by. */
export const TSC_ROW = 'tsc';

/** Where the row looks for tsc under the project root. */
const TSC_PATH: readonly string[] = ['node_modules', '.bin', 'tsc'];

/** The file whose presence asks for the row. */
const TSCONFIG = 'tsconfig.json';

/** What one `tsc --version` spawn answered. */
export interface TscVersionRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What {@link readDoctorTsc} spawns, where and under which environment. */
export interface TscVersionOptions {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** How the row spawns tsc; left out, {@link spawnTscVersion}. */
export interface DoctorTscSeams {
  readonly runTscVersion?: (options: TscVersionOptions) => Promise<TscVersionRun>;
}

/** What {@link readDoctorTsc} found; see the module note's table. */
export type DoctorTscReading =
  | { readonly kind: 'none' }
  | { readonly kind: 'missing'; readonly tsc: string }
  | { readonly kind: 'ok'; readonly tsc: string; readonly version: string }
  | { readonly kind: 'cannot-start'; readonly tsc: string; readonly exitCode: number; readonly said: string | null; readonly interpreter: string | null }
  | { readonly kind: 'broken'; readonly tsc: string; readonly exitCode: number; readonly said: string | null }
  | { readonly kind: 'unspawned'; readonly tsc: string; readonly problem: string };

/** One row: its lines and whether they go out as a warning. */
interface TscRow {
  readonly warn: boolean;
  readonly lines: readonly string[];
}

/** Spawns `argv` in `cwd` under `env` with stdin closed, reading both streams to their end. */
export async function spawnTscVersion(options: TscVersionOptions): Promise<TscVersionRun> {
  const proc = Bun.spawn([...options.argv], {
    cwd: options.cwd,
    env: { ...options.env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** The first non-blank line of either stream, or null when tsc printed none. */
function firstLine(run: TscVersionRun): string | null {
  return `${run.stdout}\n${run.stderr}`.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? null;
}

/** Reads the row for the project at `root` under `env`; see the module note. Never throws. */
export async function readDoctorTsc(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
  seams: DoctorTscSeams = {},
): Promise<DoctorTscReading> {
  if (!existsSync(join(root, TSCONFIG))) return { kind: 'none' };
  const tsc = join(root, ...TSC_PATH);
  if (!existsSync(tsc)) return { kind: 'missing', tsc };
  const run = seams.runTscVersion ?? spawnTscVersion;
  let result: TscVersionRun;
  try {
    result = await run({ cwd: root, argv: [tsc, '--version'], env });
  } catch (error) {
    return { kind: 'unspawned', tsc, problem: messageOf(error) };
  }
  const said = firstLine(result);
  if (result.exitCode === 0) return { kind: 'ok', tsc, version: said ?? 'no version printed' };
  if (CANNOT_START_CODES.includes(result.exitCode)) {
    return { kind: 'cannot-start', tsc, exitCode: result.exitCode, said, interpreter: scriptInterpreter(tsc) };
  }
  return { kind: 'broken', tsc, exitCode: result.exitCode, said };
}

/** `<tsc> exited <n>`, with the first line it printed in brackets when it printed one. */
function exited(tsc: string, exitCode: number, said: string | null): string {
  const heard = said === null
    ? ''
    : ` (${said})`;
  return `${tsc} exited ${String(exitCode)}${heard}`;
}

/** What to do about a tsc that cannot start, naming its interpreter when its first line names one. */
export function cannotStartFix(tsc: string, interpreter: string | null): string {
  return interpreter === null
    ? `Its first line names no interpreter: make ${tsc} runnable from the PATH the loop runs under.`
    : `tsc runs under ${interpreter}, which its first line names: put ${interpreter} on the PATH the loop runs under.`;
}

/** The row's lines and level, or null for no row. */
export function tscRow(reading: DoctorTscReading): TscRow | null {
  switch (reading.kind) {
    case 'none':
      return null;
    case 'missing':
      return { warn: true, lines: [`${TSC_ROW}: warn, ${TSCONFIG} is here and ${reading.tsc} is not: the type step runs nothing`] };
    case 'ok':
      return { warn: false, lines: [`${TSC_ROW}: ok, ${reading.version} (${reading.tsc})`] };
    case 'cannot-start':
      return {
        warn: true,
        lines: [
          `${TSC_ROW}: fail, ${exited(reading.tsc, reading.exitCode, reading.said)}`,
          `  ${cannotStartFix(reading.tsc, reading.interpreter)}`,
        ],
      };
    case 'broken':
      return { warn: true, lines: [`${TSC_ROW}: warn, ${exited(reading.tsc, reading.exitCode, reading.said)}`] };
    case 'unspawned':
      return { warn: true, lines: [`${TSC_ROW}: warn, ${reading.tsc} could not be spawned: ${reading.problem}`] };
  }
}

/** The text `doctor` exits 1 with for a tsc that cannot start, or null for any other reading. */
export function tscRefusal(reading: DoctorTscReading): string | null {
  if (reading.kind !== 'cannot-start') return null;
  return `rafa doctor: ${TSC_ROW}: ${exited(reading.tsc, reading.exitCode, reading.said)}. `
    + cannotStartFix(reading.tsc, reading.interpreter);
}

/**
 * Reads the row and writes it, as the module note says, answering the
 * refusal `doctor` exits 1 with, or null.
 */
export async function writeDoctorTsc(
  context: Pick<RafaContext, 'output' | 'outputMode' | 'env'>,
  root: string,
  seams?: DoctorTscSeams,
): Promise<string | null> {
  const reading = await readDoctorTsc(root, context.env, seams);
  const row = tscRow(reading);
  if (row === null) return null;
  if (row.warn) context.output.warn(row.lines.join('\n'));
  else if (context.outputMode !== 'json') for (const line of row.lines) context.output.info(line);
  return tscRefusal(reading);
}
