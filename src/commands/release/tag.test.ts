/**
 * Tests for `rafa release tag` (`tag.ts`): the branch reading, the
 * decision the readings make, the tag it writes, the three refusals the
 * spec asks for and the two that keep an unreadable input from passing,
 * a run over a workspace that tags every unit after every decision, and
 * the lines a run that tagged prints. The version and changelog readers
 * are `tag-units.ts`'s, tested in `tag-units.test.ts`.
 *
 * The decision is pure and total, so every combination of the readings
 * is driven from literals: provoking a real repository into a tag list
 * that could not be read, or into a changelog that disagrees with its
 * manifest, would measure the planting rather than this module.
 *
 * The readings that touch a disk get a directory of their own under
 * this file's temporary base, and the dispatch cases run over a git
 * seam that answers from a table and RECORDS every command it was
 * given. That record is this file's main control: a refused run is
 * known to have written nothing because no `git tag` is in it, which a
 * reading of the exit code alone could not tell from a tag that was
 * written and then reported as a refusal.
 *
 * More controls carry readings that would otherwise pass while
 * wrong:
 *
 *   - the changelog fixture opens with a FENCED `## 9.9.9` heading
 *     above its newest real section, so a fence skip that stopped
 *     working would name 9.9.9 as the newest release and redden;
 *   - the private-package case is paired with the same manifest
 *     without `"private": true`, which DOES get a publish line;
 *   - the workspace case whose package refuses holds a root that alone
 *     would be ready, so its missing write is the refusal's doing, and
 *     the package that passes over the root's tag of its version is
 *     paired with the same tags refusing the root;
 *   - the manifest names `packageManager: bun@…`, as this repository's
 *     does, and the dispatched run still prints `npm publish`, so a
 *     publish line read off that field again would redden;
 *   - cases run against a real git repository through the default
 *     seams, so `git tag <tag> <commit>` is known to write a tag git
 *     then lists, a second run refuses on the tag the first wrote, and
 *     a history with commits past the release is known to put the tag
 *     on the commit that set the version rather than on HEAD — the
 *     0.24.0 shape `./release-commit.ts` measures.
 */
import type { ReleaseSeams } from './status.js';
import type { PublishTarget } from './tag-follow-ups.js';
import type {
  ReleaseTagResult,
  ReleaseTagUnit,
  TagDecision,
  TagInputs,
  TagReady,
  TagRefused,
} from './tag.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { ReleaseTag } from '../../release/status-readings.js';
import type { TagPushed } from '../../release/tag-push.js';
import type { PlantedProject } from '../../tests/cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';
import type { CliEvent } from '@open-tomato/rafa/ports';

import '../../adapter-registry.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseSemanticVersion, RELEASE_REMOTE } from '../../release/version.js';
import { dispatchInProject, eventsOf, plantProject, plantScratchRepo } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { DEFAULT_REGISTRY, followUpsFor } from './tag-follow-ups.js';
import {
  createReleaseTagCommand,
  DEFAULT_RELEASE_BRANCH,
  decideTag,
  readBranch,
  RELEASE_TAG_USAGE,
  pastReleaseWarning,
  renderTagged,
} from './tag.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-tag-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many scratch directories this file has made, so each gets its own. */
let scratchCount = 0;

/** A directory of this case's own, under the temporary base. */
function scratch(): string {
  scratchCount += 1;
  const path = join(tempBase, `case-${scratchCount}`);
  mkdirSync(path, { recursive: true });
  return path;
}

/** The subject the command routes under in this file's registry. */
const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The version this file's repositories are about to release. */
const VERSION = '0.5.0';

/** The tag that names it. */
const TAG = `v${VERSION}`;

/** The commit a planted history says set {@link VERSION}, which is HEAD unless a case says otherwise. */
const SET_COMMIT = '7db04a24932a061f36518918f1e776a67cd601f8';

/** The decision a run that tags {@link SET_COMMIT}, with HEAD on it, makes. */
const READY: TagReady = Object.freeze({ kind: 'ready', version: VERSION, tag: TAG, commit: SET_COMMIT, ahead: 0 });

/** The publish command `release.publishCommand` names when no layer sets it. */
const DEFAULT_PUBLISH = 'npm publish';

/** A manifest shaped like this repository's own, `packageManager` included; see the module note. */
const MANIFEST = JSON.stringify({
  name: '@open-tomato/rafa',
  version: VERSION,
  packageManager: 'bun@1.3.14',
  publishConfig: { access: 'public' },
});

/**
 * A changelog whose newest real section names {@link VERSION}, opening
 * with a fenced heading that is not a release; see the module note's
 * controls.
 */
const CHANGELOG = [
  '# Changelog',
  '',
  'Every release of rafa, newest first.',
  '',
  '```markdown',
  '## 9.9.9 — an example heading, which is not a release',
  '```',
  '',
  `## ${VERSION} — 2026-09-20, rafa-21: the changelog and the release`,
  '',
  '- release: `rafa release tag` tags the merged release',
  '',
  '## 0.4.0 — 2026-09-01, rafa-20: the pull request commands',
  '',
].join('\n');

/** A version parsed, for a tag literal. */
function version(raw: string): ReturnType<typeof parseSemanticVersion> {
  const parsed = parseSemanticVersion(raw);
  if (parsed === null) throw new Error(`the case wrote no version: ${raw}`);
  return parsed;
}

/** A release tag, as `release status` reads one. */
function tag(raw: string): ReleaseTag {
  const bare = raw.startsWith('v')
    ? raw.slice(1)
    : raw;
  const parsed = version(bare);
  if (parsed === null) throw new Error(`the case wrote no version: ${raw}`);
  return { tag: raw, package: null, version: bare, parsed };
}

/** A git result git writes for a command that worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A git result git writes for one that did not. */
function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** What a fake git answers each command, keyed by the words joined with a space. */
type GitTable = Readonly<Record<string, GitResult>>;

/** The four readings a decision is made from, all agreeing, narrowed by `over`. */
function inputs(over: Partial<TagInputs> = {}): TagInputs {
  return {
    releaseBranch: DEFAULT_RELEASE_BRANCH,
    branch: { branch: DEFAULT_RELEASE_BRANCH, problem: null },
    package: null,
    version: { path: 'package.json', text: MANIFEST, version: VERSION, problem: null },
    changelog: { path: 'CHANGELOG.md', version: VERSION, problem: null },
    tags: { tags: [tag('v0.4.0')], latest: tag('v0.4.0'), problem: null },
    release: { commit: SET_COMMIT, ahead: 0, problem: null },
    receipt: { kind: 'receipted', ids: ['rafa-21'] },
    ...over,
  };
}

/** A publish target, narrowed by `over`. */
function target(over: Partial<PublishTarget> = {}): PublishTarget {
  return { registry: DEFAULT_REGISTRY, name: '@open-tomato/rafa', isPrivate: false, ...over };
}

/** The seams a dispatch case runs with, and what they recorded. */
interface RecordedSeams {
  readonly seams: ReleaseSeams;
  /** The roots a git runner was made for, in call order. */
  readonly roots: string[];
  /** Every git command the run sent, its words joined with a space, in order. */
  readonly calls: string[];
}

/** Seams over `table`, recording every runner made and every command sent. */
function recorded(table: GitTable): RecordedSeams {
  const roots: string[] = [];
  const calls: string[] = [];
  const git: GitRunner = (args) => {
    calls.push(args.join(' '));
    return table[args.join(' ')] ?? refused(`the case planted no answer for git ${args.join(' ')}`);
  };
  return {
    roots,
    calls,
    seams: {
      git: (root) => {
        roots.push(root);
        return git;
      },
    },
  };
}

/**
 * The git table a run that tags answers from: a branch, a tag list, a
 * history in which {@link SET_COMMIT} set the version and HEAD is
 * `ahead` commits past it, and the write.
 */
function gitTable(
  branch = DEFAULT_RELEASE_BRANCH,
  tags = 'v0.4.0\n',
  write: GitResult = said(''),
  ahead = 0,
): GitTable {
  return {
    'rev-parse --abbrev-ref HEAD': said(`${branch}\n`),
    'tag --list': said(tags),
    'log --first-parent --format=%H HEAD -- ./package.json': said(`${SET_COMMIT}\n`),
    [`show ${SET_COMMIT}:./package.json`]: said(MANIFEST),
    [`rev-list --count --first-parent ${SET_COMMIT}..HEAD`]: said(`${String(ahead)}\n`),
    [`tag ${TAG} ${SET_COMMIT}`]: write,
  };
}

/** A project holding the manifest and the changelog of a release about to be tagged. */
function releaseProject(manifest = MANIFEST, changelog = CHANGELOG): PlantedProject {
  const project = plantProject(scratch());
  writeFileSync(join(project.root, 'package.json'), manifest, 'utf8');
  writeFileSync(join(project.root, 'CHANGELOG.md'), changelog, 'utf8');
  return project;
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

/** Dispatches `rafa release tag` with `words` after it, over `seams`, in `project`. */
async function ran(
  seams: ReleaseSeams,
  project: PlantedProject,
  words: readonly string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string; events: CliEvent[] }> {
  const command: RafaCommand = createReleaseTagCommand(seams);
  const run = await dispatchInProject(['release', 'tag', ...words], SUBJECTS, [command], project);
  return {
    ...run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
  };
}

describe('the branch reading', () => {
  it('answers the branch git names, with no problem', () => {
    const reading = readBranch(() => said('main\n'));

    expect(reading).toEqual({ branch: 'main', problem: null });
  });

  it('answers no branch for a detached HEAD, which git spells HEAD', () => {
    const reading = readBranch(() => said('HEAD\n'));

    expect(reading.branch).toBeNull();
    expect(reading.problem).toContain('detached HEAD');
  });

  it('answers no branch, and what git said, for a git that refused', () => {
    const reading = readBranch(() => refused('fatal: not a git repository'));

    expect(reading.branch).toBeNull();
    expect(reading.problem).toContain('fatal: not a git repository');
  });
});

describe('the decision one run makes', () => {
  /** The refusal `decision` is, or a throw naming what it was instead. */
  function refusalOf(decision: TagDecision): TagRefused {
    if (decision.kind !== 'refused') throw new Error(`the case expected a refusal, got ${decision.kind}`);
    return decision;
  }

  it('tags the version both files agree on when no tag names it yet', () => {
    expect(decideTag(inputs())).toEqual(READY);
  });

  it('refuses when another branch is checked out, naming both branches', () => {
    const refusal = refusalOf(decideTag(inputs({ branch: { branch: 'feat/rafa-21', problem: null } })));

    expect(refusal.reason).toBe('branch');
    expect(refusal.message).toContain('feat/rafa-21');
    expect(refusal.message).toContain(DEFAULT_RELEASE_BRANCH);
  });

  it('refuses when no branch is checked out at all, and says which one it wanted', () => {
    const refusal = refusalOf(decideTag(inputs({
      branch: { branch: null, problem: 'no branch is checked out, so this is a detached HEAD' },
    })));

    expect(refusal.reason).toBe('branch');
    expect(refusal.message).toBe('no branch is checked out, so this is a detached HEAD,'
      + ` and a release is tagged on ${DEFAULT_RELEASE_BRANCH}`);
  });

  it('tags on the branch the caller names, which need not be main', () => {
    const decision = decideTag(inputs({ releaseBranch: 'master', branch: { branch: 'master', problem: null } }));

    expect(decision).toEqual(READY);
  });

  it('refuses when the version file declares no version, and says why it could not be read', () => {
    const refusal = refusalOf(decideTag(inputs({
      version: { path: 'package.json', text: null, version: null, problem: 'the version file could not be read' },
    })));

    expect(refusal.reason).toBe('version');
    expect(refusal.message).toBe('the version file could not be read');
  });

  it('refuses when the tag list could not be read, rather than tagging over a tag it cannot see', () => {
    const refusal = refusalOf(decideTag(inputs({
      tags: { tags: [], latest: null, problem: 'the tags could not be listed: fatal: not a git repository' },
    })));

    expect(refusal.reason).toBe('git');
    expect(refusal.message).toContain('the tags could not be listed');
  });

  it('refuses when a tag already names that version, naming the tag it found', () => {
    const refusal = refusalOf(decideTag(inputs({ tags: { tags: [tag(TAG)], latest: tag(TAG), problem: null } })));

    expect(refusal.reason).toBe('tagged');
    expect(refusal.message).toBe(`${TAG} already names ${VERSION}, so there is nothing to tag`);
  });

  it('refuses for a tag naming the version without the v, as release status reads one', () => {
    const bare = tag(VERSION);
    const refusal = refusalOf(decideTag(inputs({ tags: { tags: [bare], latest: bare, problem: null } })));

    expect(refusal.reason).toBe('tagged');
    expect(refusal.message).toBe(`${VERSION} already names ${VERSION}, so there is nothing to tag`);
  });

  it('does not refuse for a package\'s tag naming the same version, which is no root tag', () => {
    const plugin = { ...tag(VERSION), tag: `@scope/plugin@${VERSION}`, package: '@scope/plugin' };

    expect(decideTag(inputs({ tags: { tags: [plugin, tag('v0.4.0')], latest: tag('v0.4.0'), problem: null } })))
      .toEqual(READY);
  });

  it('spells a package\'s tag with its name, and passes over the root\'s tag of the same version', () => {
    const decision = decideTag(inputs({
      package: '@scope/plugin',
      tags: { tags: [tag(TAG)], latest: tag(TAG), problem: null },
    }));

    // The control: the same tags refuse the root, so the package's pass is its own reading.
    expect(refusalOf(decideTag(inputs({ tags: { tags: [tag(TAG)], latest: tag(TAG), problem: null } }))).reason)
      .toBe('tagged');
    expect(decision).toEqual({ ...READY, tag: `@scope/plugin@${VERSION}` });
  });

  it('refuses tagged for a package whose own tag names its version', () => {
    const plugin = { ...tag(VERSION), tag: `@scope/plugin@${VERSION}`, package: '@scope/plugin' };

    const refusal = refusalOf(decideTag(inputs({
      package: '@scope/plugin',
      tags: { tags: [plugin], latest: plugin, problem: null },
    })));

    expect(refusal).toEqual({
      kind: 'refused',
      reason: 'tagged',
      message: `@scope/plugin@${VERSION} already names ${VERSION}, so there is nothing to tag`,
    });
  });

  it('refuses when the newest changelog section names another version, naming both files', () => {
    const refusal = refusalOf(decideTag(inputs({
      changelog: { path: 'CHANGELOG.md', version: '0.4.0', problem: null },
    })));

    expect(refusal.reason).toBe('changelog');
    expect(refusal.message).toBe(`package.json says ${VERSION} and the newest section of CHANGELOG.md says 0.4.0`);
  });

  it('refuses when the changelog names no release at all', () => {
    const refusal = refusalOf(decideTag(inputs({
      changelog: { path: 'CHANGELOG.md', version: null, problem: null },
    })));

    expect(refusal.reason).toBe('changelog');
    expect(refusal.message).toContain('names no release');
  });

  it('refuses when the changelog could not be read', () => {
    const refusal = refusalOf(decideTag(inputs({
      changelog: { path: 'CHANGELOG.md', version: null, problem: 'the changelog could not be read at /x' },
    })));

    expect(refusal.reason).toBe('changelog');
    expect(refusal.message).toBe('the changelog could not be read at /x');
  });

  it('tags the commit that set the version, carrying how far HEAD is past it', () => {
    const decision = decideTag(inputs({ release: { commit: SET_COMMIT, ahead: 3, problem: null } }));

    expect(decision).toEqual({ ...READY, ahead: 3 });
  });

  it('refuses with the version reason when no commit holds the version yet', () => {
    const message = 'package.json says 0.5.0, and the last commit on this branch that changed it says 0.4.0;'
      + ' commit the version before tagging it';
    const refusal = refusalOf(decideTag(inputs({
      release: { commit: null, ahead: 0, problem: { reason: 'version', message } },
    })));

    expect(refusal).toEqual({ kind: 'refused', reason: 'version', message });
  });

  it('refuses with the git reason when the history could not be walked', () => {
    const refusal = refusalOf(decideTag(inputs({
      release: { commit: null, ahead: 0, problem: { reason: 'git', message: 'the history could not be read' } },
    })));

    expect(refusal.reason).toBe('git');
  });

  it('refuses for the changelog before the release commit, which is only about where the tag goes', () => {
    const refusal = refusalOf(decideTag(inputs({
      changelog: { path: 'CHANGELOG.md', version: '0.4.0', problem: null },
      release: { commit: null, ahead: 0, problem: { reason: 'git', message: 'the history could not be read' } },
    })));

    expect(refusal.reason).toBe('changelog');
  });

  it('refuses for the branch first when every reading is wrong, which is the order it checks in', () => {
    const refusal = refusalOf(decideTag(inputs({
      branch: { branch: 'feat/rafa-21', problem: null },
      version: { path: 'package.json', text: null, version: null, problem: 'no version' },
      changelog: { path: 'CHANGELOG.md', version: '0.4.0', problem: null },
      tags: { tags: [tag(TAG)], latest: tag(TAG), problem: null },
    })));

    expect(refusal.reason).toBe('branch');
  });

  it('refuses for the version before the tag, so a reading it needs is never taken as done', () => {
    const refusal = refusalOf(decideTag(inputs({
      version: { path: 'package.json', text: null, version: null, problem: 'no version' },
      tags: { tags: [tag(TAG)], latest: tag(TAG), problem: null },
    })));

    expect(refusal.reason).toBe('version');
  });
});

/** A unit of a run that tagged: the root's, ready on HEAD, narrowed by `over`. */
function unit(over: Partial<ReleaseTagUnit> = {}): ReleaseTagUnit {
  return { package: null, dir: null, inputs: inputs(), decision: READY, followUps: [], ...over };
}

/** The tag a package unit of the render cases writes. */
const PLUGIN_TAG = '@scope/plugin@0.2.0';

/** The decision of a package unit ready on HEAD. */
const PLUGIN_READY: TagReady = Object.freeze({ ...READY, version: '0.2.0', tag: PLUGIN_TAG });

describe('the lines a run that tagged prints', () => {
  it('names the tag, the branch, and every follow-up under one heading', () => {
    const lines = renderTagged(
      [unit({ followUps: followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH) })],
      'main',
    );

    expect(lines).toEqual([
      `✅ Tagged ${TAG} at the HEAD of main.`,
      'Next:',
      `  git push ${RELEASE_REMOTE} ${TAG} — the tag is local until ${RELEASE_REMOTE} has it`,
      `  ${DEFAULT_PUBLISH} — publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`,
    ]);
  });

  it('names the push under the tag once it went, with no push line among the follow-ups', () => {
    const pushed: TagPushed = { outcome: 'pushed', exitCode: 0, tag: TAG, remote: 'upstream', sentence: '' };
    const onHead = { ahead: 0, branch: 'main' };
    const followUps = followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, onHead, null);

    expect(renderTagged([unit({ followUps, pushed })], 'main'))
      .toEqual([
        `✅ Tagged ${TAG} at the HEAD of main.`,
        `✅ Pushed ${TAG} to upstream.`,
        'Next:',
        `  ${DEFAULT_PUBLISH} — publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`,
      ]);
    expect(renderTagged([unit({ pushed })], 'main')).toEqual([
      `✅ Tagged ${TAG} at the HEAD of main.`,
      `✅ Pushed ${TAG} to upstream.`,
    ]);
  });

  it('prints one Tagged line per tag in unit order, then every unit\'s follow-ups, the package\'s in its folder', () => {
    const root = unit({ followUps: followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH) });
    const place = { ahead: 0, branch: 'main', dir: 'packages/plugin' };
    const plugin = unit({
      package: '@scope/plugin',
      dir: 'packages/plugin',
      decision: PLUGIN_READY,
      followUps: followUpsFor(PLUGIN_TAG, '0.2.0', target({ name: '@scope/plugin' }), DEFAULT_PUBLISH, place),
    });

    expect(renderTagged([root, plugin], 'main')).toEqual([
      `✅ Tagged ${TAG} at the HEAD of main.`,
      `✅ Tagged ${PLUGIN_TAG} at the HEAD of main.`,
      'Next:',
      `  git push ${RELEASE_REMOTE} ${TAG} — the tag is local until ${RELEASE_REMOTE} has it`,
      `  ${DEFAULT_PUBLISH} — publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`,
      `  git push ${RELEASE_REMOTE} ${PLUGIN_TAG} — the tag is local until ${RELEASE_REMOTE} has it`,
      `  (cd packages/plugin && ${DEFAULT_PUBLISH}) — publishes @scope/plugin@0.2.0 to ${DEFAULT_REGISTRY}`,
    ]);
  });

  it('names a skipped unit in its place, with no follow-ups of its own', () => {
    const skipped = unit({ decision: { kind: 'skipped', message: `${TAG} already names ${VERSION}, so there is nothing to tag` } });
    const plugin = unit({ package: '@scope/plugin', dir: 'packages/plugin', decision: PLUGIN_READY });

    expect(renderTagged([skipped, plugin], 'main')).toEqual([
      `Skipped: ${TAG} already names ${VERSION}, so there is nothing to tag.`,
      `✅ Tagged ${PLUGIN_TAG} at the HEAD of main.`,
    ]);
  });
});

describe('a tag written behind HEAD', () => {
  const behind: TagReady = { ...READY, ahead: 3 };

  it('warns how far HEAD is past the tagged commit, and says nothing when HEAD is the tagged commit', () => {
    expect(pastReleaseWarning(READY, 'main')).toBeNull();
    expect(pastReleaseWarning(behind, 'main'))
      .toBe(`HEAD of main is 3 commits past 7db04a2, where ${VERSION} was set; they are not in ${TAG}.`);
    expect(pastReleaseWarning({ ...READY, ahead: 1 }, 'main'))
      .toBe(`HEAD of main is 1 commit past 7db04a2, where ${VERSION} was set; they are not in ${TAG}.`);
  });

  it('spells the publish line to publish the tagged tree and switch back to the branch', () => {
    expect(followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, { ahead: 3, branch: 'main' })).toEqual([
      { command: `git push ${RELEASE_REMOTE} ${TAG}`, why: `the tag is local until ${RELEASE_REMOTE} has it` },
      {
        command: `git switch --detach ${TAG} && ${DEFAULT_PUBLISH} && git switch main`,
        why: `publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY} from the tagged commit, not HEAD;`
          + ` skip it if ${DEFAULT_REGISTRY} has that version already`,
      },
    ]);
  });

  it('names the commit it tagged in place of the HEAD of the branch', () => {
    const lines = renderTagged([unit({ decision: behind })], 'main');

    expect(lines[0]).toBe(`✅ Tagged ${TAG} at 7db04a2, the commit of main that set ${VERSION}.`);
  });
});

describe('the dispatched action', () => {
  it('writes the tag on the commit that set the version, HEAD here, and prints the push and the publish line', async () => {
    const seams = recorded(gitTable());

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`✅ Tagged ${TAG} at the HEAD of ${DEFAULT_RELEASE_BRANCH}.`);
    expect(run.stdout).toContain(`git push ${RELEASE_REMOTE} ${TAG}`);
    expect(run.stdout).toContain(`${DEFAULT_PUBLISH} — publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`);
    expect(run.stdout).not.toContain('bun publish');
    expect(seams.calls).toContain(`tag ${TAG} ${SET_COMMIT}`);
  });

  it('prints the publish command release.publishCommand names, from the tag too', async () => {
    const project = plantProject(scratch(), 'release:\n  publishCommand: pnpm publish --tag next\n');
    writeFileSync(join(project.root, 'package.json'), MANIFEST, 'utf8');
    writeFileSync(join(project.root, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    const seams = recorded(gitTable(DEFAULT_RELEASE_BRANCH, 'v0.4.0\n', said(''), 3));

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`git switch --detach ${TAG} && pnpm publish --tag next && git switch main`);
  });

  it('tags the commit that set the version when HEAD is past it, warning and publishing from the tag', async () => {
    const seams = recorded(gitTable(DEFAULT_RELEASE_BRANCH, 'v0.4.0\n', said(''), 3));

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(0);
    expect(seams.calls).toContain(`tag ${TAG} ${SET_COMMIT}`);
    expect(run.stdout).toContain(`HEAD of main is 3 commits past 7db04a2, where ${VERSION} was set`);
    expect(run.stdout).toContain(`✅ Tagged ${TAG} at 7db04a2, the commit of main that set ${VERSION}.`);
    expect(run.stdout).toContain(`git switch --detach ${TAG} && ${DEFAULT_PUBLISH} && git switch main`);
  });

  it('makes its git runner for the project the dispatcher resolved', async () => {
    const project = releaseProject();
    const seams = recorded(gitTable());

    await ran(seams.seams, project);

    expect(seams.roots).toEqual([project.root]);
  });

  it('refuses on another branch with exit code 1, and sends no git tag', async () => {
    const seams = recorded(gitTable('feat/rafa-21-changelog-and-release'));

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('a release is tagged on main');
    expect(run.stderr).toContain(RELEASE_TAG_USAGE);
    expect(seams.calls.filter((call) => call.startsWith('tag v'))).toEqual([]);
  });

  it('refuses when the tag already exists, and sends no git tag', async () => {
    const seams = recorded(gitTable(DEFAULT_RELEASE_BRANCH, `v0.4.0\n${TAG}\n`));

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`${TAG} already names ${VERSION}`);
    expect(seams.calls.filter((call) => call.startsWith('tag v'))).toEqual([]);
  });

  it('refuses when the changelog newest section names another version, and sends no git tag', async () => {
    const changelog = '# Changelog\n\n## 0.4.0 — 2026-09-01, an older release\n';
    const seams = recorded(gitTable());

    const run = await ran(seams.seams, releaseProject(MANIFEST, changelog));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('package.json says 0.5.0 and the newest section of CHANGELOG.md says 0.4.0');
    expect(seams.calls.filter((call) => call.startsWith('tag v'))).toEqual([]);
  });

  it('refuses with what git said when the tag could not be written', async () => {
    const seams = recorded(gitTable(DEFAULT_RELEASE_BRANCH, 'v0.4.0\n', refused('fatal: tag already exists')));

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`${TAG} could not be written: fatal: tag already exists`);
  });

  it('gives the readings, what was written and the follow-ups as the result event\'s data in json mode', async () => {
    const seams = recorded(gitTable());

    const run = await ran(seams.seams, releaseProject(), ['--output=json']);
    const data = dataOf(run.events) as ReleaseTagResult;

    expect(run.exitCode).toBe(0);
    expect(data.written).toEqual(READY);
    expect(data.inputs.branch.branch).toBe(DEFAULT_RELEASE_BRANCH);
    expect(data.inputs.changelog.version).toBe(VERSION);
    expect(data.followUps.map((followUp) => followUp.command))
      .toEqual([`git push ${RELEASE_REMOTE} ${TAG}`, DEFAULT_PUBLISH]);
    expect(Object.keys(data)).toEqual(['inputs', 'written', 'followUps', 'units']);
    expect(data.units.map((each) => [each.package, each.decision.kind])).toEqual([[null, 'ready']]);
  });

  it('sends no push without --push, reading only the remote the push line names', async () => {
    const seams = recorded(gitTable());

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(0);
    expect(seams.calls.filter((call) => call.startsWith('push') || call.startsWith('config')))
      .toEqual(['config --get branch.main.remote']);
  });

  it('names the remote a release branch tracking upstream tracks in the push line without --push', async () => {
    const seams = recorded({ ...gitTable(), 'config --get branch.main.remote': said('upstream\n') });

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`git push upstream ${TAG} — the tag is local until upstream has it`);
    expect(run.stdout).not.toContain(`git push ${RELEASE_REMOTE} ${TAG}`);
  });

  it('names origin in the push line when the release branch tracks nothing', async () => {
    const seams = recorded({ ...gitTable(), 'config --get branch.main.remote': refused('') });

    const run = await ran(seams.seams, releaseProject());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`git push origin ${TAG} — the tag is local until origin has it`);
  });

  it('pushes the tag with --push, giving the push as the result\'s pushed in json mode', async () => {
    const table = {
      ...gitTable(),
      'config --get branch.main.remote': said('origin\n'),
      [`push --porcelain origin refs/tags/${TAG}:refs/tags/${TAG}`]: said(''),
    };
    const seams = recorded(table);

    const run = await ran(seams.seams, releaseProject(), ['--push', '--output=json']);
    const data = dataOf(run.events) as ReleaseTagResult;

    expect(run.exitCode).toBe(0);
    expect(seams.calls.at(-1)).toBe(`push --porcelain origin refs/tags/${TAG}:refs/tags/${TAG}`);
    expect(data.pushed?.remote).toBe('origin');
    expect(data.followUps.map((followUp) => followUp.command)).toEqual([DEFAULT_PUBLISH]);
  });

  it('refuses a value typed after --push with exit code 1, and makes no git runner', async () => {
    const seams = recorded(gitTable());

    const run = await ran(seams.seams, releaseProject(), ['--push=yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--push takes no value');
    expect(seams.roots).toEqual([]);
  });

  it('tags the branch pr.base names rather than main', async () => {
    const project = plantProject(scratch(), 'pr:\n  base: master\n');
    writeFileSync(join(project.root, 'package.json'), MANIFEST, 'utf8');
    writeFileSync(join(project.root, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    const seams = recorded(gitTable('master'));

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('at the HEAD of master.');
    expect(seams.calls).toContain(`tag ${TAG} ${SET_COMMIT}`);
  });

  it('refuses a stray word with exit code 1, and makes no git runner', async () => {
    const seams = recorded(gitTable());

    const run = await ran(seams.seams, releaseProject(), [VERSION]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`Expected no argument, got 1: ${VERSION}`);
    expect(run.stderr).toContain(RELEASE_TAG_USAGE);
    expect(seams.roots).toEqual([]);
  });

  it('refuses a config it cannot use, with exit code 1', async () => {
    const project = plantProject(scratch(), 'release:\n  versionFile: 7\n');
    const seams = recorded(gitTable());

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('The config cannot be used:');
    expect(seams.roots).toEqual([]);
  });
});

describe('a run under release.publish: ci', () => {
  const sentence = `Once pushed, ${TAG} publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`
    + ' through .github/workflows/release-publish.yml (release.publish: ci).';

  /** A release project whose config sets `release.publish` to `mode`. */
  function publishProject(mode: string, manifest = MANIFEST): PlantedProject {
    const project = plantProject(scratch(), `release:\n  publish: ${mode}\n`);
    writeFileSync(join(project.root, 'package.json'), manifest, 'utf8');
    writeFileSync(join(project.root, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    return project;
  }

  it('prints the sentence where the publish line stood, and no publish command', async () => {
    const run = await ran(recorded(gitTable()).seams, publishProject('ci'));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`git push ${RELEASE_REMOTE} ${TAG}`);
    expect(run.stdout).toContain(`  ${sentence}`);
    expect(run.stdout).not.toContain(`${DEFAULT_PUBLISH} — publishes`);
  });

  it('prints the publish command and no sentence under release.publish: manual', async () => {
    const run = await ran(recorded(gitTable()).seams, publishProject('manual'));

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`${DEFAULT_PUBLISH} — publishes @open-tomato/rafa@${VERSION}`);
    expect(run.stdout).not.toContain('release-publish.yml');
  });

  it('carries publish: "ci" on the unit in json, with only the push among its follow-ups', async () => {
    const run = await ran(recorded(gitTable()).seams, publishProject('ci'), ['--output=json']);
    const data = dataOf(run.events) as ReleaseTagResult;

    expect(run.exitCode).toBe(0);
    expect(data.units[0]?.publish).toBe('ci');
    expect(data.units[0]?.followUps.map((each) => each.command)).toEqual([`git push ${RELEASE_REMOTE} ${TAG}`]);
  });

  it('leaves publish out of the unit in json under manual', async () => {
    const run = await ran(recorded(gitTable()).seams, publishProject('manual'), ['--output=json']);
    const data = dataOf(run.events) as ReleaseTagResult;

    expect(data.units[0]).toBeDefined();
    expect(data.units[0]).not.toHaveProperty('publish');
  });

  it('gives a private root neither a sentence nor publish: "ci"', async () => {
    const manifest = JSON.stringify({ name: '@open-tomato/rafa', version: VERSION, private: true });
    const table = { ...gitTable(), [`show ${SET_COMMIT}:./package.json`]: said(manifest) };

    const run = await ran(recorded(table).seams, publishProject('ci', manifest), ['--output=json']);
    const data = dataOf(run.events) as ReleaseTagResult;

    expect(run.exitCode).toBe(0);
    expect(data.units[0]?.decision.kind).toBe('ready');
    expect(data.units[0]).not.toHaveProperty('publish');
  });

  it('renders the sentence after the unit\'s push line, and alone once the tag was pushed', () => {
    const pushed: TagPushed = { outcome: 'pushed', exitCode: 0, tag: TAG, remote: 'origin', sentence: '' };
    const onHead = { ahead: 0, branch: 'main' };
    const followUps = followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, onHead, RELEASE_REMOTE, 'ci');

    expect(renderTagged([unit({ followUps, publish: 'ci' })], 'main')).toEqual([
      `✅ Tagged ${TAG} at the HEAD of main.`,
      'Next:',
      `  git push ${RELEASE_REMOTE} ${TAG} — the tag is local until ${RELEASE_REMOTE} has it`,
      `  ${sentence}`,
    ]);
    expect(renderTagged([unit({ followUps: [], pushed, publish: 'ci' })], 'main')).toEqual([
      `✅ Tagged ${TAG} at the HEAD of main.`,
      `✅ Pushed ${TAG} to origin.`,
      'Next:',
      `  ${sentence}`,
    ]);
  });
});

describe('a run over a workspace', () => {
  /** The package the workspace cases publish, and its folder. */
  const PLUGIN = '@scope/plugin';
  const PLUGIN_DIR = 'packages/plugin';
  const PLUGIN_VERSION = '0.2.0';

  /** The package's manifest, private when asked. */
  function pluginManifest(isPrivate = false): string {
    return JSON.stringify(isPrivate
      ? { name: PLUGIN, version: PLUGIN_VERSION, private: true }
      : { name: PLUGIN, version: PLUGIN_VERSION });
  }

  /** A changelog whose newest section names `version`. */
  function changelogOf(version: string): string {
    return `# Changelog\n\n## ${version} — 2026-10-01, rafa-1172: package publishes\n\n- a change\n`;
  }

  /** A project whose root manifest names `packages/*`, holding the plugin with its own changelog. */
  function workspaceProject(pluginChangelog = changelogOf(PLUGIN_VERSION), isPrivate = false): PlantedProject {
    const project = releaseProject(JSON.stringify({ ...JSON.parse(MANIFEST) as object, workspaces: ['packages/*'] }));
    mkdirSync(join(project.root, PLUGIN_DIR), { recursive: true });
    writeFileSync(join(project.root, PLUGIN_DIR, 'package.json'), pluginManifest(isPrivate), 'utf8');
    writeFileSync(join(project.root, PLUGIN_DIR, 'CHANGELOG.md'), pluginChangelog, 'utf8');
    return project;
  }

  /** {@link gitTable} with the plugin's history, set on the same commit, and its write. */
  function workspaceTable(tags = 'v0.4.0\n', over: GitTable = {}): GitTable {
    return {
      ...gitTable(DEFAULT_RELEASE_BRANCH, tags),
      [`log --first-parent --format=%H HEAD -- ./${PLUGIN_DIR}/package.json`]: said(`${SET_COMMIT}\n`),
      [`show ${SET_COMMIT}:./${PLUGIN_DIR}/package.json`]: said(pluginManifest()),
      [`tag ${PLUGIN}@${PLUGIN_VERSION} ${SET_COMMIT}`]: said(''),
      ...over,
    };
  }

  /** The tag writes a run sent, in order. */
  function writes(calls: readonly string[]): readonly string[] {
    return calls.filter((call) => call.startsWith('tag ') && call !== 'tag --list');
  }

  const pluginTag = `${PLUGIN}@${PLUGIN_VERSION}`;

  it('tags the root and the package in unit order, printing a Tagged line and a publish line for each', async () => {
    const seams = recorded(workspaceTable());

    const run = await ran(seams.seams, workspaceProject());

    expect(run.exitCode).toBe(0);
    expect(writes(seams.calls)).toEqual([`tag ${TAG} ${SET_COMMIT}`, `tag ${pluginTag} ${SET_COMMIT}`]);
    expect(run.stdout).toContain(`✅ Tagged ${TAG} at the HEAD of main.\n✅ Tagged ${pluginTag} at the HEAD of main.`);
    expect(run.stdout).toContain(`  ${DEFAULT_PUBLISH} — publishes @open-tomato/rafa@${VERSION}`);
    expect(run.stdout).toContain(`  git push ${RELEASE_REMOTE} ${pluginTag} — `);
    expect(run.stdout).toContain(`  (cd ${PLUGIN_DIR} && ${DEFAULT_PUBLISH}) — publishes ${pluginTag} to ${DEFAULT_REGISTRY}`);
  });

  it('tags the package alone, and exits 0, when a tag already names the root\'s version', async () => {
    const seams = recorded(workspaceTable(`v0.4.0\n${TAG}\n`));

    const run = await ran(seams.seams, workspaceProject());

    expect(run.exitCode).toBe(0);
    expect(writes(seams.calls)).toEqual([`tag ${pluginTag} ${SET_COMMIT}`]);
    expect(run.stdout).toContain(`Skipped: ${TAG} already names ${VERSION}, so there is nothing to tag.`);
    expect(run.stdout).not.toContain(`Tagged ${TAG}`);
  });

  it('refuses tagged, naming both tags and writing nothing, when every unit is tagged', async () => {
    const seams = recorded(workspaceTable(`${TAG}\n${pluginTag}\n`));

    const run = await ran(seams.seams, workspaceProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ ${TAG} already names ${VERSION}, so there is nothing to tag\n`
      + `❌ ${pluginTag} already names ${PLUGIN_VERSION}, so there is nothing to tag\nUsage: ${RELEASE_TAG_USAGE}`);
    expect(writes(seams.calls)).toEqual([]);
  });

  it('writes no tag at all, the root\'s included, when the package\'s changelog disagrees', async () => {
    const seams = recorded(workspaceTable());

    const run = await ran(seams.seams, workspaceProject(changelogOf('0.1.0')));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`${PLUGIN_DIR}/package.json says ${PLUGIN_VERSION} and the newest section of`
      + ` ${PLUGIN_DIR}/CHANGELOG.md says 0.1.0`);
    // The control: the root alone would have been ready, so its missing write is the refusal's doing.
    expect(run.stderr).not.toContain(TAG);
    expect(writes(seams.calls)).toEqual([]);
  });

  it('reads the branch once and refuses on it before any package is read', async () => {
    const seams = recorded({ ...workspaceTable(), 'rev-parse --abbrev-ref HEAD': said('feat/x\n') });

    const run = await ran(seams.seams, workspaceProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('a release is tagged on main, and feat/x is checked out');
    expect(seams.calls.filter((call) => call === 'rev-parse --abbrev-ref HEAD')).toHaveLength(1);
    expect(seams.calls.filter((call) => call.includes(PLUGIN_DIR))).toEqual([]);
  });

  it('passes over a private member, which never publishes', async () => {
    const seams = recorded(workspaceTable());

    const run = await ran(seams.seams, workspaceProject(changelogOf(PLUGIN_VERSION), true));

    expect(run.exitCode).toBe(0);
    expect(writes(seams.calls)).toEqual([`tag ${TAG} ${SET_COMMIT}`]);
  });

  it('pushes every tag in unit order with --push, giving each unit its push in json mode', async () => {
    const pushOf = (name: string): string => `push --porcelain origin refs/tags/${name}:refs/tags/${name}`;
    const seams = recorded(workspaceTable('v0.4.0\n', { [pushOf(TAG)]: said(''), [pushOf(pluginTag)]: said('') }));

    const run = await ran(seams.seams, workspaceProject(), ['--push', '--output=json']);
    const data = dataOf(run.events) as ReleaseTagResult;

    expect(run.exitCode).toBe(0);
    expect(seams.calls.filter((call) => call.startsWith('push'))).toEqual([pushOf(TAG), pushOf(pluginTag)]);
    expect(data.units.map((each) => each.pushed?.tag)).toEqual([TAG, pluginTag]);
    expect(data.pushed?.tag).toBe(TAG);
    expect(data.written?.tag).toBe(TAG);
    expect(data.followUps.map((followUp) => followUp.command))
      .toEqual([DEFAULT_PUBLISH, `(cd ${PLUGIN_DIR} && ${DEFAULT_PUBLISH})`]);
  });

  it('stops at the first push that fails, naming the tags written and not pushed after it', async () => {
    const pushOf = (name: string): string => `push --porcelain origin refs/tags/${name}:refs/tags/${name}`;
    const seams = recorded(workspaceTable('v0.4.0\n', { [pushOf(TAG)]: refused('rejected') }));

    const run = await ran(seams.seams, workspaceProject(), ['--push']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`${TAG} is written and kept locally, but could not be pushed to origin`);
    expect(run.stderr).toContain(`; ${pluginTag} is written and not pushed`);
    expect(seams.calls.filter((call) => call.startsWith('push'))).toEqual([pushOf(TAG)]);
  });

  it('names the tags written before a write that failed', async () => {
    const seams = recorded(workspaceTable('v0.4.0\n', { [`tag ${pluginTag} ${SET_COMMIT}`]: refused('fatal: bad ref') }));

    const run = await ran(seams.seams, workspaceProject());

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`${pluginTag} could not be written: fatal: bad ref; ${TAG} is written already`);
  });

  it('gives the root as written and every unit in json mode when the root is skipped', async () => {
    const seams = recorded(workspaceTable(`${TAG}\n`));

    const run = await ran(seams.seams, workspaceProject(), ['--output=json']);
    const data = dataOf(run.events) as ReleaseTagResult;

    expect(run.exitCode).toBe(0);
    expect(data.written).toBeNull();
    expect(data.units.map((each) => [each.package, each.dir, each.decision.kind]))
      .toEqual([[null, null, 'skipped'], [PLUGIN, PLUGIN_DIR, 'ready']]);
    expect(data.units[1]?.inputs.version.path).toBe(`${PLUGIN_DIR}/package.json`);
  });
});

describe('what the default seams reach', () => {
  /** Runs git in `repo`, with an identity and a config of this file's own. */
  function gitIn(repo: string, home: string, args: readonly string[]): string {
    return execFileSync('git', [...args], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        ...gitIdentityEnv(),
      },
    });
  }

  it('writes a tag real git then lists, on the commit that is HEAD, and refuses the second time', async () => {
    // Arrange: a real repository on main, with one commit and the two release files.
    const repo = plantScratchRepo(scratch());
    writeFileSync(join(repo.repo, 'package.json'), MANIFEST, 'utf8');
    writeFileSync(join(repo.repo, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    gitIn(repo.repo, repo.home, ['checkout', '-q', '-B', DEFAULT_RELEASE_BRANCH]);
    gitIn(repo.repo, repo.home, ['add', '-A']);
    gitIn(repo.repo, repo.home, ['commit', '-q', '-m', 'chore: release 0.5.0']);
    const head = gitIn(repo.repo, repo.home, ['rev-parse', 'HEAD']).trim();
    const project: PlantedProject = { root: repo.repo, home: repo.home };

    // The control: nothing is tagged before the run.
    expect(gitIn(repo.repo, repo.home, ['tag', '--list']).trim()).toBe('');

    // Act: no seam is replaced, so the run reaches real git.
    const first = await ran({}, project);

    // Assert: git lists the tag, and it names the commit that was HEAD.
    expect(first.exitCode).toBe(0);
    expect(gitIn(repo.repo, repo.home, ['tag', '--list']).trim()).toBe(TAG);
    expect(gitIn(repo.repo, repo.home, ['rev-list', '-n', '1', TAG]).trim()).toBe(head);

    // Act again: the same run over the tag it just wrote.
    const second = await ran({}, project);

    // Assert: refused, and the repository still holds the one tag.
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain(`${TAG} already names ${VERSION}`);
    expect(gitIn(repo.repo, repo.home, ['tag', '--list']).trim()).toBe(TAG);
  });

  it('tags the commit that set the version, not HEAD, when commits landed after it in a real repository', async () => {
    // Arrange: the version is set, then three more commits land on main — the 0.24.0 shape.
    const repo = plantScratchRepo(scratch());
    gitIn(repo.repo, repo.home, ['checkout', '-q', '-B', DEFAULT_RELEASE_BRANCH]);
    writeFileSync(join(repo.repo, 'package.json'), MANIFEST.replace(VERSION, '0.4.0'), 'utf8');
    gitIn(repo.repo, repo.home, ['add', '-A']);
    gitIn(repo.repo, repo.home, ['commit', '-q', '-m', 'chore: release 0.4.0']);
    writeFileSync(join(repo.repo, 'package.json'), MANIFEST, 'utf8');
    writeFileSync(join(repo.repo, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    gitIn(repo.repo, repo.home, ['add', '-A']);
    gitIn(repo.repo, repo.home, ['commit', '-q', '-m', 'chore: release 0.5.0']);
    const set = gitIn(repo.repo, repo.home, ['rev-parse', 'HEAD']).trim();
    for (const name of ['a', 'b', 'c']) {
      writeFileSync(join(repo.repo, `${name}.txt`), `${name}\n`, 'utf8');
      gitIn(repo.repo, repo.home, ['add', '-A']);
      gitIn(repo.repo, repo.home, ['commit', '-q', '-m', `feat: ${name}`]);
    }
    const head = gitIn(repo.repo, repo.home, ['rev-parse', 'HEAD']).trim();

    const run = await ran({}, { root: repo.repo, home: repo.home });

    expect(run.exitCode).toBe(0);
    expect(gitIn(repo.repo, repo.home, ['rev-list', '-n', '1', TAG]).trim()).toBe(set);
    expect(set).not.toBe(head);
    expect(run.stdout).toContain(`HEAD of main is 3 commits past ${set.slice(0, 7)}`);
  });

  it('refuses a version no commit holds yet, and writes no tag, in a real repository', async () => {
    const repo = plantScratchRepo(scratch());
    gitIn(repo.repo, repo.home, ['checkout', '-q', '-B', DEFAULT_RELEASE_BRANCH]);
    writeFileSync(join(repo.repo, 'package.json'), MANIFEST.replace(VERSION, '0.4.0'), 'utf8');
    writeFileSync(join(repo.repo, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    gitIn(repo.repo, repo.home, ['add', '-A']);
    gitIn(repo.repo, repo.home, ['commit', '-q', '-m', 'chore: release 0.4.0']);
    // The bump is in the working tree only.
    writeFileSync(join(repo.repo, 'package.json'), MANIFEST, 'utf8');

    const run = await ran({}, { root: repo.repo, home: repo.home });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('commit the version before tagging it');
    expect(gitIn(repo.repo, repo.home, ['tag', '--list']).trim()).toBe('');
  });

  /** A bare origin beside `repo`, its `pre-receive` hook declining when `refusing`. */
  function bareOrigin(repo: string, home: string, refusing = false): string {
    const origin = `${repo}-origin.git`;
    gitIn(repo, home, ['init', '-q', '--bare', origin]);
    gitIn(origin, home, ['config', 'core.hooksPath', join(origin, 'hooks')]);
    if (refusing) {
      mkdirSync(join(origin, 'hooks'), { recursive: true });
      writeFileSync(join(origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho "tags are frozen here" >&2\nexit 1\n', 'utf8');
      chmodSync(join(origin, 'hooks', 'pre-receive'), 0o755);
    }
    gitIn(repo, home, ['remote', 'add', 'origin', origin]);
    return origin;
  }

  /** A real repository on main holding one release commit, with a bare origin; see {@link bareOrigin}. */
  function releasedRepo(refusing = false): { project: PlantedProject; origin: string; repo: string; home: string } {
    const repo = plantScratchRepo(scratch());
    writeFileSync(join(repo.repo, 'package.json'), MANIFEST, 'utf8');
    writeFileSync(join(repo.repo, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    gitIn(repo.repo, repo.home, ['checkout', '-q', '-B', DEFAULT_RELEASE_BRANCH]);
    gitIn(repo.repo, repo.home, ['add', '-A']);
    gitIn(repo.repo, repo.home, ['commit', '-q', '-m', 'chore: release 0.5.0']);
    const origin = bareOrigin(repo.repo, repo.home, refusing);
    return { project: { root: repo.repo, home: repo.home }, origin, repo: repo.repo, home: repo.home };
  }

  it('pushes nothing to a bare origin without --push, and still names the push line', async () => {
    const world = releasedRepo();

    const run = await ran({}, world.project);

    expect(run.exitCode).toBe(0);
    expect(gitIn(world.repo, world.home, ['tag', '--list']).trim()).toBe(TAG);
    expect(gitIn(world.origin, world.home, ['tag', '--list']).trim()).toBe('');
    expect(run.stdout).toContain(`git push ${RELEASE_REMOTE} ${TAG}`);
  });

  it('names the remote main tracks in the push line without --push, in a real repository', async () => {
    const world = releasedRepo();
    gitIn(world.repo, world.home, ['config', 'branch.main.remote', 'upstream']);

    const run = await ran({}, world.project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`git push upstream ${TAG}`);
    expect(run.stdout).not.toContain(`git push origin ${TAG}`);
  });

  it('puts the tag on the bare origin with --push, on the commit it tagged, and drops the push line', async () => {
    const world = releasedRepo();

    const run = await ran({}, world.project, ['--push']);

    expect(run.exitCode).toBe(0);
    expect(gitIn(world.origin, world.home, ['tag', '--list']).trim()).toBe(TAG);
    expect(gitIn(world.origin, world.home, ['rev-parse', `${TAG}^{commit}`]).trim())
      .toBe(gitIn(world.repo, world.home, ['rev-parse', 'HEAD']).trim());
    expect(run.stdout).toContain(`✅ Pushed ${TAG} to origin.`);
    expect(run.stdout).not.toContain(`git push ${RELEASE_REMOTE} ${TAG}`);
  });

  it('exits 1 naming what git said when the origin refuses the push, and keeps the local tag', async () => {
    const world = releasedRepo(true);

    const run = await ran({}, world.project, ['--push']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`${TAG} is written and kept locally, but could not be pushed to origin`);
    expect(run.stderr).toContain('tags are frozen here');
    expect(run.stdout).not.toContain('✅');
    expect(gitIn(world.repo, world.home, ['tag', '--list']).trim()).toBe(TAG);
    expect(gitIn(world.origin, world.home, ['tag', '--list']).trim()).toBe('');
  });

  it('refuses on a branch that is not the release branch, in a real repository', async () => {
    const repo = plantScratchRepo(scratch());
    writeFileSync(join(repo.repo, 'package.json'), MANIFEST, 'utf8');
    writeFileSync(join(repo.repo, 'CHANGELOG.md'), CHANGELOG, 'utf8');
    gitIn(repo.repo, repo.home, ['checkout', '-q', '-B', 'feat/rafa-21-changelog-and-release']);
    gitIn(repo.repo, repo.home, ['add', '-A']);
    gitIn(repo.repo, repo.home, ['commit', '-q', '-m', 'feat: a change']);

    const run = await ran({}, { root: repo.repo, home: repo.home });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('feat/rafa-21-changelog-and-release');
    expect(gitIn(repo.repo, repo.home, ['tag', '--list']).trim()).toBe('');
  });
});
