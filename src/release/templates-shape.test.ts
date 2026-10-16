/**
 * The shape every shipped workflow template under
 * `src/release/templates/*.yml` keeps: parsed with `Bun.YAML.parse`, its
 * triggers and `permissions` block, and each `rafa <subject> <action>`
 * inside a `run:` naming an action of the command registry.
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
  readonly jobs: Record<string, { readonly steps: readonly Step[] }>;
}

/** The workflow at `file`, parsed. */
function parse(file: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(DIR, file), 'utf8')) as Workflow;
}

/** Every `run:` script of the workflow. */
function scriptsOf(workflow: Workflow): readonly string[] {
  return Object.values(workflow.jobs).flatMap((job) => job.steps.flatMap((step) => step.run === undefined
    ? []
    : [step.run]));
}

describe('the release workflow templates', () => {
  it('ship at least one template', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  describe.each(FILES)('%s', (file) => {
    it('triggers on a pushed tag and on workflow_call with a ref input', () => {
      const { on } = parse(file);

      expect((on.push as { tags: string[] }).tags).toEqual(['**']);
      expect(Object.keys(on)).toContain('workflow_call');
      expect(Object.keys((on.workflow_call as { inputs: object }).inputs)).toEqual(['ref']);
    });

    it('declares contents: read and id-token: write', () => {
      expect(parse(file).permissions).toEqual({ contents: 'read', 'id-token': 'write' });
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
