/**
 * `rafa stretch start` dispatched in planted projects under the temp
 * directory, every effect behind a fake: git answers from a script and
 * records its calls, tmux and `claude` are recorded and never run, the
 * installed package is a folder the case plants, and HOME is the case's
 * own. The stretch folders, `stretch.json`, the copy and the config are
 * real files, read back after each run.
 *
 * A dry run and every refusal read the config's bytes before and after
 * and find them equal; the first case finds them changed, so a reading
 * that could not tell the two apart would fail there.
 */
import type { StepRun, StretchStartSeams } from './start.js';
import type { GitResult } from '../../pr/git.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText } from '../../config.js';
import { nodeStretchFs } from '../../stretch/folder.js';
import { nodeOperatorsFs } from '../../stretch/operators.js';
import { nodePromptFs } from '../../stretch/prompt.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { createStretchStartCommand, stretchRecordPath } from './start.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stretch-start-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The subject the command sits under, declared for the registry the test dispatches over. */
const STRETCH_SUBJECT = { name: 'stretch', summary: 'stretches' };

/** A config pointing `pr.base` at main, with a comment on the line and one of its own. */
const BASE_CONFIG = 'version: 1\n# the pull request settings\npr:\n  base: main   # where a PR opens\n  provider: gh\n';

/** The bundled engineer prompt the planted package carries. */
const DEFAULT_PROMPT = 'Open stretch {{STRETCH}}.\nRead stretch {{PREVIOUS}}\'s report.\n';

/** The pid the fake probe reads as alive. */
const LIVE_PID = 4242;

/** A planted project, its package and the fakes one case runs with. */
interface Case {
  readonly project: PlantedProject;
  readonly pkg: string;
  readonly gitCalls: string[][];
  readonly steps: string[][];
  readonly sessions: string[][];
  readonly seams: StretchStartSeams;
}

/** What a case changes about the fakes. */
interface CaseOptions {
  /** Programs on the fake PATH; tmux and claude when left out. */
  readonly programs?: readonly string[];
  /** Whether origin holds the stretch branch already. */
  readonly remoteHolds?: boolean;
  /** A git subcommand that fails, with what git says. */
  readonly gitFails?: Readonly<Record<string, string>>;
  /** The tmux sessions the probe reads as open. */
  readonly openTmux?: readonly string[];
  /** Whether the package carries the plugin manifest. */
  readonly operators?: boolean;
  /** The exit code each session answers. */
  readonly sessionExit?: number;
  /** Runs at each sleep, as the engineer writing its `agent.json` would. */
  readonly onSleep?: () => void;
}

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '' });

/** Answers one git call from the case's script. */
function gitAnswer(args: readonly string[], options: CaseOptions): GitResult {
  const [subcommand = ''] = args;
  const failure = options.gitFails?.[subcommand];
  if (failure !== undefined) return { ok: false, stdout: '', stderr: failure };
  if (subcommand === 'symbolic-ref') return ok('origin/main\n');
  if (subcommand === 'ls-remote') {
    return options.remoteHolds === true
      ? ok('0123abc\trefs/heads/stretch/1\n')
      : { ok: false, stdout: '', stderr: '' };
  }
  return ok();
}

/** Plants the installed package: its entry, version, operators and default prompt. */
function plantPackage(pkg: string, withManifest: boolean): string {
  const dist = join(pkg, 'dist');
  const operators = join(dist, 'bundled', 'operators');
  mkdirSync(join(operators, 'agents'), { recursive: true });
  mkdirSync(join(dist, 'bundled', 'stretch'), { recursive: true });
  writeFileSync(join(dist, 'cli.js'), '');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.4.2' }));
  writeFileSync(join(operators, 'agents', 'rafa-stretch-engineer.md'), 'engineer');
  writeFileSync(join(dist, 'bundled', 'stretch', 'engineer-prompt-default.md'), DEFAULT_PROMPT);
  if (withManifest) {
    mkdirSync(join(operators, '.claude-plugin'));
    writeFileSync(join(operators, '.claude-plugin', 'plugin.json'), '{}');
  }
  return join(dist, 'cli.js');
}

/** A project planted with {@link BASE_CONFIG}, a package beside it, and fakes recording every call. */
function plant(options: CaseOptions = {}): Case {
  const caseDir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const project = plantProject(caseDir, BASE_CONFIG);
  const pkg = join(caseDir, 'pkg');
  const entry = plantPackage(pkg, options.operators ?? true);
  const programs = options.programs ?? ['tmux', 'claude'];
  const gitCalls: string[][] = [];
  const steps: string[][] = [];
  const sessions: string[][] = [];
  const seams: StretchStartSeams = {
    folder: {
      fs: nodeStretchFs,
      isAlive: (pid) => pid === LIVE_PID,
      hasTmuxSession: (name) => (options.openTmux ?? []).includes(name),
    },
    operators: { fs: nodeOperatorsFs, entry, buildVersion: '0.0.0', home: () => project.home },
    prompt: { fs: nodePromptFs, entry },
    git: () => (args) => {
      gitCalls.push([...args]);
      return gitAnswer(args, options);
    },
    which: (program) => (programs.includes(program)
      ? `/fake/bin/${program}`
      : null),
    runStep: (argv): StepRun => {
      steps.push([...argv]);
      return { exitCode: 0, said: '' };
    },
    runSession: async (argv) => {
      sessions.push([...argv]);
      return Promise.resolve(options.sessionExit ?? 0);
    },
    sleep: async () => {
      options.onSleep?.();
      return Promise.resolve();
    },
    isTerminal: () => false,
    now: () => new Date('2026-10-07T09:00:00.000Z'),
    rafa: ['rafa'],
  };
  return { project, pkg, gitCalls, steps, sessions, seams };
}

/** Dispatches `stretch start` with `words` in the case's project. */
async function run(planted: Case, words: readonly string[] = [], env: Readonly<Record<string, string>> = {}): Promise<CapturedRun> {
  const command = createStretchStartCommand(planted.seams);
  return dispatchInProject(['stretch', 'start', ...words], [STRETCH_SUBJECT], [command], planted.project, env);
}

/** The project's config text. */
function configText(planted: Case): string {
  return readFileSync(join(planted.project.root, '.rafa', 'config.yaml'), 'utf8');
}

/** The stretch folder `n` of the case's project. */
function folder(planted: Case, n: number): string {
  return join(planted.project.root, '.rafa', 'stretch', String(n));
}

/** Writes stretch `n`'s `agent.json` with `fields`. */
function plantAgent(planted: Case, n: number, fields: Readonly<Record<string, unknown>>): void {
  mkdirSync(folder(planted, n), { recursive: true });
  writeFileSync(join(folder(planted, n), 'agent.json'), JSON.stringify(fields));
}

/** The index of each line in `stdout`, which must hold every one. */
function positions(stdout: string, lines: readonly string[]): number[] {
  return lines.map((line) => {
    const at = stdout.indexOf(line);
    expect(at, `stdout holds ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
    return at;
  });
}

/** True when `numbers` rise from first to last. */
function rising(numbers: readonly number[]): boolean {
  return numbers.every((value, index) => index === 0 || value > (numbers[index - 1] ?? -1));
}

describe('rafa stretch start, opening a stretch', () => {
  it('pushes stretch/1, records and sets pr.base, copies the operators and opens the tmux session', async () => {
    const planted = plant();

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.gitCalls).toEqual([
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      ['ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/stretch/1'],
      ['fetch', 'origin', 'main'],
      ['push', 'origin', 'origin/main:refs/heads/stretch/1'],
    ]);
    expect(JSON.parse(readFileSync(stretchRecordPath(planted.project.root, 1), 'utf8'))).toEqual({
      stretch: 1,
      branch: 'stretch/1',
      defaultBranch: 'main',
      prBase: 'main',
      startedAt: '2026-10-07T09:00:00.000Z',
    });
    expect(configText(planted)).toBe(BASE_CONFIG.replace('base: main', 'base: stretch/1'));
    expect(parseConfigText(configText(planted), 'config.yaml').values.prBase).toBe('stretch/1');
    expect(readFileSync(join(folder(planted, 1), 'operators', 'agents', 'rafa-stretch-engineer.md'), 'utf8')).toBe('engineer');
    expect(outcome.stdout).toContain(`operators: rafa 1.4.2, from ${join(planted.pkg, 'dist', 'bundled', 'operators')}`);
    expect(planted.steps.map((argv) => argv.slice(0, 2))).toEqual([
      ['tmux', 'new-session'],
      ['tmux', 'new-window'],
      ['tmux', 'new-window'],
      ['tmux', 'select-window'],
    ]);
    expect(planted.steps[0]).toContain('stretch-project-1');
    expect(planted.steps[0]?.at(-1)).toContain('rafa stretch start --role=engineer --n=1');
    expect(outcome.stdout).toContain('stretch 1 started in tmux session stretch-project-1 (windows: engineer, watchtower, analyst)');
    expect(outcome.stdout).toContain('attach with: tmux attach -t stretch-project-1');
    expect(planted.sessions).toEqual([]);
  });

  it('prints every step in order under --dry-run and runs none, writing nothing', async () => {
    const planted = plant({ programs: ['tmux'] });

    const outcome = await run(planted, ['--dry-run']);

    expect(outcome.exitCode).toBe(0);
    const record = stretchRecordPath(planted.project.root, 1);
    const copy = join(folder(planted, 1), 'operators');
    const at = positions(outcome.stdout, [
      'git fetch origin main',
      'git push origin origin/main:refs/heads/stretch/1',
      `record pr.base main in ${record}`,
      'rafa config set pr.base=stretch/1',
      `cp -R ${join(planted.pkg, 'dist', 'bundled', 'operators')} ${copy}`,
      'operators: rafa 1.4.2',
      'tmux new-session -d -s stretch-project-1',
      'tmux new-window -t \'=stretch-project-1:\' -c',
      'tmux select-window -t \'=stretch-project-1:engineer\'',
      'dry run: would start stretch 1 in tmux session stretch-project-1; nothing was run',
    ]);
    expect(rising(at)).toBe(true);
    expect(planted.gitCalls.map((args) => args[0])).toEqual(['symbolic-ref', 'ls-remote']);
    expect(configText(planted)).toBe(BASE_CONFIG);
    expect(existsSync(folder(planted, 1))).toBe(false);
    expect(planted.steps).toEqual([]);
    expect(planted.sessions).toEqual([]);
  });

  it('leaves the push out when origin holds the branch already', async () => {
    const planted = plant({ remoteHolds: true });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(planted.gitCalls.map((args) => args[0])).toEqual(['symbolic-ref', 'ls-remote', 'fetch']);
    expect(outcome.stdout).toContain('origin already holds stretch/1; it is not pushed again');
  });

  it('keeps a stretch.json an earlier start wrote and a copy it made, and still sets pr.base', async () => {
    const planted = plant();
    const record = stretchRecordPath(planted.project.root, 1);
    mkdirSync(join(folder(planted, 1), 'operators'), { recursive: true });
    writeFileSync(record, '{"prBase":"develop"}\n');

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(readFileSync(record, 'utf8')).toBe('{"prBase":"develop"}\n');
    expect(outcome.stdout).toContain(`keep ${record}, written by an earlier start`);
    expect(outcome.stdout).toContain('operators: the copy kept; the installed rafa is 1.4.2');
    expect(existsSync(join(folder(planted, 1), 'operators', 'agents'))).toBe(false);
    expect(parseConfigText(configText(planted), 'config.yaml').values.prBase).toBe('stretch/1');
  });

  it('opens the stretch --n names', async () => {
    const planted = plant();

    const outcome = await run(planted, ['--n=7', '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('git push origin origin/main:refs/heads/stretch/7');
    expect(outcome.stdout).toContain('tmux new-session -d -s stretch-project-7');
  });

  it('passes --remote-control on to every window', async () => {
    const planted = plant();

    const outcome = await run(planted, ['--remote-control']);

    expect(outcome.exitCode).toBe(0);
    const windows = planted.steps.slice(0, 3).map((argv) => argv.at(-1) ?? '');
    expect(windows.every((command) => command.includes('--remote-control'))).toBe(true);
  });

  it('switches the tmux client inside tmux rather than printing the attach line', async () => {
    const planted = plant();

    const outcome = await run(planted, [], { TMUX: '/tmp/tmux-1000/default,1,0' });

    expect(outcome.exitCode).toBe(0);
    expect(planted.steps.at(-1)).toEqual(['tmux', 'switch-client', '-t', '=stretch-project-1']);
    expect(outcome.stdout).not.toContain('attach with:');
  });

  it('starts the engineer here without tmux, after the lines for the other two', async () => {
    const planted = plant({ programs: ['claude'] });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('tmux is not installed: starting the engineer here. In a second terminal run:');
    expect(outcome.stdout).toContain('  rafa stretch start --role=watchtower --n=1');
    expect(outcome.stdout).toContain('  rafa stretch start --role=analyst --n=1');
    expect(planted.steps).toEqual([]);
    expect(planted.sessions).toEqual([[
      'claude',
      '--plugin-dir',
      join(folder(planted, 1), 'operators'),
      '--agent',
      'rafa-operators:rafa-stretch-engineer',
      '-n',
      'project stretch 1 engineer',
      'Open stretch 1.\n',
    ]]);
  });

  it('fails a push git refuses with exit code 2, naming the steps already done', async () => {
    const planted = plant({ gitFails: { push: 'remote: permission denied' } });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('git push origin origin/main:refs/heads/stretch/1 failed: remote: permission denied');
    expect(outcome.stderr).toContain('already done:\n  git fetch origin main');
    expect(configText(planted)).toBe(BASE_CONFIG);
    expect(existsSync(folder(planted, 1))).toBe(false);
  });
});

describe('rafa stretch start, refusing', () => {
  it('refuses while a stretch of the project is live by its agent.json, running nothing', async () => {
    const planted = plant();
    plantAgent(planted, 2, { sessionId: 'abc', pid: LIVE_PID, state: 'running' });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('a stretch of this project is live');
    expect(outcome.stderr).toContain(`stretch 2: agent.json reads running, pid ${String(LIVE_PID)} alive`);
    expect(planted.gitCalls).toEqual([]);
    expect(configText(planted)).toBe(BASE_CONFIG);
  });

  it('refuses while a stretch\'s tmux session is open, and reads a dead pid as not live', async () => {
    const planted = plant({ openTmux: ['stretch-project-3'] });
    plantAgent(planted, 2, { sessionId: 'abc', pid: 9, state: 'running' });
    plantAgent(planted, 3, {});

    const outcome = await run(planted, ['--dry-run']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('stretch 3: tmux session stretch-project-3 open');
    expect(outcome.stderr).not.toContain('stretch 2:');
  });

  it('refuses while a loop of the project runs', async () => {
    const planted = plant();
    const runs = join(planted.project.root, '.rafa', 'runs');
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, 'loop-1.json'), JSON.stringify({
      sessionId: 'loop-1',
      planStub: 'stub-1',
      plan: '.rafa/plans/PLAN-stub-1.md',
      branch: 'feat/rafa-1',
      pid: LIVE_PID,
      startedAt: '2026-10-07T08:00:00.000Z',
      state: 'running',
      task: null,
    }));

    const outcome = await run(planted, ['--dry-run']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`loop on feat/rafa-1 (pid ${String(LIVE_PID)}, session loop-1)`);
    expect(planted.gitCalls).toEqual([]);
  });

  it('refuses a package that carries no operators', async () => {
    const planted = plant({ operators: false });

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('this rafa install carries no stretch operators');
    expect(planted.gitCalls).toEqual([]);
  });

  it('refuses without claude on PATH, and a dry run does not ask for it', async () => {
    const planted = plant({ programs: ['tmux'] });

    const refused = await run(planted);
    const dry = await run(planted, ['--dry-run']);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('claude is not on PATH');
    expect(dry.exitCode).toBe(0);
  });

  it('refuses a config whose pr.base the edit refuses, before any step', async () => {
    const planted = plant();
    writeFileSync(join(planted.project.root, '.rafa', 'config.yaml'), 'version: 1\npr: { base: main }\n');

    const outcome = await run(planted);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('pr.base cannot be set:');
    expect(planted.gitCalls).toEqual([]);
  });

  it.each([
    [['extra'], 'Expected no argument'],
    [['--n=0'], '--n is "0", expected a stretch number'],
    [['--n=two'], '--n is "two", expected a stretch number'],
    [['--role=pilot'], '--role is "pilot", expected one of: engineer, watchtower, analyst'],
  ])('refuses the line %p', async (words, said) => {
    const planted = plant();

    const outcome = await run(planted, words);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(said);
  });
});

describe('rafa stretch start --role', () => {
  it('starts the engineer of --n here, past a live stretch, with its prompt filled in', async () => {
    const planted = plant({ openTmux: ['stretch-project-3'] });

    const outcome = await run(planted, ['--role=engineer', '--n=3']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`prompt: ${join(planted.pkg, 'dist', 'bundled', 'stretch', 'engineer-prompt-default.md')}`);
    expect(planted.gitCalls).toEqual([]);
    expect(existsSync(join(folder(planted, 3), 'operators', 'agents'))).toBe(true);
    expect(planted.sessions).toEqual([[
      'claude',
      '--plugin-dir',
      join(folder(planted, 3), 'operators'),
      '--agent',
      'rafa-operators:rafa-stretch-engineer',
      '-n',
      'project stretch 3 engineer',
      'Open stretch 3.\nRead stretch 2\'s report.\n',
    ]]);
    expect(configText(planted)).toBe(BASE_CONFIG);
  });

  it('refuses the watchtower when no stretch has an agent.json and no --n is given', async () => {
    const planted = plant();

    const outcome = await run(planted, ['--role=watchtower']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('no .rafa/stretch/<n>/agent.json yet');
  });

  it('waits for the engineer\'s agent.json before it starts the analyst', async () => {
    let planted: Case | null = null;
    planted = plant({
      onSleep: () => {
        if (planted !== null) plantAgent(planted, 2, { sessionId: 'abc' });
      },
    });

    const outcome = await run(planted, ['--role=analyst', '--n=2', '--remote-control']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`waiting for ${join(folder(planted, 2), 'agent.json')} …`);
    expect(planted.sessions[0]?.slice(3)).toEqual([
      '--agent',
      'rafa-operators:rafa-stretch-analyst',
      '--remote-control',
      'project stretch 2 analyst',
      'Stretch 2 is running. Read .rafa/stretch/2/, then wait for my first hunch.',
    ]);
  });

  it('starts the watchtower of the newest watched stretch when --n is left out', async () => {
    const planted = plant();
    plantAgent(planted, 4, { sessionId: 'abc' });
    mkdirSync(folder(planted, 5));

    const outcome = await run(planted, ['--role=watchtower']);

    expect(outcome.exitCode).toBe(0);
    expect(planted.sessions[0]?.slice(5)).toEqual(['-n', 'project stretch 4 watchtower', '/loop']);
  });

  it('prints the claude line under --dry-run, copying and starting nothing', async () => {
    const planted = plant({ programs: [] });

    const outcome = await run(planted, ['--role=watchtower', '--n=2', '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`claude --plugin-dir ${join(folder(planted, 2), 'operators')} --agent rafa-operators:rafa-stretch-watchtower -n 'project stretch 2 watchtower' /loop`);
    expect(outcome.stdout).toContain('dry run: would start the watchtower of stretch 2 here; nothing was run');
    expect(existsSync(folder(planted, 2))).toBe(false);
    expect(planted.sessions).toEqual([]);
  });

  it('exits with the session\'s own code when it ends non-zero', async () => {
    const planted = plant({ sessionExit: 3 });

    const outcome = await run(planted, ['--role=engineer']);

    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toContain('the engineer session ended with exit code 3');
  });
});

describe('the stretch start declaration', () => {
  it('spends unless --dry-run, and renders text alone', () => {
    const command = createStretchStartCommand();

    expect(command.spends).toEqual({ when: 'unless', flag: '--dry-run', what: 'one session per operator it starts' });
    expect(command.outputs).toEqual(['text']);
    expect(command.flags.map((flag) => flag.name)).toEqual(['n', 'remote-control', 'role', 'dry-run']);
  });
});
