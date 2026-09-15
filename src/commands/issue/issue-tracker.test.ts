/**
 * Tests for what the `issue` actions share (`issue-tracker.ts`): the
 * readers of a line's words and flags, the ref an id names, the refusal
 * of an adapter call that rejects, and the tracker resolved through the
 * chain.
 *
 * The chain cases dispatch a probe action whose run resolves the tracker
 * and gives what json mode says of it as its result. Each runs from a
 * project of its own beside a home of its own under this file's
 * temporary directory (`tests/cli-capture.ts`), so the config read is the
 * one the case planted. `gh` is the recorded fake
 * (`adapters/tracker/github-fake.ts`), so no case runs `gh` or reads the
 * real home. The fake's calls are the control that a config refused ran
 * no preflight: the case landing on `github` records both preflight
 * commands through the same seam.
 *
 * The registry seam is held by a kind the core registry lacks: the probe
 * lands on it with the seam, and without the seam the same config
 * degrades to `local`, so the case cannot pass on the core registry.
 */
import type { IssueSeams, LineFlags } from './issue-tracker.js';
import type { RafaCommand } from '../../cli/command.js';
import type { CliEvent, Tracker } from '../../ports/index.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createAdapterRegistry, PORT_VERSIONS } from '../../adapters/registry.js';
import { createFakeGh } from '../../adapters/tracker/github-fake.js';
import { CommandExit } from '../../cli/command.js';
import { configFilePath } from '../../config.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import {
  expectTwoArguments,
  issueName,
  issueRef,
  onTracker,
  readChoice,
  readChoiceFlag,
  readNonBlankFlag,
  readRequiredFlag,
  readTextFlag,
  resolveIssueTracker,
  urlLines,
} from './issue-tracker.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-tracker-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line the reader cases refuse with. */
const USAGE = 'rafa issue probe <id> <state>';

/** The subject the probe routes under. */
const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** What the `github` preflight answers over a fake with no host logged in. */
const NOT_LOGGED_IN = 'gh auth status: You are not logged into any GitHub hosts. To log in, run: gh auth login';

/** A config naming `local` first. */
const LOCAL_CONFIG = 'tracker:\n  default: local\n';

/** A config naming `github` first, then `local`. */
const GITHUB_CONFIG = 'tracker:\n  default: github\n  fallback: [local]\n';

/** Flag sets as a line's context holds them. */
function flagSets(...sets: readonly LineFlags[]): readonly LineFlags[] {
  return sets;
}

/** What `run` threw, as its exit code and message for a `CommandExit`, or undefined when it returned. */
function exitOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

/** A probe action resolving the tracker with `seams` and giving what json mode says of it. */
function probe(seams: IssueSeams): RafaCommand {
  return {
    name: 'issue probe',
    subject: 'issue',
    action: 'probe',
    summary: 'resolve the tracker',
    description: 'Resolves the tracker through the chain and gives what json mode says of it.',
    args: [],
    flags: [],
    examples: [{ cmd: 'rafa issue probe', note: 'Resolves the tracker.' }],
    outputs: ['text', 'json'],
    run: async (context) => {
      const { data } = await resolveIssueTracker(context, seams);
      context.output.result(data);
    },
  };
}

/** A tracker of `kind` recording each preflight it runs, and refusing every other call. */
function recordingTracker(kind: string, preflights: string[]): Tracker {
  const refuse = (): Promise<never> => Promise.reject(new Error(`${kind}: not modelled`));
  return {
    kind,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: async () => {
      preflights.push(kind);
      return { ok: true };
    },
    find: refuse,
    get: refuse,
    create: refuse,
    comment: refuse,
    transition: refuse,
  };
}

/** What one probe dispatched in json mode left: its project, what it wrote, and its events. */
interface Probed {
  readonly project: PlantedProject;
  readonly run: CapturedRun;
  readonly events: readonly CliEvent[];
}

/** Dispatches the probe in json mode from a fresh project holding `config`. */
async function probed(config: string, seams: IssueSeams): Promise<Probed> {
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), config);
  const run = await dispatchInProject(['issue', 'probe', '--output=json'], SUBJECTS, [probe(seams)], project);
  return { project, run, events: eventsOf(run.stdout) };
}

describe('reading a line', () => {
  it('answers two arguments, and refuses any other count naming the words and the usage', () => {
    expect(expectTwoArguments(['12', 'done'], USAGE)).toEqual(['12', 'done']);
    expect([[], ['12'], ['12', 'done', 'now']].map((args) => exitOf(() => expectTwoArguments(args, USAGE)))).toEqual([
      { exitCode: 1, message: `❌ Expected two arguments, got none\nUsage: ${USAGE}` },
      { exitCode: 1, message: `❌ Expected two arguments, got 1: 12\nUsage: ${USAGE}` },
      { exitCode: 1, message: `❌ Expected two arguments, got 3: 12 done now\nUsage: ${USAGE}` },
    ]);
  });

  it('reads a flag value as typed, an empty one included, and refuses one typed bare or negated', () => {
    expect(flagSets({}, { body: 'x' }, { body: '' }).map((flags) => readTextFlag(flags, 'body', USAGE))).toEqual([undefined, 'x', '']);
    expect([true, false].map((value) => exitOf(() => readTextFlag({ body: value }, 'body', USAGE)))).toEqual([
      { exitCode: 1, message: `❌ --body needs a value: --body=<value>\nUsage: ${USAGE}` },
      { exitCode: 1, message: `❌ --body needs a value: --body=<value>\nUsage: ${USAGE}` },
    ]);
  });

  it('refuses a blank value where a flag must hold text, and a required flag left out', () => {
    expect(flagSets({}, { module: ' cli ' }).map((flags) => readNonBlankFlag(flags, 'module', USAGE))).toEqual([undefined, ' cli ']);
    expect(exitOf(() => readNonBlankFlag({ module: ' \t' }, 'module', USAGE))).toEqual({
      exitCode: 1,
      message: `❌ --module cannot be blank: --module=<value>\nUsage: ${USAGE}`,
    });
    expect(readRequiredFlag({ title: 'x' }, 'title', USAGE)).toBe('x');
    expect(flagSets({}, { title: '' }).map((flags) => exitOf(() => readRequiredFlag(flags, 'title', USAGE)))).toEqual([
      { exitCode: 1, message: `❌ --title is required: --title=<value>\nUsage: ${USAGE}` },
      { exitCode: 1, message: `❌ --title cannot be blank: --title=<value>\nUsage: ${USAGE}` },
    ]);
  });

  it('reads a choice among its members, and refuses any other naming them', () => {
    expect(readChoice('done', 'The state', ['todo', 'done'], USAGE)).toBe('done');
    expect(exitOf(() => readChoice('Done', 'The state', ['todo', 'done'], USAGE))).toEqual({
      exitCode: 1,
      message: `❌ The state is "Done", expected one of: todo, done\nUsage: ${USAGE}`,
    });
    expect(flagSets({}, { type: 'bug' }).map((flags) => readChoiceFlag(flags, 'type', ['bug', 'code'], USAGE))).toEqual([undefined, 'bug']);
    expect(exitOf(() => readChoiceFlag({ type: 'feature' }, 'type', ['bug', 'code'], USAGE))).toEqual({
      exitCode: 1,
      message: `❌ --type is "feature", expected one of: bug, code\nUsage: ${USAGE}`,
    });
  });
});

describe('naming an issue', () => {
  it('makes the ref an id names on a tracker: its kind, the id, opt 0 and no URL', () => {
    expect(issueRef({ kind: 'github' }, '12')).toEqual({ opt: 0, kind: 'github', externalId: '12', url: null });
    expect(issueName({ kind: 'local', externalId: '3' })).toBe('local issue 3');
    expect([urlLines({ url: null }), urlLines({ url: 'https://example.test/3' })]).toEqual([[], ['URL: https://example.test/3']]);
  });

  it('answers what a tracker call answers, and refuses a rejection naming the action, the kind and the message', async () => {
    const answered = await onTracker({ kind: 'local' }, 'read issue 3', () => Promise.resolve('read'));
    const refused = await onTracker({ kind: 'local' }, 'read issue 3', () => Promise.reject(new Error('local tracker: no issue 3')))
      .then(() => undefined, (error: unknown) => exitOf(() => {
        throw error;
      }));

    expect(answered).toBe('read');
    expect(refused).toEqual({ exitCode: 1, message: '❌ Could not read issue 3 on the local tracker: local tracker: no issue 3' });
  });
});

describe('the tracker, through the chain', () => {
  it('lands on local when tracker.default names it, running no gh, from a project under this file', async () => {
    const fake = createFakeGh();
    const { project, run, events } = await probed(LOCAL_CONFIG, { gh: fake.run });

    expect(project.root.startsWith(`${tempBase}${sep}`)).toBe(true);
    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({ ok: true, data: { kind: 'local', degraded: false, fallbackReason: null } });
    expect(fake.calls()).toEqual([]);
  });

  it('lands on github when its preflight passes, through the gh runner the seams name', async () => {
    const fake = createFakeGh();
    const { run, events } = await probed(GITHUB_CONFIG, { gh: fake.run });

    expect(run.exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({ ok: true, data: { kind: 'github', degraded: false, fallbackReason: null } });
    expect(fake.calls()).toEqual([['auth', 'status'], ['repo', 'view', '--json', 'nameWithOwner']]);
  });

  it('falls back to local when github fails its preflight, warning through the command output first', async () => {
    const fake = createFakeGh({ authOk: false });
    const { run, events } = await probed(GITHUB_CONFIG, { gh: fake.run });

    expect(run.exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(events[1]).toMatchObject({ level: 'warn', message: `tracker chain: github unavailable: ${NOT_LOGGED_IN}` });
    expect(events[2]).toMatchObject({
      ok: true,
      data: { kind: 'local', degraded: true, fallbackReason: `github: ${NOT_LOGGED_IN}` },
    });
  });

  it('refuses a chain landing nowhere with the message of the chain, each kind warned about first', async () => {
    const fake = createFakeGh({ authOk: false });
    const { run, events } = await probed('tracker:\n  default: github\n  fallback: [linear]\n', { gh: fake.run });
    const linear = 'adapter registry: no tracker adapter is registered as "linear"; registered: local, github';

    expect(run.exitCode).toBe(1);
    expect(events.filter((event) => event.type === 'log')).toMatchObject([
      { level: 'warn', message: `tracker chain: github unavailable: ${NOT_LOGGED_IN}` },
      { level: 'warn', message: `tracker chain: linear unavailable: ${linear}` },
    ]);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: {
        code: 'command_exit',
        message: `❌ tracker chain: no tracker available; tried github: ${NOT_LOGGED_IN}; linear: ${linear}`,
      },
    });
  });

  it('resolves each kind through the registry the seams name, which the core registry does not hold', async () => {
    const preflights: string[] = [];
    const registry = createAdapterRegistry([{
      port: 'tracker',
      kind: 'probe',
      portVersion: PORT_VERSIONS.tracker,
      create: () => recordingTracker('probe', preflights),
    }]);
    const config = 'tracker:\n  default: probe\n  fallback: [local]\n';

    const seamed = await probed(config, { registry });
    const unseamed = await probed(config, {});

    expect(seamed.events.at(-1)).toMatchObject({ ok: true, data: { kind: 'probe', degraded: false, fallbackReason: null } });
    expect(preflights).toEqual(['probe']);
    expect(unseamed.events.at(-1)).toMatchObject({ ok: true, data: { kind: 'local', degraded: true } });
  });

  it('refuses a config loadConfig refuses, one line per problem, running no preflight', async () => {
    const fake = createFakeGh();
    const { project, run, events } = await probed('tracker:\n  default: [github]\n', { gh: fake.run });
    const problem = `${configFilePath(project.root)}: tracker.default is a list, expected a tracker kind name`;

    expect(run.exitCode).toBe(1);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: { code: 'command_exit', message: `❌ The config cannot be used:\n  ${problem}` },
    });
    expect(fake.calls()).toEqual([]);
  });
});
