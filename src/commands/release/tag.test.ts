/**
 * Tests for `rafa release tag` (`tag.ts`): the four readings, the
 * decision they make, the tag it writes, the three refusals the spec
 * asks for and the two that keep an unreadable input from passing,
 * and the lines a run that tagged prints.
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
 * Three more controls carry readings that would otherwise pass while
 * wrong:
 *
 *   - the changelog fixture opens with a FENCED `## 9.9.9` heading
 *     above its newest real section, so a fence skip that stopped
 *     working would name 9.9.9 as the newest release and redden;
 *   - the private-package case is paired with the same manifest
 *     without `"private": true`, which DOES get a publish line;
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
import type { ReleaseSeams, ReleaseTag } from './status.js';
import type {
  ChangelogReading,
  PublishTarget,
  ReleaseTagResult,
  TagDecision,
  TagInputs,
  TagReady,
  TagRefused,
} from './tag.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent } from '../../ports/index.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseSemanticVersion } from '../../release/version.js';
import { dispatchInProject, eventsOf, plantProject, plantScratchRepo } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import {
  createReleaseTagCommand,
  DEFAULT_RELEASE_BRANCH,
  DEFAULT_REGISTRY,
  decideTag,
  followUpsFor,
  readBranch,
  readNewestRelease,
  readPublishTarget,
  readVersion,
  RELEASE_REMOTE,
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
  return { tag: raw, version: bare, parsed };
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

describe('the version file reading', () => {
  it('reads the version and keeps the text the publish line is read from', () => {
    const root = scratch();
    writeFileSync(join(root, 'package.json'), MANIFEST, 'utf8');

    const reading = readVersion(root, 'package.json');

    expect(reading.version).toBe(VERSION);
    expect(reading.text).toBe(MANIFEST);
    expect(reading.problem).toBeNull();
  });

  it('says where it looked for a version file that is not there', () => {
    const root = scratch();

    const reading = readVersion(root, 'package.json');

    expect(reading.version).toBeNull();
    expect(reading.text).toBeNull();
    expect(reading.problem).toContain(join(root, 'package.json'));
  });

  it('says so for a manifest that declares no version', () => {
    const root = scratch();
    writeFileSync(join(root, 'package.json'), '{"name": "a"}', 'utf8');

    expect(readVersion(root, 'package.json').problem).toContain('declares no version');
  });
});

describe('the changelog reading', () => {
  it('takes the version of the newest section, passing over a fenced heading above it', () => {
    const root = scratch();
    writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG, 'utf8');

    const reading = readNewestRelease(root, 'CHANGELOG.md');

    // The control: the fenced heading names a HIGHER version, so a skip that stopped working would show.
    expect(reading.version).toBe(VERSION);
    expect(reading.problem).toBeNull();
  });

  it('answers no version for a changelog naming no release at all', () => {
    const root = scratch();
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n', 'utf8');

    expect(readNewestRelease(root, 'CHANGELOG.md')).toMatchObject({ version: null, problem: null });
  });

  it('says where it looked for a changelog that is not there', () => {
    const root = scratch();

    const reading: ChangelogReading = readNewestRelease(root, 'CHANGELOG.md');

    expect(reading.version).toBeNull();
    expect(reading.problem).toContain(join(root, 'CHANGELOG.md'));
  });
});

describe('where a publish would go', () => {
  it('reads the name and the registry publishConfig names, and nothing off packageManager', () => {
    const manifest = JSON.stringify({
      name: '@open-tomato/rafa',
      version: VERSION,
      packageManager: 'bun@1.3.14',
      publishConfig: { registry: 'https://npm.example.com' },
    });

    expect(readPublishTarget(manifest)).toEqual({
      registry: 'https://npm.example.com',
      name: '@open-tomato/rafa',
      isPrivate: false,
    });
  });

  it('falls back to the npm registry when the manifest names none', () => {
    expect(readPublishTarget('{"name": "a", "version": "1.0.0"}'))
      .toEqual({ registry: DEFAULT_REGISTRY, name: 'a', isPrivate: false });
  });

  it('reads a private manifest as private', () => {
    expect(readPublishTarget('{"name": "a", "private": true}').isPrivate).toBe(true);
  });

  it('names no package for a text that is no JSON object, and for no text at all', () => {
    expect(readPublishTarget('not json').name).toBeNull();
    expect(readPublishTarget('[]').name).toBeNull();
    expect(readPublishTarget(null).name).toBeNull();
  });
});

describe('what the operator is told to do next', () => {
  it('names the push and the publish, the publish saying what goes where', () => {
    const followUps = followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH);

    expect(followUps.map((followUp) => followUp.command))
      .toEqual([`git push ${RELEASE_REMOTE} ${TAG}`, DEFAULT_PUBLISH]);
    expect(followUps[1]?.why).toBe(`publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`);
  });

  it('names the publish command it is handed, flags and all', () => {
    expect(followUpsFor(TAG, VERSION, target(), 'pnpm publish --tag next')[1]?.command)
      .toBe('pnpm publish --tag next');
  });

  it('names the push alone for a private package, where the same one public gets a publish line', () => {
    expect(followUpsFor(TAG, VERSION, target({ isPrivate: true }), DEFAULT_PUBLISH).map((each) => each.command))
      .toEqual([`git push ${RELEASE_REMOTE} ${TAG}`]);
    expect(followUpsFor(TAG, VERSION, target({ isPrivate: false }), DEFAULT_PUBLISH)).toHaveLength(2);
  });

  it('names the push alone when the version file names no package to publish', () => {
    expect(followUpsFor(TAG, VERSION, target({ name: null }), DEFAULT_PUBLISH)).toHaveLength(1);
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

describe('the lines a run that tagged prints', () => {
  it('names the tag, the branch, and every follow-up under one heading', () => {
    const lines = renderTagged(
      READY,
      'main',
      followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH),
    );

    expect(lines).toEqual([
      `✅ Tagged ${TAG} at the HEAD of main.`,
      'Next:',
      `  git push ${RELEASE_REMOTE} ${TAG} — the tag is local until ${RELEASE_REMOTE} has it`,
      `  ${DEFAULT_PUBLISH} — publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`,
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
    const lines = renderTagged(behind, 'main', followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, { ahead: 3, branch: 'main' }));

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
