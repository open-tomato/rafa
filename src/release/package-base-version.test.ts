/**
 * Tests for `package-base-version.ts`: the version case and the four
 * problem lines, each over a scripted git runner that answers the root
 * manifest, the tree listing and each member manifest at one commit.
 *
 * The problem lines are pinned word for word, since the guard and the
 * pull request body's forecast must say the same thing. The version
 * case is paired with a control on the same tree asking for another
 * member, so a reading that ignored the name would show there.
 */
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';

import { describe, expect, it } from 'bun:test';

import { packageBaseVersionAt } from './package-base-version.js';

/** The commit every case reads at. */
const COMMIT = 'abc1234';

/** The base every case names. */
const BASE = { ref: 'origin/main', commit: COMMIT };

/** A manifest's text from its fields. */
function manifest(fields: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(fields, null, 2)}\n`;
}

/** The root manifest of every workspace case. */
const ROOT = manifest({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] });

/** The member manifests every workspace case holds, by path. */
const MEMBERS: Readonly<Record<string, string>> = {
  'packages/plugin/package.json': manifest({ name: '@x/plugin', version: ' 2.3.4 ' }),
  'packages/other/package.json': manifest({ name: '@x/other', version: '0.9.0' }),
  'packages/core/package.json': manifest({ name: '@x/core', version: '0.1.0', private: true }),
  'packages/bare/package.json': manifest({ name: '@x/bare' }),
};

/** A runner answering `files` at {@link COMMIT} the way `git show` and `git ls-tree` would. */
function scriptedGit(files: Readonly<Record<string, string>>): GitRunner {
  return (args): GitResult => {
    if (args[0] === 'show') {
      const [commit, path] = (args[1] ?? '').split(/:(.*)/su);
      const text = commit === COMMIT && path !== undefined
        ? files[path]
        : undefined;
      return text === undefined
        ? { ok: false, stdout: '', stderr: `fatal: invalid object name '${args[1] ?? ''}'.\n` }
        : { ok: true, stdout: text, stderr: '' };
    }
    if (args[0] === 'ls-tree' && args.at(-1) === COMMIT) {
      return { ok: true, stdout: `${Object.keys(files).join('\0')}\0`, stderr: '' };
    }
    return { ok: false, stdout: '', stderr: `fatal: unscripted git ${args.join(' ')}\n` };
  };
}

/** The workspace every case but the unreadable one reads. */
const workspaceGit = scriptedGit({ 'package.json': ROOT, ...MEMBERS });

describe('packageBaseVersionAt', () => {
  it('answers the member manifest version at the base commit, trimmed', () => {
    expect(packageBaseVersionAt({ git: workspaceGit, base: BASE, package: '@x/plugin' })).toEqual({ version: '2.3.4' });
  });

  it('answers another member its own version on the same tree (control)', () => {
    expect(packageBaseVersionAt({ git: workspaceGit, base: BASE, package: '@x/other' })).toEqual({ version: '0.9.0' });
  });

  it('answers the unreadable workspace line with the reader problem after a colon', () => {
    const git = scriptedGit({});

    const answer = packageBaseVersionAt({ git, base: BASE, package: '@x/plugin' });

    expect(answer).toEqual({
      problem: 'origin/main\'s workspace could not be read for @x/plugin, so no forecast was folded: '
        + `${COMMIT}:package.json could not be read: fatal: invalid object name '${COMMIT}:package.json'.`,
    });
  });

  it('answers the no-such-package line for a name the workspace lacks', () => {
    expect(packageBaseVersionAt({ git: workspaceGit, base: BASE, package: '@x/absent' })).toEqual({
      problem: 'origin/main\'s workspace holds no package @x/absent, so no forecast was folded',
    });
  });

  it('answers the no-such-package line for a root with no workspaces', () => {
    const git = scriptedGit({ 'package.json': manifest({ name: 'root', version: '1.0.0' }) });

    expect(packageBaseVersionAt({ git, base: BASE, package: '@x/plugin' })).toEqual({
      problem: 'origin/main\'s workspace holds no package @x/plugin, so no forecast was folded',
    });
  });

  it('answers the private line naming the member manifest', () => {
    expect(packageBaseVersionAt({ git: workspaceGit, base: BASE, package: '@x/core' })).toEqual({
      problem: 'origin/main declares @x/core private in packages/core/package.json, so no forecast was folded',
    });
  });

  it('answers the no-version line naming the member manifest', () => {
    expect(packageBaseVersionAt({ git: workspaceGit, base: BASE, package: '@x/bare' })).toEqual({
      problem: 'origin/main declares no version for @x/bare in packages/bare/package.json, so no forecast was folded',
    });
  });
});
