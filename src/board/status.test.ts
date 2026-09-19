/**
 * Tests for the board reading (`src/board/status.ts`): the label rows,
 * the template row, the two roadmap rows, and the whole of
 * {@link readBoardStatus} over a board that is set up and over one that
 * is bare.
 *
 * Every case drives {@link fakeBoard}, a `gh` runner holding the labels
 * and the open issues of one imaginary repository in memory and keeping
 * every argument list it was handed, and every root is a directory
 * under this file's own temporary root. No case spawns a process,
 * reaches GitHub, reads a real repository or touches the configuration
 * `gh` keeps under the home.
 *
 * ## What passes while wrong
 *
 * "It wrote nothing" is the reading that passes for the wrong reason
 * here: a reader that answered nothing at all also writes nothing. So
 * the two whole-board cases assert BOTH ends — every row, and that the
 * paths under the root and the bytes of the config are the ones the
 * case planted — and the fake answers `no route` for every command that
 * is not one of the two reads, so a write would come back as a failed
 * command and redden a row rather than pass quietly.
 *
 * Each `unknown` case sits beside a control differing in one thing
 * only: the same repository with the command answering, so a row that
 * reads `unknown` for every input would fail the control.
 *
 * Two mutations of `status.ts` were driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/status.test.ts`, the module
 * restored from a scratch copy after each and verified with
 * `shasum -c`:
 *
 *  - the failed listing answered `missing` instead of `unknown`, which
 *    is the false reading this module exists to avoid: 13 pass, 1 fail;
 *  - the `roadmap.issue` read that ranks ahead of the search dropped,
 *    so a configured board searches anyway: 12 pass, 2 fail.
 *
 * The file reads 14 pass either side of both.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { projectConfigText } from '../project/scaffold.js';

import { ROADMAP_SETTING, ROADMAP_TITLE, severalRoadmapsMessage } from './roadmap.js';
import { withRoadmapIssue } from './setup-config.js';
import { BOARD_LABELS, SPEC_TEMPLATE_PATH } from './setup.js';
import {
  boardGaps,
  readBoardStatus,
  readLabelRows,
  readTemplateRow,
  ROADMAP_ROW_NAME,
} from './status.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-status-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Every label name the board wants, in the order the rows carry them. */
const LABEL_NAMES = BOARD_LABELS.map((label) => label.name);

/** One open issue the fake repository holds. */
interface FakeIssue {
  readonly number: number;
  readonly title: string;
}

/** What a fake repository holds, and which commands fail on it. */
interface FakeOptions {
  readonly labels?: readonly string[];
  readonly issues?: readonly FakeIssue[];
  /** The command prefixes that fail, each with what the failure writes. */
  readonly fails?: Readonly<Record<string, string>>;
}

/** A read-only `gh` runner over one imaginary repository; see the module note. */
function fakeBoard(options: FakeOptions = {}): {
  run: GhRunner;
  calls: () => readonly (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  const labels = [...options.labels ?? []];
  const issues = [...options.issues ?? []];
  const fails = options.fails ?? {};

  const run: GhRunner = (args) => {
    calls.push([...args]);
    const route = args.slice(0, 2).join(' ');
    const failure = fails[route];
    if (failure !== undefined) return Promise.resolve({ ok: false, stdout: '', stderr: failure });

    const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
    if (route === 'label list') return ok(JSON.stringify(labels.map((name) => ({ name }))));
    if (route === 'issue list') {
      const wanted = (args.at(-3) ?? '').split(' ')[0] ?? '';
      return ok(JSON.stringify(issues.filter((issue) => issue.title.toLowerCase().includes(wanted.toLowerCase()))));
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${route}` });
  };

  return { run, calls: () => calls };
}

/** A fresh project root holding the config `rafa init` writes. */
function freshRoot(label: string): string {
  const root = mkdtempSync(join(tempBase, `${label}-`));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), projectConfigText(), 'utf8');
  return root;
}

/** The project config's path under `root`. */
function configPath(root: string): string {
  return join(root, '.rafa', 'config.yaml');
}

/** Writes `roadmap.issue: <issue>` into the config under `root`, as `init --board` would. */
function nameRoadmap(root: string, issue: number): void {
  const path = configPath(root);
  const written = withRoadmapIssue(readFileSync(path, 'utf8'), issue);
  if (written === null) throw new Error('the scaffolded config would not take roadmap.issue');
  writeFileSync(path, written, 'utf8');
}

/** Writes the spec issue template under `root`. */
function plantTemplate(root: string): void {
  const path = join(root, SPEC_TEMPLATE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '# Spec\n', 'utf8');
}

/** Every path under `root`, sorted, with the bytes of its config. */
function snapshot(root: string): { paths: string[]; config: string } {
  return {
    paths: readdirSync(root, { recursive: true }).map(String)
      .sort((a, b) => a.localeCompare(b)),
    config: readFileSync(configPath(root), 'utf8'),
  };
}

/** The row of `rows` under `name`. */
function rowNamed(rows: readonly { name: string }[], name: string): { name: string } | undefined {
  return rows.find((row) => row.name === name);
}

/** The outcome of each row, in order. */
function outcomes(rows: readonly { outcome: string }[]): string[] {
  return rows.map((row) => row.outcome);
}

describe('readLabelRows', () => {
  it('answers present for a label the repository carries and missing for one it does not', async () => {
    const gh = fakeBoard({ labels: ['type:bug', 'needs-triage'] });

    const rows = await readLabelRows(gh.run);

    expect(rows.map((row) => row.name)).toEqual(LABEL_NAMES);
    expect(rows.every((row) => row.kind === 'label')).toBe(true);
    expect(rows.filter((row) => row.outcome === 'present').map((row) => row.name))
      .toEqual(['type:bug', 'needs-triage']);
    expect(rows.filter((row) => row.outcome === 'missing').map((row) => row.name))
      .toEqual(['type:spec', 'spec:ready', 'spec:needs-work', 'module:unassigned']);
    expect(gh.calls().map((args) => args.slice(0, 2).join(' '))).toEqual(['label list']);
  });

  it('reads a label the repository spells in another case as present', async () => {
    const gh = fakeBoard({ labels: LABEL_NAMES.map((name) => name.toUpperCase()) });

    const rows = await readLabelRows(gh.run);

    expect(outcomes(rows)).toEqual(LABEL_NAMES.map(() => 'present'));
  });

  it('answers unknown for every label when the listing failed, where the same listing answering does not', async () => {
    const failing = fakeBoard({ fails: { 'label list': 'HTTP 401: Bad credentials' } });
    const control = fakeBoard({ labels: [] });

    const failed = await readLabelRows(failing.run);
    const answered = await readLabelRows(control.run);

    expect(outcomes(failed)).toEqual(LABEL_NAMES.map(() => 'unknown'));
    expect(failed[0]?.detail).toContain('HTTP 401: Bad credentials');
    expect(outcomes(answered)).toEqual(LABEL_NAMES.map(() => 'missing'));
  });
});

describe('readTemplateRow', () => {
  it('answers present for a file at the template path and missing when nothing is there', () => {
    const withOne = freshRoot('template-there');
    const without = freshRoot('template-absent');
    plantTemplate(withOne);

    expect(readTemplateRow(withOne)).toEqual({
      kind: 'template',
      name: SPEC_TEMPLATE_PATH,
      outcome: 'present',
      detail: 'the repository carries it',
    });
    expect(readTemplateRow(without).outcome).toBe('missing');
  });

  it('answers unknown for a directory at the template path, which init --board would not write', () => {
    const root = freshRoot('template-directory');
    mkdirSync(join(root, SPEC_TEMPLATE_PATH), { recursive: true });

    const row = readTemplateRow(root);

    expect(row.outcome).toBe('unknown');
    expect(row.detail).toContain('is not a file');
  });
});

describe('the roadmap rows', () => {
  it('reads the configured issue without searching, where a config naming none searches', async () => {
    const configured = freshRoot('roadmap-configured');
    const unconfigured = freshRoot('roadmap-unconfigured');
    nameRoadmap(configured, 41);
    const withSetting = fakeBoard({ issues: [{ number: 41, title: ROADMAP_TITLE }] });
    const withoutSetting = fakeBoard({ issues: [{ number: 41, title: ROADMAP_TITLE }] });

    const named = await readBoardStatus({ gh: withSetting.run, root: configured });
    const searched = await readBoardStatus({ gh: withoutSetting.run, root: unconfigured });

    expect(named.roadmapIssue).toBe(41);
    expect(rowNamed(named.rows, ROADMAP_ROW_NAME)).toEqual({
      kind: 'issue',
      name: ROADMAP_ROW_NAME,
      outcome: 'present',
      detail: `${ROADMAP_SETTING} names issue #41`,
    });
    expect(withSetting.calls().map((args) => args.slice(0, 2).join(' '))).toEqual(['label list']);
    expect(withoutSetting.calls().map((args) => args.slice(0, 2).join(' '))).toEqual(['label list', 'issue list']);
    expect(searched.roadmapIssue).toBe(41);
  });

  it('answers the issue present and the setting missing when the search finds one the config does not name', async () => {
    const root = freshRoot('roadmap-unnamed');
    const gh = fakeBoard({ issues: [{ number: 7, title: ROADMAP_TITLE }] });
    const before = snapshot(root);

    const status = await readBoardStatus({ gh: gh.run, root });

    expect(rowNamed(status.rows, ROADMAP_ROW_NAME)).toMatchObject({ outcome: 'present' });
    expect(rowNamed(status.rows, ROADMAP_SETTING)).toMatchObject({ outcome: 'missing' });
    expect(status.roadmapIssue).toBe(7);
    expect(snapshot(root)).toEqual(before);
  });

  it('answers both rows missing when no open issue is titled Roadmap', async () => {
    const root = freshRoot('roadmap-none');
    const gh = fakeBoard({ issues: [{ number: 3, title: 'Something else' }] });

    const status = await readBoardStatus({ gh: gh.run, root });

    expect(rowNamed(status.rows, ROADMAP_ROW_NAME)).toMatchObject({ outcome: 'missing' });
    expect(rowNamed(status.rows, ROADMAP_SETTING)).toMatchObject({ outcome: 'missing' });
    expect(status.roadmapIssue).toBe(null);
  });

  it('answers both rows unknown for two open Roadmap issues, where one of them is present', async () => {
    const two = freshRoot('roadmap-two');
    const one = freshRoot('roadmap-one');
    const ambiguous = fakeBoard({
      issues: [{ number: 4, title: ROADMAP_TITLE }, { number: 9, title: ROADMAP_TITLE }],
    });
    const single = fakeBoard({ issues: [{ number: 4, title: ROADMAP_TITLE }] });

    const both = await readBoardStatus({ gh: ambiguous.run, root: two });
    const control = await readBoardStatus({ gh: single.run, root: one });

    expect(rowNamed(both.rows, ROADMAP_ROW_NAME)).toEqual({
      kind: 'issue',
      name: ROADMAP_ROW_NAME,
      outcome: 'unknown',
      detail: severalRoadmapsMessage([4, 9]),
    });
    expect(rowNamed(both.rows, ROADMAP_SETTING)).toMatchObject({ outcome: 'unknown' });
    expect(both.roadmapIssue).toBe(null);
    expect(rowNamed(control.rows, ROADMAP_ROW_NAME)).toMatchObject({ outcome: 'present' });
  });

  it('answers both rows unknown when the search failed, where the same search answering does not', async () => {
    const failed = freshRoot('roadmap-search-failed');
    const answered = freshRoot('roadmap-search-answered');
    const failing = fakeBoard({ fails: { 'issue list': 'HTTP 403: rate limit exceeded' } });
    const control = fakeBoard({ issues: [] });

    const refused = await readBoardStatus({ gh: failing.run, root: failed });
    const clean = await readBoardStatus({ gh: control.run, root: answered });

    expect(rowNamed(refused.rows, ROADMAP_ROW_NAME)).toMatchObject({ outcome: 'unknown' });
    expect(rowNamed(refused.rows, ROADMAP_SETTING)?.detail).toContain('HTTP 403: rate limit exceeded');
    expect(rowNamed(clean.rows, ROADMAP_ROW_NAME)).toMatchObject({ outcome: 'missing' });
  });

  it('answers both rows unknown when the project config could not be read', async () => {
    const root = mkdtempSync(join(tempBase, 'roadmap-no-config-'));
    const gh = fakeBoard({ issues: [{ number: 5, title: ROADMAP_TITLE }] });

    const status = await readBoardStatus({ gh: gh.run, root });

    expect(rowNamed(status.rows, ROADMAP_ROW_NAME)).toMatchObject({ outcome: 'unknown' });
    expect(rowNamed(status.rows, ROADMAP_SETTING)?.detail).toContain(configPath(root));
    expect(gh.calls().map((args) => args.slice(0, 2).join(' '))).toEqual(['label list']);
  });
});

describe('readBoardStatus', () => {
  it('answers every row present over a board that is set up, sends one command and writes nothing', async () => {
    const root = freshRoot('whole-set-up');
    plantTemplate(root);
    nameRoadmap(root, 31);
    const gh = fakeBoard({ labels: [...LABEL_NAMES], issues: [{ number: 31, title: ROADMAP_TITLE }] });
    const before = snapshot(root);

    const status = await readBoardStatus({ gh: gh.run, root });

    expect(status.rows.map((row) => row.name))
      .toEqual([...LABEL_NAMES, SPEC_TEMPLATE_PATH, ROADMAP_ROW_NAME, ROADMAP_SETTING]);
    expect(outcomes(status.rows)).toEqual(status.rows.map(() => 'present'));
    expect(boardGaps(status)).toEqual([]);
    expect(status.roadmapIssue).toBe(31);
    expect(gh.calls().map((args) => args.slice(0, 2).join(' '))).toEqual(['label list']);
    expect(snapshot(root)).toEqual(before);
  });

  it('answers all nine rows missing over a bare repository and writes nothing', async () => {
    const root = freshRoot('whole-bare');
    const gh = fakeBoard();
    const before = snapshot(root);

    const status = await readBoardStatus({ gh: gh.run, root });

    expect(outcomes(status.rows)).toEqual(status.rows.map(() => 'missing'));
    expect(boardGaps(status)).toHaveLength(9);
    expect(status.roadmapIssue).toBe(null);
    expect(gh.calls().map((args) => args.slice(0, 2).join(' '))).toEqual(['label list', 'issue list']);
    expect(snapshot(root)).toEqual(before);
  });

  it('reports the gaps of a half-made board and leaves the rest present', async () => {
    const root = freshRoot('whole-half');
    plantTemplate(root);
    const gh = fakeBoard({ labels: ['type:spec', 'spec:ready'], issues: [{ number: 12, title: ROADMAP_TITLE }] });

    const status = await readBoardStatus({ gh: gh.run, root });

    expect(boardGaps(status).map((row) => row.name))
      .toEqual(['spec:needs-work', 'type:bug', 'needs-triage', 'module:unassigned', ROADMAP_SETTING]);
    expect(boardGaps(status).every((row) => row.outcome === 'missing')).toBe(true);
  });
});
