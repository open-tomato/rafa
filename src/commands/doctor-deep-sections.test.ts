/**
 * Tests driving the four `rafa doctor --deep` section readings together:
 * Environment, Settings, Providers and Stack tools, read over one planted
 * TypeScript project the way `--deep` reads them, each from what the one
 * before it answered.
 *
 * The world under this file's temporary directory:
 *
 *   - a project with a `tsconfig.json`, whose `.claude/settings.json`
 *     sets `env` to hand the session a `PATH` of only the `gh` stand-in's
 *     directory and `RAFA_GH_STATE=out`;
 *   - a home holding a user-only skill `symbols` whose description names
 *     `ts-symbols`, so the default `project,local` sources hide it;
 *   - the shell: a `PATH` holding `ts-symbols` beside the stand-in `gh`,
 *     and `RAFA_GH_STATE=in`.
 *
 * The stand-in `gh` passes `auth status` only under `RAFA_GH_STATE=in`,
 * so it passes under the shell's environment and fails under the
 * session's. Both are asked, so no pass comes from an answer that ignores
 * the environment. No case reads the real `PATH`, home or `origin`.
 */
import type { ClaudeSettingSource } from '../config-sections.js';
import type { DeepSection } from './doctor-deep-row.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { pathDirectories } from '../check/references.js';

import { readSessionEnv } from './doctor-deep-env.js';
import { readDeepStackTools, stackToolsSection } from './doctor-deep-needs.js';
import { providersSection, readDeepProviders } from './doctor-deep-providers.js';
import { renderDeepSection } from './doctor-deep-row.js';
import { readDeepSettings, settingsSection } from './doctor-deep-settings.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-sections-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const runtime = join(base, 'runtime');
const toolsBin = join(base, 'tools-bin');
const ghBin = join(base, 'gh-bin');

const SOURCES: readonly ClaudeSettingSource[] = ['project', 'local'];
const GITHUB_REMOTE = 'git@github.com:open-tomato/rafa.git';

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

write(join(projectRoot, 'tsconfig.json'), '{}\n');
write(join(projectRoot, '.claude/settings.json'), JSON.stringify({
  env: { PATH: ghBin, RAFA_GH_STATE: 'out' },
}));
write(join(runtime, 'cli.js'), '');
write(
  join(home, '.claude/skills/symbols/SKILL.md'),
  '---\nname: symbols\ndescription: Trace TypeScript symbols with ts-symbols\n---\n\n# Body\n\nRead each exit code.\n',
);
write(join(toolsBin, 'ts-symbols'), '#!/bin/sh\n');
chmodSync(join(toolsBin, 'ts-symbols'), 0o755);

// Shell builtins alone: the stand-in runs under a PATH holding only its own directory.
write(join(ghBin, 'gh'), [
  '#!/bin/sh',
  'case "$*" in',
  '  "auth status --hostname github.com")',
  '    if [ "$RAFA_GH_STATE" = in ]; then printf "Logged in to github.com\\n"; exit 0; fi',
  '    printf "You are not logged into any GitHub hosts. To log in, run: gh auth login\\n" >&2; exit 1;;',
  '  *) printf "stand-in: unhandled %s\\n" "$*" >&2; exit 2;;',
  'esac',
  '',
].join('\n'));
chmodSync(join(ghBin, 'gh'), 0o755);

/** The shell's environment: `ts-symbols` and `gh` on `PATH`, and logged in. */
const shellEnv = {
  PATH: [toolsBin, ghBin].join(delimiter),
  HOME: home,
  RAFA_GH_STATE: 'in',
};

/** What `--deep` reads over the world, each section under the environment it names. */
async function readAll(): Promise<{
  readonly env: ReturnType<typeof readSessionEnv>;
  readonly settings: DeepSection;
  readonly providersInShell: DeepSection;
  readonly providersInSession: DeepSection;
  readonly stack: DeepSection;
}> {
  const env = readSessionEnv({ env: shellEnv, settingSources: SOURCES, home, projectRoot, cwd: projectRoot });
  const inventory = {
    home,
    projectRoot,
    entry: join(runtime, 'cli.js'),
    pathDirs: pathDirectories(env.env.PATH ?? ''),
    settingSources: SOURCES,
    modules: [],
  };
  const providers = (environment: Readonly<Record<string, string | undefined>>) => readDeepProviders({
    env: environment,
    cwd: projectRoot,
    config: { trackerDefault: 'github', trackerFallback: ['local'], prProvider: null },
    readRemote: () => GITHUB_REMOTE,
  }).then(providersSection);
  const stackReading = await readDeepStackTools(inventory);

  return {
    env,
    settings: settingsSection(readDeepSettings(inventory)),
    providersInShell: await providers(shellEnv),
    providersInSession: await providers(env.env),
    stack: stackToolsSection(stackReading, inventory),
  };
}

describe('the four deep sections over one TypeScript project', () => {
  it('reads the environment the session differs from the shell in', async () => {
    const { env } = await readAll();

    expect(env.differences).toEqual([
      { key: 'CLAUDE_CODE_ENTRYPOINT', kind: 'added', layer: 'spawn' },
      { key: 'RAFA_GH_STATE', kind: 'changed', layer: 'project' },
    ]);
    expect(env.path?.layer).toBe('project');
    expect(env.path?.removed).toEqual([toolsBin]);
    expect(env.env.RAFA_GH_STATE).toBe('out');
    expect(shellEnv.RAFA_GH_STATE).toBe('in');
  });

  it('shows the user-only skill naming ts-symbols hidden, with its fix', async () => {
    const { settings } = await readAll();
    const row = settings.rows.find((candidate) => candidate.name.includes('symbols'));

    expect(row?.status).toBe('note');
    expect(row?.fix).toContain('add user to loop.settingSources');
  });

  it('reads ts-symbols missing from the session PATH as a warn stack row', async () => {
    const { stack } = await readAll();

    expect(stack.rows).toHaveLength(1);
    expect(stack.rows[0]).toMatchObject({
      status: 'warn',
      name: 'typescript',
      detail: 'ts-symbols not on PATH; skill symbols not visible to a run',
    });
    expect(stack.rows[0]?.fix).toContain('install `ts-symbols`');
  });

  it('passes gh auth status under the shell environment and fails under the session\'s', async () => {
    const { providersInShell, providersInSession } = await readAll();
    const authOf = (section: DeepSection) => section.rows.find((row) => row.name.startsWith('gh auth status'));

    expect(authOf(providersInShell)).toMatchObject({ status: 'ok', detail: 'authenticated for github.com' });
    expect(authOf(providersInSession)).toMatchObject({ status: 'warn' });
    expect(authOf(providersInSession)?.detail).toContain('exited nonzero');
    expect(authOf(providersInSession)?.fix).toContain('gh auth login');
  });

  it('finds gh on the session PATH though ts-symbols is not there', async () => {
    const { providersInSession } = await readAll();

    expect(providersInSession.rows.find((row) => row.name === 'gh')).toMatchObject({
      status: 'ok',
      detail: `${join(ghBin, 'gh')}, found on the session's PATH`,
    });
  });

  it('renders every section through the shared lines, none of them a failure', async () => {
    const { settings, providersInSession, stack } = await readAll();
    const lines = [settings, providersInSession, stack].flatMap(renderDeepSection);

    expect(lines).toContain('Settings:');
    expect(lines).toContain('Providers:');
    expect(lines).toContain('Stack tools:');
    expect([settings, providersInSession, stack].flatMap((section) => section.rows)
      .every((row) => ['ok', 'warn', 'note'].includes(row.status))).toBe(true);
  });
});
