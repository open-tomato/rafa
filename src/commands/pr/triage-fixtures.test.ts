/**
 * `rafa pr triage` driven end to end from the captured fixtures under
 * `src/tests/fixtures/pr-triage/`, rather than from ad hoc pull requests
 * built in the test itself.
 *
 * `triage.test.ts` proves the command's refusals, its ordering and its
 * writes; `classify.test.ts` proves the classifier holds the class set
 * closed over literal inputs. Neither reads the ten fixture directories
 * a earlier task captured, one per {@link TRIAGE_CLASSES} member, each
 * holding `pr.json` (the exact shape `gh pr view --json <DETAIL_FIELDS>`
 * answers, `gh.ts`'s `readDetail`), `checks.json` (the exact shape
 * `gh pr checks --json name,state,link` answers) and `log.txt` (the
 * exact TAB-separated shape `gh run view <id> --log-failed` answers).
 * This file is that reading: it turns each fixture into a
 * {@link FakePullRequestSeed}, plants it on the recorded `gh` fake, and
 * dispatches the real command over it, so the closed set is measured
 * against the same captures the classifier's own module note describes.
 *
 * Three jobs:
 *
 *   - Every class, produced from its own fixture, closed both ends the
 *     way `classify.test.ts` holds the set: the ten classes produced are
 *     exactly `TRIAGE_CLASSES`, and each fixture produces the class its
 *     directory is named for. `green` is read off `rerun.decision`
 *     rather than off `assessment.triageClass`, because a first-ever
 *     green pull request is the one case `assessOne` never classifies at
 *     all (`triage.ts`, `rerun.ts`'s module note) — `assessment` stays
 *     null and the class lives only in the re-run reading.
 *   - The four re-run readings, driven one after another over a single
 *     evolving pull request: assess (the first run), already-assessed
 *     (the same head again), pending (the head moved and a check is
 *     still running) and green (the head moved again and everything
 *     passed) — the sequence `rerun.ts`'s module note lists, read here
 *     off the comment count staying at one throughout and off
 *     `rerun.decision` in the json result.
 *   - The bare line's selection over more than one candidate, including
 *     the 72-hour skip message `select.ts`'s module note quotes: two
 *     pull requests that moved inside the window are assessed, and the
 *     third, moved five days before the clock this file fixes, is named
 *     with its age and its own command rather than assessed.
 *
 * The conflicting file list a `conflict-*` fixture needs is not itself
 * on disk — it is what a real `git merge-tree` would answer, which is
 * `conflict.test.ts`'s territory — so it is supplied here by a stub
 * `GitRunner` keyed on the head commit each fixture carries, the same
 * technique `triage.test.ts` uses for its own single conflicting case.
 */
import type { TriageSeams } from './triage.js';
import type { CliEvent } from '../../ports/index.js';
import type { FakePrAuthor, FakePrCheck, FakePullRequestSeed } from '../../pr/gh-fake.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { TriageClass } from '../../pr/triage/classes.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhPermissions } from '../../board/trust.js';
import { createFakePrGh, logFailedText } from '../../pr/gh-fake.js';
import { createGhPullRequests } from '../../pr/index.js';
import { TRIAGE_CLASSES } from '../../pr/triage/classes.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { runIdOf } from './triage-read.js';
import { createPrTriageCommand } from './triage.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-triage-fixtures-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The clock every case in this file fixes, so no reading depends on the real one. */
const NOW = '2026-09-19T09:00:00Z';

/** A project of this file's own, holding the GitHub CLI config. */
function freshProject(): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), GH_CONFIG);
}

/** The data of the terminal result event. */
function dataOf(events: readonly CliEvent[]): Record<string, unknown> {
  return (events.at(-1) as { data?: Record<string, unknown> }).data ?? {};
}

/**
 * Typed by every case here, so that no case composes the real sources
 * for the ending hint and spawns `git` and `gh` in the scratch project
 * it planted. The ending itself is driven in the command's own suite.
 */
const NO_HINT = '--no-hint';

/** Dispatches `rafa pr triage <n> --output=json` and answers its readings. */
async function readingsOf(
  seams: TriageSeams,
  project: PlantedProject,
  number: number,
): Promise<readonly Record<string, unknown>[]> {
  const command = createPrTriageCommand(seams);
  const run = await dispatchInProject(
    ['pr', 'triage', String(number), '--output=json', NO_HINT],
    SUBJECTS,
    [command],
    project,
  );
  expect(run.exitCode).toBe(0);
  const data = dataOf(eventsOf(run.stdout));
  return data['readings'] as readonly Record<string, unknown>[];
}

/** The login the recorded fake writes a comment as, which every case gives write access. */
const FAKE_COMMENT_AUTHOR = 'rafa-fake';

/** A git runner that resolves every ref and refuses to merge anything else; see the module note. */
const NO_REFS: GitRunner = () => ({ ok: false, stdout: '', stderr: 'stub git: no such ref' });

/** The record separator `git merge-tree -z` uses, built from its codepoint. */
const MERGE_TREE_NUL = String.fromCharCode(0);

/** A merged tree OID, which is what a conflicted `merge-tree` stdout opens with. */
const MERGE_TREE_OID = '0'.repeat(40);

/**
 * A git runner that resolves every ref and answers a conflict on the
 * files `filesByHead` names for the head commit `merge-tree` was asked
 * about, clean for any other. `readConflictFiles` always resolves the
 * head candidate first (`triage-read.ts`), so the head oid is the last
 * argument `merge-tree` is sent.
 */
function conflictGit(filesByHead: ReadonlyMap<string, readonly string[]>): GitRunner {
  return (args): GitResult => {
    if (args[0] === 'rev-parse') return { ok: true, stdout: '', stderr: '' };
    if (args[0] !== 'merge-tree') return { ok: false, stdout: '', stderr: 'stub git: unmodelled command' };
    const head = args.at(-1) ?? '';
    const files = filesByHead.get(head);
    return files === undefined
      ? { ok: true, stdout: `${MERGE_TREE_OID}${MERGE_TREE_NUL}`, stderr: '' }
      : { ok: false, stdout: [MERGE_TREE_OID, ...files, '', ''].join(MERGE_TREE_NUL), stderr: '' };
  };
}

/** One class's captured fixture, read straight off disk. */
interface CapturedFixture {
  /** The pull request, in the exact shape `gh pr view --json <DETAIL_FIELDS>` answers. */
  readonly pr: Record<string, unknown>;
  /** Its checks, in the exact shape `gh pr checks --json name,state,link` answers. */
  readonly checks: readonly FakePrCheck[];
  /** The failing job's `--log-failed` capture, or empty for a fixture with no failing job. */
  readonly log: string;
}

/** Where one class's fixture lives under `src/tests/fixtures/pr-triage/`. */
function fixturePath(triageClass: TriageClass, file: string): URL {
  return new URL(`../../tests/fixtures/pr-triage/${triageClass}/${file}`, import.meta.url);
}

/** Reads one class's fixture directory. */
function loadFixture(triageClass: TriageClass): CapturedFixture {
  const pr = JSON.parse(readFileSync(fixturePath(triageClass, 'pr.json'), 'utf8')) as Record<string, unknown>;
  const checks = JSON.parse(readFileSync(fixturePath(triageClass, 'checks.json'), 'utf8')) as FakePrCheck[];
  const log = readFileSync(fixturePath(triageClass, 'log.txt'), 'utf8');
  return { pr, checks, log };
}

/** An author as the fixture's `pr.json` renders one, read back into a seed's shape. */
function authorOf(raw: unknown): FakePrAuthor {
  const author = raw as Record<string, unknown>;
  return author['is_bot'] === true
    ? { login: String(author['login']), isBot: true }
    : { login: String(author['login']), isBot: false, name: String(author['name']) };
}

/** The fixture's pull request, read back into what {@link createFakePrGh} plants. */
function seedOf(fixture: CapturedFixture): FakePullRequestSeed {
  const pr = fixture.pr;
  return {
    number: Number(pr['number']),
    title: String(pr['title']),
    body: String(pr['body']),
    author: authorOf(pr['author']),
    headRefName: String(pr['headRefName']),
    baseRefName: String(pr['baseRefName']),
    headRefOid: String(pr['headRefOid']),
    isCrossRepository: Boolean(pr['isCrossRepository']),
    state: pr['state'] as FakePullRequestSeed['state'],
    mergeable: pr['mergeable'] as FakePullRequestSeed['mergeable'],
    mergeStateStatus: String(pr['mergeStateStatus']),
    updatedAt: String(pr['updatedAt']),
    checks: fixture.checks,
  };
}

/** The conflicting files behind each `conflict-*` fixture; see `classify.ts`'s module note. */
const CONFLICT_FILES: ReadonlyMap<TriageClass, readonly string[]> = new Map([
  ['conflict-lockfile', ['bun.lock']],
  ['conflict-manifest', ['package.json']],
  ['conflict-other', ['src/config.ts']],
]);

/**
 * The class one reading produced. `green` is read off `rerun.decision`
 * rather than off `assessment.triageClass`; see the module note.
 */
function classOfReading(reading: Record<string, unknown>): TriageClass {
  const rerun = reading['rerun'] as Record<string, unknown>;
  if (rerun['decision'] === 'green') return 'green';
  const assessment = reading['assessment'] as Record<string, unknown>;
  return assessment['triageClass'] as TriageClass;
}

describe('every class, read off its own captured fixture', () => {
  it('produces exactly the class each fixture directory is named for, and no class besides', async () => {
    const fake = createFakePrGh({ now: () => NOW });
    const numberOf = new Map<TriageClass, number>();
    const filesByHead = new Map<string, readonly string[]>();

    for (const triageClass of TRIAGE_CLASSES) {
      const fixture = loadFixture(triageClass);
      const seed = seedOf(fixture);
      fake.plant(seed);
      numberOf.set(triageClass, seed.number);
      const runId = fixture.checks[0] === undefined
        ? null
        : runIdOf(fixture.checks[0].link);
      if (runId !== null) fake.plantRun(runId, fixture.log);
      const files = CONFLICT_FILES.get(triageClass);
      if (files !== undefined) filesByHead.set(String(fixture.pr['headRefOid']), files);
    }

    const seams: TriageSeams = {
      pullRequests: () => createGhPullRequests({ gh: fake.run }),
      readBranch: () => 'main',
      readRemote: () => GITHUB_ORIGIN,
      git: () => conflictGit(filesByHead),
      now: () => NOW,
      permissions: () => createGhPermissions({ gh: fake.run }),
    };
    const project = freshProject();

    const produced = new Map<TriageClass, TriageClass>();
    for (const [triageClass, number] of numberOf) {
      const readings = await readingsOf(seams, project, number);
      produced.set(triageClass, classOfReading(readings[0] as Record<string, unknown>));
    }

    expect([...produced.values()].sort((a, b) => a.localeCompare(b))).toEqual([...TRIAGE_CLASSES].sort((a, b) => a.localeCompare(b)));
    for (const [triageClass, got] of produced) expect(got).toBe(triageClass);
  });
});

describe('the four re-run readings, driven over one evolving fixture', () => {
  it('answers assess, already-assessed, pending and green in that order as the head and checks move', async () => {
    const fixture = loadFixture('ci-lint');
    const seed = seedOf(fixture);
    const number = seed.number;
    const fake = createFakePrGh({ now: () => NOW });
    fake.plant(seed);
    fake.plantPermission(FAKE_COMMENT_AUTHOR, 'admin');
    const runId = fixture.checks[0] === undefined
      ? null
      : runIdOf(fixture.checks[0].link);
    if (runId !== null) fake.plantRun(runId, fixture.log);

    const seams: TriageSeams = {
      pullRequests: () => createGhPullRequests({ gh: fake.run }),
      readBranch: () => 'main',
      readRemote: () => GITHUB_ORIGIN,
      git: () => NO_REFS,
      now: () => NOW,
      permissions: () => createGhPermissions({ gh: fake.run }),
    };
    const project = freshProject();

    /** The decision one reading carries. */
    function decisionOf(reading: Record<string, unknown>): unknown {
      return (reading['rerun'] as Record<string, unknown>)['decision'];
    }

    const first = (await readingsOf(seams, project, number))[0] as Record<string, unknown>;
    expect(decisionOf(first)).toBe('assess');
    expect(classOfReading(first)).toBe('ci-lint');
    expect(fake.pull(number)?.comments).toHaveLength(1);

    const second = (await readingsOf(seams, project, number))[0] as Record<string, unknown>;
    expect(decisionOf(second)).toBe('already-assessed');
    expect(fake.pull(number)?.comments).toHaveLength(1);

    const link = fixture.checks[0]?.link ?? '';
    fake.update(number, (pull) => ({
      ...pull,
      headRefOid: '1'.repeat(40),
      checks: [{ name: 'gates', state: 'IN_PROGRESS', link }],
    }));
    const third = (await readingsOf(seams, project, number))[0] as Record<string, unknown>;
    expect(decisionOf(third)).toBe('pending');
    expect(fake.pull(number)?.comments).toHaveLength(1);

    fake.update(number, (pull) => ({
      ...pull,
      headRefOid: '2'.repeat(40),
      checks: [{ name: 'gates', state: 'SUCCESS', link }],
    }));
    const fourth = (await readingsOf(seams, project, number))[0] as Record<string, unknown>;
    expect(decisionOf(fourth)).toBe('green');
    expect(fake.pull(number)?.comments).toHaveLength(1);
  });
});

describe('the bare line, over more than one candidate, including the 72-hour skip message', () => {
  it('assesses the candidates that moved inside the window and lists the older one as skipped', async () => {
    const runId = '9101';
    const log = logFailedText('gates', [
      '##[group]Run bunx eslint .',
      'src/pr/triage/select.ts',
      '##[endgroup]',
      '##[error]Process completed with exit code 1.',
    ]);
    const link = `https://github.com/open-tomato/rafa/actions/runs/${runId}`;
    const check: FakePrCheck = { name: 'gates', state: 'FAILURE', link };

    const fake = createFakePrGh({ now: () => NOW });
    fake.plantRun(runId, log);
    // A pair that moved inside the 72-hour window, and one that moved 5 days before `now`.
    fake.plant({ number: 501, title: 'a fresh red one', headRefName: 'feat/pr-501', checks: [check], updatedAt: '2026-09-19T07:00:00Z' });
    fake.plant({ number: 502, title: 'a second fresh red one', headRefName: 'feat/pr-502', checks: [check], updatedAt: '2026-09-18T10:00:00Z' });
    fake.plant({ number: 503, title: 'an old red one', headRefName: 'feat/pr-503', checks: [check], updatedAt: '2026-09-14T00:00:00Z' });

    const seams: TriageSeams = {
      pullRequests: () => createGhPullRequests({ gh: fake.run }),
      readBranch: () => 'main',
      readRemote: () => GITHUB_ORIGIN,
      git: () => NO_REFS,
      now: () => NOW,
      permissions: () => createGhPermissions({ gh: fake.run }),
    };
    const command = createPrTriageCommand(seams);
    const project = freshProject();

    const run = await dispatchInProject(['pr', 'triage', '--output=json', NO_HINT], SUBJECTS, [command], project);

    expect(run.exitCode).toBe(0);
    const data = dataOf(eventsOf(run.stdout));
    const selection = data['selection'] as Record<string, unknown>;
    const readings = data['readings'] as readonly Record<string, unknown>[];

    expect(selection['decision']).toBe('some');
    expect(selection['headline']).toBe('3 red: assessing #501 and #502; 1 older one is skipped');
    expect(String(selection['message'])).toContain('#503 last moved 5 days ago, run rafa pr triage 503');
    expect(readings.map((reading) => (reading['detail'] as Record<string, unknown>)['number'])).toEqual([501, 502]);
    expect(fake.pull(503)?.comments ?? []).toEqual([]);
    expect(fake.pull(501)?.comments).toHaveLength(1);
    expect(fake.pull(502)?.comments).toHaveLength(1);
  });
});
