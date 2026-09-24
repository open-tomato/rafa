/**
 * The live comparison: what `buildInventory` says a loop session sees,
 * held against the init message of a real `claude` session.
 *
 * A project is planted under a temporary directory holding a skill and an
 * agent of their own, and `claude` is spawned in it with
 * `--output-format stream-json --setting-sources project`. The first
 * `system` `init` line names the agents and skills the session resolved;
 * it is written before any model call, so the child is killed once that
 * line is read and nothing is spent. Every name the inventory marks
 * `visibleToLoop` under `['project']` must be in that message. The message
 * also lists Claude Code's own built-ins, so it is a superset, never
 * equal.
 *
 * Skipped, with the reason in the suite's name, when `claude` is not on
 * the PATH: the plan's visibility rules are then unmeasured, not passing.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { buildInventory } from '../inventory/index.js';

/** How long the session may take to write its init message. */
const INIT_TIMEOUT_MS = 60_000;

/** The reason this file skips, when it does. */
const SKIP_REASON = 'claude is not on the PATH';

const claudeBinary = Bun.which('claude');

/** What the init message names. */
interface InitNames {
  readonly agents: readonly string[];
  readonly skills: readonly string[];
}

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Names of a field of the init message, keeping only strings. */
function namesOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Spawns `claude` in `cwd` and answers the names of its init message, killing it afterwards. */
async function readInit(binary: string, cwd: string, home: string): Promise<InitNames> {
  const child = Bun.spawn([
    binary, '-p', 'hello',
    '--output-format', 'stream-json', '--verbose',
    '--setting-sources', 'project',
  ], { cwd, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', env: { ...process.env, HOME: process.env.HOME ?? home } });
  const timer = setTimeout(() => child.kill(), INIT_TIMEOUT_MS);

  try {
    const decoder = new TextDecoder();
    let pending = '';
    for await (const chunk of child.stdout) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (message.type === 'system' && message.subtype === 'init') {
          return { agents: namesOf(message.agents), skills: namesOf(message.skills) };
        }
      }
    }
    throw new Error('claude ended without writing an init message');
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}

describe.skipIf(claudeBinary === null)(`inventory against a live claude session (skipped when: ${SKIP_REASON})`, () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-live-')));
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const projectRoot = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  write(
    join(projectRoot, '.claude/skills/live-probe-skill/SKILL.md'),
    '---\nname: live-probe-skill\ndescription: Probe skill planted for the live comparison\n---\n\n# Probe\n\nNothing.\n',
  );
  write(
    join(projectRoot, '.claude/agents/live-probe-agent.md'),
    '---\nname: live-probe-agent\ndescription: Probe agent planted for the live comparison\n---\n\nNothing.\n',
  );

  it('lists every project skill and agent the inventory marks visible to the loop', async () => {
    const inventory = buildInventory({
      home,
      projectRoot,
      entry: join(base, 'runtime', 'cli.js'),
      pathDirs: [],
      settingSources: ['project'],
      modules: [],
    });
    const visible = inventory.records.filter((record) => record.visibleToLoop);
    const visibleSkills = visible.filter((record) => record.kind === 'skill').map((record) => record.name);
    const visibleAgents = visible.filter((record) => record.kind === 'agent').map((record) => record.name);

    // Control: the planted items are what the inventory says is visible.
    expect(visibleSkills).toContain('live-probe-skill');
    expect(visibleAgents).toContain('live-probe-agent');

    const init = await readInit(claudeBinary as string, projectRoot, home);

    for (const name of visibleSkills) expect(init.skills).toContain(name);
    for (const name of visibleAgents) expect(init.agents).toContain(name);
  }, INIT_TIMEOUT_MS + 5_000);
});
