/**
 * Tests for the stretch row of `rafa doctor` (`./doctor-stretch.ts`):
 * which `pr.base` it reads, what holds a `stretch/<n>` branch, the line
 * each reading prints in either mode, and the row as `doctor` prints it.
 *
 * The reading cases drive a filesystem, pid probe and tmux probe of
 * their own, recording every probe, so none of them spawns tmux or
 * reads a real pid. The `rafa doctor` cases dispatch in-process over a
 * scratch project with `pr.provider: none`, so no case reaches GitHub;
 * those run the real probes, against an `agent.json` naming this test's
 * own pid (alive) or none, and a tmux session named after a scratch
 * directory no tmux server holds.
 *
 * ## The controls
 *
 *  - Every unheld case is paired with the same stretch read live, by
 *    its pid and by its tmux session apart, so a reader that warned on
 *    every `stretch/*` base would fail the held half.
 *  - The no-probe case for a base naming no stretch is paired with a
 *    `stretch/<n>` base whose probes are counted, so the zero is a
 *    reading of a probe that runs elsewhere.
 *  - The `rafa doctor` warning case is paired with a held stretch and a
 *    `main` base under the same dispatch, so the wiring is shown to
 *    print the row only where the reading asks for it.
 *
 * ## Mutations driven
 *
 * Two mutations were driven against these cases on 2026-10-07, the file
 * run alone on a baseline of 19 pass and restored from a scratch copy
 * checked with `cmp`: every probed stretch read as held reddened 6; the
 * row call dropped from `./doctor.ts` reddened 2.
 */
import type { RafaCommand } from '../cli/command.js';
import type { Output } from '../ports/index.js';
import type { StretchFolderSeams, StretchFs } from '../stretch/folder.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { agentFilePath, stretchRoot } from '../stretch/folder.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../tests/cli-capture.js';
import { SERVE_CLI_VERSION } from '../tiers/delivery.js';

import { readDoctorStretch, STRETCH_ROW_HEAD, stretchRow, writeDoctorStretch } from './doctor-stretch.js';
import { createDoctorCommand } from './doctor.js';

/** The project root every reading case names; nothing is read from it on disk. */
const ROOT = '/work/rafa';

/** The tmux session stretch 9 of {@link ROOT} runs in. */
const SESSION_9 = 'stretch-rafa-9';

/** What a case's fake world holds. */
interface FakeWorld {
  /** The text of each file, by absolute path. */
  readonly files?: Readonly<Record<string, string>>;
  readonly alive?: readonly number[];
  readonly sessions?: readonly string[];
}

/** Seams over `world`, and every pid and session probed. */
function fakeSeams(world: FakeWorld = {}): { seams: StretchFolderSeams; pids: number[]; probed: string[] } {
  const pids: number[] = [];
  const probed: string[] = [];
  const files = world.files ?? {};
  const fs: StretchFs = {
    list: () => [],
    readText: (file) => files[file] ?? null,
  };
  const seams: StretchFolderSeams = {
    fs,
    isAlive: (pid) => {
      pids.push(pid);
      return (world.alive ?? []).includes(pid);
    },
    hasTmuxSession: (name) => {
      probed.push(name);
      return (world.sessions ?? []).includes(name);
    },
  };
  return { seams, pids, probed };
}

/** Stretch 9's `agent.json` reading `fields`. */
function agent9(fields: Readonly<Record<string, unknown>>): Record<string, string> {
  return { [agentFilePath(ROOT, 9)]: JSON.stringify(fields) };
}

/** An {@link Output} recording each message with its level. */
function recordingOutput(): { readonly output: Output; readonly seen: Array<readonly [string, string]> } {
  const seen: Array<readonly [string, string]> = [];
  const at = (level: string) => (message: string): void => {
    seen.push([level, message]);
  };
  const output: Output = {
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    debug: at('debug'),
    emit: () => undefined,
    result: () => undefined,
  };
  return { output, seen };
}

describe('readDoctorStretch', () => {
  it('reads no row and probes nothing for an unset base or one naming another branch', () => {
    const { seams, pids, probed } = fakeSeams();

    expect(readDoctorStretch(ROOT, null, seams)).toEqual({ kind: 'none' });
    expect(readDoctorStretch(ROOT, 'main', seams)).toEqual({ kind: 'none' });
    expect(readDoctorStretch(ROOT, 'feature/stretch/9', seams)).toEqual({ kind: 'none' });
    expect([...pids, ...probed]).toEqual([]);
  });

  it('reads a stretch/ branch naming no stretch number as unheld, probing nothing, where stretch/9 is probed', () => {
    const named = fakeSeams();
    const numbered = fakeSeams();

    const reading = readDoctorStretch(ROOT, 'stretch/next', named.seams);
    readDoctorStretch(ROOT, 'stretch/9', numbered.seams);

    expect(reading).toEqual({ kind: 'unheld', base: 'stretch/next', liveness: null });
    expect(readDoctorStretch(ROOT, 'stretch/09', named.seams)).toMatchObject({ kind: 'unheld', liveness: null });
    expect(named.probed).toEqual([]);
    expect(numbered.probed).toEqual([SESSION_9]);
  });

  it('reads stretch/9 as held while its engineer runs with a live pid', () => {
    const { seams } = fakeSeams({ files: agent9({ state: 'running', pid: 4242 }), alive: [4242] });

    const reading = readDoctorStretch(ROOT, 'stretch/9', seams);

    expect(reading).toMatchObject({ kind: 'held', base: 'stretch/9', liveness: { n: 9, pidAlive: true, tmuxOpen: false } });
  });

  it('reads stretch/9 as held while its tmux session is open, with no agent.json', () => {
    const { seams } = fakeSeams({ sessions: [SESSION_9] });

    expect(readDoctorStretch(ROOT, 'stretch/9', seams)).toMatchObject({ kind: 'held', liveness: { tmuxOpen: true } });
  });

  it('reads stretch/9 as unheld when its pid is dead and no tmux session is open', () => {
    const { seams, pids } = fakeSeams({ files: agent9({ state: 'running', pid: 4242 }) });

    const reading = readDoctorStretch(ROOT, 'stretch/9', seams);

    expect(reading).toMatchObject({ kind: 'unheld', liveness: { pidAlive: false, tmuxOpen: false } });
    expect(pids).toEqual([4242]);
  });

  it('reads stretch/9 as unheld when another stretch is live but not 9', () => {
    const { seams } = fakeSeams({ sessions: ['stretch-rafa-8'] });

    expect(readDoctorStretch(ROOT, 'stretch/9', seams).kind).toBe('unheld');
  });

  it('reads a root that leaves no tmux project name as unread, never throwing', () => {
    const { seams } = fakeSeams();

    const reading = readDoctorStretch('/', 'stretch/9', seams);

    expect(reading).toMatchObject({ kind: 'unread', base: 'stretch/9' });
    expect(reading.kind === 'unread' && reading.problem).toContain('leaves no project name');
  });
});

describe('stretchRow', () => {
  /** The row for `prBase` over `world`. */
  function rowOf(prBase: string, world: FakeWorld = {}): ReturnType<typeof stretchRow> {
    return stretchRow(ROOT, readDoctorStretch(ROOT, prBase, fakeSeams(world).seams));
  }

  it('is no row for a base naming no stretch/ branch', () => {
    expect(rowOf('main')).toBeNull();
  });

  it('names the open tmux session, or the live pid, of a held stretch, as no warning', () => {
    expect(rowOf('stretch/9', { sessions: [SESSION_9] })).toEqual({
      warn: false,
      line: `${STRETCH_ROW_HEAD} pr.base stretch/9 is held by live stretch 9 (tmux session ${SESSION_9} is open).`,
    });
    expect(rowOf('stretch/9', { files: agent9({ state: 'running', pid: 4242 }), alive: [4242] })?.line)
      .toContain('held by live stretch 9 (the engineer\'s pid 4242 is alive).');
  });

  it('warns about an unheld stretch/9, naming why each reading does not hold it and both ways out', () => {
    const row = rowOf('stretch/9');

    expect(row).toEqual({
      warn: true,
      line: `${STRETCH_ROW_HEAD} pr.base names stretch/9, which no live stretch of this project holds:`
        + ` .rafa/stretch/9/agent.json is absent and tmux session ${SESSION_9} is not open.`
        + ' Every pull request opens into stretch/9 until it is put back; run rafa stretch start --n=9 to resume'
        + ' that stretch, or rafa config set pr.base=<branch> to put the base back.',
    });
  });

  it('says what the engineer\'s record reads when it is there but holds nothing', () => {
    expect(rowOf('stretch/9', { files: agent9({ state: 'ended', pid: 4242 }) })?.line)
      .toContain('.rafa/stretch/9/agent.json reads state "ended" and tmux session');
    expect(rowOf('stretch/9', { files: agent9({ pid: 4242 }) })?.line)
      .toContain('.rafa/stretch/9/agent.json names no state and');
    expect(rowOf('stretch/9', { files: agent9({ state: 'running' }) })?.line)
      .toContain('.rafa/stretch/9/agent.json names no pid and');
    expect(rowOf('stretch/9', { files: agent9({ state: 'running', pid: 4242 }) })?.line)
      .toContain('.rafa/stretch/9/agent.json\'s pid 4242 is not alive and');
    expect(rowOf('stretch/9', { files: { [agentFilePath(ROOT, 9)]: '{' } })?.line)
      .toContain('.rafa/stretch/9/agent.json is not JSON:');
  });

  it('warns about a stretch/ branch naming no stretch with what a stretch branch is', () => {
    const row = rowOf('stretch/next');

    expect(row?.warn).toBe(true);
    expect(row?.line).toBe(`${STRETCH_ROW_HEAD} pr.base names stretch/next, which no live stretch of this project`
      + ' holds. Every pull request opens into stretch/next until it is put back; a stretch\'s branch is'
      + ' stretch/<n>, <n> a whole number from 1; run rafa config set pr.base=<branch> to put the base back.');
  });

  it('warns about a reading it could not make, naming the problem', () => {
    const row = stretchRow('/', { kind: 'unread', base: 'stretch/9', problem: 'no name' });

    expect(row).toEqual({
      warn: true,
      line: `${STRETCH_ROW_HEAD} pr.base names stretch/9, and whether a live stretch holds it could not be read: no name`,
    });
  });
});

describe('writeDoctorStretch', () => {
  it('warns in both modes about an unheld base', () => {
    const text = recordingOutput();
    const json = recordingOutput();

    writeDoctorStretch({ output: text.output, outputMode: 'text' }, ROOT, 'stretch/9', fakeSeams().seams);
    writeDoctorStretch({ output: json.output, outputMode: 'json' }, ROOT, 'stretch/9', fakeSeams().seams);

    expect(text.seen.map(([level]) => level)).toEqual(['warn']);
    expect(json.seen.map(([level]) => level)).toEqual(['warn']);
  });

  it('writes a held base at info in text mode and nothing in json mode', () => {
    const text = recordingOutput();
    const json = recordingOutput();
    const world = { sessions: [SESSION_9] };

    writeDoctorStretch({ output: text.output, outputMode: 'text' }, ROOT, 'stretch/9', fakeSeams(world).seams);
    writeDoctorStretch({ output: json.output, outputMode: 'json' }, ROOT, 'stretch/9', fakeSeams(world).seams);

    expect(text.seen.map(([level]) => level)).toEqual(['info']);
    expect(json.seen).toEqual([]);
  });

  it('writes nothing for a base naming no stretch/ branch, and answers the reading', () => {
    const text = recordingOutput();

    const reading = writeDoctorStretch({ output: text.output, outputMode: 'text' }, ROOT, 'main', fakeSeams().seams);

    expect(reading).toEqual({ kind: 'none' });
    expect(text.seen).toEqual([]);
  });
});

describe('rafa doctor', () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'rafa-doctor-stretch-'));

  afterAll(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  /** The doctor command with no claude spawned and a tier inventory under `home`. */
  function doctorCommand(home: string): RafaCommand {
    return createDoctorCommand({
      checks: { now: () => 0 },
      readClaudeVersion: () => Promise.resolve(SERVE_CLI_VERSION),
      inventory: { entry: () => join(home, 'runtime', 'cli.js') },
    });
  }

  /** A project under a directory no tmux server names, with `pr.base` set to `base`. */
  function plantStretchProject(base: string): { readonly root: string; readonly home: string } {
    const scope = mkdtempSync(join(tempBase, 'scope-'));
    const root = join(scope, `doctor-stretch-${scope.slice(-6)}`);
    const home = join(scope, 'home');
    mkdirSync(home, { recursive: true });
    plantProjectConfig(root, ['version: 1', 'pr:', '  provider: none', `  base: ${base}`, ''].join('\n'));
    return { root, home };
  }

  /** The stretch lines a dispatch of `doctor` wrote, in text mode and json mode. */
  async function stretchLines(project: { readonly root: string; readonly home: string }): Promise<{
    readonly text: readonly string[];
    readonly json: readonly unknown[];
    readonly exitCode: number | null;
  }> {
    const env = { PATH: process.env['PATH'] ?? '' };
    const text = await dispatchInProject(['doctor'], [], [doctorCommand(project.home)], project, env);
    const json = await dispatchInProject(['doctor', '--output=json'], [], [doctorCommand(project.home)], project, env);
    const all = `${text.stdout}${text.stderr}`.split('\n');
    const logs = eventsOf(json.stdout).filter((event) => JSON.stringify(event).includes(STRETCH_ROW_HEAD));
    return { text: all.filter((line) => line.includes(STRETCH_ROW_HEAD)), json: logs, exitCode: text.exitCode };
  }

  it('warns about a pr.base on a stretch no live stretch holds, in both modes, exiting 0', async () => {
    const run = await stretchLines(plantStretchProject('stretch/9'));

    expect(run.exitCode).toBe(0);
    expect(run.text).toHaveLength(1);
    expect(run.text[0]).toContain('pr.base names stretch/9, which no live stretch of this project holds:');
    expect(run.json).toHaveLength(1);
  });

  it('prints the held line, and no warning, for a stretch whose engineer is this live process', async () => {
    const project = plantStretchProject('stretch/9');
    mkdirSync(join(stretchRoot(project.root), '9'), { recursive: true });
    writeFileSync(agentFilePath(project.root, 9), JSON.stringify({ state: 'running', pid: process.pid }), 'utf8');

    const run = await stretchLines(project);

    expect(run.text).toEqual([expect.stringContaining('pr.base stretch/9 is held by live stretch 9') as unknown as string]);
    expect(run.json).toEqual([]);
  });

  it('prints no stretch line for a pr.base on another branch', async () => {
    const run = await stretchLines(plantStretchProject('main'));

    expect(run.text).toEqual([]);
    expect(run.json).toEqual([]);
  });
});
