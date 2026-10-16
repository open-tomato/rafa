/**
 * The CODEOWNERS generator: the rendering over planted projects, the
 * collection over a planted tree under a temp directory, the command's
 * write and `--check` with a control for each refusal, and a live case
 * holding this repository's `.github/CODEOWNERS` equal to the rendering of
 * its own manifests, so a stale file fails `bun test`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';

import { SWEEP_TIMEOUT } from '../src/tests/sweep-timeout.js';

import { CODEOWNERS_FILE, collectOwnedProjects, main, renderCodeowners } from './codeowners';

setDefaultTimeout(SWEEP_TIMEOUT);

/** The team every manifest of this repository names. */
const TEAM = '@open-tomato/maintainers';

/** The scratch roots planted by the running test, removed after it. */
const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Plants `files` (path to JSON value or text) under a fresh temp root. */
function plant(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'codeowners-'));
  scratchRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string'
      ? content
      : JSON.stringify(content));
  }
  return root;
}

/** A manifest owned by `team`. */
function owned(name: string, team: string): Record<string, unknown> {
  return { name, openTomato: { team } };
}

/** The rule lines of a rendering, header and blank lines dropped. */
function rulesOf(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('/'));
}

describe('renderCodeowners', () => {
  test('emits one rule per project', () => {
    const out = renderCodeowners([
      { relDir: 'packages/hub', team: '@open-tomato/hub' },
      { relDir: 'packages/core', team: '@open-tomato/core' },
    ]);
    expect(rulesOf(out)).toEqual([
      '/packages/core/ @open-tomato/core',
      '/packages/hub/ @open-tomato/hub',
    ]);
  });

  test('writes the root rule as `/ <team>`, first, so every deeper rule wins over it', () => {
    const out = renderCodeowners([
      { relDir: 'packages/core', team: '@open-tomato/core' },
      { relDir: '', team: TEAM },
    ]);
    expect(rulesOf(out)).toEqual([`/ ${TEAM}`, '/packages/core/ @open-tomato/core']);
  });

  test('sorts by depth before path, so the specific rule wins in last-match-wins order', () => {
    const out = renderCodeowners([
      { relDir: 'a/b/c', team: '@open-tomato/deep' },
      { relDir: 'z/y', team: '@open-tomato/shallow' },
    ]);
    expect(rulesOf(out)).toEqual(['/z/y/ @open-tomato/shallow', '/a/b/c/ @open-tomato/deep']);
  });

  test('marks the file as generated and names the script that writes it', () => {
    const out = renderCodeowners([]);
    expect(out).toContain('GENERATED');
    expect(out).toContain('`bun run codeowners`');
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('collectOwnedProjects', () => {
  test('reads the root manifest and each member under packages/*', () => {
    const root = plant({
      'package.json': owned('root', TEAM),
      'packages/core/package.json': owned('core', '@open-tomato/core'),
      'packages/hub/package.json': owned('hub', TEAM),
    });
    const projects = [...collectOwnedProjects(root)].sort((a, b) => a.relDir.localeCompare(b.relDir));
    expect(projects).toEqual([
      { relDir: '', team: TEAM },
      { relDir: 'packages/core', team: '@open-tomato/core' },
      { relDir: 'packages/hub', team: TEAM },
    ]);
  });

  test('leaves out a manifest with no team and one outside the patterns', () => {
    const root = plant({
      'package.json': { name: 'root' },
      'packages/core/package.json': owned('core', TEAM),
      'packages/core/nested/package.json': owned('nested', '@open-tomato/nested'),
      'apps/web/package.json': owned('web', '@open-tomato/web'),
    });
    expect(collectOwnedProjects(root)).toEqual([{ relDir: 'packages/core', team: TEAM }]);
  });

  test('refuses a team that is not a non-empty string', () => {
    const root = plant({ 'package.json': { name: 'root', openTomato: { team: 7 } } });
    expect(() => collectOwnedProjects(root)).toThrow('openTomato.team must be a non-empty string');
  });
});

describe('main', () => {
  /** A planted tree with a root and one member, both owned. */
  function ownedTree(): string {
    return plant({
      'package.json': owned('root', TEAM),
      'packages/core/package.json': owned('core', TEAM),
    });
  }

  test('writes the file, creating .github, then --check passes on it', () => {
    const root = ownedTree();
    const lines: string[] = [];
    expect(main(['--root', root], (line) => lines.push(line))).toBe(0);
    expect(readFileSync(join(root, CODEOWNERS_FILE), 'utf8'))
      .toBe(renderCodeowners(collectOwnedProjects(root)));
    expect(main(['--check', '--root', root], (line) => lines.push(line))).toBe(0);
    expect(lines.at(-1)).toBe(`${CODEOWNERS_FILE} is up to date.`);
  });

  test('--check exits 1 when the file is missing', () => {
    const root = ownedTree();
    const lines: string[] = [];
    expect(main(['--check', '--root', root], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toContain('does not exist');
  });

  test('--check exits 1 when a manifest changed after the file was written', () => {
    const root = ownedTree();
    main(['--root', root], () => {});
    writeFileSync(join(root, 'packages/core/package.json'), JSON.stringify(owned('core', '@open-tomato/core')));
    const lines: string[] = [];
    expect(main(['--check', '--root', root], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toContain('is stale');
  });
});

describe('this repository', () => {
  const repoRoot = join(import.meta.dir, '..');

  test('every manifest the patterns name declares the maintainers team', () => {
    const projects = collectOwnedProjects(repoRoot);
    const manifests = ['package.json', ...new Bun.Glob('packages/*/package.json').scanSync({ cwd: repoRoot })];
    expect(projects.length).toBe(manifests.length);
    expect(projects.every((project) => project.team === TEAM)).toBe(true);
  });

  test(`${CODEOWNERS_FILE} equals the rendering of the manifests`, () => {
    const committed = readFileSync(join(repoRoot, CODEOWNERS_FILE), 'utf8');
    expect(committed).toBe(renderCodeowners(collectOwnedProjects(repoRoot)));
  });
});
