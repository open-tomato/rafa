/**
 * Spawned tests of `rafa doctor --deep`: the real command, run as
 * `bun src/rafa.ts` in a scratch project, read for what the deep
 * sections say of a machine that differs between the shell and the
 * environment a loop session would be handed.
 *
 * Every case plants a TypeScript project (a `tsconfig.json`) under the
 * scratch repository, with a stand-in `gh` in the scratch `bin/` that
 * answers as logged in unless it is handed a `GH_CONFIG_DIR`, so the
 * one variable a project settings file sets decides what a session's
 * `gh` says while the shell's own stays logged in. No `claude` is ever
 * planted or called: `--deep` starts no session.
 */
import type { CapturedRun, ScratchRepo } from './cli-capture.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { eventsOf, plantScratchRepo, runRafa } from './cli-capture.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-spawned-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** The skill the TypeScript stack's program is named in, planted under the scratch HOME alone. */
const SKILL = 'ts-symbols-for-agents';

/** A stand-in `gh`: logged in, unless the environment it is handed holds `GH_CONFIG_DIR`. */
const STAND_IN_GH = [
  '#!/bin/sh',
  'if [ -n "$GH_CONFIG_DIR" ]; then echo "You are not logged into any accounts" >&2; exit 1; fi',
  'echo "Logged in"',
  'exit 0',
  '',
].join('\n');

/** Writes `text` to `path`, making its directories. */
function plant(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** What a case plants beyond the TypeScript project. */
interface World {
  /** The project's `.claude/settings.json` `env`, when it sets one. */
  readonly sessionEnv?: Readonly<Record<string, string>>;
  /** A plan under the repository, its text, when the case names one. */
  readonly plan?: string;
}

/** The plan a case names, relative to the repository. */
const PLAN_FILE = 'PLAN-deep.md';

/** Plants a TypeScript project with the skill under the scratch HOME only, and a stand-in `gh`. */
function plantWorld(world: World = {}): ScratchRepo {
  const scratch = plantScratchRepo(scratchBase);
  plant(join(scratch.repo, 'tsconfig.json'), '{}\n');
  plant(
    join(scratch.home, '.claude', 'skills', SKILL, 'SKILL.md'),
    `---\nname: ${SKILL}\ndescription: Symbols of a TypeScript project.\n---\n\nRun ts-symbols def <name>.\n`,
  );
  const gh = join(scratch.bin, 'gh');
  plant(gh, STAND_IN_GH);
  chmodSync(gh, 0o755);
  if (world.sessionEnv !== undefined) {
    plant(join(scratch.repo, '.claude', 'settings.json'), JSON.stringify({ env: world.sessionEnv }));
  }
  if (world.plan !== undefined) plant(join(scratch.repo, PLAN_FILE), world.plan);
  return scratch;
}

/** The lines of a run's stdout, and the lines of one section of them. */
function sectionLines(run: CapturedRun, title: string): string[] {
  const lines = run.stdout.split('\n');
  const start = lines.indexOf(`${title}:`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith(' '));
  return end === -1
    ? rest
    : rest.slice(0, end);
}

/** The `data` of a json run's result event. */
function resultData(run: CapturedRun): Record<string, unknown> {
  const result = eventsOf(run.stdout).find((event) => event.type === 'result');
  expect(result).toBeDefined();
  return (result as unknown as { data: Record<string, unknown> }).data;
}

describe('rafa doctor --deep, spawned', () => {
  it('prints a skill only under the scratch HOME as hidden from sessions with its fix, and exits as plain doctor does', RUN_TIMEOUT, () => {
    const scratch = plantWorld();

    const plain = runRafa(scratch, scratch.repo, ['doctor']);
    const deep = runRafa(scratch, scratch.repo, ['doctor', '--deep']);

    const settings = sectionLines(deep, 'Settings');
    const hidden = settings.findIndex((line) => line.includes(`user skill ${SKILL}: hidden from sessions`));
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(settings[hidden + 1]).toContain('fix: add user to loop.settingSources in .rafa/config.yaml');
    expect(sectionLines(deep, 'Stack tools').join('\n')).toContain('skill ts-symbols visible to a run');
    expect(plain.stdout).not.toContain('Settings:');
    expect(deep.exitCode).toBe(plain.exitCode);
    expect(deep.exitCode).toBe(0);
  });

  it('prints gh logged out only under the session\'s environment as a warn provider row', RUN_TIMEOUT, () => {
    const scratch = plantWorld({ sessionEnv: { GH_CONFIG_DIR: join(scratchBase, 'no-gh-config') } });

    const plain = runRafa(scratch, scratch.repo, ['doctor']);
    const deep = runRafa(scratch, scratch.repo, ['doctor', '--deep']);

    const providers = sectionLines(deep, 'Providers');
    expect(providers.some((line) => line.startsWith('  ok    gh: ') && line.includes(scratch.bin))).toBe(true);
    const auth = providers.findIndex((line) => line.startsWith('  warn  gh auth status --hostname github.com: exited nonzero'));
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(providers[auth + 1]).toContain('fix: gh is not authenticated for github.com');
    expect(sectionLines(deep, 'Environment').join('\n')).toContain('GH_CONFIG_DIR: added by the project settings file');
    expect(deep.exitCode).toBe(plain.exitCode);
  });

  it('prints a PATH the session loses a directory of as a warn row, and gh gone with it', RUN_TIMEOUT, () => {
    const scratch = plantWorld();
    const gitDir = scratch.path.split(':').at(-1) ?? '';
    const withoutBin = plantWorld({ sessionEnv: { PATH: gitDir } });

    const same = runRafa(scratch, scratch.repo, ['doctor', '--deep']);
    const differs = runRafa(withoutBin, withoutBin.repo, ['doctor', '--deep']);
    const plain = runRafa(withoutBin, withoutBin.repo, ['doctor']);

    expect(sectionLines(same, 'Environment').join('\n')).not.toContain('  warn  PATH');
    const environment = sectionLines(differs, 'Environment');
    expect(environment.some((line) => line.startsWith('  warn  PATH: loses ') && line.includes(withoutBin.bin))).toBe(true);
    expect(environment.join('\n')).toContain('fix: add the lost directories to env.PATH in ');
    expect(sectionLines(differs, 'Providers').some((line) => line.startsWith('  warn  gh: not found on the session\'s PATH'))).toBe(true);
    expect(differs.exitCode).toBe(plain.exitCode);
  });

  it('adds the plan-needs rows for --plan, and none without it', RUN_TIMEOUT, () => {
    const scratch = plantWorld({ plan: '# Plan\n\n- [ ] Use a skill {skills=absent-skill}\n' });

    const without = runRafa(scratch, scratch.repo, ['doctor', '--deep']);
    const withPlan = runRafa(scratch, scratch.repo, ['doctor', '--deep', `--plan=${PLAN_FILE}`]);

    expect(without.stdout).not.toContain('Plan needs');
    const needs = sectionLines(withPlan, `Plan needs (${PLAN_FILE})`);
    expect(needs.some((line) => line.startsWith('  warn  ') && line.includes('absent-skill'))).toBe(true);
  });

  it('gives the deep sections as data under --output=json, with plan needs only for --plan', RUN_TIMEOUT, () => {
    const scratch = plantWorld({ plan: '# Plan\n\n- [ ] Use a skill {skills=absent-skill}\n' });

    const without = resultData(runRafa(scratch, scratch.repo, ['doctor', '--deep', '--output=json']));
    const withPlan = resultData(runRafa(scratch, scratch.repo, ['doctor', '--deep', `--plan=${PLAN_FILE}`, '--output=json']));
    const plainData = resultData(runRafa(scratch, scratch.repo, ['doctor', '--output=json']));

    const deep = without['deep'] as Record<string, unknown>;
    expect(deep['projectRoot']).toBe(scratch.repo);
    expect(deep['settingSources']).toEqual(['project', 'local']);
    expect(deep['plan']).toBeNull();
    expect(deep['planNeeds']).toBeNull();
    for (const key of ['environment', 'settings', 'providers', 'stackTools']) {
      expect(Array.isArray((deep[key] as { rows: unknown }).rows)).toBe(true);
    }
    const settings = deep['settings'] as { rows: { name: string; status: string; fix?: string }[] };
    const hiddenRow = settings.rows.find((row) => row.name === `user skill ${SKILL}`);
    expect(hiddenRow?.status).toBe('note');
    expect(hiddenRow?.fix).toBe('add user to loop.settingSources in .rafa/config.yaml');

    const planned = withPlan['deep'] as { plan: string; planNeeds: { title: string; rows: { status: string }[] } };
    expect(planned.plan).toBe(PLAN_FILE);
    expect(planned.planNeeds.title).toBe(`Plan needs (${PLAN_FILE})`);
    expect(planned.planNeeds.rows.some((row) => row.status === 'warn')).toBe(true);
    expect(plainData['deep']).toBeNull();
  });
});
