/**
 * Tests for the dangerous listing (`dangerous.ts`): the keys read off
 * the active registry, the pass line of each key resolved off its
 * default, and `loadConfig` writing each line once per invocation.
 *
 * The registry is the one `src/config-registry.ts` registers on import.
 * The keys are held by name, so a listing that came back empty, or one
 * that agreed with itself, fails: core's two and the release section's
 * one. A section registered here adds a fourth, the control that the
 * listing is read off the registry rather than spelled; the registry is
 * put back after it, as the module-level state every later test file
 * reads.
 *
 * Every pass case has its control: a file spelling the default, whose
 * `sources` name the file, prints nothing.
 *
 * The phrase cases set the running command's phrases at module level or
 * in a scope (`runWithDangerousPhrases`). Each control is a phrase for
 * a key the resolution leaves at its default, or for another key, whose
 * line stays bare; the module-level phrases are put back in a `finally`
 * for every later test file.
 */
import type { ConfigSection } from '@open-tomato/rafa/core/config/section';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '@open-tomato/rafa/core/config/config-load';
import { flag } from '@open-tomato/rafa/core/config/config-sections';
import {
  dangerousKeys,
  dangerousPassLines,
  dangerousPhrases,
  restoreDangerousPhrases,
  runWithDangerousPhrases,
  setDangerousPhrases,
} from '@open-tomato/rafa/core/config/dangerous';
import { EMPTY_CONFIG_REGISTRY, registerConfigSections, restoreConfigSections } from '@open-tomato/rafa/core/config/section';
import { runWithActiveOutput } from '@open-tomato/rafa/core/output/active';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';

import { CONFIG_DEFAULTS } from '../../../../config-registry.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-dangerous-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A fresh, empty directory under this file's temporary root. */
function freshDir(name: string): string {
  planted += 1;
  const dir = join(tempRoot, `${planted}-${name}`);
  mkdirSync(dir);
  return dir;
}

/** Writes `text` at `path`, creating its directory, and answers `path`. */
function write(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A project root and an empty home of its own, with `.rafa/config.yaml` holding `text`. */
function yamlProject(text: string): { root: string; home: string; path: string } {
  const root = freshDir('project');
  return { root, home: freshDir('home'), path: write(join(root, '.rafa', 'config.yaml'), text) };
}

/** Loads the config under `roots`, collecting what it warns about. */
async function loadCollecting(roots: { root: string; home: string }): Promise<{
  resolved: Awaited<ReturnType<typeof loadConfig>>;
  lines: string[];
}> {
  const lines: string[] = [];
  const resolved = await loadConfig(roots, {}, (line) => lines.push(line));
  return { resolved, lines };
}

describe('dangerousKeys', () => {
  it('lists every registered key opening with dangerous., each once', () => {
    const keys = dangerousKeys();

    expect([...keys].sort()).toEqual([
      'dangerous.acceptStaleRefs',
      'dangerous.acceptVersionCollision',
      'dangerous.selfUpdateDuringLoop',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reads a key a section registers later, and none while no section is registered', () => {
    const extra: ConfigSection = {
      package: 'extra',
      settings: { dangerousAcceptStaleRefs: { key: 'dangerous.extraPass', read: flag, cli: false } },
      defaults: { dangerousAcceptStaleRefs: false },
    };
    const empty = registerConfigSections([]);
    restoreConfigSections(EMPTY_CONFIG_REGISTRY);
    try {
      expect(dangerousKeys()).toEqual([]);
      registerConfigSections([extra]);
      expect(dangerousKeys()).toEqual(['dangerous.extraPass']);
    } finally {
      restoreConfigSections(empty);
    }
    expect(dangerousKeys()).toHaveLength(3);
  });
});

describe('dangerousPassLines', () => {
  it('names a key a YAML file sets off its default, with the file and entry 0', async () => {
    const project = yamlProject('dangerous:\n  acceptStaleRefs: true\n');

    const { resolved } = await loadCollecting(project);

    expect(CONFIG_DEFAULTS.dangerousAcceptStaleRefs).toBe(false);
    expect(dangerousPassLines(resolved)).toEqual([
      `dangerous.acceptStaleRefs: true (${project.path}, entry 0)`,
    ]);
  });

  it('names nothing for a file spelling the default, though its sources name the local file', async () => {
    const project = yamlProject('dangerous:\n  acceptStaleRefs: false\n  selfUpdateDuringLoop: false\n');

    const { resolved } = await loadCollecting(project);

    expect(resolved.sources.dangerousAcceptStaleRefs).toBe('local');
    expect(dangerousPassLines(resolved)).toEqual([]);
  });

  it('names the entry of a module file that last set each key, in registration order', async () => {
    const root = freshDir('module');
    const path = write(join(root, 'rafa.config.ts'), [
      'export default [',
      '  { dangerous: { acceptVersionCollision: true } },',
      '  { dangerous: { selfUpdateDuringLoop: true } },',
      '];',
      '',
    ].join('\n'));

    const { resolved } = await loadCollecting({ root, home: freshDir('home') });

    expect(dangerousPassLines(resolved)).toEqual([
      `dangerous.acceptVersionCollision: true (${path}, entry 0)`,
      `dangerous.selfUpdateDuringLoop: true (${path}, entry 1)`,
    ]);
  });

  it('names the command line where no file answered the key', async () => {
    const { resolved } = await loadCollecting(yamlProject('dangerous:\n  acceptStaleRefs: true\n'));

    const lines = dangerousPassLines({
      ...resolved,
      provenance: { ...resolved.provenance, dangerousAcceptStaleRefs: null },
    });

    expect(lines).toEqual(['dangerous.acceptStaleRefs: true (command line)']);
  });
});

describe('the running command\'s phrases', () => {
  const PHRASE = 'a release guard reading collision merges anyway';

  it('ends the line of a key the module-level phrases declare with the phrase, and leaves another key bare', async () => {
    const root = freshDir('phrases');
    const path = write(join(root, '.rafa', 'config.yaml'), [
      'dangerous:',
      '  acceptVersionCollision: true',
      '  selfUpdateDuringLoop: true',
      '',
    ].join('\n'));
    const { resolved } = await loadCollecting({ root, home: freshDir('home') });

    const previous = setDangerousPhrases({
      'dangerous.acceptVersionCollision': PHRASE,
      'dangerous.acceptStaleRefs': 'never printed',
    });
    try {
      expect(dangerousPassLines(resolved)).toEqual([
        `dangerous.acceptVersionCollision: true (${path}, entry 0); ${PHRASE}`,
        `dangerous.selfUpdateDuringLoop: true (${path}, entry 0)`,
      ]);
    } finally {
      restoreDangerousPhrases(previous);
    }
    expect(dangerousPassLines(resolved)).toEqual([
      `dangerous.acceptVersionCollision: true (${path}, entry 0)`,
      `dangerous.selfUpdateDuringLoop: true (${path}, entry 0)`,
    ]);
  });

  it('reads a scope\'s phrases inside it over the module-level ones, and the module-level ones after', async () => {
    const project = yamlProject('dangerous:\n  acceptStaleRefs: true\n');
    const { resolved } = await loadCollecting(project);
    const outer = { 'dangerous.acceptStaleRefs': 'the module-level phrase' };

    const previous = setDangerousPhrases(outer);
    try {
      const inside = await runWithDangerousPhrases({ 'dangerous.acceptStaleRefs': 'the scope\'s phrase' }, async () => {
        await Promise.resolve();
        return dangerousPassLines(resolved);
      });
      const bare = runWithDangerousPhrases(undefined, () => dangerousPassLines(resolved));

      expect(inside).toEqual([`dangerous.acceptStaleRefs: true (${project.path}, entry 0); the scope's phrase`]);
      expect(bare).toEqual([`dangerous.acceptStaleRefs: true (${project.path}, entry 0)`]);
      expect(dangerousPassLines(resolved)).toEqual([
        `dangerous.acceptStaleRefs: true (${project.path}, entry 0); the module-level phrase`,
      ]);
    } finally {
      restoreDangerousPhrases(previous);
    }
  });

  it('keeps a frozen copy, so changing the phrases handed in changes nothing set', () => {
    const handed: Record<string, string> = { 'dangerous.acceptStaleRefs': 'before' };

    const previous = setDangerousPhrases(handed);
    try {
      handed['dangerous.acceptStaleRefs'] = 'after';

      expect(dangerousPhrases()).toEqual({ 'dangerous.acceptStaleRefs': 'before' });
      expect(Object.isFrozen(dangerousPhrases())).toBe(true);
    } finally {
      restoreDangerousPhrases(previous);
    }
    expect(dangerousPhrases()).toEqual({});
  });
});

describe('loadConfig and the pass lines', () => {
  it('writes the pass line ending with the phrase of the scope it loads in', async () => {
    const project = yamlProject('dangerous:\n  acceptStaleRefs: true\n');
    const lines: string[] = [];

    await runWithDangerousPhrases(
      { 'dangerous.acceptStaleRefs': 'check 4 refuses no reference' },
      () => loadConfig(project, {}, (line) => lines.push(line)),
    );

    expect(lines).toEqual([`dangerous.acceptStaleRefs: true (${project.path}, entry 0); check 4 refuses no reference`]);
  });

  it('writes the pass line through the warning sink after the load\'s warnings', async () => {
    const project = yamlProject('dangerous:\n  acceptStaleRefs: true\nnotAKey: 1\n');

    const { resolved, lines } = await loadCollecting(project);

    expect(resolved.warnings).toHaveLength(1);
    expect(lines).toEqual([
      ...resolved.warnings,
      `dangerous.acceptStaleRefs: true (${project.path}, entry 0)`,
    ]);
  });

  it('writes each line once per sink however often the config is loaded', async () => {
    const project = yamlProject('dangerous:\n  acceptStaleRefs: true\n');
    const first: string[] = [];
    const second: string[] = [];
    const sinkFirst = (line: string): void => {
      first.push(line);
    };
    const sinkSecond = (line: string): void => {
      second.push(line);
    };

    await loadConfig(project, {}, sinkFirst);
    await loadConfig(project, {}, sinkFirst);
    await loadConfig(project, {}, sinkSecond);

    const line = `dangerous.acceptStaleRefs: true (${project.path}, entry 0)`;
    expect(first).toEqual([line]);
    expect(second).toEqual([line]);
  });

  it('writes each line once per active output when no sink is given', async () => {
    const project = yamlProject('dangerous:\n  selfUpdateDuringLoop: true\n');
    const first: string[] = [];
    const second: string[] = [];
    const outputFirst = sinkOutput({ warn: (line) => first.push(line) });
    const outputSecond = sinkOutput({ warn: (line) => second.push(line) });

    await runWithActiveOutput(outputFirst, 'text', async () => {
      await loadConfig(project);
      await loadConfig(project);
    });
    await runWithActiveOutput(outputSecond, 'text', () => loadConfig(project));

    const line = `dangerous.selfUpdateDuringLoop: true (${project.path}, entry 0)`;
    expect(first).toEqual([line]);
    expect(second).toEqual([line]);
  });

  it('writes nothing for a project with no dangerous key set', async () => {
    const { lines } = await loadCollecting(yamlProject('pr:\n  base: main\n'));

    expect(lines).toEqual([]);
  });
});
