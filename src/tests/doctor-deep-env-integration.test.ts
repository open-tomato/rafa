/**
 * Integration tests for the session-environment reading of
 * `rafa doctor --deep` over a planted project: a project directory and
 * a home, each with the `.claude` settings files a real one holds,
 * read through the reading's seams with a shell environment built for
 * the case.
 */
import type { ClaudeSettingSource } from '../config-sections.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readSessionEnv } from '../commands/doctor-deep-env.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-env-int-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SHELL_PATH = ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter);

let planted = 0;

interface Project {
  readonly home: string;
  readonly root: string;
}

/** Plants a project root and a home, each settings file written from `files`. */
function plant(files: Readonly<Partial<Record<ClaudeSettingSource, string>>>): Project {
  planted += 1;
  const base = join(tempBase, `project-${String(planted)}`);
  const home = join(base, 'home');
  const root = join(base, 'project');
  const paths: Record<ClaudeSettingSource, string> = {
    local: join(root, '.claude/settings.local.json'),
    project: join(root, '.claude/settings.json'),
    user: join(home, '.claude/settings.json'),
  };
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });
  for (const [scope, text] of Object.entries(files)) {
    const path = paths[scope as ClaudeSettingSource];
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return { home, root };
}

function read(project: Project, settingSources: readonly ClaudeSettingSource[]): ReturnType<typeof readSessionEnv> {
  return readSessionEnv({
    env: { HOME: project.home, PATH: SHELL_PATH },
    settingSources,
    home: project.home,
    projectRoot: project.root,
    cwd: project.root,
  });
}

describe('session environment over a planted project', () => {
  it('leaves a user-level settings env out under project,local, and hands it over once user is a source', () => {
    const project = plant({ user: JSON.stringify({ env: { FROM_USER: 'u' } }) });

    const left = read(project, ['project', 'local']);
    const included = read(project, ['user', 'project', 'local']);

    expect(left.env['FROM_USER']).toBeUndefined();
    expect(left.differences.map((d) => d.key)).not.toContain('FROM_USER');
    expect(left.scopes.find((s) => s.scope === 'user')).toMatchObject({ loaded: false });
    expect([...(left.scopes.find((s) => s.scope === 'user')?.entries.keys() ?? [])]).toEqual(['FROM_USER']);
    expect(included.env['FROM_USER']).toBe('u');
    expect(included.differences).toContainEqual({ key: 'FROM_USER', kind: 'added', layer: 'user' });
  });

  it('reads a project settings env.PATH as a PATH difference, not a value', () => {
    const project = plant({ project: JSON.stringify({ env: { PATH: '/opt/bin:/usr/bin' } }) });

    const reading = read(project, ['project', 'local']);

    expect(reading.path).toEqual({
      layer: 'project',
      added: ['/opt/bin'],
      removed: ['/usr/local/bin', '/bin'],
      reordered: false,
    });
    expect(reading.differences.find((d) => d.key === 'PATH')).toBeUndefined();
  });

  it('reads an unreadable settings file as a warning, not a gap, and keeps the other files', () => {
    const project = plant({ project: JSON.stringify({ env: { FROM_PROJECT: 'p' } }), local: '{ not json' });

    const reading = read(project, ['project', 'local']);

    expect(reading.env['FROM_PROJECT']).toBe('p');
    expect(reading.warnings).toHaveLength(1);
    expect(reading.warnings[0]).toMatchObject({ scope: 'local', loaded: true });
    expect(reading.warnings[0]?.reason).toStartWith('is not JSON: ');
    expect(reading.differences.map((d) => d.key)).toContain('FROM_PROJECT');
  });
});
