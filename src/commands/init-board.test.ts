/**
 * Tests for the board step (`init-board.ts`): the visibility reading,
 * the one question and the line a public repository gets above it, the
 * order `runBoardStep` decides in, and the rows text mode prints.
 *
 * Every case drives {@link fakeGh}, a `gh` runner holding the labels,
 * the open issues and the visibility of one imaginary repository in
 * memory and keeping every argument list it was handed, and a scripted
 * prompter that records what it was told, what it was asked and whether
 * it was closed. No case spawns a process, reaches GitHub, reads a real
 * repository or touches the home: each root is a directory under this
 * file's own temporary root, holding the bytes `rafa init` writes as its
 * config. What each part of the board comes to is `src/board/setup.ts`'s
 * and is held beside it; what is held here is what decides that it runs
 * at all.
 *
 * ## What passes while wrong
 *
 * Every case that holds the step NOT running also holds that nothing
 * was sent and nobody was asked — `calls` empty and the prompter never
 * opened — because a step reported as declined while it made six labels
 * is the failure that costs a repository a board it said no to. The
 * `--board` case holds the same about the visibility probe: no
 * `repo view` is sent when there is no question to word, which is the
 * reading that would otherwise pass while a round trip is spent on
 * every scripted run.
 *
 * Three mutations of `init-board.ts` were driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/commands/init-board.test.ts
 * src/commands/init.test.ts`, the module restored from a scratch copy
 * after each and verified with `shasum -c`. The two files read 51 pass
 * either side of all three, and each reddened two cases:
 *
 *  - the no-terminal answer dropped, so a run nobody can answer opens
 *    the prompter: the terminal case here and `init.test.ts`'s;
 *  - the public line said whatever the visibility, so a private
 *    repository is told its issues are public: the question case and
 *    the one where the probe failed;
 *  - the `--no-board` answer dropped, so the flag that leaves the board
 *    alone sets it up: the decline case here and `init.test.ts`'s.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { Prompter } from '../project/root-choice.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_LABELS, SPEC_TEMPLATE_PATH } from '../board/setup.js';
import { parseConfigText } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import {
  askBoard,
  BOARD_FIX,
  BOARD_HEADING,
  BOARD_QUESTION,
  boardPartLine,
  boardStepChanged,
  notGitHubWarning,
  PUBLIC_REPO_LINE,
  readVisibility,
  renderBoardStep,
  runBoardStep,
  visibilityWarning,
} from './init-board.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-board-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

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

/** What a fake repository answers, and which commands fail on it. */
interface FakeOptions {
  /** What `gh repo view --json visibility` answers as the visibility. */
  readonly visibility?: string;
  /** The command prefixes that fail, each with what the failure writes. */
  readonly fails?: Readonly<Record<string, string>>;
  /** What `gh repo view` writes instead of an object, when it should write something else. */
  readonly repoView?: string;
}

/** A `gh` runner over one imaginary repository; see the module note. */
function fakeGh(options: FakeOptions = {}): {
  run: GhRunner;
  calls: () => readonly (readonly string[])[];
  routes: () => readonly string[];
} {
  const calls: (readonly string[])[] = [];
  const labels: string[] = [];
  const fails = options.fails ?? {};

  const run: GhRunner = (args) => {
    calls.push([...args]);
    const route = args.slice(0, 2).join(' ');
    const failure = fails[route];
    if (failure !== undefined) return Promise.resolve({ ok: false, stdout: '', stderr: failure });

    const ok = (stdout: string): Promise<GhResult> => Promise.resolve({ ok: true, stdout, stderr: '' });
    if (route === 'repo view') {
      return ok(options.repoView ?? JSON.stringify({ visibility: options.visibility ?? 'PRIVATE' }));
    }
    if (route === 'label list') return ok(JSON.stringify(labels.map((name) => ({ name }))));
    if (route === 'label create') {
      labels.push(args[2] ?? '');
      return ok('');
    }
    if (route === 'issue list') return ok('[]');
    if (route === 'issue create') return ok('https://github.com/acme/widgets/issues/7\n');
    if (route === 'issue pin') return ok('');
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${route}` });
  };

  return {
    run,
    calls: () => calls,
    routes: () => calls.map((args) => args.slice(0, 2).join(' ')),
  };
}

/** A prompter answering from `answers`, then null, recording what it was told. */
function scripted(answers: readonly string[]) {
  const record = { said: [] as string[], asked: [] as string[], opened: 0, closed: 0 };
  const queue = [...answers];
  const prompter: Prompter = {
    say: (text) => {
      record.said.push(text);
    },
    ask: (question) => {
      record.asked.push(question);
      return Promise.resolve(queue.shift() ?? null);
    },
    close: () => {
      record.closed += 1;
    },
  };
  return {
    record,
    open: (): Prompter => {
      record.opened += 1;
      return prompter;
    },
  };
}

/** A prompter nobody may open. */
function noPrompter(): Prompter {
  throw new Error('the board step opened a prompter where none was expected');
}

describe('reading the visibility', () => {
  it('reads PUBLIC as public and PRIVATE as not, however gh cases it', async () => {
    const gh = fakeGh({ visibility: 'PUBLIC' });

    const readPublic = await readVisibility(gh.run);
    const readPrivate = await readVisibility(fakeGh({ visibility: 'private' }).run);
    const readInternal = await readVisibility(fakeGh({ visibility: 'INTERNAL' }).run);

    expect([readPublic.isPublic, readPublic.problem]).toEqual([true, null]);
    expect([readPrivate.isPublic, readPrivate.problem]).toEqual([false, null]);
    expect(readInternal.isPublic).toBe(false);
    expect(gh.calls()).toEqual([['repo', 'view', '--json', 'visibility']]);
  });

  it('answers the problem, and no reading, for a command that failed or wrote a shape it does not read', async () => {
    const failed = await readVisibility(fakeGh({ fails: { 'repo view': 'no git remotes found' } }).run);
    const notJson = await readVisibility(fakeGh({ repoView: 'not json' }).run);
    const notAString = await readVisibility(fakeGh({ repoView: '{"visibility":3}' }).run);

    expect(failed.isPublic).toBeNull();
    expect(failed.problem).toBe('gh repo view --json visibility failed: no git remotes found');
    expect(notJson.isPublic).toBeNull();
    expect(notJson.problem).toContain('wrote output that is not JSON');
    expect(notAString.isPublic).toBeNull();
    expect(notAString.problem).toBe('gh repo view --json visibility answered visibility as 3, expected a string');
  });
});

describe('the question', () => {
  it('says the public line above it only for a public repository', async () => {
    const onPublic = scripted(['y']);
    const onPrivate = scripted(['y']);

    await askBoard(onPublic.open(), true);
    await askBoard(onPrivate.open(), false);

    expect(onPublic.record.said).toEqual([PUBLIC_REPO_LINE]);
    expect(onPublic.record.asked).toEqual([BOARD_QUESTION]);
    expect(onPrivate.record.said).toEqual([]);
    expect(onPrivate.record.asked).toEqual([BOARD_QUESTION]);
  });

  it('takes y and yes, however cased or padded, and nothing else', async () => {
    const answers = ['y', 'YES', ' yes ', 'n', '', 'sure'];

    const read = [];
    for (const answer of answers) read.push(await askBoard(scripted([answer]).open(), false));

    expect(read).toEqual([true, true, true, false, false, false]);
    expect(await askBoard(scripted([]).open(), false)).toBe(false);
  });
});

describe('whether the step runs', () => {
  it('declines under --no-board, asking nothing and sending nothing', async () => {
    const gh = fakeGh();
    const root = freshRoot('no-board');

    const result = await runBoardStep({
      wanted: false,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result).toEqual({ status: 'declined', asked: false, report: null, warnings: [] });
    expect(gh.calls()).toEqual([]);
    expect(existsSync(join(root, SPEC_TEMPLATE_PATH))).toBe(false);
    expect(renderBoardStep(result)).toEqual([`The GitHub board was left alone; run ${BOARD_FIX} to set it up.`]);
  });

  it('does not run on a repository whose provider is not gh, and warns only when --board asked for one', async () => {
    const gh = fakeGh();
    const root = freshRoot('not-github');

    const asked = await runBoardStep({
      wanted: true,
      provider: 'none',
      root,
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });
    const silent = await runBoardStep({
      wanted: null,
      provider: 'none',
      root,
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(asked.status).toBe('not-github');
    expect(asked.warnings).toEqual([notGitHubWarning('none')]);
    expect(silent.status).toBe('not-github');
    expect(silent.warnings).toEqual([]);
    expect(renderBoardStep(silent)).toEqual([]);
    expect(gh.calls()).toEqual([]);
  });

  it('does not run without a terminal to ask on, and names the flag that would', async () => {
    const gh = fakeGh();
    const root = freshRoot('no-terminal');

    const result = await runBoardStep({
      wanted: null,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => false,
      openPrompter: noPrompter,
    });

    expect(result.status).toBe('unanswered');
    expect(result.report).toBeNull();
    expect(gh.calls()).toEqual([]);
    expect(renderBoardStep(result)).toEqual([`The GitHub board step needs a terminal; run ${BOARD_FIX} to set it up.`]);
  });

  it('sets the board up under --board without asking, and without reading the visibility', async () => {
    const gh = fakeGh({ visibility: 'PUBLIC' });
    const root = freshRoot('board-flag');

    const result = await runBoardStep({
      wanted: true,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect([result.status, result.asked]).toEqual(['ran', false]);
    expect(boardStepChanged(result)).toBe(true);
    expect(gh.routes()).not.toContain('repo view');
    expect(settingUnder(root)).toBe(7);
    expect(existsSync(join(root, SPEC_TEMPLATE_PATH))).toBe(true);
  });

  it('asks once on a terminal, says the public line, and sets the board up on a yes', async () => {
    const gh = fakeGh({ visibility: 'PUBLIC' });
    const prompter = scripted(['y']);
    const root = freshRoot('asked-yes');

    const result = await runBoardStep({
      wanted: null,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: prompter.open,
    });

    expect([result.status, result.asked]).toEqual(['ran', true]);
    expect(prompter.record.asked).toEqual([BOARD_QUESTION]);
    expect(prompter.record.said).toEqual([PUBLIC_REPO_LINE]);
    expect(prompter.record.closed).toBe(1);
    expect(gh.routes()[0]).toBe('repo view');
    expect(settingUnder(root)).toBe(7);
  });

  it('makes nothing when the question is answered with anything but yes, and closes the prompter', async () => {
    const gh = fakeGh();
    const prompter = scripted(['']);
    const root = freshRoot('asked-no');

    const result = await runBoardStep({
      wanted: null,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: prompter.open,
    });

    expect([result.status, result.asked]).toEqual(['declined', true]);
    expect(boardStepChanged(result)).toBe(false);
    expect(gh.routes()).toEqual(['repo view']);
    expect(prompter.record.closed).toBe(1);
    expect(settingUnder(root)).toBeNull();
    expect(existsSync(join(root, SPEC_TEMPLATE_PATH))).toBe(false);
  });

  it('asks without the public line when the visibility cannot be read, and warns that it could not', async () => {
    const gh = fakeGh({ fails: { 'repo view': 'gh: command not found' } });
    const prompter = scripted(['yes']);
    const root = freshRoot('blind');

    const result = await runBoardStep({
      wanted: null,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => true,
      openPrompter: prompter.open,
    });

    expect(result.status).toBe('ran');
    expect(prompter.record.said).toEqual([]);
    expect(result.warnings).toEqual([
      visibilityWarning('gh repo view --json visibility failed: gh: command not found'),
    ]);
  });

  it('carries the sentences the setup came back with, such as an issue that was opened but not pinned', async () => {
    const gh = fakeGh({ fails: { 'issue pin': 'could not pin' } });
    const root = freshRoot('unpinned');

    const result = await runBoardStep({
      wanted: true,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => false,
      openPrompter: noPrompter,
    });

    expect(result.status).toBe('ran');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('was opened but not pinned');
    expect(settingUnder(root)).toBe(7);
  });

  it('creates nothing on a second run over the board it made, and says so part by part', async () => {
    const gh = fakeGh();
    const root = freshRoot('twice');
    const options = {
      wanted: true,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => false,
      openPrompter: noPrompter,
    } as const;

    const first = await runBoardStep(options);
    const sentFirst = gh.routes().length;
    const again = await runBoardStep(options);
    const made = gh.routes()
      .slice(0, sentFirst)
      .filter((route) => route === 'label create');

    expect(boardStepChanged(first)).toBe(true);
    expect(made).toHaveLength(BOARD_LABELS.length);
    expect(boardStepChanged(again)).toBe(false);
    expect(again.report?.parts.every((part) => part.outcome === 'present')).toBe(true);
    expect(gh.routes().slice(sentFirst)).toEqual(['label list']);
  });
});

describe('the rows text mode prints', () => {
  it('opens with the heading and gives one row per part, a label under its kind', async () => {
    const gh = fakeGh();
    const root = freshRoot('rows');

    const result = await runBoardStep({
      wanted: true,
      provider: 'gh',
      root,
      openGh: () => gh.run,
      isTerminal: () => false,
      openPrompter: noPrompter,
    });
    const lines = renderBoardStep(result);

    expect(lines[0]).toBe(BOARD_HEADING);
    expect(lines).toHaveLength(BOARD_LABELS.length + 4);
    expect(lines[1]).toBe('  created  label type:spec');
    expect(lines.some((line) => line.startsWith(`  created  ${SPEC_TEMPLATE_PATH}`))).toBe(true);
    expect(lines.some((line) => line.startsWith('  created  Roadmap issue'))).toBe(true);
  });

  it('carries the detail of a part refused or made, a label it made and one already there apart', () => {
    const created = boardPartLine({ kind: 'issue', name: 'Roadmap issue', outcome: 'created', detail: 'issue #7 opened and pinned' });
    const present = boardPartLine({ kind: 'label', name: 'type:bug', outcome: 'present', detail: 'the repository already carries it' });
    const madeLabel = boardPartLine({ kind: 'label', name: 'type:spec', outcome: 'created', detail: 'made with the description ...' });
    const refused = boardPartLine({ kind: 'setting', name: 'roadmap.issue', outcome: 'refused', detail: 'it would not parse' });
    const refusedLabel = boardPartLine({ kind: 'label', name: 'spec:ready', outcome: 'refused', detail: 'gh label create failed' });

    expect(created).toBe('  created  Roadmap issue: issue #7 opened and pinned');
    expect(present).toBe('  present  label type:bug');
    expect(madeLabel).toBe('  created  label type:spec');
    expect(refused).toBe('  refused  roadmap.issue: it would not parse');
    expect(refusedLabel).toBe('  refused  label spec:ready: gh label create failed');
  });
});
