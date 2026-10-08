import type { OperatorsSeams } from './operators.js';

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  bundledOperatorsDirectory,
  copyOperators,
  defaultOperatorsSeams,
  findOperators,
  linkedOperatorLines,
  linkedOperators,
  missingOperatorsLine,
  nodeOperatorsFs,
  operatorsCopyPath,
  packageManifestPath,
} from './operators.js';

let scratch: string;
let pkg: string;
let entry: string;
let root: string;
let home: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-operators-')));
  pkg = join(scratch, 'pkg');
  entry = join(pkg, 'dist', 'cli.js');
  root = join(scratch, 'project');
  home = join(scratch, 'home');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(entry, '');
  mkdirSync(root);
  mkdirSync(home);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function operatorsDir(): string {
  return join(pkg, 'dist', 'bundled', 'operators');
}

/** A package whose operators carry a plugin manifest, one agent and one skill. */
function installOperators(version: string | null = '1.4.2'): void {
  const dir = operatorsDir();
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, 'agents'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'rafa-stretch-sweep'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{"name":"rafa-operators"}\n');
  writeFileSync(join(dir, 'agents', 'rafa-stretch-engineer.md'), 'engineer v1\n');
  writeFileSync(join(dir, 'skills', 'rafa-stretch-sweep', 'SKILL.md'), 'sweep v1\n');
  if (version !== null) {
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@open-tomato/rafa', version }));
  }
}

function seams(overrides: Partial<OperatorsSeams> = {}): OperatorsSeams {
  return {
    fs: nodeOperatorsFs,
    entry,
    buildVersion: '9.9.9-build',
    home: () => home,
    ...overrides,
  };
}

describe('where the operators are', () => {
  test('bundled/operators sits beside the entry, and package.json one folder above it', () => {
    expect(bundledOperatorsDirectory(entry)).toBe(operatorsDir());
    expect(packageManifestPath(entry)).toBe(join(pkg, 'package.json'));
  });

  test('a linked entry resolves to the package it points into', () => {
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    symlinkSync(entry, join(bin, 'rafa'));

    expect(bundledOperatorsDirectory(join(bin, 'rafa'))).toBe(operatorsDir());
  });

  test('this checkout, run from src/, carries its operators with a plugin manifest', () => {
    const checkoutEntry = join(import.meta.dir, '..', 'rafa.ts');
    const reading = findOperators(seams({ entry: checkoutEntry }));

    expect(reading.kind).toBe('found');
    expect(reading.dir).toBe(join(realpathSync(join(import.meta.dir, '..')), 'bundled', 'operators'));
  });

  test('the default seams name the running entry and the build version', () => {
    const defaults = defaultOperatorsSeams();

    expect(defaults.entry).toBe(Bun.main);
    expect(defaults.buildVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('findOperators', () => {
  test('reads the version from the package manifest', () => {
    installOperators('1.4.2');

    expect(findOperators(seams())).toEqual({
      kind: 'found',
      dir: operatorsDir(),
      version: '1.4.2',
      versionSource: 'manifest',
    });
  });

  test('falls back to the build version when the package has no manifest', () => {
    installOperators(null);

    expect(findOperators(seams())).toMatchObject({ kind: 'found', version: '9.9.9-build', versionSource: 'build' });
  });

  test('falls back to the build version when the manifest names no version', () => {
    installOperators(null);
    writeFileSync(join(pkg, 'package.json'), '{"name":"@open-tomato/rafa"}');

    expect(findOperators(seams())).toMatchObject({ version: '9.9.9-build', versionSource: 'build' });
  });

  test('reads a folder with no plugin manifest as missing', () => {
    installOperators();
    rmSync(join(operatorsDir(), '.claude-plugin'), { recursive: true });

    const reading = findOperators(seams());

    expect(reading.kind).toBe('missing');
    expect(reading).toMatchObject({ manifest: join(operatorsDir(), '.claude-plugin', 'plugin.json') });
  });

  test('reads a package with no operators folder at all as missing', () => {
    expect(findOperators(seams()).kind).toBe('missing');
  });
});

describe('copyOperators', () => {
  test('copies the whole folder into .rafa/stretch/<n>/operators the first time', () => {
    installOperators('1.4.2');

    const result = copyOperators(root, 3, seams());

    const copy = join(root, '.rafa', 'stretch', '3', 'operators');
    expect(result).toEqual({ kind: 'copied', copy, from: operatorsDir(), version: '1.4.2', versionSource: 'manifest' });
    expect(operatorsCopyPath(root, 3)).toBe(copy);
    expect(readFileSync(join(copy, '.claude-plugin', 'plugin.json'), 'utf8')).toBe('{"name":"rafa-operators"}\n');
    expect(readFileSync(join(copy, 'agents', 'rafa-stretch-engineer.md'), 'utf8')).toBe('engineer v1\n');
    expect(readFileSync(join(copy, 'skills', 'rafa-stretch-sweep', 'SKILL.md'), 'utf8')).toBe('sweep v1\n');
    expect(existsSync(`${copy}.partial-${String(process.pid)}`)).toBe(false);
  });

  test('keeps the copy on every later call, even after the package changed', () => {
    installOperators('1.4.2');
    copyOperators(root, 3, seams());
    writeFileSync(join(operatorsDir(), 'agents', 'rafa-stretch-engineer.md'), 'engineer v2\n');

    const result = copyOperators(root, 3, seams());

    const copy = operatorsCopyPath(root, 3);
    expect(result).toEqual({ kind: 'kept', copy });
    expect(readFileSync(join(copy, 'agents', 'rafa-stretch-engineer.md'), 'utf8')).toBe('engineer v1\n');
  });

  test('copies again for another stretch, which takes the new files', () => {
    installOperators('1.4.2');
    copyOperators(root, 3, seams());
    writeFileSync(join(operatorsDir(), 'agents', 'rafa-stretch-engineer.md'), 'engineer v2\n');

    expect(copyOperators(root, 4, seams()).kind).toBe('copied');
    expect(readFileSync(join(operatorsCopyPath(root, 4), 'agents', 'rafa-stretch-engineer.md'), 'utf8')).toBe('engineer v2\n');
  });

  test('refuses with no plugin manifest and copies nothing', () => {
    installOperators();
    rmSync(join(operatorsDir(), '.claude-plugin'), { recursive: true });

    const result = copyOperators(root, 1, seams());

    expect(result.kind).toBe('missing');
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  test('refuses with no plugin manifest even when the stretch already has a copy', () => {
    installOperators();
    copyOperators(root, 1, seams());
    rmSync(join(operatorsDir(), '.claude-plugin'), { recursive: true });

    expect(copyOperators(root, 1, seams()).kind).toBe('missing');
  });

  test('a copy that fails half way leaves nothing at the copy path', () => {
    installOperators();
    const unreadable = join(operatorsDir(), 'skills', 'rafa-stretch-sweep', 'zz-unreadable.md');
    writeFileSync(unreadable, 'locked');
    chmodSync(unreadable, 0o000);
    // The control: a bare cpSync over this tree throws after it made the target,
    // so the cleanup below has a half copy to remove.
    const bare = join(scratch, 'bare-copy');
    expect(() => cpSync(operatorsDir(), bare, { recursive: true })).toThrow();
    expect(existsSync(bare)).toBe(true);

    expect(() => copyOperators(root, 2, seams())).toThrow();
    chmodSync(unreadable, 0o644);

    expect(existsSync(operatorsCopyPath(root, 2))).toBe(false);
    expect(existsSync(`${operatorsCopyPath(root, 2)}.partial-${String(process.pid)}`)).toBe(false);
    expect(copyOperators(root, 2, seams()).kind).toBe('copied');
  });

  test('throws on a number that is no stretch number', () => {
    installOperators();

    expect(() => copyOperators(root, 0, seams())).toThrow('is not a stretch number');
  });
});

describe('linkedOperators', () => {
  function link(relative: string): string {
    const path = join(home, '.claude', relative);
    mkdirSync(join(path, '..'), { recursive: true });
    symlinkSync(scratch, path);
    return path;
  }

  test('a HOME with no .claude has no links', () => {
    expect(linkedOperators(seams())).toEqual([]);
    expect(linkedOperatorLines([])).toEqual([]);
  });

  test('lists operator links in agents and skills, agents first and each sorted', () => {
    const skill = link('skills/rafa-stretch-sweep');
    const watch = link('agents/rafa-stretch-watchtower.md');
    const engineer = link('agents/rafa-stretch-engineer.md');

    expect(linkedOperators(seams())).toEqual([engineer, watch, skill]);
  });

  test('skips plain files, other names and agent links that are no .md', () => {
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(home, '.claude', 'skills', 'rafa-stretch-gap-log'), { recursive: true });
    writeFileSync(join(home, '.claude', 'agents', 'rafa-stretch-analyst.md'), 'a copy, not a link');
    link('agents/code-reviewer.md');
    link('agents/rafa-stretch-notes.txt');
    link('skills/documentation');

    expect(linkedOperators(seams())).toEqual([]);
  });

  test('reads HOME through the seam, never the real one', () => {
    const elsewhere = join(scratch, 'other-home');
    mkdirSync(elsewhere);
    const path = link('agents/rafa-stretch-engineer.md');

    expect(linkedOperators(seams())).toEqual([path]);
    expect(linkedOperators(seams({ home: () => elsewhere }))).toEqual([]);
  });

  test('words the warning with every path on one line', () => {
    expect(linkedOperatorLines(['/h/.claude/agents/rafa-stretch-engineer.md', '/h/.claude/skills/rafa-stretch-sweep'])).toEqual([
      'stretch: linked operators found: /h/.claude/agents/rafa-stretch-engineer.md /h/.claude/skills/rafa-stretch-sweep',
      '  this stretch uses its own copy; remove the links once no stretch started with them runs',
    ]);
  });
});

describe('missingOperatorsLine', () => {
  test('names the missing manifest and what to do', () => {
    const reading = findOperators(seams());
    if (reading.kind !== 'missing') throw new Error('expected a missing reading');

    expect(missingOperatorsLine(reading)).toBe(`stretch: ${join(operatorsDir(), '.claude-plugin', 'plugin.json')} is missing: this rafa install carries no stretch operators; reinstall rafa or update it with rafa self-update`);
  });
});
