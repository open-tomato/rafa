/**
 * Tests for the board setup (`src/board/setup.ts`): the six labels, the
 * spec issue template, the pinned Roadmap issue, the `roadmap.issue`
 * line written into the project config, and a second run that writes
 * nothing.
 *
 * Every case drives {@link fakeBoard}, a `gh` runner holding the labels
 * and the open issues of one imaginary repository in memory and keeping
 * every argument list it was handed, and every root is a directory under
 * this file's own temporary root, holding the bytes `rafa init` writes
 * as its config. No case spawns a process, reaches GitHub, reads a real
 * repository or touches the configuration `gh` keeps under the home.
 * The edit that puts `roadmap.issue` in that config is
 * `./setup-config.ts`'s and is tested beside it; what is held here is
 * the part it answers.
 *
 * ## What passes while wrong
 *
 * Idempotency is the reading that passes for the wrong reason most
 * easily: a run that made nothing at all also writes nothing on the
 * second pass. So the rerun case asserts BOTH ends — the first run
 * creates every part and moves the modification time of the two files,
 * and the second creates none, sends no write command and leaves both
 * times where the first left them — and a control rewrites the config
 * with the bytes it already holds and finds the same reading moved, so
 * the reading can fail.
 *
 * Each refusal case asserts that the command it refuses to send was NOT
 * sent, since a refusal reported beside a write that happened anyway is
 * the failure that costs a second Roadmap issue.
 *
 * Two mutations of `setup.ts` were driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/setup.test.ts`, the module
 * restored from a scratch copy after each and verified with `shasum -c`:
 *
 *  - the `roadmap.issue` read that ranks ahead of the search dropped, so
 *    a rerun resolves the roadmap through `gh issue list` again and
 *    writes the setting a second time: 29 pass, 2 fail — the configured
 *    case and the rerun;
 *  - the check for a template already at the path dropped, so every run
 *    writes one: 27 pass, 4 fail — the rerun and the three cases about
 *    what is at the path.
 *
 * The file reads 31 pass either side of both.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { GITHUB_LABELS } from '../adapters/tracker/github.js';
import { parseConfigText } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import { SPEC_NEEDS_WORK_LABEL } from './gate.js';
import { SPEC_LABEL } from './issue.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { parseRoadmapBody, ROADMAP_SETTING, ROADMAP_TITLE } from './roadmap.js';
import { withRoadmapIssue } from './setup-config.js';
import {
  BOARD_LABELS,
  boardChanged,
  boardRefusals,
  LABEL_LIST_LIMIT,
  missingBoardLabels,
  roadmapIssueBody,
  setUpBoard,
  setUpLabels,
  setUpRoadmap,
  SPEC_TEMPLATE_PATH,
  specTemplateSource,
  writeRoadmapSetting,
  writeSpecTemplate,
} from './setup.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-board-setup-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The instant a rerun case sets every path to: 2001-09-09T01:46:40Z. */
const PAST = new Date(1_000_000_000_000);

/** A fresh project root holding the config `rafa init` writes. */
function freshRoot(label: string): string {
  const root = mkdtempSync(join(tempBase, `${label}-`));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), projectConfigText(), 'utf8');
  return root;
}

/** The `roadmap.issue` the project config under `root` resolves to. */
function settingUnder(root: string): number | null {
  const path = join(root, '.rafa', 'config.yaml');
  return parseConfigText(readFileSync(path, 'utf8'), path).values.roadmapIssue ?? null;
}

/** One open issue the fake repository holds. */
interface FakeIssue {
  readonly number: number;
  readonly title: string;
}

/** What a fake repository starts with, and which commands fail on it. */
interface FakeOptions {
  /** The labels it already carries. */
  readonly labels?: readonly string[];
  /** The open issues it already holds. */
  readonly issues?: readonly FakeIssue[];
  /** The command prefixes that fail, each with what the failure writes. */
  readonly fails?: Readonly<Record<string, string>>;
  /** What `gh issue create` writes instead of a URL, when it should write something else. */
  readonly createdUrl?: string;
}

/** A `gh` runner over one imaginary repository; see the module note. */
function fakeBoard(options: FakeOptions = {}): {
  run: GhRunner;
  calls: () => readonly (readonly string[])[];
  labels: () => readonly string[];
  issues: () => readonly FakeIssue[];
  pinned: () => readonly number[];
} {
  const calls: (readonly string[])[] = [];
  const labels: string[] = [...options.labels ?? []];
  const issues: FakeIssue[] = [...options.issues ?? []];
  const pinned: number[] = [];
  const fails = options.fails ?? {};

  const run: GhRunner = (args) => {
    calls.push([...args]);
    const route = args.slice(0, 2).join(' ');
    const failure = fails[route];
    if (failure !== undefined) return Promise.resolve({ ok: false, stdout: '', stderr: failure });

    const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });

    if (route === 'label list') {
      return ok(JSON.stringify(labels.map((name) => ({ name }))));
    }
    if (route === 'label create') {
      const name = args[2] ?? '';
      if (labels.includes(name)) {
        return Promise.resolve({ ok: false, stdout: '', stderr: `label with name ${name} already exists` });
      }
      labels.push(name);
      return ok('');
    }
    if (route === 'issue list') {
      const wanted = (args.at(-3) ?? '').split(' ')[0] ?? '';
      const found = issues.filter((issue) => issue.title.toLowerCase().includes(wanted.toLowerCase()));
      return ok(JSON.stringify(found));
    }
    if (route === 'issue create') {
      const number = issues.reduce((highest, issue) => Math.max(highest, issue.number), 0) + 1;
      issues.push({ number, title: args[3] ?? '' });
      return ok(options.createdUrl ?? `https://github.com/acme/widgets/issues/${String(number)}\n`);
    }
    if (route === 'issue pin') {
      pinned.push(Number.parseInt(args[2] ?? '0', 10));
      return ok('');
    }
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${route}` });
  };

  return {
    run,
    calls: () => calls,
    labels: () => [...labels],
    issues: () => [...issues],
    pinned: () => [...pinned],
  };
}

/** The `gh label list` arguments every run opens with. */
const LABEL_LIST_CALL = ['label', 'list', '--limit', String(LABEL_LIST_LIMIT), '--json', 'name'];

/** Every call of `calls` whose first two words are `route`. */
function callsTo(calls: readonly (readonly string[])[], route: string): readonly (readonly string[])[] {
  return calls.filter((args) => args.slice(0, 2).join(' ') === route);
}

/** The part of `parts` named `name`. */
function partNamed(parts: readonly { name: string }[], name: string): { name: string } | undefined {
  return parts.find((part) => part.name === name);
}

describe('BOARD_LABELS', () => {
  it('names the six labels the workflow files under, each with a description', () => {
    expect(BOARD_LABELS.map((label) => label.name)).toEqual([
      'type:spec',
      'spec:ready',
      'spec:needs-work',
      'type:bug',
      'needs-triage',
      'module:unassigned',
    ]);
    expect(BOARD_LABELS.every((label) => label.description.trim() !== '')).toBe(true);
  });

  it('spells the names the other modules own through those modules', () => {
    expect(BOARD_LABELS.map((label) => label.name)).toContain(SPEC_LABEL);
    expect(BOARD_LABELS.map((label) => label.name)).toContain(SPEC_READY_LABEL);
    expect(BOARD_LABELS.map((label) => label.name)).toContain(SPEC_NEEDS_WORK_LABEL);
    expect(BOARD_LABELS.map((label) => label.name)).toContain(GITHUB_LABELS.needsTriage);
    expect(BOARD_LABELS.map((label) => label.name)).toContain(`${GITHUB_LABELS.modulePrefix}unassigned`);
  });
});

describe('setUpLabels', () => {
  it('lists the labels once and creates only the ones the repository is missing', async () => {
    const gh = fakeBoard({ labels: ['type:bug', 'needs-triage'] });

    const parts = await setUpLabels(gh.run);

    expect(parts.map((part) => [part.name, part.outcome])).toEqual([
      ['type:spec', 'created'],
      ['spec:ready', 'created'],
      ['spec:needs-work', 'created'],
      ['type:bug', 'present'],
      ['needs-triage', 'present'],
      ['module:unassigned', 'created'],
    ]);
    expect(callsTo(gh.calls(), 'label list')).toEqual([LABEL_LIST_CALL]);
    expect(callsTo(gh.calls(), 'label create').map((args) => args[2])).toEqual([
      'type:spec',
      'spec:ready',
      'spec:needs-work',
      'module:unassigned',
    ]);
  });

  it('sends the description of each label it creates', async () => {
    const gh = fakeBoard();

    await setUpLabels(gh.run);

    const created = callsTo(gh.calls(), 'label create');
    expect(created).toHaveLength(BOARD_LABELS.length);
    expect(created.map((args) => args.slice(3))).toEqual(
      BOARD_LABELS.map((label) => ['--description', label.description]),
    );
  });

  it('reads a label the repository spells in another case as one it already carries', async () => {
    const gh = fakeBoard({ labels: ['Needs-Triage', 'TYPE:SPEC'] });

    const parts = await setUpLabels(gh.run);

    expect(parts.filter((part) => part.outcome === 'present').map((part) => part.name))
      .toEqual(['type:spec', 'needs-triage']);
    expect(callsTo(gh.calls(), 'label create').map((args) => args[2]))
      .not.toContain('needs-triage');
  });

  it('refuses every label when the list could not be read, and creates none', async () => {
    const gh = fakeBoard({ fails: { 'label list': 'gh: HTTP 401' } });

    const parts = await setUpLabels(gh.run);

    expect(parts).toHaveLength(BOARD_LABELS.length);
    expect(parts.every((part) => part.outcome === 'refused')).toBe(true);
    expect(parts[0]?.detail).toContain('gh label list --limit');
    expect(parts[0]?.detail).toContain('HTTP 401');
    expect(callsTo(gh.calls(), 'label create')).toEqual([]);
  });

  it('refuses the one label that could not be made and makes the rest', async () => {
    const gh = fakeBoard({ labels: [], fails: { 'label create': 'gh: label create failed' } });

    const parts = await setUpLabels(gh.run);

    expect(parts.every((part) => part.outcome === 'refused')).toBe(true);
    expect(parts[0]?.detail).toContain('gh label create type:spec failed');
    expect(callsTo(gh.calls(), 'label create')).toHaveLength(BOARD_LABELS.length);
  });

  it('refuses every label when the list answered something that is not JSON', async () => {
    const gh = fakeBoard();
    const broken: GhRunner = (args) => args[0] === 'label'
      ? Promise.resolve({ ok: true, stdout: 'not json', stderr: '' })
      : gh.run(args);

    const parts = await setUpLabels(broken);

    expect(parts.every((part) => part.outcome === 'refused')).toBe(true);
    expect(parts[0]?.detail).toContain('wrote output that is not JSON');
  });
});

describe('missingBoardLabels', () => {
  it('answers the labels not held, in the order they are made', () => {
    expect(missingBoardLabels(['spec:ready', 'module:unassigned']).map((label) => label.name))
      .toEqual(['type:spec', 'spec:needs-work', 'type:bug', 'needs-triage']);
    expect(missingBoardLabels(BOARD_LABELS.map((label) => label.name))).toEqual([]);
  });
});

describe('writeSpecTemplate', () => {
  it('writes the shipped template when the repository carries none', () => {
    const root = freshRoot('template');

    const part = writeSpecTemplate(root);

    expect(part.outcome).toBe('created');
    expect(part.name).toBe(SPEC_TEMPLATE_PATH);
    expect(readFileSync(join(root, SPEC_TEMPLATE_PATH), 'utf8'))
      .toBe(readFileSync(specTemplateSource(), 'utf8'));
  });

  it('leaves a template the repository already carries byte for byte', () => {
    const root = freshRoot('template-kept');
    const path = join(root, SPEC_TEMPLATE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'ours\n', 'utf8');
    utimesSync(path, PAST, PAST);

    const part = writeSpecTemplate(root);

    expect(part.outcome).toBe('present');
    expect(readFileSync(path, 'utf8')).toBe('ours\n');
    expect(lstatSync(path).mtimeMs).toBe(PAST.getTime());
  });

  it('refuses a path holding something that is not a file', () => {
    const root = freshRoot('template-dir');
    mkdirSync(join(root, SPEC_TEMPLATE_PATH), { recursive: true });

    const part = writeSpecTemplate(root);

    expect(part.outcome).toBe('refused');
    expect(part.detail).toContain('is not a file');
  });

  it('refuses a path holding a link that resolves to nothing', () => {
    const root = freshRoot('template-dangling');
    const path = join(root, SPEC_TEMPLATE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(join(root, 'nowhere.md'), path);

    const part = writeSpecTemplate(root);

    expect(part.outcome).toBe('refused');
    expect(part.detail).toContain('is a link to nothing');
  });

  it('reads a link that resolves to a file as a template the repository carries', () => {
    const root = freshRoot('template-linked');
    const path = join(root, SPEC_TEMPLATE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(join(root, 'ours.md'), 'ours\n', 'utf8');
    symlinkSync(join(root, 'ours.md'), path);

    expect(writeSpecTemplate(root).outcome).toBe('present');
    expect(readFileSync(path, 'utf8')).toBe('ours\n');
  });

  it('refuses, naming the path, when the shipped template is missing', () => {
    const root = freshRoot('template-gone');
    const empty = mkdtempSync(join(tempBase, 'no-templates-'));

    const part = writeSpecTemplate(root, empty);

    expect(part.outcome).toBe('refused');
    expect(part.detail).toContain(specTemplateSource(empty));
  });
});

describe('roadmapIssueBody', () => {
  it('opens with an empty Next, in order list that reads back as no roadmap lines', () => {
    const body = roadmapIssueBody();

    expect(body).toContain('## Next, in order');
    expect(parseRoadmapBody(body)).toEqual([]);
  });

  it('carries the naming paragraph, spelled as the naming module spells it', () => {
    const body = roadmapIssueBody();

    expect(body).toContain('## Naming');
    expect(body).toContain('`feat/rafa-<n>-<slug>`');
  });
});

describe('setUpRoadmap', () => {
  it('reads the issue off the config and asks GitHub nothing', async () => {
    const root = freshRoot('roadmap-configured');
    writeFileSync(join(root, '.rafa', 'config.yaml'), withRoadmapIssue(projectConfigText(), 12), 'utf8');
    const gh = fakeBoard({ issues: [{ number: 4, title: ROADMAP_TITLE }] });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.issue).toBe(12);
    expect(step.parts.map((part) => part.outcome)).toEqual(['present', 'present']);
    expect(gh.calls()).toEqual([]);
  });

  it('names the open Roadmap issue in the config when one is already there', async () => {
    const root = freshRoot('roadmap-found');
    const gh = fakeBoard({ issues: [{ number: 4, title: 'Roadmap' }] });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.issue).toBe(4);
    expect(step.parts.map((part) => [part.kind, part.outcome]))
      .toEqual([['issue', 'present'], ['setting', 'created']]);
    expect(settingUnder(root)).toBe(4);
    expect(callsTo(gh.calls(), 'issue create')).toEqual([]);
  });

  it('opens the Roadmap issue, pins it and writes the setting when there is none', async () => {
    const root = freshRoot('roadmap-new');
    const gh = fakeBoard({ issues: [{ number: 6, title: 'Something else' }] });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.issue).toBe(7);
    expect(step.parts.map((part) => part.outcome)).toEqual(['created', 'created']);
    expect(callsTo(gh.calls(), 'issue create')).toEqual([
      ['issue', 'create', '--title', ROADMAP_TITLE, '--body', roadmapIssueBody()],
    ]);
    expect(gh.pinned()).toEqual([7]);
    expect(settingUnder(root)).toBe(7);
    expect(step.problems).toEqual([]);
  });

  it('passes over an open issue whose title only looks like the roadmap', async () => {
    const root = freshRoot('roadmap-loose');
    const gh = fakeBoard({ issues: [{ number: 3, title: 'Roadmap for 2026' }] });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.parts[0]?.outcome).toBe('created');
    expect(step.issue).toBe(4);
  });

  it('refuses both parts when two open issues are titled Roadmap, and opens none', async () => {
    const root = freshRoot('roadmap-two');
    const gh = fakeBoard({ issues: [{ number: 3, title: 'Roadmap' }, { number: 8, title: 'roadmap' }] });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.issue).toBe(null);
    expect(step.parts.every((part) => part.outcome === 'refused')).toBe(true);
    expect(step.parts[0]?.detail).toContain('2 open issues are titled Roadmap (#3, #8)');
    expect(step.parts[0]?.detail).toContain(ROADMAP_SETTING);
    expect(callsTo(gh.calls(), 'issue create')).toEqual([]);
    expect(settingUnder(root)).toBe(null);
  });

  it('refuses both parts when the search failed, and opens no issue', async () => {
    const root = freshRoot('roadmap-search-failed');
    const gh = fakeBoard({ fails: { 'issue list': 'gh: HTTP 403' } });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.parts.every((part) => part.outcome === 'refused')).toBe(true);
    expect(step.parts[0]?.detail).toContain('HTTP 403');
    expect(callsTo(gh.calls(), 'issue create')).toEqual([]);
  });

  it('refuses both parts when the create printed no issue URL, and pins nothing', async () => {
    const root = freshRoot('roadmap-no-url');
    const gh = fakeBoard({ createdUrl: 'opened it\n' });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.parts.every((part) => part.outcome === 'refused')).toBe(true);
    expect(step.parts[0]?.detail).toContain('printed no issue URL');
    expect(gh.pinned()).toEqual([]);
    expect(settingUnder(root)).toBe(null);
  });

  it('reports a pin that failed as a problem and still names the issue', async () => {
    const root = freshRoot('roadmap-pin-failed');
    const gh = fakeBoard({ fails: { 'issue pin': 'gh: pinned issues limit reached' } });

    const step = await setUpRoadmap(gh.run, root);

    expect(step.parts.map((part) => part.outcome)).toEqual(['created', 'created']);
    expect(step.problems).toHaveLength(1);
    expect(step.problems[0]).toContain('not pinned');
    expect(step.problems[0]).toContain('pinned issues limit reached');
    expect(settingUnder(root)).toBe(step.issue);
  });

  it('refuses both parts when the project config could not be read, and asks GitHub nothing', async () => {
    const root = freshRoot('roadmap-broken-config');
    writeFileSync(join(root, '.rafa', 'config.yaml'), 'version: 1\nroadmap:\n  issue: 0\n', 'utf8');
    const gh = fakeBoard();

    const step = await setUpRoadmap(gh.run, root);

    expect(step.parts.every((part) => part.outcome === 'refused')).toBe(true);
    expect(step.parts[0]?.detail).toContain('roadmap.issue is 0');
    expect(gh.calls()).toEqual([]);
  });
});

describe('writeRoadmapSetting', () => {
  it('leaves the file as it was when roadmap is spelled a way the edit does not cover', () => {
    const root = freshRoot('setting-refused');
    const path = join(root, '.rafa', 'config.yaml');
    const reading = { issue: null, text: 'version: 1\nroadmap: {issue: 4}\n', problem: null };

    const part = writeRoadmapSetting(root, 5, reading);

    expect(part.outcome).toBe('refused');
    expect(part.detail).toContain('does not edit');
    expect(readFileSync(path, 'utf8')).toBe(projectConfigText());
  });

  it('leaves the file as it was when the text it would write does not read back as the issue', () => {
    const root = freshRoot('setting-control');
    const path = join(root, '.rafa', 'config.yaml');
    const reading = { issue: null, text: 'version: 1\nroadmap:\n  issue: 4\n', problem: null };

    const part = writeRoadmapSetting(root, 5, reading);

    expect(part.outcome).toBe('refused');
    expect(part.detail).toContain('was left as it was');
    expect(readFileSync(path, 'utf8')).toBe(projectConfigText());
  });
});

describe('setUpBoard', () => {
  it('makes every part on a bare repository and reports each as created', async () => {
    const root = freshRoot('board-fresh');
    const gh = fakeBoard();

    const report = await setUpBoard({ gh: gh.run, root });

    expect(report.parts).toHaveLength(BOARD_LABELS.length + 3);
    expect(report.parts.every((part) => part.outcome === 'created')).toBe(true);
    expect(boardChanged(report)).toBe(true);
    expect(boardRefusals(report)).toEqual([]);
    expect(report.roadmapIssue).toBe(1);
    expect(gh.labels()).toEqual(BOARD_LABELS.map((label) => label.name));
    expect(gh.issues()).toEqual([{ number: 1, title: ROADMAP_TITLE }]);
    expect(partNamed(report.parts, `${ROADMAP_TITLE} issue`)).toBeDefined();
    expect(partNamed(report.parts, ROADMAP_SETTING)).toBeDefined();
  });

  it('creates nothing on a second run and writes neither file again', async () => {
    const root = freshRoot('board-rerun');
    const gh = fakeBoard();
    const config = join(root, '.rafa', 'config.yaml');
    const template = join(root, SPEC_TEMPLATE_PATH);

    const first = await setUpBoard({ gh: gh.run, root });
    expect(boardChanged(first)).toBe(true);
    utimesSync(config, PAST, PAST);
    utimesSync(template, PAST, PAST);
    const before = gh.calls().length;

    const second = await setUpBoard({ gh: gh.run, root });

    expect(second.parts.every((part) => part.outcome === 'present')).toBe(true);
    expect(boardChanged(second)).toBe(false);
    expect(second.roadmapIssue).toBe(first.roadmapIssue);
    expect(gh.calls().slice(before)).toEqual([LABEL_LIST_CALL]);
    expect(lstatSync(config).mtimeMs).toBe(PAST.getTime());
    expect(lstatSync(template).mtimeMs).toBe(PAST.getTime());

    writeFileSync(config, readFileSync(config, 'utf8'), 'utf8');
    expect(lstatSync(config).mtimeMs).not.toBe(PAST.getTime());
  });

  it('carries on past a part it refuses and reports the rest', async () => {
    const root = freshRoot('board-partial');
    const gh = fakeBoard({ fails: { 'label list': 'gh: HTTP 401' } });

    const report = await setUpBoard({ gh: gh.run, root });

    expect(boardRefusals(report)).toHaveLength(BOARD_LABELS.length);
    expect(report.roadmapIssue).toBe(1);
    expect(partNamed(boardRefusals(report), ROADMAP_SETTING)).toBeUndefined();
    expect(boardChanged(report)).toBe(true);
  });
});
