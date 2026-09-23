/**
 * End-to-end test of `rafa skill list -i` and `rafa agent list -i` over a
 * planted inventory.
 *
 * Without a terminal the refusal is measured spawned, as `bun src/rafa.ts`
 * in a scratch repository whose standard input is no terminal: exit code
 * 1, naming `--output=json`. The browse itself needs a terminal and a
 * spawned child has none, so the key sequence runs in-process through the
 * real command over the same kind of planted tree, with a recording
 * terminal and scripted keys (the seams `-i` declares).
 */
import type { Key, Terminal } from '../cli/prompt/terminal.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { NO_TERMINAL_TEXT } from '../cli/prompt/terminal.js';
import { createSkillListCommand } from '../commands/skill/list.js';

import { dispatchInProject, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-browse-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SPAWN_TIMEOUT = 60_000;

const CONFIG = 'version: 1\nloop:\n  settingSources: project,local\n';

function skillText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\ntags: [verification]\nstack: [typescript]\n---\n\n# ${name}\n\nRead each exit code.\n`;
}

function agentText(name: string): string {
  return `---\nname: ${name}\ndescription: A planted agent\n---\n\n# ${name}\n\nDo the work.\n`;
}

function plantFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Plants the same three skills and one agent under a project root and a home. */
function plantInventory(root: string, home: string): void {
  plantFile(join(root, '.claude/skills/alpha-skill/SKILL.md'), skillText('alpha-skill', 'First in the list'));
  plantFile(join(root, '.claude/skills/beta-skill/SKILL.md'), skillText('beta-skill', 'Second in the list'));
  plantFile(join(root, '.claude/skills/gamma-skill/SKILL.md'), skillText('gamma-skill', 'Third in the list'));
  plantFile(join(root, '.claude/agents/planted-agent.md'), agentText('planted-agent'));
  mkdirSync(home, { recursive: true });
}

const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };

function char(typed: string): Key {
  return { name: 'char', char: typed };
}

/** A terminal that records what it is written. */
function recordingTerminal(): { terminal: Terminal; written: () => string } {
  const chunks: string[] = [];
  return {
    terminal: {
      isTTY: true,
      setRawMode: () => undefined,
      write: (text) => {
        chunks.push(text);
      },
      onInterrupt: () => () => undefined,
      exit: () => undefined,
    },
    written: () => chunks.join(''),
  };
}

/** Keys handed over one at a time, then the source ends. */
function scriptedKeys(keys: readonly Key[]): () => AsyncIterable<Key> {
  return async function* source() {
    for (const key of keys) yield key;
  };
}

describe('rafa skill list -i and rafa agent list -i over a planted inventory', () => {
  it('exits 1 naming --output=json when standard input is no terminal', () => {
    const scratch = plantScratchRepo(tempBase);
    plantProjectConfig(scratch.repo, CONFIG);
    plantInventory(scratch.repo, scratch.home);

    const skills = runRafa(scratch, scratch.repo, ['skill', 'list', '-i']);
    const agents = runRafa(scratch, scratch.repo, ['agent', 'list', '-i']);

    expect(skills.exitCode).toBe(1);
    expect(skills.stdout + skills.stderr).toContain(NO_TERMINAL_TEXT);
    expect(skills.stdout + skills.stderr).toContain('rafa skill list --output=json');
    expect(skills.stdout).not.toContain('alpha-skill');
    expect(agents.exitCode).toBe(1);
    expect(agents.stdout + agents.stderr).toContain('rafa agent list --output=json');
  }, SPAWN_TIMEOUT);

  it('runs down, down, Enter, f, Escape, q and exits 0 with the list, show and full-context views drawn', async () => {
    const scope = join(tempBase, 'browse');
    const root = join(scope, 'project');
    const home = join(scope, 'home');
    const entry = join(scope, 'runtime', 'cli.js');
    plantProjectConfig(root, CONFIG);
    plantInventory(root, home);
    plantFile(entry, '// the runtime\n');
    const { terminal, written } = recordingTerminal();
    const command = createSkillListCommand({
      entry: () => entry,
      modules: {},
      terminal: () => terminal,
      keys: scriptedKeys([DOWN, DOWN, ENTER, char('f'), ESCAPE, char('q')]),
    });

    const answered = await dispatchInProject(
      ['skill', 'list', '-i'],
      [{ name: 'skill', summary: 'list every skill' }],
      [command],
      { root, home },
      { PATH: '' },
    );

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    const screen = written();
    expect(screen).toContain('Skills (project: ');
    expect(screen).toContain('alpha-skill');
    expect(screen).toContain('[show] skill gamma-skill (project)');
    expect(screen).toContain('[full context] skill gamma-skill (project)');
    expect(screen).toContain('description: Third in the list');
    expect(screen).not.toContain('[show] skill alpha-skill');
  });
});
