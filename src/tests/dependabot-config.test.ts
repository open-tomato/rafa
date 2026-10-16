/**
 * The Dependabot config this repository commits at `.github/dependabot.yml`.
 * The root eslint config lints no YAML and GitHub reads the file only after
 * a push, so this test is the file's only gate before then. It checks the
 * file against the keys and values GitHub's Dependabot options reference
 * names (docs.github.com, `dependabot-options-reference`, read 2026-10-16):
 * the `package-ecosystem` YAML values, the `schedule.interval` values, the
 * per-update option keys and the group `update-types` values.
 *
 * The lockfile is `bun.lock`, which the `npm` ecosystem does not update, so
 * the dependencies are watched under `bun`; the action pins under
 * `github-actions`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

/** The repository root. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The `package-ecosystem` YAML values the options reference lists. */
const DOCUMENTED_ECOSYSTEMS: ReadonlySet<string> = new Set([
  'bazel',
  'bun',
  'bundler',
  'cargo',
  'composer',
  'conda',
  'deno',
  'devcontainers',
  'docker',
  'docker-compose',
  'dotnet-sdk',
  'helm',
  'mix',
  'julia',
  'elm',
  'gitsubmodule',
  'github-actions',
  'gomod',
  'gradle',
  'maven',
  'nix',
  'npm',
  'nuget',
  'opentofu',
  'pip',
  'pre-commit',
  'pub',
  'rust-toolchain',
  'sbt',
  'swift',
  'terraform',
  'uv',
  'vcpkg',
]);

/** The `schedule.interval` values the options reference lists. */
const DOCUMENTED_INTERVALS: ReadonlySet<string> = new Set([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'semiannually',
  'yearly',
  'cron',
]);

/** The top-level keys the options reference names. */
const DOCUMENTED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'version',
  'updates',
  'registries',
  'multi-ecosystem-groups',
  'enable-beta-ecosystems',
]);

/** The keys the options reference names under each `updates` entry. */
const DOCUMENTED_UPDATE_KEYS: ReadonlySet<string> = new Set([
  'allow',
  'assignees',
  'commit-message',
  'cooldown',
  'directories',
  'directory',
  'exclude-paths',
  'groups',
  'ignore',
  'insecure-external-code-execution',
  'labels',
  'milestone',
  'multi-ecosystem-group',
  'open-pull-requests-limit',
  'package-ecosystem',
  'pull-request-branch-name',
  'rebase-strategy',
  'registries',
  'schedule',
  'target-branch',
  'vendor',
  'versioning-strategy',
]);

/** The group `update-types` values the options reference lists. */
const DOCUMENTED_GROUP_UPDATE_TYPES: ReadonlySet<string> = new Set(['major', 'minor', 'patch']);

/** One `updates` entry, as far as this test reads it. */
interface UpdateEntry {
  readonly 'package-ecosystem': string;
  readonly directory: string;
  readonly schedule: { readonly interval: string };
  readonly groups?: Readonly<Record<string, { readonly 'update-types'?: readonly string[] }>>;
}

/** The parsed config, as far as this test reads it. */
interface DependabotConfig {
  readonly version: number;
  readonly updates: readonly UpdateEntry[];
}

/** Reads and parses the committed config. */
function readConfig(): DependabotConfig {
  const text = readFileSync(join(ROOT, '.github', 'dependabot.yml'), 'utf8');

  return Bun.YAML.parse(text) as DependabotConfig;
}

describe('the committed dependabot config', () => {
  const config = readConfig();

  it('is version 2 and holds only documented top-level keys', () => {
    expect(config.version).toBe(2);
    for (const key of Object.keys(config)) {
      expect(DOCUMENTED_TOP_LEVEL_KEYS.has(key)).toBe(true);
    }
  });

  it('watches bun and github-actions over the root directory weekly', () => {
    const watched = config.updates.map((entry) => [
      entry['package-ecosystem'],
      entry.directory,
      entry.schedule.interval,
    ]);

    expect(watched).toEqual([
      ['bun', '/', 'weekly'],
      ['github-actions', '/', 'weekly'],
    ]);
  });

  it('names only documented ecosystems, intervals and update keys', () => {
    for (const entry of config.updates) {
      expect(DOCUMENTED_ECOSYSTEMS.has(entry['package-ecosystem'])).toBe(true);
      expect(DOCUMENTED_INTERVALS.has(entry.schedule.interval)).toBe(true);
      for (const key of Object.keys(entry)) {
        expect(DOCUMENTED_UPDATE_KEYS.has(key)).toBe(true);
      }
    }
  });

  it('groups the bun minor and patch updates into one pull request', () => {
    const bun = config.updates.find((entry) => entry['package-ecosystem'] === 'bun');
    const groups = Object.values(bun?.groups ?? {});

    expect(groups).toHaveLength(1);
    const updateTypes = groups[0]?.['update-types'] ?? [];

    expect([...updateTypes].sort()).toEqual(['minor', 'patch']);
    for (const type of updateTypes) {
      expect(DOCUMENTED_GROUP_UPDATE_TYPES.has(type)).toBe(true);
    }
  });
});
