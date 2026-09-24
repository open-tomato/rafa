/**
 * Tests for the served directory.
 *
 * Every case writes real files under a fresh `tmpdir` directory: a planted
 * rafa tier and a project root whose `.rafa/runs/<run>/served/` the
 * module fills. The resolution each case serves comes from `resolveTiers`
 * over rows naming those files, so the served set is always taken from
 * the resolver's own outcome, never from a hand-written `Resolution`.
 *
 * Every rule that leaves an item out is paired with a control that
 * differs from it in one thing and is served, so a case cannot pass
 * because nothing was ever served. The last case serves the real
 * `src/bundled` tier, read through the inventory's tree readers, so the
 * `--agents` value is checked against the definitions rafa actually
 * ships.
 */
import type { TierPin } from '../config-sections.js';
import type { SkillDelivery } from './delivery.js';
import type { TierRow, TierSettings } from './resolve.js';
import type { AgentDefinition, ServedSet } from './serve.js';
import type { InventoryKind, InventorySource } from '../inventory/record.js';

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { readAgentTree, readSkillTree } from '../inventory/trees.js';

import { readItemBytes, resolveTiers } from './resolve.js';
import {
  agentDefinition,
  provenanceBlock,
  rafaWinners,
  SERVED_AGENTS_FILE,
  servedDirectory,
  servedFlags,
  serveResolution,
} from './serve.js';

const RUN = 'run-1';

const REVIEWED = 'provenance:\n  origin: https://example.com/x\n  license: MIT\n  reviewed: marcos 2026-09-24';
const UNREVIEWED = 'provenance:\n  origin: https://example.com/x\n  license: MIT';
const MISSPELT = 'provenance:\n  origin: https://example.com/x\n  license: MIT\n  review: marcos 2026-09-24';

let scratch: string;
let root: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'rafa-serve-'));
  root = join(scratch, 'project');
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Writes `text` at `path`, making its parents. */
function plant(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A skill's `SKILL.md` carrying `extra` in its frontmatter. */
function skillText(name: string, extra = 'provenance: first-party'): string {
  return `---\nname: ${name}\ndescription: The ${name} skill.\n${extra}\n---\n\n# ${name}\n`;
}

/** An agent definition whose frontmatter lines are `lines`, with `body` after it. */
function agentText(lines: readonly string[], body = 'You do the work.'): string {
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

/** An agent named `name`, with comma-string tools and `extra` after them. */
function agent(name: string, extra = 'provenance: first-party'): string {
  return agentText([`name: ${name}`, `description: The ${name} agent.`, 'tools: Read, Grep', 'model: sonnet', extra]);
}

/** Plants a skill in `source`'s tree and answers its row. */
function skillRow(source: InventorySource, name: string, text = skillText(name)): TierRow {
  const path = plant(join(scratch, source, 'skills', name, 'SKILL.md'), text);
  return { kind: 'skill', name, source, path };
}

/** Plants an agent in `source`'s tree and answers its row. */
function agentRow(source: InventorySource, name: string, text = agent(name)): TierRow {
  const path = plant(join(scratch, source, 'agents', `${name}.md`), text);
  return { kind: 'agent', name, source, path };
}

/** Settings a project that has written nothing gets, with `changes` over them. */
function settings(changes: Partial<TierSettings> = {}): TierSettings {
  return {
    settingSources: ['project', 'local'],
    tiersRafa: 'on',
    tiersSkills: new Map<string, TierPin>(),
    tiersAgents: new Map<string, TierPin>(),
    ...changes,
  };
}

/** Serves `rows` resolved under `tierSettings` into the run's served directory. */
function serve(
  rows: readonly TierRow[],
  delivery: SkillDelivery = 'add-dir',
  tierSettings: TierSettings = settings(),
): ServedSet {
  return serveResolution(resolveTiers(rows, tierSettings, readItemBytes), { root, run: RUN, delivery });
}

/** The `kind` names `served` copied. */
function names(served: ServedSet, kind: InventoryKind): readonly string[] {
  return (kind === 'skill'
    ? served.skills
    : served.agents).map((copy) => copy.name);
}

/** The `--agents` value the flags carry, parsed, or null when there is none. */
function agentsFlag(served: ServedSet): Record<string, AgentDefinition> | null {
  const at = served.flags.indexOf('--agents');
  return at === -1
    ? null
    : JSON.parse(served.flags[at + 1] ?? '') as Record<string, AgentDefinition>;
}

describe('servedDirectory', () => {
  it('names served/ under the run in the project\'s .rafa/runs', () => {
    expect(servedDirectory('/p', 'abc-1')).toBe(join('/p', '.rafa', 'runs', 'abc-1', 'served'));
  });

  it('refuses a run id that would leave .rafa/runs', () => {
    expect(() => servedDirectory('/p', '../escape')).toThrow('unusable run id');
    expect(() => servedDirectory('/p', 'a/b')).toThrow('unusable run id');
  });
});

describe('what is served', () => {
  it('copies a rafa-tier skill directory, supporting files included, under .claude/skills of the served directory', () => {
    const row = skillRow('rafa', 'documentation');
    plant(join(dirname(row.path), 'scripts', 'lint.sh'), 'echo lint\n');

    const served = serve([row]);

    const copy = join(served.dir, '.claude', 'skills', 'documentation');
    expect(served.dir).toBe(servedDirectory(root, RUN));
    expect(served.skills).toEqual([{ kind: 'skill', name: 'documentation', from: row.path, to: copy }]);
    expect(readFileSync(join(copy, 'SKILL.md'), 'utf8')).toBe(skillText('documentation'));
    expect(readFileSync(join(copy, 'scripts', 'lint.sh'), 'utf8')).toBe('echo lint\n');
    expect(served.flags).toEqual(['--add-dir', served.dir]);
  });

  it('writes nothing under the project\'s .claude/', () => {
    serve([skillRow('rafa', 'documentation'), agentRow('rafa', 'tdd-guide')]);

    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(servedDirectory(root, RUN))).toBe(true);
  });

  it('serves only rafa winners: a project winner, a collision and an item switched off are not copied', () => {
    const rows = [
      skillRow('rafa', 'served-one'),
      skillRow('project', 'project-only'),
      skillRow('project', 'clash', skillText('clash', 'provenance: first-party\nversion: 2')),
      skillRow('rafa', 'clash'),
      skillRow('rafa', 'switched-off'),
    ];

    const tierSettings = settings({ tiersSkills: new Map<string, TierPin>([['switched-off', false]]) });
    const resolution = resolveTiers(rows, tierSettings, readItemBytes);
    const served = serve(rows, 'add-dir', tierSettings);

    expect(resolution.items.map((item) => `${item.name}:${item.state}`))
      .toEqual(['clash:collision', 'project-only:served', 'served-one:served', 'switched-off:off']);
    expect(rafaWinners(resolution).map((item) => item.name)).toEqual(['served-one']);
    expect(names(served, 'skill')).toEqual(['served-one']);
    expect(served.skipped).toEqual([]);
  });

  it('serves the rafa copy a pin chose over the project\'s', () => {
    const rows = [
      skillRow('project', 'clash', skillText('clash', 'provenance: first-party\nversion: 2')),
      skillRow('rafa', 'clash'),
    ];

    const served = serve(rows, 'add-dir', settings({ tiersSkills: new Map<string, TierPin>([['clash', 'rafa']]) }));

    expect(names(served, 'skill')).toEqual(['clash']);
    expect(readFileSync(join(served.dir, '.claude', 'skills', 'clash', 'SKILL.md'), 'utf8')).toBe(skillText('clash'));
  });

  it('serves nothing, and hands no flag, while tiers.rafa is off', () => {
    const served = serve([skillRow('rafa', 'documentation'), agentRow('rafa', 'tdd-guide')], 'add-dir', settings({ tiersRafa: 'off' }));

    expect(served.skills).toEqual([]);
    expect(served.agents).toEqual([]);
    expect(served.flags).toEqual([]);
    expect(existsSync(join(served.dir, SERVED_AGENTS_FILE))).toBe(false);
  });
});

describe('what is not served', () => {
  it('leaves out an unreviewed third-party skill and agent, and serves the reviewed ones beside them', () => {
    const rows = [
      skillRow('rafa', 'taken', skillText('taken', UNREVIEWED)),
      skillRow('rafa', 'read', skillText('read', REVIEWED)),
      agentRow('rafa', 'taken-agent', agent('taken-agent', UNREVIEWED)),
      agentRow('rafa', 'read-agent', agent('read-agent', REVIEWED)),
    ];

    const served = serve(rows);

    expect(names(served, 'skill')).toEqual(['read']);
    expect(names(served, 'agent')).toEqual(['read-agent']);
    expect(served.skipped.map((item) => `${item.kind} ${item.name} ${item.reason}`))
      .toEqual(['skill taken unreviewed', 'agent taken-agent unreviewed']);
    expect(served.skipped[0]?.message).toBe(
      `rafa-tier skill taken is not served: it is third-party from https://example.com/x with no reviewed (${rows[0]?.path})`,
    );
    expect(existsSync(join(served.dir, '.claude', 'skills', 'taken'))).toBe(false);
    expect(Object.keys(agentsFlag(served) ?? {})).toEqual(['read-agent']);
  });

  it('leaves out a provenance the checker refuses, and serves an item with no provenance', () => {
    const served = serve([
      skillRow('rafa', 'misspelt', skillText('misspelt', MISSPELT)),
      skillRow('rafa', 'unmarked', skillText('unmarked', 'version: 1')),
    ]);

    expect(names(served, 'skill')).toEqual(['unmarked']);
    expect(served.skipped.map((item) => `${item.name} ${item.reason}`)).toEqual(['misspelt invalid-provenance']);
  });

  it('leaves out a loose-file skill and a definition with no frontmatter', () => {
    const loose = plant(join(scratch, 'rafa', 'skills', 'loose.md'), skillText('loose'));
    const rows: TierRow[] = [
      { kind: 'skill', name: 'loose', source: 'rafa', path: loose },
      skillRow('rafa', 'bare', '# bare, no frontmatter\n'),
      skillRow('rafa', 'fine'),
    ];

    const served = serve(rows);

    expect(names(served, 'skill')).toEqual(['fine']);
    expect(served.skipped.map((item) => `${item.name} ${item.reason}`)).toEqual(['bare unreadable', 'loose not-loadable']);
  });

  it('leaves out an agent the --agents flag would refuse, without taking the others down', () => {
    const rows = [
      agentRow('rafa', 'no-body', agentText(['name: no-body', 'description: Nothing to say.'], '   ')),
      agentRow('rafa', 'no-description', agentText(['name: no-description'])),
      agentRow('rafa', 'bad-tools', agentText(['name: bad-tools', 'description: d', 'tools: 3'])),
      agentRow('rafa', 'good'),
    ];

    const served = serve(rows);

    expect(names(served, 'agent')).toEqual(['good']);
    expect(Object.keys(agentsFlag(served) ?? {})).toEqual(['good']);
    expect(served.skipped.map((item) => `${item.name} ${item.reason}`))
      .toEqual(['bad-tools invalid-definition', 'no-body invalid-definition', 'no-description invalid-definition']);
  });
});

describe('the --agents value', () => {
  it('turns a comma-string tools into a list, drops name and provenance, and keeps every other key', () => {
    const verdict = agentDefinition(
      { name: 'x', description: 'An x.', tools: 'Read, Grep ,,Bash', model: 'haiku', color: 'blue', provenance: 'first-party' },
      '\nBe x.\n',
    );

    expect(verdict).toEqual({
      ok: true,
      value: { description: 'An x.', prompt: 'Be x.', tools: ['Read', 'Grep', 'Bash'], model: 'haiku', color: 'blue' },
    });
  });

  it('keeps a tools list as written, and leaves tools out when the definition has none', () => {
    expect(agentDefinition({ description: 'd', tools: ['Read'] }, 'p')).toEqual({ ok: true, value: { description: 'd', prompt: 'p', tools: ['Read'] } });
    expect(agentDefinition({ description: 'd' }, 'p')).toEqual({ ok: true, value: { description: 'd', prompt: 'p' } });
  });

  it('writes the value into agents.json and hands the same value as the last flag', () => {
    const served = serve([skillRow('rafa', 'documentation'), agentRow('rafa', 'tdd-guide'), agentRow('rafa', 'doc-updater')]);

    const file = join(served.dir, SERVED_AGENTS_FILE);
    const written = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    expect(served.flags.slice(0, 3)).toEqual(['--add-dir', served.dir, '--agents']);
    expect(served.flags).toHaveLength(4);
    expect(agentsFlag(served)).toEqual(written as Record<string, AgentDefinition>);
    expect(agentsFlag(served)?.['tdd-guide']).toEqual({
      description: 'The tdd-guide agent.',
      prompt: 'You do the work.',
      tools: ['Read', 'Grep'],
      model: 'sonnet',
    });
    expect(served.agents.map((copy) => copy.to)).toEqual([file, file]);
  });

  it('places the agents nowhere a delivery would load them a second time', () => {
    const served = serve([agentRow('rafa', 'tdd-guide')], 'plugin-dir');

    expect(existsSync(join(served.dir, '.claude', 'agents'))).toBe(false);
    expect(existsSync(join(served.dir, 'agents'))).toBe(false);
    expect(served.flags).toEqual(['--agents', served.flags[1] ?? '']);
  });
});

describe('the plugin-dir delivery', () => {
  it('copies skills under skills/ beside a manifest naming the plugin rafa, and hands --plugin-dir', () => {
    const served = serve([skillRow('rafa', 'documentation'), agentRow('rafa', 'tdd-guide')], 'plugin-dir');

    const manifest = JSON.parse(readFileSync(join(served.dir, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string };
    expect(manifest.name).toBe('rafa');
    expect(served.delivery).toBe('plugin-dir');
    expect(existsSync(join(served.dir, 'skills', 'documentation', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(served.dir, '.claude'))).toBe(false);
    expect(served.flags.slice(0, 3)).toEqual(['--plugin-dir', served.dir, '--agents']);
  });
});

describe('copies, not links', () => {
  it('follows a link inside a skill directory, so editing the source later changes nothing served', () => {
    const target = plant(join(scratch, 'elsewhere', 'notes.md'), 'first\n');
    const row = skillRow('rafa', 'linked');
    const link = join(dirname(row.path), 'notes.md');
    symlinkSync(target, link);

    const served = serve([row]);
    writeFileSync(target, 'changed by a self-update\n');

    const copy = join(served.dir, '.claude', 'skills', 'linked', 'notes.md');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(lstatSync(copy).isSymbolicLink()).toBe(false);
    expect(readFileSync(copy, 'utf8')).toBe('first\n');
  });

  it('replaces what an earlier call served, so a winner no longer served is gone', () => {
    const first = serve([skillRow('rafa', 'old'), agentRow('rafa', 'old-agent')]);
    expect(existsSync(join(first.dir, '.claude', 'skills', 'old'))).toBe(true);

    const second = serve([skillRow('rafa', 'new')]);

    expect(existsSync(join(second.dir, '.claude', 'skills', 'old'))).toBe(false);
    expect(existsSync(join(second.dir, SERVED_AGENTS_FILE))).toBe(false);
    expect(names(second, 'skill')).toEqual(['new']);
  });
});

describe('the pieces', () => {
  it('provenanceBlock serves first-party, reviewed and absent, and refuses unreviewed and misspelt', () => {
    expect(provenanceBlock({ provenance: 'first-party' }).ok).toBe(true);
    expect(provenanceBlock({}).ok).toBe(true);
    expect(provenanceBlock({ provenance: { origin: 'o', license: 'MIT', reviewed: 'm 2026-09-24' } }).ok).toBe(true);
    expect(provenanceBlock({ provenance: { origin: 'o', license: 'MIT' } })).toMatchObject({ ok: false, reason: 'unreviewed' });
    expect(provenanceBlock({ provenance: { origin: 'o', license: 'MIT', review: 'm 2026-09-24' } }))
      .toMatchObject({ ok: false, reason: 'invalid-provenance' });
  });

  it('servedFlags hands no flag for an empty set, and each flag only for its own kind', () => {
    const agents = { a: { description: 'd', prompt: 'p' } };
    expect(servedFlags('/s', 'add-dir', 0, {})).toEqual([]);
    expect(servedFlags('/s', 'add-dir', 1, {})).toEqual(['--add-dir', '/s']);
    expect(servedFlags('/s', 'plugin-dir', 0, agents)).toEqual(['--agents', JSON.stringify(agents)]);
  });
});

describe('the real rafa tier', () => {
  it('serves every bundled skill and agent, each agent in a shape the --agents flag accepts', () => {
    const seams = {
      home: join(scratch, 'home'),
      projectRoot: null,
      entry: join(import.meta.dir, '..', 'rafa.ts'),
      pathDirs: [],
    };
    const rows = [...readSkillTree('rafa', seams).items, ...readAgentTree('rafa', seams).items];

    const served = serve(rows);

    const agents = agentsFlag(served) ?? {};
    expect(names(served, 'skill')).toEqual(['dev-planner', 'documentation', 'git-workflow', 'ts-symbols']);
    expect(Object.keys(agents).sort()).toEqual([
      'build-error-resolver',
      'code-reviewer',
      'doc-updater',
      'loop-implementer',
      'qa-bug-reporter',
      'tdd-guide',
    ]);
    expect(served.skipped).toEqual([]);
    for (const definition of Object.values(agents)) {
      expect(definition.description.trim()).not.toBe('');
      expect(definition.prompt.trim()).not.toBe('');
      expect(Array.isArray(definition['tools'])).toBe(true);
      expect(Object.hasOwn(definition, 'provenance')).toBe(false);
    }
  });
});
