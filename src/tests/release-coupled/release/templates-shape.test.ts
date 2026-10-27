/**
 * The shape every shipped workflow template under
 * `src/release/templates/*.yml` keeps: parsed with `Bun.YAML.parse`, its
 * triggers and `permissions` block as {@link SHAPES} names them for that
 * file, its publish job's `if` as the table names it and no other job's
 * `if` naming the publishing switch, and each `rafa <subject> <action>`
 * inside a `run:` naming an action of the command registry.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';

import { CORE_REGISTRY } from '../../../commands/index.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-shape-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const DIR = fileURLToPath(new URL('../../../../packages/rafa-release/src/release/templates/', import.meta.url));
const FILES = readdirSync(DIR).filter((file) => file.endsWith('.yml'));

interface Step {
  readonly name?: string;
  readonly run?: string;
}
interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions: Record<string, string>;
  readonly jobs: Record<string, { readonly if?: string; readonly steps?: readonly Step[] }>;
}

/**
 * What one template's top level holds: its trigger names, its
 * `permissions` block, and the exact `if` of its `publish` job, `null`
 * when the template has no publish job.
 */
interface Shape {
  readonly triggers: readonly string[];
  readonly permissions: Readonly<Record<string, string>>;
  readonly publishIf: string | null;
}

/** The repository variable that switches CI publishing on when it reads `ci`. */
const SWITCH = 'RAFA_RELEASE_PUBLISH';
const SWITCH_ON = `vars.${SWITCH} == 'ci'`;

/**
 * Each shipped template's triggers and permissions. The publish
 * workflow runs on a pushed tag or a `workflow_call` and mints an id
 * token; the tag workflow runs on a closed pull request and pushes a
 * tag, granting the token to its publish job alone; the settle
 * workflow runs on a push and pushes a release commit and its tags, and
 * does the same; the bot fragment workflow runs on a bot's pull request
 * in the base's context, pushes one commit to its branch and reads the
 * pull request's metadata. Every publish job runs only when the
 * repository variable `RAFA_RELEASE_PUBLISH` reads `ci`, the settle
 * workflow's joined to its own condition; the bot fragment workflow has
 * no publish job.
 */
const SHAPES: Readonly<Record<string, Shape>> = {
  'release-publish.yml': {
    triggers: ['push', 'workflow_call'],
    permissions: { contents: 'read', 'id-token': 'write' },
    publishIf: SWITCH_ON,
  },
  'release-tag.yml': { triggers: ['pull_request'], permissions: { contents: 'write' }, publishIf: SWITCH_ON },
  'release-settle.yml': {
    triggers: ['push'],
    permissions: { contents: 'write' },
    publishIf: `needs.settle.outputs.release != '' && ${SWITCH_ON}`,
  },
  'release-bot-fragment.yml': {
    triggers: ['pull_request_target'],
    permissions: { 'contents': 'write', 'pull-requests': 'read' },
    publishIf: null,
  },
};

/** The workflow at `file`, parsed. */
function parse(file: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(DIR, file), 'utf8')) as Workflow;
}

/** Every `run:` script of the workflow. */
function scriptsOf(workflow: Workflow): readonly string[] {
  return Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).flatMap((step) => step.run === undefined
    ? []
    : [step.run]));
}

const CONFIG_STEP = 'Write the CI config';
const RAFA_CALL = /\brafa(?:\.ts)? [a-z][a-z-]* [a-z][a-z-]*/;

/** The steps of the job holding the config step, and the step itself. */
function configJob(file: string): { readonly steps: readonly Step[]; readonly step: Step | undefined } {
  const steps = Object.values(parse(file).jobs)
    .map((job) => job.steps ?? [])
    .find((jobSteps) => jobSteps.some((candidate) => candidate.name === CONFIG_STEP)) ?? [];
  return { steps, step: steps.find((candidate) => candidate.name === CONFIG_STEP) };
}

/** Runs the config step's script under bash in `dir`, failing on a nonzero exit. */
function runConfigStep(file: string, dir: string): void {
  const run = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', configJob(file).step?.run ?? 'exit 99'], {
    cwd: dir,
    env: { TMPDIR: tmpdir(), PATH: process.env['PATH'] ?? '', ...scratchHomeEnv(tempBase) },
  });
  expect(run.exitCode).toBe(0);
}

/** Every file under `dir`, relative, sorted. */
function listing(dir: string): readonly string[] {
  return [...new Bun.Glob('**/*').scanSync({ cwd: dir, dot: true, onlyFiles: true })].sort();
}

describe('the release workflow templates', () => {
  it('ship at least one template', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  describe.each(FILES)('%s', (file) => {
    it('has a shape of its own in the table', () => {
      expect(SHAPES[file]).toBeDefined();
    });

    it('triggers on the events its shape names', () => {
      expect(Object.keys(parse(file).on)).toEqual([...(SHAPES[file]?.triggers ?? [])]);
    });

    it('declares the permissions its shape names', () => {
      expect(parse(file).permissions).toEqual({ ...SHAPES[file]?.permissions });
    });

    it('gives its publish job the if its shape names, or has none when the shape names none', () => {
      const publish = parse(file).jobs['publish'];
      const expected = SHAPES[file]?.publishIf;

      expect(expected).toBeDefined();
      if (expected === null) {
        expect(publish).toBeUndefined();
        return;
      }
      expect(publish?.if).toBe(expected as string);
    });

    it('names the publishing switch in no if but the publish job\'s', () => {
      const others = Object.entries(parse(file).jobs)
        .filter(([name]) => name !== 'publish')
        .map(([, job]) => job.if ?? '');

      expect(Object.keys(parse(file).jobs).length).toBeGreaterThan(0);
      expect(others.filter((condition) => condition.includes(SWITCH))).toEqual([]);
    });

    it('calls only actions the command registry holds in every rafa line of a run', () => {
      const scripts = scriptsOf(parse(file));
      const calls = scripts.flatMap((script) => [...script.matchAll(/\brafa(?:\.ts)? ([a-z][a-z-]*) ([a-z][a-z-]*)/g)]
        .map((match) => ({ subject: match[1] ?? '', action: match[2] ?? '' })));

      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(CORE_REGISTRY.find(call.subject, call.action)).toBeDefined();
      }
    });

    describe(CONFIG_STEP, () => {
      it('sits before the first step whose script runs rafa', () => {
        const { steps } = configJob(file);
        const at = steps.findIndex((candidate) => candidate.name === CONFIG_STEP);
        const firstRafa = steps.findIndex((candidate) => RAFA_CALL.test(candidate.run ?? ''));

        expect(at).toBeGreaterThanOrEqual(0);
        expect(firstRafa).toBeGreaterThan(at);
      });

      it('writes .rafa/config.yaml enabling the release commands when no config exists', () => {
        const dir = mkdtempSync(join(tempBase, 'none-'));

        runConfigStep(file, dir);

        expect(listing(dir)).toEqual(['.rafa/config.yaml']);
        const text = readFileSync(join(dir, '.rafa/config.yaml'), 'utf8');
        expect(Bun.YAML.parse(text)).toEqual({ release: { enabled: true } });
        const name = (parse(file) as unknown as { readonly name: string }).name;
        expect(text.split('\n')[0]).toBe(`# Written by the ${name} workflow: the checkout holds no rafa config.`);
      });

      it.each(['rafa.config.ts', 'rafa.config.mjs', '.rafa/config.yaml'])('leaves a planted %s byte for byte and writes nothing else', (planted) => {
        const dir = mkdtempSync(join(tempBase, 'planted-'));
        const content = 'export default { planted: true }; // \u00e9\n';
        mkdirSync(join(dir, '.rafa'), { recursive: true });
        writeFileSync(join(dir, planted), content);

        runConfigStep(file, dir);

        expect(listing(dir)).toEqual([planted]);
        expect(readFileSync(join(dir, planted), 'utf8')).toBe(content);
      });
    });
  });
});
