/**
 * The shape every shipped workflow template under
 * `src/release/templates/*.yml` keeps: parsed with `Bun.YAML.parse`, its
 * triggers and `permissions` block as {@link SHAPES} names them for that
 * file, and each `rafa <subject> <action>` inside a `run:` naming an
 * action of the command registry.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { CORE_REGISTRY } from '../commands/index.js';

const DIR = fileURLToPath(new URL('./templates/', import.meta.url));
const FILES = readdirSync(DIR).filter((file) => file.endsWith('.yml'));

interface Step {
  readonly run?: string;
}
interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions: Record<string, string>;
  readonly jobs: Record<string, { readonly steps?: readonly Step[] }>;
}

/** What one template's top level holds: its trigger names and its `permissions` block. */
interface Shape {
  readonly triggers: readonly string[];
  readonly permissions: Readonly<Record<string, string>>;
}

/**
 * Each shipped template's triggers and permissions. The publish
 * workflow runs on a pushed tag or a `workflow_call` and mints an id
 * token; the tag workflow runs on a closed pull request and pushes a
 * tag, granting the token to its publish job alone; the settle
 * workflow runs on a push and pushes a release commit and its tags, and
 * does the same.
 */
const SHAPES: Readonly<Record<string, Shape>> = {
  'release-publish.yml': { triggers: ['push', 'workflow_call'], permissions: { contents: 'read', 'id-token': 'write' } },
  'release-tag.yml': { triggers: ['pull_request'], permissions: { contents: 'write' } },
  'release-settle.yml': { triggers: ['push'], permissions: { contents: 'write' } },
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

    it('calls only actions the command registry holds in every rafa line of a run', () => {
      const scripts = scriptsOf(parse(file));
      const calls = scripts.flatMap((script) => [...script.matchAll(/\brafa(?:\.ts)? ([a-z][a-z-]*) ([a-z][a-z-]*)/g)]
        .map((match) => ({ subject: match[1] ?? '', action: match[2] ?? '' })));

      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(CORE_REGISTRY.find(call.subject, call.action)).toBeDefined();
      }
    });
  });
});
