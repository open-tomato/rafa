/**
 * Tests for `rafa release status` (`status.ts`): the four readings, the
 * block they render to, the order the tags are put in, which plan the
 * pending notes are read for, and the two refusals.
 *
 * Every pure function here — the version order, the tag reader, the
 * changelog reader, the untagged difference and the renderer — is
 * driven by calling it, because each is total and takes its whole world
 * as an argument. Provoking a real repository into a prerelease
 * ordering or a changelog into a fenced heading would measure git and
 * markdown rather than this module.
 *
 * The readings that touch a disk get a directory of their own under
 * this file's temporary base, and the git seam is a runner that answers
 * from a table, so no case runs `git` and no case reads the real home.
 * One case does the opposite on purpose: it writes change notes through
 * the real store writer and reads them back through the DEFAULT seam,
 * so "the notes come out of the store" is measured once rather than
 * assumed from a stub everywhere.
 *
 * Four controls carry readings that would otherwise pass while wrong:
 *
 *   - the git seam counts the runners it made, so a refused line is
 *     known to have made none;
 *   - the notes seam records every `(root, stub)` it was asked, so
 *     "no plan means no store read" is a reading and not a claim;
 *   - the semver order is asserted against the sequence the semver
 *     specification itself prints, which a plain string sort fails;
 *   - the changelog fixture carries a fenced `## 9.9.9` heading, so
 *     the fence skip is known to be doing something.
 */
import type { ReleaseSeams, ReleaseStatusReading, ReleaseStatusResult } from './status.js';
import type { RafaCommand } from '../../cli/command.js';
import type { PlanChange } from '../../effort/store/changes.js';
import type { CliEvent } from '../../ports/index.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { writeChanges } from '../../effort/store/changes.js';
import { parseSemanticVersion } from '../../release/version.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  changelogVersions,
  compareReleaseTags,
  compareVersions,
  createReleaseStatusCommand,
  NOTHING,
  readPending,
  readTags,
  readUntagged,
  readVersionFile,
  releaseTagsOf,
  RELEASE_STATUS_USAGE,
  renderStatus,
  UNREADABLE,
  untaggedVersions,
} from './status.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-status-')));

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

/** The plan this file's notes are stored under. */
const STUB = 'rafa-21-changelog-and-release';

/** The branch that plan runs on. */
const BRANCH = `feat/${STUB}`;

/** A version parsed, for a comparison case. */
function version(raw: string): ReturnType<typeof parseSemanticVersion> {
  const parsed = parseSemanticVersion(raw);
  if (parsed === null) throw new Error(`the case wrote no version: ${raw}`);
  return parsed;
}

/** A release tag, for an ordering case. */
function tag(raw: string): { tag: string; version: string; parsed: ReturnType<typeof version> } {
  const bare = raw.startsWith('v')
    ? raw.slice(1)
    : raw;
  return { tag: raw, version: bare, parsed: version(bare) };
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

/** A runner answering from `table`, and refusing anything the table does not name. */
function fakeGit(table: GitTable): GitRunner {
  return (args) => table[args.join(' ')] ?? refused(`the case planted no answer for git ${args.join(' ')}`);
}

/** A stored change note, filled from `over`. */
function note(over: Partial<PlanChange> = {}): PlanChange {
  return {
    sessionId: 'session-1',
    taskLine: '- [x] a task',
    level: 'minor',
    area: 'release',
    summary: 'a line a user would understand',
    collectedAt: '2026-09-20T10:00:00.000Z',
    ...over,
  };
}

/** A reading with everything readable, which a rendering case narrows from. */
function reading(over: Partial<ReleaseStatusReading> = {}): ReleaseStatusReading {
  return {
    versionFile: { path: 'package.json', version: '0.5.0', problem: null },
    tags: { tags: [tag('v0.4.0')], latest: tag('v0.4.0'), problem: null },
    untagged: { path: 'CHANGELOG.md', released: ['0.5.0', '0.4.0'], versions: ['0.5.0'], problem: null },
    plan: { stub: STUB, source: 'roster', branch: BRANCH, notes: [note()], level: 'minor', problem: null },
    ...over,
  };
}

/** The lines of a rendered block, blank ones included. */
function linesOf(text: string): readonly string[] {
  return text.split('\n');
}

/** The line of `text` whose first word after the indent is `label`. */
function cellOf(text: string, label: string): string {
  const line = linesOf(text).find((candidate) => candidate.trimStart().startsWith(label));
  if (line === undefined) throw new Error(`no line for ${label} in:\n${text}`);
  const cell = line.trimStart().slice(label.length);
  return cell.trim();
}

/** A project with a config naming the two release files this file plants. */
function freshProject(text = 'release:\n  versionFile: package.json\n  changelog: CHANGELOG.md\n'): PlantedProject {
  return plantProject(scratch(), text);
}

/** The seams a dispatch case runs with, and what they recorded. */
interface RecordedSeams {
  readonly seams: ReleaseSeams;
  /** The roots a git runner was made for, in call order. */
  readonly roots: string[];
  /** Each `<root> <stub>` the notes seam was asked, in call order. */
  readonly asked: string[];
}

/** Seams over `table` and `notes`, recording every call; see the module note's controls. */
function recorded(table: GitTable, notes: readonly PlanChange[] = []): RecordedSeams {
  const roots: string[] = [];
  const asked: string[] = [];
  return {
    roots,
    asked,
    seams: {
      git: (root) => {
        roots.push(root);
        return fakeGit(table);
      },
      readNotes: (root, stub) => {
        asked.push(`${root} ${stub}`);
        return notes;
      },
    },
  };
}

/** The git table a dispatch case runs with: a tag list and a branch. */
function gitTable(tags: string, branch = BRANCH): GitTable {
  return {
    'tag --list': said(tags),
    'rev-parse --abbrev-ref HEAD': said(`${branch}\n`),
  };
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): unknown {
  return (events.at(-1) as { data?: unknown }).data;
}

/** Dispatches `rafa release status` with `words` after it, over `seams`, in `project`. */
async function ran(
  seams: ReleaseSeams,
  project: PlantedProject,
  words: readonly string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string; events: CliEvent[] }> {
  const command: RafaCommand = createReleaseStatusCommand(seams);
  const run = await dispatchInProject(['release', 'status', ...words], SUBJECTS, [command], project);
  return {
    ...run,
    events: words.includes('--output=json')
      ? eventsOf(run.stdout)
      : [],
  };
}

describe('the order two versions are put in', () => {
  it('orders the semver specification\'s own precedence sequence, which a string sort does not', () => {
    // Arrange: the sequence semver's clause 11 prints, shuffled.
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    const shuffled = [...ordered].reverse();

    // Act
    const sorted = [...shuffled].sort((left, right) => compareVersions(version(left), version(right)));

    // Assert: and the control, that a plain string sort gives another answer.
    expect(sorted).toEqual(ordered);
    expect([...shuffled].sort()).not.toEqual(ordered);
  });

  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(version('1.0.0'), version('2.0.0'))).toBeLessThan(0);
    expect(compareVersions(version('1.2.0'), version('1.10.0'))).toBeLessThan(0);
    expect(compareVersions(version('1.2.3'), version('1.2.4'))).toBeLessThan(0);
    expect(compareVersions(version('1.2.3'), version('1.2.3'))).toBe(0);
  });

  it('ignores the build metadata, as semver ignores it', () => {
    expect(compareVersions(version('1.2.3+a'), version('1.2.3+b'))).toBe(0);
  });

  it('puts the highest tag first, which is the reverse of the version order', () => {
    const tags = [tag('v0.4.0'), tag('v1.0.0'), tag('v0.10.0')];

    expect([...tags].sort(compareReleaseTags).map((each) => each.tag))
      .toEqual(['v1.0.0', 'v0.10.0', 'v0.4.0']);
  });
});

describe('the tags read off a tag list', () => {
  it('keeps the tags that name a release, highest first, with or without the v', () => {
    const tags = releaseTagsOf('v0.4.0\n1.0.0\nv0.10.0\n');

    expect(tags.map((each) => each.tag)).toEqual(['1.0.0', 'v0.10.0', 'v0.4.0']);
    expect(tags.map((each) => each.version)).toEqual(['1.0.0', '0.10.0', '0.4.0']);
  });

  it('leaves out a tag that names no version, and a blank line', () => {
    expect(releaseTagsOf('v0.4.0\nrelease-candidate\n\n  \nv1.2\nv01.2.3\n').map((each) => each.tag))
      .toEqual(['v0.4.0']);
  });

  it('answers none for a repository with no tag at all', () => {
    expect(releaseTagsOf('')).toEqual([]);
  });
});

describe('the versions a changelog calls released', () => {
  /** A changelog carrying every shape this reader has to get right. */
  const CHANGELOG = [
    '# Changelog',
    '',
    'Every release of rafa, newest first.',
    '',
    '## 0.5.0 — 2026-09-20, rafa-21: the changelog and the release',
    '',
    '- release: `rafa release status` reports what is pending',
    '',
    '```markdown',
    '## 9.9.9 — an example heading, which is not a release',
    '```',
    '',
    '## Unreleased',
    '',
    '- nothing yet',
    '',
    '### 0.4.1 — 2026-09-10, a patch',
    '',
    '## 0.4.0 — 2026-09-01, rafa-20: the pull request commands',
    '',
    '## 0.5.0 — a repeat of the newest section',
    '',
  ].join('\n');

  it('reads the version out of each heading, in the file\'s order and without repeats', () => {
    expect(changelogVersions(CHANGELOG)).toEqual(['0.5.0', '0.4.1', '0.4.0']);
  });

  it('skips a heading inside a fenced code block', () => {
    // The control: the same heading outside a fence IS read.
    expect(changelogVersions(CHANGELOG)).not.toContain('9.9.9');
    expect(changelogVersions('## 9.9.9 — an example heading')).toEqual(['9.9.9']);
  });

  it('reads no version out of a heading that names none', () => {
    expect(changelogVersions('# Changelog\n\n## Unreleased\n')).toEqual([]);
  });

  it('reads a v-prefixed heading, and does not read a date as a version', () => {
    expect(changelogVersions('## v2.0.0 — 2026-09-20\n')).toEqual(['2.0.0']);
  });

  it('refuses a version with a leading zero and takes the next token that parses', () => {
    expect(changelogVersions('## 01.2.3 and 1.2.3\n')).toEqual(['1.2.3']);
  });

  it('keeps a prerelease and its build metadata whole', () => {
    expect(changelogVersions('## 1.0.0-rc.1+build.5 — 2026-09-20\n')).toEqual(['1.0.0-rc.1+build.5']);
  });
});

describe('the released versions carrying no tag', () => {
  it('answers those of the released versions no tag names, in the released order', () => {
    expect(untaggedVersions(['0.6.0', '0.5.0', '0.4.0'], [tag('v0.4.0'), tag('0.5.0')]))
      .toEqual(['0.6.0']);
  });

  it('answers none when every released version is tagged', () => {
    expect(untaggedVersions(['0.4.0'], [tag('v0.4.0')])).toEqual([]);
  });

  it('answers every released version when the repository holds no tag', () => {
    expect(untaggedVersions(['0.5.0', '0.4.0'], [])).toEqual(['0.5.0', '0.4.0']);
  });
});

describe('the version file read', () => {
  it('answers the version a manifest declares', () => {
    const root = scratch();
    writeFileSync(join(root, 'package.json'), '{\n  "name": "rafa",\n  "version": "0.5.0"\n}', 'utf8');

    expect(readVersionFile(root, 'package.json')).toEqual({
      path: 'package.json',
      version: '0.5.0',
      problem: null,
    });
  });

  it('says the file could not be read when there is none', () => {
    const root = scratch();
    const answer = readVersionFile(root, 'package.json');

    expect(answer.version).toBeNull();
    expect(answer.problem).toBe(`the version file could not be read at ${join(root, 'package.json')}`);
  });

  it('says the file declares no version when its JSON carries none', () => {
    const root = scratch();
    writeFileSync(join(root, 'package.json'), '{"name": "rafa"}', 'utf8');
    const answer = readVersionFile(root, 'package.json');

    expect(answer.version).toBeNull();
    expect(answer.problem).toBe(`${join(root, 'package.json')} declares no version this can read`);
  });

  it('says the same for a file that is no JSON at all', () => {
    const root = scratch();
    writeFileSync(join(root, 'version.txt'), 'version = 0.5.0\n', 'utf8');

    expect(readVersionFile(root, 'version.txt').version).toBeNull();
  });
});

describe('the tag reading', () => {
  it('answers every release tag and the highest of them', () => {
    const answer = readTags(fakeGit({ 'tag --list': said('v0.4.0\nv1.0.0\n') }));

    expect(answer.latest?.tag).toBe('v1.0.0');
    expect(answer.tags).toHaveLength(2);
    expect(answer.problem).toBeNull();
  });

  it('answers no latest tag, and no problem, for a repository with no tag', () => {
    const answer = readTags(fakeGit({ 'tag --list': said('') }));

    expect(answer.latest).toBeNull();
    expect(answer.tags).toEqual([]);
    expect(answer.problem).toBeNull();
  });

  it('carries what git said when the list could not be made', () => {
    const answer = readTags(fakeGit({ 'tag --list': refused('fatal: not a git repository') }));

    expect(answer.latest).toBeNull();
    expect(answer.problem).toBe('the tags could not be listed: fatal: not a git repository');
  });
});

describe('the changelog reading', () => {
  it('answers the released versions and those of them carrying no tag', () => {
    const root = scratch();
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## 0.5.0 — x\n\n## 0.4.0 — y\n', 'utf8');
    const answer = readUntagged(root, 'CHANGELOG.md', [tag('v0.4.0')]);

    expect(answer.released).toEqual(['0.5.0', '0.4.0']);
    expect(answer.versions).toEqual(['0.5.0']);
    expect(answer.problem).toBeNull();
  });

  it('says the changelog could not be read when there is none', () => {
    const root = scratch();
    const answer = readUntagged(root, 'CHANGELOG.md', []);

    expect(answer.versions).toEqual([]);
    expect(answer.problem).toBe(`the changelog could not be read at ${join(root, 'CHANGELOG.md')}`);
  });
});

describe('the plan the pending notes are read for', () => {
  /** A notes reader recording what it was asked, answering `notes`. */
  function reader(notes: readonly PlanChange[] = []): {
    read: (root: string, stub: string) => readonly PlanChange[];
    asked: string[];
  } {
    const asked: string[] = [];
    return {
      asked,
      read: (root, stub) => {
        asked.push(`${root} ${stub}`);
        return notes;
      },
    };
  }

  it('takes the stub --plan names, whatever the branch says', () => {
    const { read, asked } = reader([note()]);
    const answer = readPending('/repo', 'rafa-25-learns-from-runs', BRANCH, [STUB], read);

    expect(answer.stub).toBe('rafa-25-learns-from-runs');
    expect(answer.source).toBe('flag');
    expect(asked).toEqual(['/repo rafa-25-learns-from-runs']);
  });

  it('takes the branch\'s stub when a plan file corroborates it', () => {
    const { read, asked } = reader([note()]);
    const answer = readPending('/repo', null, BRANCH, [STUB, 'rafa-20-pr-commands'], read);

    expect(answer).toMatchObject({ stub: STUB, source: 'roster', branch: BRANCH, level: 'minor' });
    expect(asked).toEqual([`/repo ${STUB}`]);
  });

  it('takes the branch\'s stub through its queue id when no plan file spells it', () => {
    const { read } = reader();
    const answer = readPending('/repo', null, 'feat/q16', ['q16-changelog-and-release'], read);

    expect(answer.stub).toBe('q16-changelog-and-release');
    expect(answer.source).toBe('roster');
  });

  it('takes the branch\'s stub verbatim when the roster corroborates nothing', () => {
    const { read, asked } = reader([note()]);
    const answer = readPending('/repo', null, BRANCH, [], read);

    expect(answer).toMatchObject({ stub: STUB, source: 'branch', problem: null });
    expect(asked).toEqual([`/repo ${STUB}`]);
  });

  it('resolves no plan, and reads no note, for a branch stub that reaches two plans', () => {
    const { read, asked } = reader([note()]);
    const answer = readPending('/repo', null, 'feat/q16', ['q16-one', 'q16-two'], read);

    expect(answer.stub).toBeNull();
    expect(answer.source).toBe('none');
    expect(answer.problem).toBe('the branch stub "q16" reaches 2 plans: q16-one, q16-two');
    expect(asked).toEqual([]);
  });

  it('resolves no plan, and reads no note, on a branch with no type prefix', () => {
    const { read, asked } = reader([note()]);
    const answer = readPending('/repo', null, 'main', [STUB], read);

    expect(answer).toMatchObject({ stub: null, source: 'none', notes: [], level: null });
    expect(answer.problem).toBe('the branch "main" names no plan stub');
    expect(asked).toEqual([]);
  });

  it('resolves no plan, and reads no note, when git could not say what branch it is on', () => {
    const { read, asked } = reader([note()]);
    const answer = readPending('/repo', null, null, [STUB], read);

    expect(answer.source).toBe('none');
    expect(answer.problem).toBe('the branch could not be read, so no plan was resolved');
    expect(asked).toEqual([]);
  });

  it('answers the highest level among the notes', () => {
    const notes = [note({ level: 'patch' }), note({ level: 'major', summary: 'b' }), note({ level: 'none', summary: 'c' })];
    const answer = readPending('/repo', STUB, null, [], () => notes);

    expect(answer.level).toBe('major');
  });

  it('carries what the store said when the notes could not be read', () => {
    const answer = readPending('/repo', STUB, null, [], () => {
      throw new Error('the store is newer than this rafa');
    });

    expect(answer.notes).toEqual([]);
    expect(answer.problem).toBe('the change notes could not be read: the store is newer than this rafa');
  });
});

describe('the block', () => {
  it('writes one line per reading, each labelled, with the pending notes under theirs', () => {
    const text = renderStatus(reading());

    expect(cellOf(text, 'version file')).toBe('package.json: 0.5.0');
    expect(cellOf(text, 'latest tag')).toBe('v0.4.0, of 1 release tags');
    expect(cellOf(text, 'untagged')).toBe('0.5.0');
    expect(cellOf(text, 'pending')).toBe(`1 note for ${STUB}, worth a minor release`);
    expect(linesOf(text).at(-1)).toBe('                - release: a line a user would understand');
  });

  it('pads the labels to one column, so every cell starts at the same character', () => {
    const lines = linesOf(renderStatus(reading()));

    expect(lines.slice(0, 4)).toEqual([
      '  version file  package.json: 0.5.0',
      '  latest tag    v0.4.0, of 1 release tags',
      '  untagged      0.5.0',
      `  pending       1 note for ${STUB}, worth a minor release`,
    ]);
    expect(lines[4]).toBe('                - release: a line a user would understand');
  });

  it('marks a cell nothing could be read for, and says why under the block', () => {
    const text = renderStatus(reading({
      versionFile: { path: 'package.json', version: null, problem: 'the version file could not be read at /x' },
      tags: { tags: [], latest: null, problem: 'the tags could not be listed: fatal: not a git repository' },
    }));

    expect(cellOf(text, 'version file')).toBe(`package.json: ${UNREADABLE}`);
    expect(cellOf(text, 'latest tag')).toBe(UNREADABLE);
    expect(text).toContain('the version file could not be read at /x');
    expect(text).toContain('the tags could not be listed: fatal: not a git repository');
  });

  it('writes no problem block when every reading was made', () => {
    const text = renderStatus(reading());

    expect(text).not.toContain('\n\n');
  });

  it('says a repository with no release tag has none', () => {
    const text = renderStatus(reading({ tags: { tags: [], latest: null, problem: null } }));

    expect(cellOf(text, 'latest tag')).toBe(`${NOTHING}, of 0 release tags`);
  });

  it('says so when every released version is tagged, and when none was ever released', () => {
    const tagged = renderStatus(reading({
      untagged: { path: 'CHANGELOG.md', released: ['0.4.0'], versions: [], problem: null },
    }));
    const never = renderStatus(reading({
      untagged: { path: 'CHANGELOG.md', released: [], versions: [], problem: null },
    }));

    expect(cellOf(tagged, 'untagged')).toBe(NOTHING);
    expect(cellOf(never, 'untagged')).toBe(`${NOTHING}, and the changelog names no release`);
  });

  it('says there is no current plan, and lists no note, when none resolved', () => {
    const text = renderStatus(reading({
      plan: { stub: null, source: 'none', branch: 'main', notes: [], level: null, problem: null },
    }));

    expect(cellOf(text, 'pending')).toBe(`${NOTHING}: no current plan`);
    expect(linesOf(text)).toHaveLength(4);
  });

  it('says a plan with no stored note has none pending', () => {
    const text = renderStatus(reading({
      plan: { stub: STUB, source: 'roster', branch: BRANCH, notes: [], level: null, problem: null },
    }));

    expect(cellOf(text, 'pending')).toBe(`${NOTHING} for ${STUB}`);
  });

  it('says notes that are all level none are worth no release', () => {
    const text = renderStatus(reading({
      plan: {
        stub: STUB,
        source: 'roster',
        branch: BRANCH,
        notes: [note({ level: 'none' })],
        level: 'none',
        problem: null,
      },
    }));

    expect(cellOf(text, 'pending')).toBe(`1 note for ${STUB}, worth no release`);
    expect(text).not.toContain('- release:');
  });

  it('groups the note lines by area, as the changelog entry would', () => {
    const text = renderStatus(reading({
      plan: {
        stub: STUB,
        source: 'roster',
        branch: BRANCH,
        notes: [
          note({ area: 'release', summary: 'one' }),
          note({ area: null, summary: 'two' }),
          note({ area: 'release', summary: 'three' }),
        ],
        level: 'minor',
        problem: null,
      },
    }));

    const notes = linesOf(text).slice(4);

    expect(notes.map((line) => line.trim()))
      .toEqual(['- release: one', '- release: three', '- two']);
  });
});

describe('the dispatched action', () => {
  it('reads all four from the project the dispatcher resolved, and writes nothing', async () => {
    const project = freshProject();
    writeFileSync(join(project.root, 'package.json'), '{"version": "0.5.0"}', 'utf8');
    writeFileSync(join(project.root, 'CHANGELOG.md'), '# Changelog\n\n## 0.5.0 — x\n\n## 0.4.0 — y\n', 'utf8');
    const seams = recorded(gitTable('v0.4.0\n'), [note()]);

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(cellOf(run.stdout, 'version file')).toBe('package.json: 0.5.0');
    expect(cellOf(run.stdout, 'latest tag')).toBe('v0.4.0, of 1 release tags');
    expect(cellOf(run.stdout, 'untagged')).toBe('0.5.0');
    expect(cellOf(run.stdout, 'pending')).toBe(`1 note for ${STUB}, worth a minor release`);
    expect(seams.roots).toEqual([project.root]);
    expect(seams.asked).toEqual([`${project.root} ${STUB}`]);
  });

  it('gives the four readings and the block as the result event\'s data in json mode', async () => {
    const project = freshProject();
    writeFileSync(join(project.root, 'package.json'), '{"version": "0.5.0"}', 'utf8');
    const seams = recorded(gitTable('v0.4.0\nv0.3.0\n'), [note()]);

    const run = await ran(seams.seams, project, ['--output=json']);
    const data = dataOf(run.events) as ReleaseStatusResult;

    expect(run.exitCode).toBe(0);
    expect(data.reading.versionFile.version).toBe('0.5.0');
    expect(data.reading.tags.latest?.tag).toBe('v0.4.0');
    expect(data.reading.tags.tags).toHaveLength(2);
    expect(data.reading.plan.stub).toBe(STUB);
    expect(data.reading.plan.notes).toHaveLength(1);
    expect(data.text).toContain('version file');
  });

  it('reads the pending notes for the stub --plan names', async () => {
    const project = freshProject();
    const seams = recorded(gitTable('', 'main'), [note()]);

    const run = await ran(seams.seams, project, ['--plan=rafa-25-learns-from-runs']);

    expect(run.exitCode).toBe(0);
    expect(seams.asked).toEqual([`${project.root} rafa-25-learns-from-runs`]);
    expect(cellOf(run.stdout, 'pending')).toBe('1 note for rafa-25-learns-from-runs, worth a minor release');
  });

  it('reports each reading that failed rather than refusing the ones that did not', async () => {
    const project = freshProject();
    writeFileSync(join(project.root, 'package.json'), '{"version": "0.5.0"}', 'utf8');
    const seams = recorded({
      'tag --list': refused('fatal: not a git repository'),
      'rev-parse --abbrev-ref HEAD': refused('fatal: not a git repository'),
    });

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(0);
    expect(cellOf(run.stdout, 'version file')).toBe('package.json: 0.5.0');
    expect(cellOf(run.stdout, 'latest tag')).toBe(UNREADABLE);
    expect(run.stdout).toContain('the tags could not be listed');
    expect(run.stdout).toContain('the changelog could not be read');
    expect(run.stdout).toContain('the branch could not be read');
    expect(seams.asked).toEqual([]);
  });

  it('refuses a stray word with exit code 1, and makes no git runner', async () => {
    const seams = recorded(gitTable('v0.4.0\n'));

    const run = await ran(seams.seams, freshProject(), ['0.5.0']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('Expected no arguments, got 1: 0.5.0');
    expect(run.stderr).toContain(RELEASE_STATUS_USAGE);
    expect(seams.roots).toEqual([]);
  });

  it('refuses --plan with no stub, and makes no git runner', async () => {
    const seams = recorded(gitTable('v0.4.0\n'));

    const run = await ran(seams.seams, freshProject(), ['--plan=']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--plan takes a plan stub');
    expect(seams.roots).toEqual([]);
  });

  it('refuses a config it cannot use, with exit code 1', async () => {
    const project = freshProject('release:\n  versionFile: 7\n');
    const seams = recorded(gitTable('v0.4.0\n'));

    const run = await ran(seams.seams, project);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('The config cannot be used:');
  });
});

describe('what the default seams reach', () => {
  it('reads the notes the store holds for the plan, through the real reader', async () => {
    // Arrange: a project whose store carries two notes for one plan.
    const project = freshProject();
    writeChanges(project.root, {
      dispatch: { sessionId: 'session-a', planStub: STUB, taskLine: '- [x] a task' },
      changes: [
        { level: 'minor', area: 'release', summary: 'the status action', extras: [] },
        { level: 'patch', area: null, summary: 'a smaller thing', extras: [] },
      ],
    });

    // Act: the git seam alone is replaced, so the notes come off the disk.
    const run = await ran({ git: () => fakeGit(gitTable('')) }, project);

    // Assert
    expect(run.exitCode).toBe(0);
    expect(cellOf(run.stdout, 'pending')).toBe(`2 notes for ${STUB}, worth a minor release`);
    expect(run.stdout).toContain('- release: the status action');
    expect(run.stdout).toContain('- a smaller thing');
  });

  it('reads no note for a plan the store holds none for, which is the control for that', async () => {
    const project = freshProject();
    writeChanges(project.root, {
      dispatch: { sessionId: 'session-a', planStub: 'rafa-20-pr-commands', taskLine: '- [x] a task' },
      changes: [{ level: 'minor', area: 'release', summary: 'another plan\'s note', extras: [] }],
    });

    const run = await ran({ git: () => fakeGit(gitTable('')) }, project);

    expect(cellOf(run.stdout, 'pending')).toBe(`${NOTHING} for ${STUB}`);
    expect(run.stdout).not.toContain('another plan\'s note');
  });
});
