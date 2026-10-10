/**
 * Cross-module test for #172's classes: a fixture spec is extracted by
 * `refs/extract.ts` and each reference read by the verifier
 * `createPlanRefsVerifier` builds over a planted repository and a fake
 * checkout roster. None of the correct names reads `absent`; the
 * controls (a word in a comment, a `gh` flag, a `claude` flag) never
 * reach the verifier as references at all.
 */
import type { DescribeDocument, DescribedAction } from '../cli/describe.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPlanRefsVerifier } from '../commands/plan/refs-check.js';
import { extractRefs } from '../refs/extract.js';
import { ABSENT, PRESENT } from '../refs/stamp.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-readings-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

const SOURCE = [
  'interface LocalShape {',
  '  memberName: number;',
  '}',
  'const TABLE = {',
  '  objectField: 1,',
  '};',
  'function localHelper(): LocalShape {',
  '  return { memberName: TABLE.objectField };',
  '}',
  '// see commentOnlyWord for the reason',
  'localHelper();',
  '',
].join('\n');

function plantRepository(): string {
  const root = join(tempBase, 'repo');
  mkdirSync(join(root, 'src'), { recursive: true });
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'rafa@example.test']);
  git(root, ['config', 'user.name', 'rafa test']);
  writeFileSync(join(root, 'src/shapes.ts'), SOURCE);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '--message', 'planted']);
  return root;
}

function action(name: string, flags: readonly string[] = []): DescribedAction {
  return {
    name,
    summary: '',
    description: '',
    args: [],
    flags: flags.map((flag) => ({ name: flag, description: '', type: 'boolean', required: false, default: null, aliases: [] })),
    examples: [],
    outputs: ['text'],
    aliases: [],
    deprecated: null,
    module: null,
    spends: null,
  };
}

/** A roster holding a command only this checkout has. */
const CHECKOUT_ROSTER: DescribeDocument = {
  schemaVersion: 2,
  binary: 'rafa',
  version: '0.0.0-test',
  subjects: [{ name: 'checkoutonly', summary: '', actions: [action('frobnicate', ['accept-refs'])] }],
  commands: [],
};

/** The roster handed in as the core's: it holds nothing, so a command or flag read against it and not the checkout's reads absent. */
const EMPTY_ROSTER: DescribeDocument = { ...CHECKOUT_ROSTER, subjects: [] };

const SPEC = [
  '# Spec',
  '',
  'The member `memberName`, the field `objectField` and the function `localHelper()` are read.',
  'Run `rafa checkoutonly frobnicate --accept-refs` to try it.',
  'Prose: gh issue create --body-file is not ours, and `gh issue create --body-file` nor',
  '`claude --setting-sources` is a rafa flag; --body-file in running text is not either.',
  '',
].join('\n');

describe('the #172 classes, extracted and verified together', () => {
  it('reads no extracted reference as absent', async () => {
    const root = plantRepository();
    const verify = createPlanRefsVerifier(root, EMPTY_ROSTER, { checkoutRoster: () => Promise.resolve({ kind: 'read', roster: CHECKOUT_ROSTER }) });

    const refs = extractRefs(SPEC);
    const readings = await Promise.all(refs.map(async (ref) => ({ ref, reading: await verify(ref) })));

    const texts = refs.map((ref) => `${ref.kind}:${ref.text}`);
    expect(texts).toContain('symbol:memberName');
    expect(texts).toContain('symbol:objectField');
    expect(texts).toContain('symbol:localHelper');
    expect(texts).toContain('command:rafa checkoutonly frobnicate');
    expect(texts).toContain('flag:--accept-refs');
    expect(texts.filter((text) => text.includes('--body-file') || text.includes('--setting-sources'))).toEqual([]);
    for (const { ref, reading } of readings) {
      expect([ref.text, reading]).toEqual([ref.text, PRESENT]);
      expect(reading).not.toEqual(ABSENT);
    }
  });
});
