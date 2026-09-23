/**
 * Tests for the MCP server configuration reader.
 *
 * Every case plants a home and a project root of its own under this
 * file's temporary directory, so nothing reads the real home. A reader
 * that answered "not loaded" for everything would pass every negative
 * here, so each negative sits beside a control that reads the same
 * world, changed in one place, as loaded: a rejection under a source
 * that is off beside the same rejection under one that is on, another
 * project's entry beside this project's, and so on.
 */
import type { McpSeams } from './mcp.js';
import type { ClaudeSettingSource } from '../config-sections.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  isLoadedUnder,
  mcpDeclarationsOf,
  mcpServerFor,
  readMcpServers,
} from './mcp.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-inventory-mcp-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const ALL: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

let planted = 0;

/** A fresh world: a home and a project root, neither written yet. */
function world(): McpSeams {
  planted += 1;
  const base = join(tempBase, `w${planted}`);
  return { home: join(base, 'home'), projectRoot: join(base, 'project') };
}

/** Writes `content` at `path`, as JSON unless it is already a string. */
function plant(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string'
    ? content
    : JSON.stringify(content));
}

/** A server entry as `.mcp.json` and `~/.claude.json` spell one. */
function server(command: string): Record<string, unknown> {
  return { command, args: [] };
}

function claudeJsonPath(seams: McpSeams): string {
  return join(seams.home, '.claude.json');
}

function mcpJsonPath(seams: McpSeams): string {
  return join(seams.projectRoot ?? '', '.mcp.json');
}

/** Plants `~/.claude.json` with user servers and this project's entry. */
function plantClaudeJson(seams: McpSeams, user: Record<string, unknown>, entry: Record<string, unknown> = {}): void {
  plant(claudeJsonPath(seams), { mcpServers: user, projects: { [seams.projectRoot ?? '']: entry } });
}

describe('readMcpServers', () => {
  it('reads the local, project and user scopes, nearest first, each with its file', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { shared: server('p'), docs: server('d') } });
    plantClaudeJson(seams, { shared: server('u') }, { mcpServers: { shared: server('l') } });

    const reading = readMcpServers(seams);

    expect(reading.warnings).toEqual([]);
    expect(reading.servers.map((s) => [s.name, s.scope, s.path])).toEqual([
      ['shared', 'local', claudeJsonPath(seams)],
      ['shared', 'project', mcpJsonPath(seams)],
      ['docs', 'project', mcpJsonPath(seams)],
      ['shared', 'user', claudeJsonPath(seams)],
    ]);
    expect(mcpDeclarationsOf(reading, 'shared').map((s) => s.scope)).toEqual(['local', 'project', 'user']);
  });

  it('reads nothing and warns of nothing when no file is there', () => {
    expect(readMcpServers(world())).toEqual({ servers: [], warnings: [] });
  });

  it('reads only the user scope with no project root', () => {
    const seams = world();
    plantClaudeJson(seams, { u: server('u') }, { mcpServers: { l: server('l') } });
    plant(mcpJsonPath(seams), { mcpServers: { p: server('p') } });

    const reading = readMcpServers({ home: seams.home, projectRoot: null });

    expect(reading.servers.map((s) => [s.name, s.scope])).toEqual([['u', 'user']]);
  });

  it('reads the local scope from this project\'s entry and no other', () => {
    const seams = world();
    plant(claudeJsonPath(seams), {
      projects: {
        [`${seams.projectRoot ?? ''}-other`]: { mcpServers: { elsewhere: server('e') } },
        [dirname(seams.projectRoot ?? '')]: { mcpServers: { parent: server('p') } },
        [seams.projectRoot ?? '']: { mcpServers: { here: server('h') } },
      },
    });

    expect(readMcpServers(seams).servers.map((s) => s.name)).toEqual(['here']);
  });

  it('marks a name in this project\'s disabledMcpServers disabled in every scope', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { off: server('p'), on: server('p') } });
    plantClaudeJson(seams, { off: server('u') }, { disabledMcpServers: ['off'] });

    const servers = readMcpServers(seams).servers;

    expect(servers.map((s) => [s.name, s.scope, s.disabled])).toEqual([
      ['off', 'project', true],
      ['on', 'project', false],
      ['off', 'user', true],
    ]);
  });

  it('reads disabledMcpjsonServers from each settings file, for project servers only', () => {
    const seams = world();
    const root = seams.projectRoot ?? '';
    plant(mcpJsonPath(seams), { mcpServers: { a: server('a'), b: server('b') } });
    plantClaudeJson(seams, { a: server('u') });
    plant(join(root, '.claude', 'settings.local.json'), { disabledMcpjsonServers: ['a'] });
    plant(join(root, '.claude', 'settings.json'), { disabledMcpjsonServers: ['b'] });
    plant(join(seams.home, '.claude', 'settings.json'), { disabledMcpjsonServers: ['a', 'b'] });

    const servers = readMcpServers(seams).servers;

    expect(servers.map((s) => [s.name, s.scope, s.rejectedBy])).toEqual([
      ['a', 'project', ['local', 'user']],
      ['b', 'project', ['project', 'user']],
      ['a', 'user', []],
    ]);
  });
});

describe('readMcpServers warnings', () => {
  it('warns of a .mcp.json that is not JSON and reads the other files', () => {
    const seams = world();
    plant(mcpJsonPath(seams), '{"mcpServers":');
    plantClaudeJson(seams, { u: server('u') });

    const reading = readMcpServers(seams);

    expect(reading.servers.map((s) => s.name)).toEqual(['u']);
    expect(reading.warnings).toHaveLength(1);
    expect(reading.warnings[0]?.path).toBe(mcpJsonPath(seams));
    expect(reading.warnings[0]?.reason).toStartWith('is not JSON: ');
  });

  it('warns of keys of the wrong shape and keeps the entries that read', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { good: server('g'), bad: 'nope' } });
    plantClaudeJson(seams, [] as unknown as Record<string, unknown>, { disabledMcpServers: ['x', 3] });
    plant(join(seams.home, '.claude', 'settings.json'), { disabledMcpjsonServers: 'good' });

    const reading = readMcpServers(seams);

    expect(reading.servers.map((s) => [s.name, s.disabled, s.rejectedBy])).toEqual([['good', false, []]]);
    expect(reading.warnings).toEqual([
      { path: mcpJsonPath(seams), reason: 'mcpServers "bad" is "nope", expected a mapping' },
      { path: claudeJsonPath(seams), reason: 'has mcpServers a list, expected a mapping' },
      { path: claudeJsonPath(seams), reason: 'disabledMcpServers[1] is 3, expected a name' },
      { path: join(seams.home, '.claude', 'settings.json'), reason: 'has disabledMcpjsonServers "good", expected a list of names' },
    ]);
  });

  it('warns of a projects key or a project entry that is not a mapping', () => {
    const listed = world();
    plant(claudeJsonPath(listed), { projects: [] });
    const scalar = world();
    plant(claudeJsonPath(scalar), { projects: { [scalar.projectRoot ?? '']: 'x' } });

    expect(readMcpServers(listed).warnings.map((w) => w.reason)).toEqual(['has projects a list, expected a mapping']);
    expect(readMcpServers(scalar).warnings.map((w) => w.reason)).toEqual([`has ${scalar.projectRoot ?? ''} "x", expected a mapping`]);
  });
});

describe('mcpServerFor', () => {
  it('answers the nearest declaration: local, then project, then user', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { shared: server('p'), pu: server('p') } });
    plantClaudeJson(seams, { shared: server('u'), pu: server('u') }, { mcpServers: { shared: server('l') } });
    const reading = readMcpServers(seams);

    expect(mcpServerFor(reading, 'shared', ALL)?.scope).toBe('local');
    expect(mcpServerFor(reading, 'pu', ALL)?.scope).toBe('project');
  });

  it('loads a scope only under its own setting source', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { shared: server('p') } });
    plantClaudeJson(seams, { shared: server('u') }, { mcpServers: { shared: server('l') } });
    const reading = readMcpServers(seams);

    expect(mcpServerFor(reading, 'shared', ['user'])?.scope).toBe('user');
    expect(mcpServerFor(reading, 'shared', ['project'])?.scope).toBe('project');
    expect(mcpServerFor(reading, 'shared', ['local'])?.scope).toBe('local');
  });

  it('answers null for a name nothing declares, and for one declared only under a source that is off', () => {
    const seams = world();
    plantClaudeJson(seams, { u: server('u') });
    const reading = readMcpServers(seams);

    expect(mcpServerFor(reading, 'absent', ALL)).toBeNull();
    expect(mcpServerFor(reading, 'u', ['project', 'local'])).toBeNull();
    // Control: the same world under `user` loads it.
    expect(mcpServerFor(reading, 'u', ['user'])?.scope).toBe('user');
  });

  it('leaves the name of a rejected project server to the user one', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { pu: server('p') } });
    plantClaudeJson(seams, { pu: server('u') });
    plant(join(seams.home, '.claude', 'settings.json'), { disabledMcpjsonServers: ['pu'] });

    expect(mcpServerFor(readMcpServers(seams), 'pu', ALL)?.scope).toBe('user');
  });

  it('counts a rejection only when its settings file\'s source is on', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { probe: server('p') } });
    plant(join(seams.projectRoot ?? '', '.claude', 'settings.local.json'), { disabledMcpjsonServers: ['probe'] });
    const reading = readMcpServers(seams);

    expect(mcpServerFor(reading, 'probe', ['project', 'local'])).toBeNull();
    // Control: the same rejection with `local` off does not stop it.
    expect(mcpServerFor(reading, 'probe', ['project'])?.scope).toBe('project');
  });

  it('never loads a server disabledMcpServers names, whatever the sources', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { probe: server('p') } });
    plantClaudeJson(seams, {}, { disabledMcpServers: ['probe'] });
    const disabled = readMcpServers(seams);

    const control = world();
    plant(mcpJsonPath(control), { mcpServers: { probe: server('p') } });
    plantClaudeJson(control, {}, {});

    expect(mcpServerFor(disabled, 'probe', ['project'])).toBeNull();
    expect(mcpServerFor(disabled, 'probe', ALL)).toBeNull();
    expect(mcpServerFor(readMcpServers(control), 'probe', ['project'])?.scope).toBe('project');
  });
});

describe('isLoadedUnder', () => {
  it('reads one declaration alone, ignoring nearer holders of its name', () => {
    const seams = world();
    plant(mcpJsonPath(seams), { mcpServers: { shared: server('p') } });
    plantClaudeJson(seams, {}, { mcpServers: { shared: server('l') } });
    const [local, project] = readMcpServers(seams).servers;

    expect(local === undefined || project === undefined).toBe(false);
    if (local === undefined || project === undefined) return;
    expect(isLoadedUnder(project, ALL)).toBe(true);
    expect(isLoadedUnder(local, ['project'])).toBe(false);
  });
});
