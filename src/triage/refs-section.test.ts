/**
 * Tests for a filed bug's `## Refs` section (`src/triage/refs-section.ts`).
 *
 * What is read and how it is shown are driven through a fake verifier
 * that records what it was asked, so a case can say the verifier was
 * never asked about a flag or an issue. The default verifier is driven
 * through a real git over a repository planted under the temp
 * directory, with a `PATH` that holds no `ts-symbols`, so the grep
 * alone answers for a symbol whatever the machine has installed.
 *
 * ## The controls
 *
 * A committed file's stamp is pinned against `git rev-parse` run by
 * the test itself, so a verifier answering some other object's sha
 * fails here. A path missing from the tree reads `absent` beside it,
 * which proves the verifier can answer something other than a sha. A
 * directory that is no repository reads `unread`, which proves the
 * section shows a failed reading rather than rejecting.
 */
import type { RefVerifier } from '../refs/verify.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  ARTIFACT_REF_KINDS,
  artifactRefs,
  buildRefsSection,
  createArtifactRefsVerifier,
  REFS_HEADING,
  refsSection,
  stampArtifactRefs,
  UNREAD_STAMP,
} from './refs-section.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-section-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A sha1 blob id, for fake readings. */
const SHA = 'a'.repeat(40);

/** An environment whose `PATH` holds no `ts-symbols`. */
const NO_TS_SYMBOLS: Readonly<Record<string, string>> = { PATH: '' };

/** Runs git in `cwd`, throwing on failure: the planting's own git, not the seam under test. */
function plantGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/** A repository with `src/a.ts` committed, exporting `readFoo`. */
function plantRepository(): string {
  const root = join(tempBase, 'repo');
  mkdirSync(dirname(join(root, 'src/a.ts')), { recursive: true });
  writeFileSync(join(root, 'src/a.ts'), 'export function readFoo(): number {\n  return 1;\n}\n');
  plantGit(root, ['init', '--quiet', '--initial-branch=main']);
  plantGit(root, ['config', 'user.email', 'rafa@example.test']);
  plantGit(root, ['config', 'user.name', 'rafa test']);
  plantGit(root, ['add', '--all']);
  plantGit(root, ['commit', '--quiet', '--message', 'planted']);
  return root;
}

/** A fake verifier: each path's answer from `blobs`, `present` for any other path or symbol; records what it was asked. */
function fakeVerifier(blobs: Readonly<Record<string, string>> = {}): {
  readonly verify: RefVerifier;
  readonly asked: string[];
} {
  const asked: string[] = [];
  const verify: RefVerifier = async (ref) => {
    asked.push(`${ref.kind}:${ref.text}`);
    const sha = blobs[ref.text];
    if (ref.kind === 'path' && sha === 'absent') return { kind: 'absent' };
    return ref.kind === 'path' && sha !== undefined
      ? { kind: 'blob', sha }
      : { kind: 'present' };
  };
  return { verify, asked };
}

describe('artifactRefs', () => {
  it('keeps the paths and symbols a code span names, in the order the artifact names them', () => {
    const artifact = 'TypeError in `readFoo()` at `src/a.ts:12` — see `src/b.ts` and `MAX_RETRIES`';

    const refs = artifactRefs(artifact).map((ref) => `${ref.kind}:${ref.text}`);

    expect(refs).toEqual(['symbol:readFoo', 'path:src/b.ts', 'symbol:MAX_RETRIES']);
  });

  it('drops the issues, flags, commands and keys an artifact names', () => {
    const artifact = 'after #12, `rafa plan create --issue` refused `specs.dir` with `--force`';

    expect(artifactRefs(artifact)).toEqual([]);
  });

  it('reads no path from running text, which the extractor reads only in code spans', () => {
    expect(artifactRefs('Cannot find module src/a.ts from src/b.ts')).toEqual([]);
  });

  it('lists exactly the path and symbol kinds', () => {
    expect([...ARTIFACT_REF_KINDS].sort((a, b) => a.localeCompare(b))).toEqual(['path', 'symbol']);
  });
});

describe('stampArtifactRefs', () => {
  it('stamps each reference with the fingerprint its reading answers', async () => {
    const { verify, asked } = fakeVerifier({ 'src/a.ts': SHA, 'src/gone.ts': 'absent' });

    const stamps = await stampArtifactRefs('`src/a.ts` `src/gone.ts` `readFoo` `--force`', verify);

    expect(stamps).toEqual([
      { kind: 'path', text: 'src/a.ts', stamp: `blob:${SHA}` },
      { kind: 'path', text: 'src/gone.ts', stamp: 'absent' },
      { kind: 'symbol', text: 'readFoo', stamp: 'present' },
    ]);
    expect(asked).toEqual(['path:src/a.ts', 'path:src/gone.ts', 'symbol:readFoo']);
  });

  it('stamps a reference whose reading throws as unread, and still reads the rest', async () => {
    const verify: RefVerifier = async (ref) => {
      if (ref.text === 'src/a.ts') throw new Error('git ls-files failed: /Users/someone/secret-path');
      return { kind: 'present' };
    };

    const stamps = await stampArtifactRefs('`src/a.ts` `readFoo`', verify);

    expect(stamps.map((stamp) => stamp.stamp)).toEqual([UNREAD_STAMP, 'present']);
  });

  it('stamps an unreadable reading as unread', async () => {
    const stamps = await stampArtifactRefs('`src/a.ts`', async () => ({ kind: 'unreadable' }));

    expect(stamps).toEqual([{ kind: 'path', text: 'src/a.ts', stamp: UNREAD_STAMP }]);
  });
});

describe('refsSection', () => {
  it('answers null for no references', () => {
    expect(refsSection([])).toBeNull();
  });

  it('writes the heading, the sentence, then one line per reference', () => {
    const section = refsSection([
      { kind: 'path', text: 'src/a.ts', stamp: `blob:${SHA}` },
      { kind: 'symbol', text: 'readFoo', stamp: 'present' },
    ]);

    expect(section).toBe([
      `## ${REFS_HEADING}`,
      '',
      'The paths and symbols the artifact names, each with its target\'s fingerprint when this bug was filed.',
      '',
      `- path \`src/a.ts\`: \`blob:${SHA}\``,
      '- symbol `readFoo`: `present`',
    ].join('\n'));
  });
});

describe('buildRefsSection', () => {
  it('answers null for no artifact, asking nothing', async () => {
    const { verify, asked } = fakeVerifier();

    expect(await buildRefsSection(null, verify)).toBeNull();
    expect(asked).toEqual([]);
  });

  it('answers null for an artifact naming no path and no symbol, asking nothing', async () => {
    const { verify, asked } = fakeVerifier();

    expect(await buildRefsSection('TypeError: lines.at(-1) is undefined', verify)).toBeNull();
    expect(asked).toEqual([]);
  });

  it('keeps a failed reading\'s reason off the section', async () => {
    const verify: RefVerifier = () => Promise.reject(new Error('could not run git in /Users/someone/checkout'));

    const section = await buildRefsSection('`src/a.ts`', verify);

    expect(section).toContain(`- path \`src/a.ts\`: \`${UNREAD_STAMP}\``);
    expect(section).not.toContain('/Users/someone');
  });
});

describe('createArtifactRefsVerifier', () => {
  const repo = plantRepository();

  it('stamps a committed file with the blob sha git holds for it at HEAD', async () => {
    const sha = plantGit(repo, ['rev-parse', 'HEAD:src/a.ts']).trim();

    const section = await buildRefsSection('`src/a.ts`', createArtifactRefsVerifier(repo, NO_TS_SYMBOLS));

    expect(sha).toMatch(/^[0-9a-f]{40}$/u);
    expect(section).toContain(`- path \`src/a.ts\`: \`blob:${sha}\``);
  });

  it('stamps an exported symbol present and a missing path absent', async () => {
    const section = await buildRefsSection('`readFoo()` `src/missing.ts`', createArtifactRefsVerifier(repo, NO_TS_SYMBOLS));

    expect(section).toContain('- symbol `readFoo`: `present`');
    expect(section).toContain('- path `src/missing.ts`: `absent`');
  });

  it('stamps every reference unread in a directory that is no repository', async () => {
    const notARepo = join(tempBase, 'not-a-repo');
    mkdirSync(notARepo, { recursive: true });

    const stamps = await stampArtifactRefs('`src/a.ts` `readFoo`', createArtifactRefsVerifier(notARepo, NO_TS_SYMBOLS));

    expect(stamps.map((stamp) => stamp.stamp)).toEqual([UNREAD_STAMP, UNREAD_STAMP]);
  });
});
