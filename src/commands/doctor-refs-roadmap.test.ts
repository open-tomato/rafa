/**
 * One planted `specs.dir` read two ways: the doctor row's counts and the
 * roadmap's `refs` column, over a clean copy (#1), a suspect copy (#2) and
 * a Roadmap line with no saved copy (#3). Both readings come from the same
 * `readDoctorRefs`, so the cases hold that the two surfaces agree.
 *
 * The control is the clean copy: it must print `0`, not `-`, so a copy that
 * reads clean is told apart from a line with no copy.
 */
import type { DoctorRefsSeams } from './doctor-refs.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RoadmapRow } from '../board/roadmap-rows.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { createGitRunner } from '../pr/git.js';
import { issueFingerprint, writeRefsBlock } from '../refs/stamp.js';
import { createRefVerifier } from '../refs/verify.js';

import { readDoctorRefs, renderDoctorRefs, roadmapRefsCells } from './doctor-refs.js';
import { roadmapCells } from './issue/roadmap-table.js';

import { CORE_REGISTRY } from './index.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-roadmap-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const SPECS = join('.rafa', 'specs');
const REFS_COLUMN = 6;

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const OLD = { title: 'Seven', body: '## Design\n\nOld.\n', state: 'open' as const };
const NEW = { title: 'Seven', body: '## Design\n\nNew.\n', state: 'OPEN' };

function plantProject(): string {
  const root = join(base, 'project');
  mkdirSync(root, { recursive: true });
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'rafa@example.test']);
  git(root, ['config', 'user.name', 'rafa test']);
  plant(root, 'src/a.ts', 'export const alphaValue = 1;\n');
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '--message', 'planted']);
  plant(root, join(SPECS, 'rafa-1-clean-copy.md'), 'Reads `src/a.ts`.\n');
  const stamp = issueFingerprint(OLD);
  plant(
    root,
    join(SPECS, 'rafa-2-suspect-copy.md'),
    writeRefsBlock('Builds on #7 and adds `src/missing.ts`.\n', [{ kind: 'issue', text: '#7', fingerprint: stamp }]),
  );
  return root;
}

const gh: GhRunner = async () => ({ ok: true, stdout: JSON.stringify(NEW), stderr: '' });

function rowFor(issue: number, refs: RoadmapRow['refs']): RoadmapRow {
  return {
    line: { issue, ticked: false, why: 'why', lineNumber: issue },
    issue: null,
    spec: null,
    blocked: null,
    blockers: [],
    has: [],
    refs,
  };
}

describe('doctor row and roadmap refs column over planted saved copies', () => {
  it('counts one clean and one suspect copy, and leaves the uncopied line at -', async () => {
    const root = plantProject();
    const seams: DoctorRefsSeams = {
      refsVerifier: (dir, issues) => createRefVerifier({
        issues,
        git: createGitRunner(dir),
        outline: null,
        roster: describeRegistry(CORE_REGISTRY, '0.0.0-test'),
      }),
    };

    const reading = await readDoctorRefs({ root, specsDir: SPECS, gh, issues: undefined }, seams);
    if (!reading.ok) throw new Error(reading.detail);

    expect([reading.suspect, reading.dangling, reading.unknown]).toEqual([1, 1, 0]);
    const doctor = renderDoctorRefs(reading);
    expect(doctor[0]).toContain('1 suspect, 1 dangling across 2 saved copies');
    expect(doctor.filter((line) => line.includes('rafa issue check 2'))).toHaveLength(1);
    expect(doctor.some((line) => line.includes('rafa issue check 1'))).toBe(false);

    const cells = roadmapRefsCells(reading);
    const refs = [1, 2, 3].map((issue) => roadmapCells(rowFor(issue, cells.get(issue) ?? null))[REFS_COLUMN]);
    expect(refs).toEqual(['0', '2', '-']);
  });
});
