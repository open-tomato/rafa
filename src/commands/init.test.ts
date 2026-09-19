/**
 * Tests for `rafa init` (`init.ts`): how the root is chosen under
 * `--root`, `--yes`, a terminal and no terminal, what is written under
 * the root and the home, a rerun, the refusals, the `PATH` check, json
 * mode, the agent warning, and the registered command spawned.
 *
 * The agent cases plant a `~/.claude/agents` and a `plan.dir` plan under
 * the world, never the real home, and each narrowing carries its
 * control: the same plan with the definition vendored into the project,
 * and a plan naming an agent no home file carries, both warn nothing.
 *
 * ## The world
 *
 * Each case plants a world under this file's own temporary root: a home,
 * a repository and a subdirectory of it the command runs from. The
 * in-process cases dispatch a command made over seams naming that world,
 * with a git probe answering the repository for any directory in it and
 * no repository elsewhere, a terminal that is absent unless a case says
 * otherwise, and a prompter that throws when opened unless a case scripts
 * one. Each hands the dispatcher a `PATH` of its own, `~/.rafa/bin` of
 * the world's home unless the case is about the `PATH`, so no case reads
 * the real home or the `PATH` this suite runs under.
 *
 * ## Nothing written, and no byte changed
 *
 * A refusal is held to leave the whole world as it was: every path under
 * it, with its bytes and its modification time, read before and after. A
 * rerun is held harder: every path is set to one instant in 2001 first,
 * and none has moved after. The control sets a `tracking` flag in the
 * project's config and reruns under the same reading, which finds the
 * `.gitignore` and the digest moved and nothing else, so the reading can
 * fail.
 *
 * ## Spawned
 *
 * Two cases run `bun src/rafa.ts init` in a scratch repository through
 * `src/tests/cli-capture.ts`, whose child gets a scratch HOME, a PATH of
 * a `bin/` of its own and git's directory, and a standard input that is
 * no terminal. So the registered command's own seams are read: the
 * working directory, `homedir()`, `process.stdin` and the real git.
 *
 * ## The board step
 *
 * The seams answer no `origin` and open a `gh` runner that throws, so
 * every case but the board ones resolves `pr.provider: none`, runs no
 * board step and reaches neither git nor GitHub — and a case that
 * reached for a runner would say so rather than spawn one. The board
 * cases hand in an `origin` of their own and a `gh` runner over one
 * imaginary repository ({@link fakeGh}); what each part of the board
 * comes to is held in `init-board.test.ts` and `src/board/setup.test.ts`,
 * and what is held here is the step reaching the command's output, its
 * json result and its warnings.
 */
import type { InitResult, InitSeams } from './init.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Prompter } from '../project/root-choice.js';

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { readBinPath } from '../project/bin-path.js';
import { BLOCK_BEGIN, BLOCK_END } from '../project/gitignore.js';
import { candidateLines } from '../project/root-choice.js';
import { rootCandidates } from '../project/roots.js';
import { PROJECT_TREE, projectConfigText, userConfigText } from '../project/scaffold.js';
import { dispatchCaptured, eventsOf, plantScratchRepo, runRafa } from '../tests/cli-capture.js';

import { createInitCommand, DEFAULT_INIT_SEAMS, readBoardFlag, readRootFlag, readYesFlag } from './init.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The instant every path is set to before a rerun: 2001-09-09T01:46:40Z. */
const PAST = new Date(1_000_000_000_000);

/** A world a case runs `init` in. */
interface World {
  /** The directory holding the rest. */
  readonly base: string;
  readonly home: string;
  /** The repository the git probe answers. */
  readonly repo: string;
  /** A subdirectory of the repository, the working directory. */
  readonly sub: string;
  /** `~/.rafa/bin` of the home: the PATH a case not about the PATH hands in. */
  readonly rafaBin: string;
  /** `~/.bun/bin` of the home. */
  readonly bunBin: string;
}

/** Plants a fresh world under the temporary root. */
function plantWorld(): World {
  const base = mkdtempSync(join(tempBase, 'world-'));
  const home = join(base, 'home');
  const repo = join(base, 'repo');
  const sub = join(repo, 'sub');
  mkdirSync(home);
  mkdirSync(sub, { recursive: true });
  return { base, home, repo, sub, rafaBin: join(home, '.rafa', 'bin'), bunBin: join(home, '.bun', 'bin') };
}

/** The seams of `world`, with `overrides`; see the module note. */
function seamsFor(world: World, overrides: Partial<InitSeams> = {}): InitSeams {
  return {
    ...DEFAULT_INIT_SEAMS,
    cwd: () => world.sub,
    home: () => world.home,
    isTerminal: () => false,
    openPrompter: () => {
      throw new Error('init opened a prompter where none was expected');
    },
    gitToplevel: (dir) => dir === world.repo || dir.startsWith(`${world.repo}/`)
      ? world.repo
      : null,
    readRemote: () => null,
    gh: () => {
      throw new Error('init opened a gh runner where none was expected');
    },
    ...overrides,
  };
}

/** Dispatches `rafa init` with `words` over `seams`, handing it `path` as the PATH. */
async function init(world: World, words: readonly string[], seams = seamsFor(world), path = world.rafaBin) {
  return dispatchCaptured(['init', ...words], [], [createInitCommand(seams)], { PATH: path });
}

/** The data of a json-mode run's terminal result. */
function resultOf(stdout: string): InitResult {
  const result = eventsOf(stdout).find((event) => event.type === 'result') as { data?: unknown } | undefined;
  return result?.data as InitResult;
}

/** A prompter answering from `answers`, then null, recording what it was told and whether it was closed. */
function scripted(answers: readonly string[]) {
  const record = { said: [] as string[], asked: 0, opened: 0, closed: 0 };
  const queue = [...answers];
  const prompter: Prompter = {
    say: (text) => {
      record.said.push(text);
    },
    ask: async () => {
      record.asked += 1;
      return queue.shift() ?? null;
    },
    close: () => {
      record.closed += 1;
    },
  };
  const open = (): Prompter => {
    record.opened += 1;
    return prompter;
  };
  return { record, open };
}

/** What a fake GitHub repository answers, and which commands fail on it. */
interface FakeGhOptions {
  /** The command prefixes that fail, each with what the failure writes. */
  readonly fails?: Readonly<Record<string, string>>;
}

/**
 * A `gh` runner over one imaginary repository, private and holding no
 * label and no issue, keeping the first two words of every call. What
 * each part of the board comes to is held in `init-board.test.ts` and
 * `src/board/setup.test.ts`; this is here so a case can drive the step
 * through the command without reaching GitHub.
 */
function fakeGh(options: FakeGhOptions = {}) {
  const routes: string[] = [];
  const labels: string[] = [];
  const fails = options.fails ?? {};

  const run: GhRunner = (args) => {
    const route = args.slice(0, 2).join(' ');
    routes.push(route);
    const failure = fails[route];
    if (failure !== undefined) return Promise.resolve({ ok: false, stdout: '', stderr: failure });

    const ok = (stdout: string) => Promise.resolve({ ok: true, stdout, stderr: '' });
    if (route === 'repo view') return ok(JSON.stringify({ visibility: 'PRIVATE' }));
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

  return { run, routes: () => [...routes] };
}

/** Every path under `dir`, `dir` first. */
function pathsUnder(dir: string): readonly string[] {
  const children = lstatSync(dir).isDirectory()
    ? readdirSync(dir).flatMap((name) => pathsUnder(join(dir, name)))
    : [];
  return [dir, ...children];
}

/** Every path under `dir` with its modification time and its bytes, sorted by path. */
function stateOf(dir: string): readonly string[] {
  return pathsUnder(dir)
    .map((path) => {
      const stat = lstatSync(path);
      const body = stat.isDirectory()
        ? '<directory>'
        : readFileSync(path, 'utf8');
      return `${path} ${String(stat.mtimeMs)} ${body}`;
    })
    .sort((a, b) => a.localeCompare(b));
}

/** Sets every path under `dir` to {@link PAST}. */
function ageAll(dir: string): void {
  for (const path of [...pathsUnder(dir)].reverse()) utimesSync(path, PAST, PAST);
}

/** Each path under `dir` whose modification time is no longer {@link PAST}, sorted. */
function movedSincePast(dir: string): readonly string[] {
  return pathsUnder(dir)
    .filter((path) => lstatSync(path).mtimeMs !== PAST.getTime())
    .sort((a, b) => a.localeCompare(b));
}

/** The text-mode lines a first init under `root` lists, the user scope under `home`. */
function createdLines(root: string, home: string): readonly string[] {
  return [
    '  created   .rafa/',
    '  created   .rafa/config.yaml',
    ...PROJECT_TREE.map((name) => `  created   .rafa/${name}/`),
    '  created   .gitignore',
    '  created   .rafa/tracking.digest',
    `  created   ${join(home, '.rafa')}/`,
    `  created   ${join(home, '.rafa', 'config.yaml')}`,
    `  created   ${join(home, '.rafa', 'instincts')}/`,
  ].map((line) => line.replace(root, ''));
}

describe('choosing the root', () => {
  it('sets up the project at the root --root names, relative to the working directory, asking nothing', async () => {
    const world = plantWorld();

    const run = await init(world, ['--root=..'], seamsFor(world, { isTerminal: () => true }));

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout.split('\n')[0]).toBe(`Initialised a rafa project at ${world.repo} (named by --root).`);
    expect(existsSync(join(world.repo, '.rafa', 'config.yaml'))).toBe(true);
    expect(existsSync(join(world.sub, '.rafa'))).toBe(false);
  });

  it('takes the git toplevel above the working directory under --yes', async () => {
    const world = plantWorld();

    const run = await init(world, ['--yes', '--output=json']);

    expect(run.exitCode).toBe(0);
    expect([resultOf(run.stdout).root, resultOf(run.stdout).source]).toEqual([world.repo, 'git-toplevel']);
  });

  it('takes the working directory under --yes outside a repository', async () => {
    const world = plantWorld();

    const run = await init(world, ['--yes', '--output=json'], seamsFor(world, { gitToplevel: () => null }));

    expect([resultOf(run.stdout).root, resultOf(run.stdout).source]).toEqual([world.sub, 'directory']);
  });

  it('warns about a package.json above the root the monorepo walk could not read, and still takes the first candidate', async () => {
    const world = plantWorld();
    writeFileSync(join(world.base, 'package.json'), '{ not json');

    const run = await init(world, ['--yes']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')[0]).toStartWith(`warn: ${join(world.base, 'package.json')} was not read as a monorepo marker (`);
    expect(run.stdout.split('\n')[1]).toBe(`Initialised a rafa project at ${world.repo} (the git toplevel).`);
  });

  it('lets --root outrank --yes', async () => {
    const world = plantWorld();

    const run = await init(world, ['--yes', `--root=${world.sub}`, '--output=json']);

    expect([resultOf(run.stdout).root, resultOf(run.stdout).source]).toEqual([world.sub, 'root-flag']);
  });

  it('refuses the first candidate under --yes when it is refused, listing the candidates, and writes nothing', async () => {
    const world = plantWorld();
    const seams = seamsFor(world, { cwd: () => world.home, gitToplevel: () => null });
    const before = stateOf(world.base);

    const run = await init(world, ['--yes'], seams);

    const found = rootCandidates(world.home, { home: world.home, gitToplevel: () => null });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe([
      `rafa init: refused: ${world.home} is the home directory, whose .rafa/ is the user scope`,
      ...candidateLines(found),
      'Name another root with --root=<path>.',
      'Nothing was written.',
      '',
    ].join('\n'));
    expect(stateOf(world.base)).toEqual(before);
  });

  it.each([
    ['the scratch home', (world: World) => world.home, (world: World) => `${world.home} is the home directory, whose .rafa/ is the user scope`],
    ['/', () => '/', () => '/ is the filesystem root'],
  ])('refuses %s named by --root with its reason, and writes nothing', async (_label, rootOf, reasonOf) => {
    const world = plantWorld();
    const before = stateOf(world.base);

    const run = await init(world, [`--root=${rootOf(world)}`]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe(`rafa init: refused: ${reasonOf(world)}\nNothing was written.\n`);
    expect(stateOf(world.base)).toEqual(before);
  });

  it('refuses without a terminal when neither flag is given, listing the candidates and naming both flags', async () => {
    const world = plantWorld();
    const before = stateOf(world.base);

    const run = await init(world, []);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe([
      'rafa init: no terminal to choose a root on.',
      `Root candidates for a rafa project, from ${world.sub}:`,
      `  1) ${world.repo}   the git toplevel`,
      'Take the first candidate with --yes, or name a root with --root=<path>.',
      'Nothing was written.',
      '',
    ].join('\n'));
    expect(stateOf(world.base)).toEqual(before);
  });

  it('lists the candidates on a terminal and takes the root an answer names, after saying each problem', async () => {
    const world = plantWorld();
    writeFileSync(join(world.base, 'package.json'), JSON.stringify({ workspaces: ['repo'] }));
    const script = scripted(['9', '2']);
    const seams = seamsFor(world, { isTerminal: () => true, openPrompter: script.open });

    const run = await init(world, ['--output=json'], seams);

    const found = rootCandidates(world.sub, { home: world.home, gitToplevel: seams.gitToplevel });
    expect(found.candidates.map((candidate) => candidate.path)).toEqual([world.repo, world.base]);
    expect(run.exitCode).toBe(0);
    expect([resultOf(run.stdout).root, resultOf(run.stdout).source]).toEqual([world.base, 'monorepo']);
    expect(script.record).toEqual({
      said: [candidateLines(found).join('\n'), 'no candidate is numbered 9; type 1 to 2, or a path'],
      asked: 2,
      opened: 1,
      closed: 1,
    });
  });

  it('refuses when the input ends before a root is chosen, closing the prompter and writing nothing', async () => {
    const world = plantWorld();
    const script = scripted([]);
    const before = stateOf(world.base);

    const run = await init(world, [], seamsFor(world, { isTerminal: () => true, openPrompter: script.open }));

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe('rafa init: the input ended before a root was chosen.\nNothing was written.\n');
    expect([script.record.opened, script.record.closed]).toEqual([1, 1]);
    expect(stateOf(world.base)).toEqual(before);
  });

  it('refuses a positional word, a value read for --yes and a --root with no path', async () => {
    const world = plantWorld();

    const runs = [
      await init(world, ['somewhere']),
      await init(world, ['--yes', 'somewhere']),
      await init(world, ['--root']),
    ];

    expect(runs.map((run) => run.exitCode)).toEqual([1, 1, 1]);
    expect(runs.map((run) => run.stderr.split('\n')[0])).toEqual([
      'rafa init: expected no argument, got 1: somewhere; name a root with --root=<path>',
      'rafa init: --yes takes no value, and read "somewhere" as one; name a root with --root=<path>',
      'rafa init: --root needs a path: --root=<path>',
    ]);
    expect(existsSync(join(world.repo, '.rafa'))).toBe(false);
  });

  it('reads --yes as true or false and --root as a path, refusing anything else', () => {
    expect([undefined, false, 'false', true, 'true'].map(readYesFlag)).toEqual([false, false, false, true, true]);
    expect([readRootFlag(undefined), readRootFlag('.')]).toEqual([null, '.']);
    expect(() => readRootFlag('')).toThrow('--root needs a path');
    expect(() => readRootFlag(false)).toThrow('--root needs a path');
  });

  it('reads --board as true, --no-board as false and neither as nobody having said, refusing a value', () => {
    expect([readBoardFlag(undefined), readBoardFlag(true), readBoardFlag('true')]).toEqual([null, true, true]);
    expect([readBoardFlag(false), readBoardFlag('false')]).toEqual([false, false]);
    expect(() => readBoardFlag('later')).toThrow('--board takes no value');
  });

  it('refuses a value read for --board before a root is chosen, writing nothing', async () => {
    const world = plantWorld();

    const run = await init(world, ['--yes', '--board=later']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr.split('\n')[0]).toBe(
      'rafa init: --board takes no value, and read "later" as one;'
      + ' set the board up with --board, or leave it alone with --no-board',
    );
    expect(run.stderr.trimEnd().endsWith('Nothing was written.')).toBe(true);
    expect(existsSync(join(world.repo, '.rafa'))).toBe(false);
  });
});

describe('what it writes', () => {
  it('writes the config, the tree, the .gitignore entry, the digest and the user scope, listing each created', async () => {
    const world = plantWorld();

    const run = await init(world, [`--root=${world.repo}`]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe([
      `Initialised a rafa project at ${world.repo} (named by --root).`,
      ...createdLines(world.repo, world.home),
      '',
    ].join('\n'));
    expect(readFileSync(join(world.repo, '.rafa', 'config.yaml'), 'utf8')).toBe(projectConfigText());
    expect(PROJECT_TREE.filter((name) => !lstatSync(join(world.repo, '.rafa', name)).isDirectory())).toEqual([]);
    expect(readFileSync(join(world.repo, '.gitignore'), 'utf8')).toBe(`${BLOCK_BEGIN}\n.rafa/\n${BLOCK_END}\n`);
    expect(readFileSync(join(world.home, '.rafa', 'config.yaml'), 'utf8')).toBe(userConfigText());
    expect(lstatSync(join(world.home, '.rafa', 'instincts')).isDirectory()).toBe(true);
  });

  it('changes no byte and no modification time on a rerun, in either mode, and says the project already is one', async () => {
    const world = plantWorld();
    await init(world, [`--root=${world.repo}`]);
    const bytes = stateOf(world.base).map((entry) => entry.replace(/ \d+(\.\d+)? /, ' '));
    ageAll(world.base);

    const text = await init(world, [`--root=${world.repo}`]);
    const json = await init(world, [`--root=${world.repo}`, '--output=json']);

    expect(text.stdout).toBe([
      `${world.repo} (named by --root) is already a rafa project: its .rafa/config.yaml is left as it was.`,
      'Nothing changed.',
      '',
    ].join('\n'));
    const result = resultOf(json.stdout);
    expect([result.configExisted, result.changed, result.trackingNotice]).toEqual([true, false, false]);
    expect(result.writes.filter((write) => write.change !== 'unchanged')).toEqual([]);
    expect(result.writes).toHaveLength(12);
    expect(movedSincePast(world.base)).toEqual([]);
    expect(stateOf(world.base).map((entry) => entry.replace(/ \d+(\.\d+)? /, ' '))).toEqual(bytes);
  });

  it('rewrites only the .gitignore block and the digest on a rerun after a tracking flag is set, so the rerun reading can fail', async () => {
    const world = plantWorld();
    await init(world, [`--root=${world.repo}`]);
    writeFileSync(join(world.repo, '.rafa', 'config.yaml'), `${projectConfigText()}tracking:\n  specs: true\n`);
    ageAll(world.base);

    const run = await init(world, [`--root=${world.repo}`]);

    expect(run.stdout).toBe([
      `${world.repo} (named by --root) is already a rafa project: its .rafa/config.yaml is left as it was.`,
      '  updated   .gitignore',
      '  updated   .rafa/tracking.digest',
      '',
    ].join('\n'));
    expect(movedSincePast(world.base)).toEqual([join(world.repo, '.gitignore'), join(world.repo, '.rafa', 'tracking.digest')]);
    expect(readFileSync(join(world.repo, '.gitignore'), 'utf8')).toContain('!.rafa/specs/');
  });

  it('leaves an existing config as it was and writes the scope missing beside it', async () => {
    const world = plantWorld();
    mkdirSync(join(world.repo, '.rafa'));
    writeFileSync(join(world.repo, '.rafa', 'config.yaml'), 'store: ndjson\n');

    const run = await init(world, [`--root=${world.repo}`]);

    expect(run.stdout.split('\n').slice(0, 3)).toEqual([
      `${world.repo} (named by --root) is already a rafa project: its .rafa/config.yaml is left as it was.`,
      '  created   .rafa/specs/',
      '  created   .rafa/plans/',
    ]);
    expect(readFileSync(join(world.repo, '.rafa', 'config.yaml'), 'utf8')).toBe('store: ndjson\n');
  });

  it('appends the entry after a blank line to a .gitignore the project already has', async () => {
    const world = plantWorld();
    writeFileSync(join(world.repo, '.gitignore'), 'node_modules\n');

    const run = await init(world, [`--root=${world.repo}`]);

    expect(run.stdout).toContain('\n  updated   .gitignore\n');
    expect(readFileSync(join(world.repo, '.gitignore'), 'utf8')).toBe(`node_modules\n\n${BLOCK_BEGIN}\n.rafa/\n${BLOCK_END}\n`);
  });

  it('prints the tracking.all notice once when the user scope sets it, and not on a rerun', async () => {
    const world = plantWorld();
    mkdirSync(join(world.home, '.rafa'));
    writeFileSync(join(world.home, '.rafa', 'config.yaml'), 'tracking:\n  all: true\n');

    const first = await init(world, [`--root=${world.repo}`]);
    const again = await init(world, [`--root=${world.repo}`]);

    expect(first.stdout.split('warn: tracking.all is true')).toHaveLength(2);
    expect(again.stdout).not.toContain('tracking.all is true');
    expect(readFileSync(join(world.repo, '.gitignore'), 'utf8')).toContain('!/.rafa/');
    expect(readFileSync(join(world.home, '.rafa', 'config.yaml'), 'utf8')).toBe('tracking:\n  all: true\n');
  });

  it.each([
    [
      'a config it cannot use',
      (world: World) => {
        mkdirSync(join(world.repo, '.rafa'));
        writeFileSync(join(world.repo, '.rafa', 'config.yaml'), 'store: postgres\n');
      },
      'rafa init: the config cannot be used:',
    ],
    [
      'a .rafa that is a file',
      (world: World) => writeFileSync(join(world.repo, '.rafa'), ''),
      'rafa init: the scopes cannot be written:',
    ],
    [
      'a .gitignore holding the begin marker twice',
      (world: World) => writeFileSync(join(world.repo, '.gitignore'), `${BLOCK_BEGIN}\n${BLOCK_BEGIN}\n${BLOCK_END}\n`),
      'rafa gitignore: ',
    ],
  ])('refuses %s with exit code 1 and writes nothing', async (_label, plant, opening) => {
    const world = plantWorld();
    plant(world);
    const before = stateOf(world.base);

    const run = await init(world, [`--root=${world.repo}`]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toStartWith(opening);
    expect(run.stderr).toEndWith('\nNothing was written.\n');
    expect(stateOf(world.base)).toEqual(before);
  });
});

describe('the board step', () => {
  it('sets the GitHub board up under --board, listing each part it made and naming the issue in the config', async () => {
    const world = plantWorld();
    const gh = fakeGh();

    const run = await init(world, ['--yes', '--board'], seamsFor(world, {
      readRemote: () => 'https://github.com/acme/widgets.git',
      gh: () => gh.run,
    }));
    const lines = run.stdout.split('\n');

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(lines).toContain('GitHub board:');
    expect(lines).toContain('  created  label type:spec');
    expect(lines.some((line) => line.startsWith('  created  Roadmap issue'))).toBe(true);
    expect(readFileSync(join(world.repo, '.rafa', 'config.yaml'), 'utf8')).toContain('roadmap:\n  issue: 7');
    expect(existsSync(join(world.repo, '.github', 'ISSUE_TEMPLATE', 'spec.md'))).toBe(true);
    expect(gh.routes()).toContain('label create');
  });

  it('gives the step as the board of the result in json mode, and warns what it came back with', async () => {
    const world = plantWorld();
    const gh = fakeGh({ fails: { 'issue pin': 'could not pin' } });

    const run = await init(world, ['--yes', '--board', '--output=json'], seamsFor(world, {
      readRemote: () => 'git@github.com:acme/widgets.git',
      gh: () => gh.run,
    }));
    const result = resultOf(run.stdout);
    const logs = eventsOf(run.stdout).filter((event) => event.type === 'log');

    expect(result.board.status).toBe('ran');
    expect(result.board.report?.roadmapIssue).toBe(7);
    expect(result.changed).toBe(true);
    expect(logs.some((event) => JSON.stringify(event).includes('opened but not pinned'))).toBe(true);
  });

  it('leaves the board alone under --no-board, and on a repository whose origin is not GitHub, sending nothing', async () => {
    const world = plantWorld();
    const onGitHub = seamsFor(world, { readRemote: () => 'https://github.com/acme/widgets.git' });

    const declined = await init(world, [`--root=${world.repo}`, '--no-board', '--output=json'], onGitHub);
    const elsewhere = await init(world, [`--root=${world.repo}`, '--board', '--output=json'], seamsFor(world, {
      readRemote: () => 'https://gitlab.com/acme/widgets.git',
    }));

    expect(declined.exitCode).toBe(0);
    expect(resultOf(declined.stdout).board.status).toBe('declined');
    expect(elsewhere.exitCode).toBe(0);
    expect(resultOf(elsewhere.stdout).board.status).toBe('not-github');
    expect(JSON.stringify(eventsOf(elsewhere.stdout))).toContain('--board sets up a GitHub board');
    expect(existsSync(join(world.repo, '.github'))).toBe(false);
  });

  it('asks nothing and names --board without a terminal to ask on, leaving Nothing changed. true on a rerun', async () => {
    const world = plantWorld();
    const onGitHub = seamsFor(world, { readRemote: () => 'https://github.com/acme/widgets.git' });

    const first = await init(world, [`--root=${world.repo}`], onGitHub);
    const again = await init(world, [`--root=${world.repo}`], onGitHub);

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('The GitHub board step needs a terminal; run rafa init --board to set it up.');
    expect(again.stdout.trimEnd().endsWith('Nothing changed.')).toBe(true);
    expect(existsSync(join(world.repo, '.github'))).toBe(false);
  });

  it('asks once on a terminal, and sets the board up on a yes', async () => {
    const world = plantWorld();
    const gh = fakeGh();
    const prompter = scripted(['y']);

    const run = await init(world, [`--root=${world.repo}`, '--output=json'], seamsFor(world, {
      readRemote: () => 'https://github.com/acme/widgets.git',
      gh: () => gh.run,
      isTerminal: () => true,
      openPrompter: prompter.open,
    }));

    expect(run.exitCode).toBe(0);
    expect(prompter.record.asked).toBe(1);
    expect(resultOf(run.stdout).board).toMatchObject({ status: 'ran', asked: true });
    expect(gh.routes()[0]).toBe('repo view');
  });
});

describe('the PATH check', () => {
  it('warns after the summary when ~/.rafa/bin is not on the PATH handed in, and not when it leads', async () => {
    const missing = plantWorld();
    const leading = plantWorld();

    const warned = await init(missing, [`--root=${missing.repo}`], seamsFor(missing), missing.bunBin);
    const quiet = await init(leading, [`--root=${leading.repo}`], seamsFor(leading), [leading.rafaBin, leading.bunBin].join(delimiter));

    const warning = readBinPath(missing.bunBin, missing.home).warning;
    expect(warning).toStartWith(`${missing.rafaBin} is not on PATH;`);
    expect(warned.stdout).toEndWith(`${join(missing.home, '.rafa', 'instincts')}/\nwarn: ${String(warning)}\n`);
    expect(quiet.stdout).not.toContain('warn: ');
    expect(warned.exitCode).toBe(0);
  });

  it('gives the reading in json mode, the warning as a log event before the one result', async () => {
    const world = plantWorld();

    const run = await init(world, [`--root=${world.repo}`, '--output=json'], seamsFor(world), [world.bunBin, world.rafaBin].join(delimiter));

    const events = eventsOf(run.stdout);
    const result = resultOf(run.stdout);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(JSON.stringify(events[1])).toContain(`${world.rafaBin} is on PATH after ${world.bunBin}`);
    expect([result.binPath.state, result.binPath.rafaIndex, result.binPath.bunIndex]).toEqual(['behind', 1, 0]);
    expect([result.root, result.start, result.configExisted, result.changed]).toEqual([world.repo, world.sub, false, true]);
    expect(result.writes.filter((write) => !write.path.startsWith(`${tempBase}/`))).toEqual([]);
  });
});

describe('the agent warning', () => {
  /** Writes `<root>/.claude/agents/<name>.md` carrying that frontmatter `name`. */
  const plantAgent = (root: string, name: string): void => {
    const dir = join(root, '.claude', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), ['---', `name: ${name}`, '---', 'Body.', ''].join('\n'), 'utf8');
  };

  /** Writes a one-task plan routed to `agent` under the world's default `plan.dir`. */
  const plantPlan = (world: World, agent: string): string => {
    const dir = join(world.repo, '.rafa', 'plans');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'PLAN.md');
    writeFileSync(path, `- [ ] Write the module  {agent=${agent}}\n`, 'utf8');
    return path;
  };

  it('warns about an agent a plan routes to that only the home defines, naming the vendor command', async () => {
    const world = plantWorld();
    plantAgent(world.home, 'tdd-guide');
    plantPlan(world, 'tdd-guide');

    const run = await init(world, [`--root=${world.repo}`]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('warn: 1 agent use(s) under plan.dir resolve only in ~/.claude/agents');
    expect(run.stdout).toContain('warn:   .rafa/plans/PLAN.md (line 1) routes to agent "tdd-guide",'
      + ' which resolves only in ~/.claude/agents: run `rafa agent vendor tdd-guide`');
  });

  it('says nothing when the project defines the agent itself, and nothing when no home file carries it', async () => {
    const vendored = plantWorld();
    plantAgent(vendored.home, 'tdd-guide');
    plantAgent(vendored.repo, 'tdd-guide');
    plantPlan(vendored, 'tdd-guide');
    const unknown = plantWorld();
    plantPlan(unknown, 'ghost-agent');

    const quiet = await init(vendored, [`--root=${vendored.repo}`]);
    const silent = await init(unknown, [`--root=${unknown.repo}`]);

    expect([quiet.exitCode, silent.exitCode]).toEqual([0, 0]);
    expect(quiet.stdout).not.toContain('warn: ');
    expect(silent.stdout).not.toContain('warn: ');
  });

  it('warns about nothing on a project whose plan.dir holds no plan, and gives the uses in json mode', async () => {
    const world = plantWorld();
    plantAgent(world.home, 'tdd-guide');

    const empty = await init(world, [`--root=${world.repo}`, '--output=json']);
    const plan = plantPlan(world, 'tdd-guide');
    const warned = await init(world, [`--root=${world.repo}`, '--output=json']);

    expect(resultOf(empty.stdout).vendorableAgents).toEqual([]);
    expect(resultOf(warned.stdout).vendorableAgents).toEqual([
      { plan, name: 'tdd-guide', lines: [1], fix: 'rafa agent vendor tdd-guide' },
    ]);
    expect(eventsOf(warned.stdout).map((event) => event.type)).toEqual(['start', 'log', 'log', 'result']);
  });
});

describe('the registered command, spawned', () => {
  it('refuses without a terminal in a scratch repository, listing the git toplevel', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });

    const run = runRafa(scratch, scratch.repo, ['init']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toStartWith(`rafa init: no terminal to choose a root on.\nRoot candidates for a rafa project, from ${scratch.repo}:\n  1) ${scratch.repo}   the git toplevel\n`);
    expect([existsSync(join(scratch.repo, '.rafa')), existsSync(join(scratch.home, '.rafa'))]).toEqual([false, false]);
  }, SPAWN_TIMEOUT);

  it('sets up the scratch repository from a subdirectory under --yes, its user scope under the scratch HOME', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    const sub = join(scratch.repo, 'sub');
    mkdirSync(sub);

    const run = runRafa(scratch, sub, ['init', '--yes', '--output=json']);

    const result = resultOf(run.stdout);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect([result.root, result.source, result.binPath.state]).toEqual([scratch.repo, 'git-toplevel', 'missing']);
    expect(readFileSync(join(scratch.repo, '.rafa', 'config.yaml'), 'utf8')).toBe(projectConfigText());
    expect(readFileSync(join(scratch.home, '.rafa', 'config.yaml'), 'utf8')).toBe(userConfigText());
    expect(result.writes.filter((write) => !write.path.startsWith(`${tempBase}/`))).toEqual([]);
  }, SPAWN_TIMEOUT);
});
