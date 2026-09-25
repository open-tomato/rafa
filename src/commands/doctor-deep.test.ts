/**
 * Tests for `./doctor-deep.ts`: the Environment rows of a session
 * reading, and `readDeep` reading every section once over a planted
 * TypeScript project, under the seams `DoctorSeams` takes for it.
 *
 * The world under this file's temporary directory:
 *
 *   - a project with a `tsconfig.json` and a `.rafa/config.yaml`, whose
 *     `.claude/settings.json` hands the session a `PATH` of only the
 *     `gh-bin` directory and a secret token;
 *   - a home holding a user-only skill `symbols` naming `ts-symbols`;
 *   - the shell: a `PATH` of `tools-bin`, which holds `ts-symbols`, then
 *     `gh-bin`, which holds a `gh` the scripted runner stands behind.
 *
 * Each claim that a section was read under the SESSION's environment is
 * paired with the shell's reading of the same thing, so a pass cannot
 * come from a reader that ignored the environment it was handed.
 */
import type { SessionEnvReading } from './doctor-deep-env.js';
import type { DeepReading, ReadDeepSeams } from './doctor-deep.js';
import type { GhResult, GhRunnerOptions } from '../adapters/tracker/github.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '../config-load.js';
import { resolveScope } from '../project/scope.js';

import { readSessionEnv } from './doctor-deep-env.js';
import { PLAN_NEEDS_SECTION_TITLE, STACK_TOOLS_SECTION_TITLE } from './doctor-deep-needs.js';
import { PROVIDERS_SECTION_TITLE } from './doctor-deep-providers.js';
import { SETTINGS_SECTION_TITLE } from './doctor-deep-settings.js';
import { deepSections, ENVIRONMENT_SECTION_TITLE, environmentSection, readDeep, renderDeep } from './doctor-deep.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const runtime = join(base, 'runtime');
const toolsBin = join(base, 'tools-bin');
const ghBin = join(base, 'gh-bin');
const planPath = join(projectRoot, '.rafa/plans/PLAN-demo.md');
const projectSettings = join(projectRoot, '.claude/settings.json');

const SECRET = 'tok-do-not-print-7f3a';
const GITHUB_REMOTE = 'git@github.com:open-tomato/rafa.git';

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

write(join(projectRoot, 'tsconfig.json'), '{}\n');
write(projectSettings, JSON.stringify({ env: { PATH: ghBin, RAFA_DEEP_TOKEN: SECRET } }));
write(join(home, '.claude/settings.json'), JSON.stringify({ env: { USER_ONLY_KEY: 'x' } }));
write(
  join(home, '.claude/skills/symbols/SKILL.md'),
  '---\nname: symbols\ndescription: Trace TypeScript symbols with ts-symbols\n---\n\n# Body\n\nRead each exit code.\n',
);
write(join(runtime, 'cli.js'), '');
write(join(toolsBin, 'ts-symbols'), '#!/bin/sh\n');
chmodSync(join(toolsBin, 'ts-symbols'), 0o755);
write(join(ghBin, 'gh'), '#!/bin/sh\nexit 2\n');
chmodSync(join(ghBin, 'gh'), 0o755);
write(planPath, '# Plan\n\n- [ ] Review it {agent=absent-reviewer}\n');

/** The shell's environment. */
const shellEnv = { PATH: [toolsBin, ghBin].join(delimiter), HOME: home };

/** Plants `.rafa/config.yaml` with `lines` and answers the project and its resolved config. */
function projectWith(lines: readonly string[]) {
  write(join(projectRoot, '.rafa/config.yaml'), ['version: 1', ...lines, ''].join('\n'));
  const project = resolveScope(projectRoot, { home });
  if (!project.found) throw new Error('the planted project was not found');
  return { project, resolved: loadConfig({ root: project.root, home }, {}, () => undefined) };
}

/** The config of a project nothing goes through `gh` for. */
const LOCAL_ONLY = ['tracker:', '  default: local', 'pr:', '  provider: none'];

/** The seams every case runs with: the session in the project root, the rafa tier under `runtime`. */
const SEAMS: ReadDeepSeams = {
  sessionCwd: () => projectRoot,
  inventory: { entry: () => join(runtime, 'cli.js') },
};

/** `readDeep` over the world with `lines` as the config. */
function read(lines: readonly string[], plan: string | null = null, seams: ReadDeepSeams = SEAMS): Promise<DeepReading> {
  const { project, resolved } = projectWith(lines);
  return readDeep({ project, env: shellEnv, resolved, plan }, seams);
}

/** A session reading by hand, with every field a case does not name empty. */
function sessionReading(overrides: Partial<SessionEnvReading>): SessionEnvReading {
  return {
    env: {},
    cwd: projectRoot,
    projectRoot,
    settingSources: ['project', 'local'],
    scopes: [],
    differences: [],
    path: null,
    warnings: [],
    ...overrides,
  };
}

describe('environmentSection', () => {
  it('reads a session in the project root with no difference as two ok rows', () => {
    const section = environmentSection(sessionReading({}));

    expect(section.title).toBe(ENVIRONMENT_SECTION_TITLE);
    expect(section.rows).toEqual([
      { status: 'ok', name: 'working directory', detail: `the project root, ${projectRoot}` },
      { status: 'ok', name: 'environment', detail: 'the same as the shell\'s' },
    ]);
  });

  it('notes a working directory that is not the project root, with the fix', () => {
    const elsewhere = join(projectRoot, 'src');
    const [row] = environmentSection(sessionReading({ cwd: elsewhere })).rows;

    expect(row?.status).toBe('note');
    expect(row?.detail).toContain(`${elsewhere}, not the project root ${projectRoot}`);
    expect(row?.fix).toBe(`run rafa from ${projectRoot}`);
  });

  it('warns of a PATH a settings file set losing a directory, naming that file in the fix', () => {
    const reading = sessionReading({
      scopes: [{ scope: 'project', path: projectSettings, loaded: true, entries: new Map([['PATH', ghBin]]) }],
      path: { layer: 'project', added: [], removed: [toolsBin], reordered: false },
    });
    const row = environmentSection(reading).rows.find((candidate) => candidate.name === 'PATH');

    expect(row?.status).toBe('warn');
    expect(row?.detail).toBe(`loses ${toolsBin}, which the shell searches; set by the project settings file ${projectSettings}`);
    expect(row?.fix).toContain(`env.PATH in ${projectSettings}`);
  });

  it('notes a PATH that only gains or reorders, with no fix', () => {
    const reading = sessionReading({ path: { layer: 'spawn', added: ['/opt/x'], removed: [], reordered: true } });
    const row = environmentSection(reading).rows.find((candidate) => candidate.name === 'PATH');

    expect(row).toEqual({
      status: 'note',
      name: 'PATH',
      detail: 'gains /opt/x; searches the directories both hold in another order; set by rafa\'s spawn',
    });
  });

  it('drops the ok environment row once anything differs', () => {
    const reading = sessionReading({ differences: [{ key: 'CLAUDE_CODE_ENTRYPOINT', kind: 'added', layer: 'spawn' }] });

    expect(environmentSection(reading).rows.map((row) => row.name)).toEqual(['working directory', 'CLAUDE_CODE_ENTRYPOINT']);
  });

  it('notes each differing key and who set it, and a removed one', () => {
    const reading = sessionReading({
      differences: [
        { key: 'CLAUDE_CODE_ENTRYPOINT', kind: 'added', layer: 'spawn' },
        { key: 'GONE', kind: 'removed', layer: null },
      ],
    });

    expect(environmentSection(reading).rows.slice(1)).toEqual([
      { status: 'note', name: 'CLAUDE_CODE_ENTRYPOINT', detail: 'added by rafa\'s spawn' },
      { status: 'note', name: 'GONE', detail: 'removed: the shell has it and a session does not' },
    ]);
  });

  it('notes a settings env a session is not handed, by its keys alone', () => {
    const userFile = join(home, '.claude/settings.json');
    const reading = sessionReading({
      scopes: [{ scope: 'user', path: userFile, loaded: false, entries: new Map([['A_KEY', SECRET]]) }],
    });
    const row = environmentSection(reading).rows.find((candidate) => candidate.name === 'user settings env');

    expect(row?.status).toBe('note');
    expect(row?.detail).toBe(`${userFile} sets A_KEY, which a session is not handed: loop.settingSources leaves out user`);
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it('warns of each settings file that did not read, leaving out the ones already shown', () => {
    const kept = { scope: 'user', path: '/h/.claude/settings.json', loaded: false, reason: 'is not JSON' } as const;
    const shown = { scope: 'project', path: projectSettings, loaded: true, reason: 'is not a mapping' } as const;
    const section = environmentSection(sessionReading({ warnings: [kept, shown] }), [shown]);
    const warns = section.rows.filter((row) => row.status === 'warn');

    expect(warns).toEqual([{ status: 'warn', name: kept.path, detail: 'is not JSON (a file sessions do not load)' }]);
    expect(environmentSection(sessionReading({ warnings: [kept, shown] })).rows
      .filter((row) => row.status === 'warn')).toHaveLength(2);
  });
});

describe('readDeep over a planted TypeScript project', () => {
  it('reads every section once, in print order, with no plan section without --plan', async () => {
    const reading = await read(LOCAL_ONLY);

    expect(deepSections(reading).map((section) => section.title)).toEqual([
      ENVIRONMENT_SECTION_TITLE,
      SETTINGS_SECTION_TITLE,
      PROVIDERS_SECTION_TITLE,
      STACK_TOOLS_SECTION_TITLE,
    ]);
    expect(reading.planNeeds).toBeNull();
    expect(reading.plan).toBeNull();
    expect(reading.projectRoot).toBe(projectRoot);
    expect(reading.settingSources).toEqual(['project', 'local']);
  });

  it('reads the environment under the project settings, as a warn PATH row and a noted key', async () => {
    const { environment } = await read(LOCAL_ONLY);
    const names = environment.rows.map((row) => row.name);

    expect(environment.rows.find((row) => row.name === 'PATH')?.status).toBe('warn');
    expect(names).toContain('RAFA_DEEP_TOKEN');
    expect(names).toContain('user settings env');
  });

  it('looks ts-symbols up on the session PATH, which lost it, not the shell\'s', async () => {
    const { stackTools } = await read(LOCAL_ONLY);
    const [row] = stackTools.rows;

    expect(row?.status).toBe('warn');
    expect(row?.detail).toContain('ts-symbols neither in bundled/bin nor on PATH');
    // Control: the shell's PATH does hold it, so a reader handed the shell's would read it as found.
    expect(Bun.which('ts-symbols', { PATH: shellEnv.PATH })).toBe(join(toolsBin, 'ts-symbols'));
  });

  it('shows the user-only skill as hidden from sessions, with its fix', async () => {
    const { settings } = await read(LOCAL_ONLY);
    const row = settings.rows.find((candidate) => candidate.name === 'user skill symbols');

    expect(row?.status).toBe('note');
    expect(row?.fix).toContain('add user to loop.settingSources');
  });

  it('runs the session in the directory sessionCwd names', async () => {
    const elsewhere = join(projectRoot, 'src');
    const reading = await read(LOCAL_ONLY, null, { ...SEAMS, sessionCwd: () => elsewhere });

    expect(reading.cwd).toBe(elsewhere);
    expect(reading.environment.rows[0]?.status).toBe('note');
    expect((await read(LOCAL_ONLY)).environment.rows[0]?.status).toBe('ok');
  });

  it('builds the inventory beside the entry the inventory seam names', async () => {
    let asked = 0;
    await read(LOCAL_ONLY, null, { ...SEAMS, inventory: { entry: () => { asked += 1; return join(runtime, 'cli.js'); } } });

    expect(asked).toBe(1);
  });

  it('opens the provider runner with the session\'s environment, found on the session\'s PATH', async () => {
    const opened: GhRunnerOptions[] = [];
    const logout: GhResult = { ok: false, stdout: '', stderr: 'You are not logged into any GitHub hosts.' };
    const reading = await read(['tracker:', '  default: github'], null, {
      ...SEAMS,
      readRemote: () => GITHUB_REMOTE,
      openProviderGh: (options) => {
        opened.push(options);
        return () => Promise.resolve(logout);
      },
    });

    expect(opened).toHaveLength(1);
    expect(opened[0]?.command).toBe(join(ghBin, 'gh'));
    expect(opened[0]?.env?.['RAFA_DEEP_TOKEN']).toBe(SECRET);
    expect(opened[0]?.env?.['PATH']).toBe(ghBin);
    const auth = reading.providers.rows.find((row) => row.name.startsWith('gh auth status'));
    expect(auth?.status).toBe('warn');
  });

  it('adds the Plan needs section for a plan, named relative to the project root', async () => {
    const reading = await read(LOCAL_ONLY, planPath);

    expect(reading.plan).toBe('.rafa/plans/PLAN-demo.md');
    expect(reading.planNeeds?.title).toBe(`${PLAN_NEEDS_SECTION_TITLE} (.rafa/plans/PLAN-demo.md)`);
    expect(reading.planNeeds?.rows.find((row) => row.name === 'agent absent-reviewer')?.status).toBe('warn');
    expect(deepSections(reading).at(-1)).toBe(reading.planNeeds ?? undefined);
  });

  it('reads a plan that is not there as one warn row rather than throwing', async () => {
    const reading = await read(LOCAL_ONLY, join(projectRoot, '.rafa/plans/PLAN-gone.md'));

    expect(reading.planNeeds?.rows).toHaveLength(1);
    expect(reading.planNeeds?.rows[0]?.status).toBe('warn');
  });

  it('never reads a row as anything but ok, warn or note', async () => {
    const reading = await read(LOCAL_ONLY, planPath);

    expect(deepSections(reading).flatMap((section) => section.rows)
      .every((row) => ['ok', 'warn', 'note'].includes(row.status))).toBe(true);
  });
});

describe('the json shape and the text lines', () => {
  it('round-trips through JSON, and carries no environment value', async () => {
    const reading = await read(LOCAL_ONLY, planPath);
    const json = JSON.stringify(reading);

    expect(JSON.parse(json) as unknown).toEqual(reading);
    expect(json).not.toContain(SECRET);
    // Control: the session IS handed the secret, so its absence above is the rendering's doing.
    const session = readSessionEnv({ env: shellEnv, settingSources: ['project', 'local'], home, projectRoot, cwd: projectRoot });
    expect(session.env['RAFA_DEEP_TOKEN']).toBe(SECRET);
  });

  it('renders each section\'s title in order, and no value', async () => {
    const lines = renderDeep(await read(LOCAL_ONLY, planPath));
    const titles = lines.filter((line) => !line.startsWith(' '));

    expect(titles).toEqual([
      'Environment:',
      'Settings:',
      'Providers:',
      'Stack tools:',
      'Plan needs (.rafa/plans/PLAN-demo.md):',
    ]);
    expect(lines.join('\n')).not.toContain(SECRET);
  });
});
