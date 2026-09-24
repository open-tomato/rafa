/**
 * Tests for `serveSession`, the served directory made before one loop
 * session.
 *
 * Every case plants real trees under a fresh `tmpdir` directory: a
 * runtime whose `bundled/` is the rafa tier, a project with its own
 * `.claude/`, and a home. The rafa tier is found beside the planted
 * `cli.js` entry, so the running checkout's `src/bundled` is never read.
 *
 * Each rule that keeps an item out is paired with an item that differs
 * from it in one thing and is served, so no case passes because nothing
 * was ever served. The project's `.claude/` tree is listed before and
 * after each serve, byte for byte, which holds that nothing is written
 * there.
 */
import type { SessionServing } from './serving.js';
import type { TierPin, TierSwitch } from '../config-sections.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { serveSession } from './serving.js';

const RUN = 'run-1';

let scratch: string;
let root: string;
let runtime: string;
let home: string;

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A skill file; `body` makes two holders of one name differ. */
function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Run the gates in order\n---\n\n# ${name}\n\n${body}\n`;
}

/** An agent file the `--agents` flag accepts, with `extra` frontmatter lines. */
function agent(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: Does the ${name} work\ntools: Read, Grep\n${extra}---\n\nYou do the ${name} work.\n`;
}

/** Every file under `dir` with its bytes, by path relative to `dir`; empty when `dir` is absent. */
function snapshot(dir: string): Readonly<Record<string, string>> {
  if (!existsSync(dir)) return {};
  const files: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(dir);
  return files;
}

/** The serving `start()` would build, under the planted trees. */
function serving(overrides: { tiersRafa?: TierSwitch; tiersSkills?: ReadonlyMap<string, TierPin> } = {}): SessionServing {
  return {
    root,
    run: RUN,
    home,
    entry: join(runtime, 'cli.js'),
    settings: {
      settingSources: ['project', 'local'],
      tiersRafa: overrides.tiersRafa ?? 'on',
      tiersSkills: overrides.tiersSkills ?? new Map<string, TierPin>(),
      tiersAgents: new Map<string, TierPin>(),
    },
  };
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'rafa-start-serving-'));
  root = join(scratch, 'project');
  runtime = join(scratch, 'runtime');
  home = join(scratch, 'home');
  write(join(runtime, 'cli.js'), '');
  // Served: held by the rafa tier alone.
  write(join(runtime, 'bundled/skills/rafa-only/SKILL.md'), skill('rafa-only', 'r'));
  write(join(runtime, 'bundled/agents/rafa-agent.md'), agent('rafa-agent'));
  // Not served: the project holds a byte-identical copy, and wins by order.
  write(join(runtime, 'bundled/skills/same/SKILL.md'), skill('same', 's'));
  write(join(root, '.claude/skills/same/SKILL.md'), skill('same', 's'));
  // Not served: a collision, which nothing serves.
  write(join(runtime, 'bundled/skills/differs/SKILL.md'), skill('differs', 'rafa'));
  write(join(root, '.claude/skills/differs/SKILL.md'), skill('differs', 'project'));
  // Not served: a user-tier skill, which Claude Code loads by itself when it loads at all.
  write(join(home, '.claude/skills/user-only/SKILL.md'), skill('user-only', 'u'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('serveSession', () => {
  it('serves the rafa-tier winners alone, and hands the session their flags', () => {
    const served = serveSession(serving());

    expect(served.dir).toBe(join(root, '.rafa/runs', RUN, 'served'));
    expect(served.skills.map((copy) => copy.name)).toEqual(['rafa-only']);
    expect(served.agents.map((copy) => copy.name)).toEqual(['rafa-agent']);
    expect(served.skipped).toEqual([]);
    expect(readFileSync(join(served.dir, '.claude/skills/rafa-only/SKILL.md'), 'utf8')).toBe(skill('rafa-only', 'r'));

    expect(served.flags.slice(0, 3)).toEqual(['--add-dir', served.dir, '--agents']);
    const agents = JSON.parse(served.flags[3] ?? '{}') as Record<string, { tools: unknown }>;
    expect(Object.keys(agents)).toEqual(['rafa-agent']);
    expect(agents['rafa-agent']?.tools).toEqual(['Read', 'Grep']);
  });

  it('serves a collision once a pin settles it on the rafa tier', () => {
    // The control for the collision left out above: the one thing
    // changed is the pin, and the rafa holder is then served.
    const served = serveSession(serving({ tiersSkills: new Map<string, TierPin>([['differs', 'rafa']]) }));

    expect(served.skills.map((copy) => copy.name)).toEqual(['differs', 'rafa-only']);
    expect(readFileSync(join(served.dir, '.claude/skills/differs/SKILL.md'), 'utf8')).toBe(skill('differs', 'rafa'));
  });

  it('serves nothing and answers no flag with the rafa tier off', () => {
    const served = serveSession(serving({ tiersRafa: 'off' }));

    expect(served.skills).toEqual([]);
    expect(served.agents).toEqual([]);
    expect(served.flags).toEqual([]);
    expect(existsSync(join(served.dir, '.claude'))).toBe(false);
  });

  it('leaves out an unreviewed third-party agent, with the sentence a door prints', () => {
    write(
      join(runtime, 'bundled/agents/borrowed.md'),
      agent('borrowed', 'provenance:\n  origin: https://example.com/x\n  license: MIT\n'),
    );

    const served = serveSession(serving());

    expect(served.agents.map((copy) => copy.name)).toEqual(['rafa-agent']);
    expect(served.skipped.map((item) => [item.name, item.reason])).toEqual([['borrowed', 'unreviewed']]);
    expect(served.skipped[0]?.message).toContain('rafa-tier agent borrowed is not served');
    expect(served.flags[3]).not.toContain('borrowed');
  });

  it('reads the tiers again on each call, so a second session is served what they hold then', () => {
    serveSession(serving());
    rmSync(join(runtime, 'bundled/skills/rafa-only'), { recursive: true });

    const served = serveSession(serving());

    expect(served.skills).toEqual([]);
    expect(existsSync(join(served.dir, '.claude/skills/rafa-only'))).toBe(false);
    expect(served.flags[0]).toBe('--agents');
  });

  it('writes nothing under the project\'s .claude/', () => {
    const before = snapshot(join(root, '.claude'));
    expect(Object.keys(before)).toHaveLength(2);

    const served = serveSession(serving({ tiersSkills: new Map<string, TierPin>([['differs', 'rafa']]) }));

    expect(served.skills).toHaveLength(2);
    expect(snapshot(join(root, '.claude'))).toEqual(before);
    // The control: the served tree does hold a `.claude/skills/`, so the
    // snapshot above would have shown one written under the wrong root.
    expect(Object.keys(snapshot(join(served.dir, '.claude'))).sort()).toEqual([
      join('skills', 'differs', 'SKILL.md'),
      join('skills', 'rafa-only', 'SKILL.md'),
    ]);
  });
});
