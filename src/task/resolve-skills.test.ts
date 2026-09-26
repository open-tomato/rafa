/**
 * Unit tests for the skill resolvers: `planner` by `skills=` name, `tag`
 * by rank against the task text and stage context, `none`, what none of
 * them may offer, and the exported floor and limit.
 */
import type { TierPin } from '../config-sections.js';
import type { TaskInput } from './resolve-skills.js';
import type { InventoryState } from '../inventory/record.js';
import type { SkillTier } from '../schema/tiers.js';
import type { Resolution, TierSettings } from '../tiers/resolve.js';

import { describe, expect, it } from 'bun:test';

import { SKILL_RESOLVERS } from '../config-sections.js';
import { resolveTiers } from '../tiers/resolve.js';

import {
  noneResolver,
  plannerResolver,
  RANK_FLOOR,
  SKILL_RESOLVER_BY_NAME,
  TAG_LIMIT,
  tagResolver,
  tagResolverWith,
} from './resolve-skills.js';

interface Row {
  readonly kind: 'skill' | 'agent';
  readonly name: string;
  readonly source: SkillTier;
  readonly path: string;
  readonly tags: readonly string[];
  readonly prevents: string | null;
  readonly whenToUse: string | null;
  readonly summary: string;
  readonly state?: InventoryState;
}

const SETTINGS: TierSettings = {
  settingSources: ['user', 'project', 'local'],
  tiersRafa: 'on',
  tiersSkills: new Map(),
  tiersAgents: new Map(),
};

function row(name: string, fields: Partial<Row> = {}): Row {
  const source = fields.source ?? 'project';
  const kind = fields.kind ?? 'skill';
  return {
    kind,
    name,
    source,
    path: `/${source}/${kind}/${name}/SKILL.md`,
    tags: [],
    prevents: null,
    whenToUse: null,
    summary: '',
    ...fields,
  };
}

/** Each path its own bytes, so two holders of one name always differ. */
function resolve(rows: readonly Row[], skills: ReadonlyMap<string, TierPin> = new Map()): Resolution {
  return resolveTiers(rows, { ...SETTINGS, tiersSkills: skills }, (path) => new TextEncoder().encode(path));
}

function task(text: string, fields: Partial<TaskInput> = {}): TaskInput {
  return { text, skills: [], stageContext: null, ...fields };
}

/** A read seam serving `files` by path and throwing for any other. */
function reader(files: Readonly<Record<string, string>>): (path: string) => string {
  return (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };
}

/** A read seam that never finds a file: every skill ranks on its row alone. */
const NO_FILES = reader({});

const names = (skills: readonly { readonly name: string }[]): readonly string[] => skills.map((skill) => skill.name);

describe('the exported floor and limit', () => {
  it('sets the floor at zero, so a kept score is above zero', () => {
    expect(RANK_FLOOR).toBe(0);
  });

  it('keeps three skills at most under tag', () => {
    expect(TAG_LIMIT).toBe(3);
  });

  it('maps every name task.skills may take to its resolver', () => {
    expect(Object.keys(SKILL_RESOLVER_BY_NAME).sort()).toEqual([...SKILL_RESOLVERS].sort());
    expect(SKILL_RESOLVER_BY_NAME.planner).toBe(plannerResolver);
    expect(SKILL_RESOLVER_BY_NAME.tag).toBe(tagResolver);
    expect(SKILL_RESOLVER_BY_NAME.none).toBe(noneResolver);
  });
});

describe('plannerResolver', () => {
  it('offers the skills= names in declaration order, with the winner\'s tier, path and summary', () => {
    const resolution = resolve([
      row('git-workflow', { summary: 'Use when pushing a branch' }),
      row('bun-testing', { source: 'rafa', summary: 'Use when writing bun tests' }),
    ]);

    const offered = plannerResolver(task('anything', { skills: ['bun-testing', 'git-workflow'] }), resolution);

    expect(offered).toEqual([
      {
        name: 'bun-testing',
        source: 'rafa',
        path: '/rafa/skill/bun-testing/SKILL.md',
        description: 'Use when writing bun tests',
      },
      {
        name: 'git-workflow',
        source: 'project',
        path: '/project/skill/git-workflow/SKILL.md',
        description: 'Use when pushing a branch',
      },
    ]);
  });

  it('offers nothing for a task that declared no skills, whatever its text says', () => {
    const resolution = resolve([row('git-workflow', { tags: ['git'] })]);

    expect(plannerResolver(task('push the git branch'), resolution)).toEqual([]);
  });

  it('offers a name once when skills= repeats it', () => {
    const resolution = resolve([row('docs')]);

    expect(names(plannerResolver(task('x', { skills: ['docs', 'docs'] }), resolution))).toEqual(['docs']);
  });

  it('drops a name nothing serves, keeping the ones that resolve', () => {
    const resolution = resolve([row('docs')]);

    expect(names(plannerResolver(task('x', { skills: ['ghost', 'docs'] }), resolution))).toEqual(['docs']);
  });

  it('drops a name switched off, a collision, and a winner the inventory reads as disabled', () => {
    const rows = [
      row('switched', { summary: 'off' }),
      row('split'),
      row('split', { source: 'rafa' }),
      row('muted', { state: 'disabled:skillOverrides' }),
      row('kept'),
    ];
    const resolution = resolve(rows, new Map<string, TierPin>([['switched', false]]));
    const declared = task('x', { skills: ['switched', 'split', 'muted', 'kept'] });

    expect(resolution.collisions.map((collision) => collision.name)).toEqual(['split']);
    expect(names(plannerResolver(declared, resolution))).toEqual(['kept']);
  });

  it('never offers an agent of the declared name', () => {
    const resolution = resolve([row('reviewer', { kind: 'agent' })]);

    expect(plannerResolver(task('x', { skills: ['reviewer'] }), resolution)).toEqual([]);
  });

  it('answers an empty description for a winner with no summary', () => {
    const resolution = resolveTiers(
      [{ kind: 'skill', name: 'bare', source: 'project', path: '/p/bare/SKILL.md' }],
      SETTINGS,
      () => null,
    );

    expect(plannerResolver(task('x', { skills: ['bare'] }), resolution)).toEqual([
      { name: 'bare', source: 'project', path: '/p/bare/SKILL.md', description: '' },
    ]);
  });
});

describe('tagResolver', () => {
  it('ignores skills= and ranks on the task text instead', () => {
    const resolution = resolve([row('docs', { tags: ['documentation'] }), row('git-workflow', { tags: ['git'] })]);
    const declared = task('update the documentation', { skills: ['git-workflow'] });

    expect(names(plannerResolver(declared, resolution))).toEqual(['git-workflow']);
    expect(names(tagResolverWith(NO_FILES)(declared, resolution))).toEqual(['docs']);
  });

  it('ranks against the stage context as well as the task text', () => {
    const resolution = resolve([row('docs', { tags: ['documentation'] })]);
    const tag = tagResolverWith(NO_FILES);

    expect(tag(task('write the module'), resolution)).toEqual([]);
    expect(names(tag(task('write the module', { stageContext: 'Each module carries documentation.' }), resolution)))
      .toEqual(['docs']);
  });

  it('keeps nothing scoring at or below the floor', () => {
    const resolution = resolve([row('docs', { tags: ['documentation'] })]);
    const tag = tagResolverWith(NO_FILES);

    expect(tag(task('refactor the parser'), resolution)).toEqual([]);
    expect(names(tag(task('refactor the documentation'), resolution))).toEqual(['docs']);
  });

  it('keeps the top three by score, highest first', () => {
    const resolution = resolve([
      row('a', { tags: ['release'] }),
      row('b', { tags: ['release', 'changelog'] }),
      row('c', { tags: ['release', 'changelog', 'version'] }),
      row('d', { tags: ['release', 'changelog', 'version', 'notes'] }),
    ]);

    const offered = tagResolverWith(NO_FILES)(task('write release changelog version notes'), resolution);

    expect(names(offered)).toEqual(['d', 'c', 'b']);
  });

  it('breaks a tie by the index order: tier, then name', () => {
    const resolution = resolve([
      row('zeta', { tags: ['release'] }),
      row('alpha', { source: 'rafa', tags: ['release'] }),
      row('beta', { tags: ['release'] }),
    ]);

    expect(names(tagResolverWith(NO_FILES)(task('cut a release'), resolution))).toEqual(['beta', 'zeta', 'alpha']);
  });

  it('scores the whole description and body read from the winner\'s file', () => {
    const resolution = resolve([row('docs', { summary: 'Writes pages' })]);
    const files = {
      '/project/skill/docs/SKILL.md': '---\nname: docs\ndescription: Writes pages\n---\nCovers every changelog entry.\n',
    };

    expect(tagResolverWith(NO_FILES)(task('add a changelog entry'), resolution)).toEqual([]);
    expect(tagResolverWith(reader(files))(task('add a changelog entry'), resolution)).toEqual([
      { name: 'docs', source: 'project', path: '/project/skill/docs/SKILL.md', description: 'Writes pages' },
    ]);
  });

  it('never offers a skill that is switched off, colliding, disabled or an agent', () => {
    const rows = [
      row('switched', { tags: ['release'] }),
      row('split', { tags: ['release'] }),
      row('split', { source: 'rafa', tags: ['release'] }),
      row('muted', { tags: ['release'], state: 'disabled:skillOverrides' }),
      row('router', { kind: 'agent', tags: ['release'] }),
      row('kept', { tags: ['release'] }),
    ];
    const resolution = resolve(rows, new Map<string, TierPin>([['switched', false]]));

    expect(names(tagResolverWith(NO_FILES)(task('cut a release'), resolution))).toEqual(['kept']);
  });

  it('answers the same offer for the same input on every call', () => {
    const resolution = resolve([row('a', { tags: ['release'] }), row('b', { tags: ['release'] })]);
    const tag = tagResolverWith(NO_FILES);

    expect(tag(task('cut a release'), resolution)).toEqual(tag(task('cut a release'), resolution));
  });
});

describe('noneResolver', () => {
  it('offers nothing, even where planner and tag would offer a skill', () => {
    const resolution = resolve([row('docs', { tags: ['documentation'] })]);
    const declared = task('update the documentation', { skills: ['docs'] });

    expect(names(plannerResolver(declared, resolution))).toEqual(['docs']);
    expect(names(tagResolverWith(NO_FILES)(declared, resolution))).toEqual(['docs']);
    expect(noneResolver(declared, resolution)).toEqual([]);
  });
});
