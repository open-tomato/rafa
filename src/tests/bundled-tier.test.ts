/**
 * The rafa tier as shipped: `checkDirectory` over `src/bundled/skills`,
 * the agent check over `src/bundled/agents`, `provenance` required on
 * every item (the field is optional to the checkers, mandatory for what
 * rafa ships), and every default `routing` row resolved against the
 * bundle by `resolveTiers` and `resolveRouting`.
 *
 * `PATH` is a scratch `bin/` holding stubs for `bun` and `git` only, as
 * in `project-skills-check.test.ts`, so a clean answer does not depend
 * on this machine's toolchain.
 */
import type { TierRow, TierSettings } from '../tiers/resolve.js';

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { checkDirectory } from '../check/run.js';
import { parseAgentFrontmatter } from '../schema/agent.js';
import { readFrontmatter } from '../schema/frontmatter.js';
import { readItemBytes, resolveTiers } from '../tiers/resolve.js';
import { DEFAULT_ROUTES, DEFAULT_ROUTING, resolveRouting } from '../tiers/routing.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKILLS_DIR = join(REPO_ROOT, 'src', 'bundled', 'skills');
const AGENTS_DIR = join(REPO_ROOT, 'src', 'bundled', 'agents');

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-bundled-tier-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A `bin/` of executable stubs for the tools a CI runner has. */
function ciPathDirs(): readonly string[] {
  const bin = join(tempBase, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const tool of ['bun', 'git']) {
    const path = join(bin, tool);
    writeFileSync(path, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(path, 0o755);
  }
  return [bin];
}

const skillNames = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const agentFiles = readdirSync(AGENTS_DIR)
  .filter((file) => file.endsWith('.md'))
  .sort();

describe('src/bundled/skills', () => {
  it('holds skills and checks clean', () => {
    const report = checkDirectory(SKILLS_DIR, 'skill', {
      projectRoot: null,
      pathDirs: ciPathDirs(),
      fix: false,
    });

    expect(skillNames.length).toBeGreaterThan(0);
    expect(report.failingFiles).toBe(0);
    expect(report.exitCode).toBe(0);
  });

  it.each(skillNames)('%s carries provenance', (name) => {
    const data = readFrontmatter(readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8'));

    expect(data).not.toBeNull();
    expect(data?.['provenance']).toBeDefined();
  });
});

describe('src/bundled/agents', () => {
  it('holds agents', () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  it.each(agentFiles)('%s passes the agent check and carries provenance', (file) => {
    const data = readFrontmatter(readFileSync(join(AGENTS_DIR, file), 'utf8'));
    expect(data).not.toBeNull();

    const result = parseAgentFrontmatter(data ?? {});

    expect(result.issues).toEqual([]);
    expect(result.agent?.name).toBe(file.replace(/\.md$/, ''));
    expect(result.agent?.provenance).not.toBeNull();
  });
});

describe('the default routing rows against the bundle', () => {
  const rows: readonly TierRow[] = agentFiles.map((file) => ({
    kind: 'agent',
    name: file.replace(/\.md$/, ''),
    source: 'rafa',
    path: join(AGENTS_DIR, file),
  }));
  const settings: TierSettings = {
    settingSources: ['project', 'local'],
    tiersRafa: 'on',
    tiersSkills: new Map(),
    tiersAgents: new Map(),
  };

  it('resolves every row to an agent the rafa tier serves', () => {
    const resolution = resolveTiers(rows, settings, readItemBytes);
    const reading = resolveRouting(DEFAULT_ROUTING, resolution, {
      configured: new Set(),
      builtIns: [],
    });

    expect(reading.doctorProblems).toEqual([]);
    expect(reading.loadErrors).toEqual([]);
    expect(reading.rows).toHaveLength(DEFAULT_ROUTES.length);
    for (const row of reading.rows) {
      expect(row.answer.state).toBe('served');
    }
  });
});
