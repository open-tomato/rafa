/**
 * Tests for the config rows of `rafa doctor` (`./doctor-config.ts`).
 *
 * The rows are read off a real `loadConfig` over scratch scopes: a
 * project holding `rafa.config.ts` beside `.rafa/config.yaml`, the
 * module file setting an unknown key, `pr.base` and
 * `dangerous.selfUpdateDuringLoop`, the YAML file `pr.base` over it.
 * Both files are read, so neither is a row: the YAML file is the local
 * layer over the module file, not a file it shadows. Each reading has
 * its control: a clean config writes nothing, a dangerous key spelled at
 * its default writes no note, and json mode writes no note and passes
 * each line on as a warning. That a YAML
 * project reads `doctor` as before is `src/tests/config-parity.test.ts`'s.
 * The registry is the one `src/config-registry.ts` registers on import.
 */
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';

import { CONFIG_DEFAULTS } from '../config-registry.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { CONFIG_ROWS_TITLE, doctorConfigRows, loadDoctorConfig, renderDoctorConfigNotes } from './doctor-config.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-doctor-config-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A fresh, empty directory under this file's temporary root. */
function freshDir(name: string): string {
  planted += 1;
  const dir = join(tempRoot, `${String(planted)}-${name}`);
  mkdirSync(dir);
  return dir;
}

/** Writes `text` at `path`, creating its directory, and answers `path`. */
function write(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** The project's files, each written when given. */
interface ProjectFiles {
  readonly ts?: string;
  readonly yaml?: string;
}

/** A project root and an empty home of its own, holding `files`. */
function project(files: ProjectFiles): { root: string; home: string; ts: string; yaml: string } {
  const root = freshDir('project');
  const ts = join(root, 'rafa.config.ts');
  const yaml = join(root, '.rafa', 'config.yaml');
  if (files.ts !== undefined) write(ts, files.ts);
  if (files.yaml !== undefined) write(yaml, files.yaml);
  return { root, home: freshDir('home'), ts, yaml };
}

/** What one run of {@link loadDoctorConfig} wrote, level by level. */
interface Written {
  readonly resolved: ResolvedConfig;
  readonly info: readonly string[];
  readonly warn: readonly string[];
}

/** Runs {@link loadDoctorConfig} over `roots` in `outputMode`, collecting what it wrote. */
async function run(roots: { root: string; home: string }, outputMode: 'text' | 'json' = 'text'): Promise<Written> {
  const info: string[] = [];
  const warn: string[] = [];
  const output = sinkOutput({ info: (line) => info.push(line), warn: (line) => warn.push(line) });
  const resolved = await loadDoctorConfig({ output, outputMode }, async (sink) => loadConfig(roots, {}, sink));
  return { resolved, info, warn };
}

/** The load's sentence about the unknown key `nonesuch` in `file`, held to its opening. */
function unknownKeyWarning(resolved: ResolvedConfig, file: string): string {
  const opening = `rafa config: unknown key "nonesuch" in ${file} has no effect`;
  const found = resolved.warnings.find((warning) => warning.startsWith(opening));
  if (found === undefined) throw new Error(`no warning opens with ${opening}`);
  return found;
}

/** A module file exporting one entry. */
const MODULE = 'export default { nonesuch: 1, pr: { base: \'ts-base\' }, dangerous: { selfUpdateDuringLoop: true } };\n';

/** A YAML file setting the one key {@link MODULE} sets that it also sets. */
const YAML = 'pr:\n  base: yaml-base\n';

describe('loadDoctorConfig in text mode', () => {
  it('writes the unknown key as a warn row and the dangerous pass as a note, and no row for the YAML file over the module file', async () => {
    const scratch = project({ ts: MODULE, yaml: YAML });

    const { resolved, info, warn } = await run(scratch);

    expect([resolved.config.prBase, resolved.sources.prBase, resolved.provenance.prBase])
      .toEqual(['yaml-base', 'local', { file: scratch.yaml, entry: 0 }]);
    expect([resolved.config.dangerousSelfUpdateDuringLoop, resolved.sources.dangerousSelfUpdateDuringLoop])
      .toEqual([true, 'file']);
    expect(warn).toEqual([unknownKeyWarning(resolved, scratch.ts)]);
    expect(info).toEqual([
      CONFIG_ROWS_TITLE,
      `  note  dangerous.selfUpdateDuringLoop: true (${scratch.ts}, entry 0)`,
    ]);
  });

  it('writes nothing for a clean config', async () => {
    const { info, warn } = await run(project({ ts: 'export default { pr: { base: \'trunk\' } };\n' }));

    expect([info, warn]).toEqual([[], []]);
  });

  it('writes no note for a dangerous key a YAML file spells at its default', async () => {
    const atDefault = CONFIG_DEFAULTS.dangerousSelfUpdateDuringLoop;
    const { resolved, info, warn } = await run(project({ yaml: `dangerous:\n  selfUpdateDuringLoop: ${String(atDefault)}\n` }));

    expect(resolved.sources.dangerousSelfUpdateDuringLoop).toBe('local');
    expect([info, warn]).toEqual([[], []]);
  });

  it('passes a refusal through with no row written', async () => {
    const scratch = project({ yaml: 'store: nonesuch\n' });
    const lines: string[] = [];
    const output = sinkOutput({ info: (line) => lines.push(line), warn: (line) => lines.push(line) });

    const loading = loadDoctorConfig({ output, outputMode: 'text' }, async (sink) => loadConfig(scratch, {}, sink));

    await expect(loading).rejects.toBeInstanceOf(ConfigError);
    expect(lines).toEqual([]);
  });
});

describe('loadDoctorConfig in json mode', () => {
  it('writes no note and passes each line the load wrote on as a warning', async () => {
    const scratch = project({ ts: MODULE, yaml: YAML });

    const { resolved, info, warn } = await run(scratch, 'json');

    expect(info).toEqual([]);
    expect(warn).toEqual([
      unknownKeyWarning(resolved, scratch.ts),
      `dangerous.selfUpdateDuringLoop: true (${scratch.ts}, entry 0)`,
    ]);
  });
});

describe('doctorConfigRows', () => {
  it('keeps the warnings in their order and words, and makes each pass line a note named by its key', () => {
    const warnings = [
      'rafa config: unknown key "nonesuch" in /h/.rafa/config.yaml has no effect in this version',
      'rafa config: /p/rafa.config.ts: key "a" set twice',
    ];
    const written = [...warnings, 'dangerous.acceptStaleRefs: true (/p/rafa.config.ts, entry 1)'];

    expect(doctorConfigRows(written)).toEqual({
      warnings,
      passes: [{ status: 'note', name: 'dangerous.acceptStaleRefs', detail: 'true (/p/rafa.config.ts, entry 1)' }],
    });
  });

  it('writes no note line for no pass', () => {
    expect(renderDoctorConfigNotes(doctorConfigRows(['rafa config: x']).passes)).toEqual([]);
  });
});
