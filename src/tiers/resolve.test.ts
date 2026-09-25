/**
 * Tests for the tier resolver.
 *
 * Every case runs over rows and a fake disk, a map from path to text,
 * so no directory is read apart from the one case holding the real
 * reader. The reader counts its calls, so a case can hold that a name
 * with one loaded holder costs no read.
 *
 * Each "does not collide" reading has a control: the same rows under
 * settings that DO load both holders, which collide. That shows the
 * quiet answer came from the setting and not from a check that never
 * fires. The byte-identical case builds its copy with
 * `withSourceHeader`, the writer `rafa agent vendor` uses, so the
 * header pattern here is tied to what that writer actually writes.
 */
import type { TierPin } from '../config-sections.js';
import type { ReadItemBytes, TierItem, TierRow, TierSettings } from './resolve.js';
import type { InventoryKind, InventorySource } from '../inventory/record.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { withSourceHeader } from '../commands/agent/vendor.js';
import { CONFIG_DEFAULTS } from '../config.js';

import {
  collisionMessage,
  comparableText,
  findTierItem,
  loadedTiers,
  pinLine,
  readItemBytes,
  resolveTiers,
} from './resolve.js';

/** Where each tier's definitions sit on the fake disk. */
const DIRS: Record<string, string> = {
  project: '/repo/.claude',
  rafa: '/rafa/bundled',
  user: '/home/.claude',
  'plugin:alpha': '/home/.claude/plugins/alpha',
  'addon:beta': '/modules/beta',
};

/** A skill or agent row of `name` in `source`. */
function row(source: InventorySource, name: string, kind: InventoryKind = 'skill'): TierRow {
  const path = kind === 'skill'
    ? `${DIRS[source]}/skills/${name}/SKILL.md`
    : `${DIRS[source]}/agents/${name}.md`;
  return { kind, name, source, path };
}

/** Settings as a project that has written nothing gets them, with `changes` over them. */
function settings(changes: Partial<TierSettings> = {}): TierSettings {
  return {
    settingSources: ['project', 'local'],
    tiersRafa: 'on',
    tiersSkills: new Map<string, TierPin>(),
    tiersAgents: new Map<string, TierPin>(),
    ...changes,
  };
}

/** Settings that load all three tiers. */
const ALL_LOADED = settings({ settingSources: ['user', 'project', 'local'] });

/** A fake disk over `files`, counting reads by path. */
function disk(files: ReadonlyMap<string, string>): { read: ReadItemBytes; reads: string[] } {
  const reads: string[] = [];
  const read: ReadItemBytes = (path) => {
    reads.push(path);
    const text = files.get(path);
    return text === undefined
      ? null
      : new TextEncoder().encode(text);
  };
  return { read, reads };
}

/** A disk holding `text` at each row's path. */
function same(rows: readonly TierRow[], text = '---\nname: x\n---\nbody\n'): ReturnType<typeof disk> {
  return disk(new Map(rows.map((each) => [each.path, text])));
}

/** A disk holding different text at each row's path. */
function distinct(rows: readonly TierRow[]): ReturnType<typeof disk> {
  return disk(new Map(rows.map((each) => [each.path, `body of ${each.source}\n`])));
}

/** The only item of `rows` resolved, failing when there is not exactly one. */
function only(rows: readonly TierRow[], use: TierSettings, read: ReadItemBytes): TierItem {
  const { items } = resolveTiers(rows, use, read);
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item === undefined) throw new Error('no item');
  return item;
}

/** `item` as a served one, throwing on any other state. */
function servedItem(item: TierItem) {
  if (item.state !== 'served') throw new Error(`expected served, got ${item.state}`);
  return item;
}

/** `item` as a collision, throwing on any other state. */
function collisionOf(item: TierItem) {
  if (item.state !== 'collision') throw new Error(`expected collision, got ${item.state}`);
  return item.collision;
}

describe('loadedTiers', () => {
  it('loads project and rafa under the default sources', () => {
    expect(loadedTiers(settings())).toEqual(['project', 'rafa']);
  });

  it('loads the user tier only when the sources include user', () => {
    expect(loadedTiers(ALL_LOADED)).toEqual(['project', 'rafa', 'user']);
  });

  it('drops the rafa tier when tiers.rafa is off', () => {
    expect(loadedTiers(settings({ tiersRafa: 'off' }))).toEqual(['project']);
    expect(loadedTiers(settings({ tiersRafa: 'off', settingSources: ['user'] })))
      .toEqual(['project', 'user']);
  });

  it('reads a RafaConfig as its settings, answering the defaults', () => {
    expect(loadedTiers(CONFIG_DEFAULTS)).toEqual(['project', 'rafa']);
  });
});

describe('resolveTiers: the order', () => {
  it('serves the project holder over rafa and user, whatever order the rows came in', () => {
    const rows = [row('user', 'doc'), row('rafa', 'doc'), row('project', 'doc')];
    const item = servedItem(only(rows, ALL_LOADED, same(rows).read));

    expect(item.winner.source).toBe('project');
    expect(item.decidedBy).toBe('order');
    expect(item.holders.map((each) => each.source)).toEqual(['project', 'rafa', 'user']);
    expect(item.copies.map((each) => each.source)).toEqual(['rafa', 'user']);
  });

  it('serves the rafa holder over the user one when the project holds none', () => {
    const rows = [row('user', 'doc'), row('rafa', 'doc')];
    const item = servedItem(only(rows, ALL_LOADED, same(rows).read));

    expect(item.winner.source).toBe('rafa');
    expect(item.copies.map((each) => each.source)).toEqual(['user']);
  });

  it('lets the first row a tier was handed hold its name, and never collides inside one tier', () => {
    const first = row('project', 'doc');
    const second = { ...first, path: '/repo/.claude/skills/doc.md' };
    const { read, reads } = distinct([first, second]);
    const item = servedItem(only([first, second], ALL_LOADED, read));

    expect(item.winner).toBe(first);
    expect(item.loaded).toEqual([first]);
    expect(item.holders).toEqual([first, second]);
    expect(reads).toEqual([]);
  });

  it('keeps a skill and an agent of one name apart', () => {
    const rows = [row('project', 'doc', 'agent'), row('rafa', 'doc', 'skill')];
    const { items, collisions } = resolveTiers(rows, settings(), distinct(rows).read);

    expect(items.map((item) => [item.kind, item.state])).toEqual([['skill', 'served'], ['agent', 'served']]);
    expect(collisions).toEqual([]);
  });

  it('lists skills before agents, each by name', () => {
    const rows = [row('rafa', 'zeta', 'agent'), row('rafa', 'beta'), row('rafa', 'alpha', 'agent'), row('rafa', 'alpha')];
    const { items } = resolveTiers(rows, settings(), same(rows).read);

    expect(items.map((item) => `${item.kind}:${item.name}`))
      .toEqual(['skill:alpha', 'skill:beta', 'agent:alpha', 'agent:zeta']);
  });

  it('leaves plugin and add-on rows outside the three tiers', () => {
    const rows = [row('plugin:alpha', 'doc'), row('addon:beta', 'doc'), row('rafa', 'doc')];
    const item = servedItem(only(rows, ALL_LOADED, distinct(rows).read));

    expect(item.holders.map((each) => each.source)).toEqual(['rafa']);
    expect(resolveTiers(rows.slice(0, 2), ALL_LOADED, distinct(rows).read).items).toEqual([]);
  });
});

describe('resolveTiers: loaded tiers only', () => {
  const rows = [row('project', 'doc'), row('user', 'doc')];

  it('does not let a user holder collide under project,local, and reads nothing', () => {
    const { read, reads } = distinct(rows);
    const resolution = resolveTiers(rows, settings(), read);
    const item = servedItem(only(rows, settings(), read));

    expect(resolution.collisions).toEqual([]);
    expect(item.winner.source).toBe('project');
    expect(item.loaded.map((each) => each.source)).toEqual(['project']);
    expect(item.holders.map((each) => each.source)).toEqual(['project', 'user']);
    expect(reads).toEqual([]);
  });

  it('control: the same two holders collide once the user tier loads', () => {
    expect(resolveTiers(rows, ALL_LOADED, distinct(rows).read).collisions).toHaveLength(1);
  });

  it('reads a name held only by the user tier as unloaded under project,local', () => {
    const user = [row('user', 'solo')];
    expect(only(user, settings(), same(user).read).state).toBe('unloaded');
    expect(servedItem(only(user, ALL_LOADED, same(user).read)).winner.source).toBe('user');
  });
});

describe('resolveTiers: a collision is refused', () => {
  const rows = [row('rafa', 'doc'), row('project', 'doc')];

  it('serves nothing and names both paths and the pin line', () => {
    const resolution = resolveTiers(rows, settings(), distinct(rows).read);
    const [item] = resolution.items;
    if (item === undefined) throw new Error('no item');
    const collision = collisionOf(item);

    expect(resolution.collisions).toEqual([collision]);
    expect(collision.holders.map((each) => each.path)).toEqual([
      '/repo/.claude/skills/doc/SKILL.md',
      '/rafa/bundled/skills/doc/SKILL.md',
    ]);
    expect(collision.pinLine).toBe('tiers.skills: { doc: project }');
  });

  it('prints a message holding both paths and the pin line', () => {
    const collision = collisionOf(only(rows, settings(), distinct(rows).read));

    expect(collisionMessage(collision)).toBe('skill doc is held by 2 loaded tiers with different contents: '
      + 'project /repo/.claude/skills/doc/SKILL.md and rafa /rafa/bundled/skills/doc/SKILL.md; '
      + 'pin the tier that serves it: tiers.skills: { doc: project }');
  });

  it('pins an agent under tiers.agents, naming the nearest loaded tier', () => {
    const agents = [row('user', 'tdd-guide', 'agent'), row('rafa', 'tdd-guide', 'agent')];
    const collision = collisionOf(only(agents, ALL_LOADED, distinct(agents).read));

    expect(collision.pinLine).toBe('tiers.agents: { tdd-guide: rafa }');
  });

  it('names every distinct holder when all three tiers differ', () => {
    const three = [...rows, row('user', 'doc')];
    const collision = collisionOf(only(three, ALL_LOADED, distinct(three).read));

    expect(collision.holders.map((each) => each.source)).toEqual(['project', 'rafa', 'user']);
    expect(collisionMessage(collision)).toContain('held by 3 loaded tiers');
  });

  it('counts an unreadable holder as different from every other', () => {
    const { read } = disk(new Map([[rows[0]?.path ?? '', 'body\n']]));
    expect(only(rows, settings(), read).state).toBe('collision');
  });
});

describe('resolveTiers: a pin', () => {
  const rows = [row('project', 'doc'), row('rafa', 'doc')];

  it('settles a collision by serving the pinned tier', () => {
    const agents = [row('project', 'doc', 'agent'), row('rafa', 'doc', 'agent')];
    const pinned = settings({ tiersAgents: new Map<string, TierPin>([['doc', 'rafa']]) });
    const resolution = resolveTiers(agents, pinned, distinct(agents).read);
    const item = servedItem(only(agents, pinned, distinct(agents).read));

    expect(resolution.collisions).toEqual([]);
    expect(item.winner.source).toBe('rafa');
    expect(item.decidedBy).toBe('pin');
    expect(item.pin).toBe('rafa');
    expect(item.overridden.map((each) => each.source)).toEqual(['project']);
    expect(item.copies).toEqual([]);
  });

  it('reads a pin under tiers.skills only for a skill', () => {
    const agents = [row('project', 'doc', 'agent'), row('rafa', 'doc', 'agent')];
    const pinned = settings({ tiersSkills: new Map<string, TierPin>([['doc', 'rafa']]) });
    expect(only(agents, pinned, distinct(agents).read).state).toBe('collision');
  });

  it('has no effect when it names a tier holding nothing under the name', () => {
    const pinned = settings({
      settingSources: ['user'],
      tiersSkills: new Map<string, TierPin>([['doc', 'user']]),
    });
    expect(only(rows, pinned, distinct(rows).read).state).toBe('collision');
  });

  it('has no effect when it names a tier that is not loaded', () => {
    const withUser = [...rows, row('user', 'doc')];
    const pinned = settings({ tiersSkills: new Map<string, TierPin>([['doc', 'user']]) });
    const item = only(withUser, pinned, distinct(withUser).read);

    expect(item.state).toBe('collision');
    expect(item.pin).toBe('user');
  });
});

describe('resolveTiers: a skill pin Claude Code would not load', () => {
  const rows = [row('project', 'doc'), row('rafa', 'doc')];
  const pins = (tier: TierPin) => new Map<string, TierPin>([['doc', tier]]);
  const toRafa = settings({ tiersSkills: pins('rafa') });

  it('sets a rafa pin aside while a loaded project skill differs, so the name stays a collision', () => {
    const resolution = resolveTiers(rows, toRafa, distinct(rows).read);
    const [item] = resolution.items;
    if (item === undefined) throw new Error('no item');
    const collision = collisionOf(item);

    expect(item.pin).toBe('rafa');
    expect(resolution.collisions).toEqual([collision]);
    expect(collision.setAsidePin).toBe('rafa');
    expect(collision.outrankedBy.map((each) => each.source)).toEqual(['project']);
    expect(collision.pinLine).toBe('tiers.skills: { doc: project }');
  });

  it('names the copy to delete or rename and the pin that works', () => {
    const collision = collisionOf(only(rows, toRafa, distinct(rows).read));

    expect(collisionMessage(collision)).toBe('skill doc is held by 2 loaded tiers with different contents: '
      + 'project /repo/.claude/skills/doc/SKILL.md and rafa /rafa/bundled/skills/doc/SKILL.md; '
      + 'tiers.skills: { doc: rafa } has no effect, because Claude Code loads the project copy over the rafa copy: '
      + 'pin the copy it loads (tiers.skills: { doc: project }), '
      + 'or delete or rename /repo/.claude/skills/doc/SKILL.md to let the rafa copy serve');
  });

  it('sets a rafa pin aside while only a loaded user skill differs, and names the user pin', () => {
    const rafaAndUser = [row('rafa', 'doc'), row('user', 'doc')];
    const collision = collisionOf(only(rafaAndUser, settings({ settingSources: ['user'], tiersSkills: pins('rafa') }), distinct(rafaAndUser).read));

    expect(collision.setAsidePin).toBe('rafa');
    expect(collision.outrankedBy.map((each) => each.source)).toEqual(['user']);
    expect(collision.pinLine).toBe('tiers.skills: { doc: user }');
  });

  it('names both the user and the project copy when both outrank a rafa pin', () => {
    const three = [...rows, row('user', 'doc')];
    const collision = collisionOf(only(three, settings({ settingSources: ['user'], tiersSkills: pins('rafa') }), distinct(three).read));

    expect(collision.outrankedBy.map((each) => each.source)).toEqual(['user', 'project']);
    expect(collisionMessage(collision)).toContain('tiers.skills: { doc: rafa } has no effect, because Claude Code loads '
      + 'the user and project copies over the rafa copy: pin the copy it loads (tiers.skills: { doc: user }), '
      + 'or delete or rename /home/.claude/skills/doc/SKILL.md and /repo/.claude/skills/doc/SKILL.md '
      + 'to let the rafa copy serve');
  });

  it('sets a project pin aside while a loaded user skill differs, and names the user pin', () => {
    const projectAndUser = [row('project', 'doc'), row('user', 'doc')];
    const collision = collisionOf(only(projectAndUser, settings({ settingSources: ['user'], tiersSkills: pins('project') }), distinct(projectAndUser).read));

    expect(collision.setAsidePin).toBe('project');
    expect(collision.outrankedBy.map((each) => each.source)).toEqual(['user']);
    expect(collisionMessage(collision)).toContain('tiers.skills: { doc: project } has no effect, because Claude Code '
      + 'loads the user copy over the project copy: pin the copy it loads (tiers.skills: { doc: user }), '
      + 'or delete or rename /home/.claude/skills/doc/SKILL.md to let the project copy serve');
  });

  it('keeps a user pin, since nothing outranks a loaded user skill', () => {
    const three = [...rows, row('user', 'doc')];
    const item = servedItem(only(three, settings({ settingSources: ['user'], tiersSkills: pins('user') }), distinct(three).read));

    expect(item.winner.source).toBe('user');
    expect(item.decidedBy).toBe('pin');
    expect(item.overridden.map((each) => each.source)).toEqual(['project', 'rafa']);
  });

  it('suggests the user pin for an unpinned skill collision a loaded user tier is in', () => {
    const projectAndUser = [row('project', 'doc'), row('user', 'doc')];
    const collision = collisionOf(only(projectAndUser, ALL_LOADED, distinct(projectAndUser).read));

    expect(collision.pinLine).toBe('tiers.skills: { doc: user }');
    expect(collision.setAsidePin).toBeNull();
    expect(collision.outrankedBy).toEqual([]);
  });

  it('control: the same two agents suggest the nearest tier, since agent pins are kept', () => {
    const agents = [row('project', 'doc', 'agent'), row('user', 'doc', 'agent')];
    expect(collisionOf(only(agents, ALL_LOADED, distinct(agents).read)).pinLine).toBe('tiers.agents: { doc: project }');
  });

  it('control: an unpinned collision sets no pin aside', () => {
    const collision = collisionOf(only(rows, settings(), distinct(rows).read));

    expect(collision.setAsidePin).toBeNull();
    expect(collision.outrankedBy).toEqual([]);
  });

  it('control: a rafa pin serves once the project holds nothing and the user tier is not loaded', () => {
    const rafaAndUser = [row('rafa', 'doc'), row('user', 'doc')];
    const item = servedItem(only(rafaAndUser, toRafa, distinct(rafaAndUser).read));

    expect(item.winner.source).toBe('rafa');
    expect(item.decidedBy).toBe('pin');
    expect(item.holders.map((each) => each.source)).toEqual(['rafa', 'user']);
  });

  it('control: a project pin serves while the differing user skill is not loaded', () => {
    const projectAndUser = [row('project', 'doc'), row('user', 'doc')];
    const item = servedItem(only(projectAndUser, settings({ tiersSkills: pins('project') }), distinct(projectAndUser).read));

    expect(item.winner.source).toBe('project');
  });

  it('control: a rafa pin serves while the project copy is byte-identical', () => {
    const item = servedItem(only(rows, toRafa, same(rows).read));

    expect(item.winner.source).toBe('rafa');
    expect(item.decidedBy).toBe('pin');
    expect(item.copies.map((each) => each.source)).toEqual(['project']);
  });

  it('control: a project pin serves while the loaded user copy is byte-identical, over a differing rafa copy', () => {
    const three = [...rows, row('user', 'doc')];
    const { read } = disk(new Map([
      [three[0]?.path ?? '', 'shared\n'],
      [three[1]?.path ?? '', 'rafa\n'],
      [three[2]?.path ?? '', 'shared\n'],
    ]));
    const item = servedItem(only(three, settings({ settingSources: ['user'], tiersSkills: pins('project') }), read));

    expect(item.winner.source).toBe('project');
    expect(item.copies.map((each) => each.source)).toEqual(['user']);
    expect(item.overridden.map((each) => each.source)).toEqual(['rafa']);
  });

  it('control: an agent pin to rafa serves over differing project and user agents, since --agents outranks both', () => {
    const agents = [row('project', 'doc', 'agent'), row('rafa', 'doc', 'agent'), row('user', 'doc', 'agent')];
    const pinned = settings({ settingSources: ['user'], tiersAgents: pins('rafa') });
    const item = servedItem(only(agents, pinned, distinct(agents).read));

    expect(item.winner.source).toBe('rafa');
    expect(item.overridden.map((each) => each.source)).toEqual(['project', 'user']);
  });
});

describe('the skill pin rule on the pages that document it', () => {
  const repo = join(import.meta.dir, '..', '..');
  /** The page at `path` under the repo, with every run of whitespace one space. */
  const flat = (...path: string[]) => readFileSync(join(repo, ...path), 'utf8').replace(/\s+/g, ' ');
  const pages = { inventory: flat('context', 'inventory.md'), readme: flat('README.md') };

  it('says on both pages that a skill pin must name the copy Claude Code loads, and how to get out', () => {
    for (const page of Object.values(pages)) {
      expect(page).toContain('A skill pin must name the copy Claude Code loads');
      expect(page).toContain('a user skill over a project skill, and both over the rafa copy');
      expect(page).toMatch(/delet(?:e|ing) or renam(?:e|ing)/);
    }
  });

  it('control: neither page still says a skill pin can only name project', () => {
    for (const page of Object.values(pages)) expect(page).not.toContain('can only name `project`');
  });
});

describe('resolveTiers: false', () => {
  it('turns a name off in every tier, so distinct holders never collide', () => {
    const rows = [row('project', 'doc', 'agent'), row('rafa', 'doc', 'agent'), row('user', 'doc', 'agent')];
    const off = settings({
      settingSources: ['user'],
      tiersAgents: new Map<string, TierPin>([['doc', false]]),
    });
    const { read, reads } = distinct(rows);
    const resolution = resolveTiers(rows, off, read);

    expect(resolution.items.map((item) => item.state)).toEqual(['off']);
    expect(resolution.collisions).toEqual([]);
    expect(reads).toEqual([]);
  });

  it('turns off a name only one tier holds', () => {
    const rows = [row('rafa', 'doc')];
    const off = settings({ tiersSkills: new Map<string, TierPin>([['doc', false]]) });
    expect(only(rows, off, same(rows).read).state).toBe('off');
  });
});

describe('resolveTiers: byte-identical copies', () => {
  const original = '---\nname: tdd-guide\ndescription: Tests first.\n---\n\nWrite the test first.\n';
  const rows = [row('project', 'tdd-guide', 'agent'), row('rafa', 'tdd-guide', 'agent')];
  const vendored = withSourceHeader(original, '/home/x/.claude/agents/tdd-guide.md', new Date('2026-09-18T00:00:00Z'));

  it('reads a vendored copy as one item with its source, served by the nearer', () => {
    const { read } = disk(new Map([[rows[0]?.path ?? '', vendored], [rows[1]?.path ?? '', original]]));
    const item = servedItem(only(rows, settings(), read));

    expect(vendored).not.toBe(original);
    expect(item.winner.source).toBe('project');
    expect(item.decidedBy).toBe('order');
    expect(item.copies.map((each) => each.source)).toEqual(['rafa']);
    expect(item.overridden).toEqual([]);
  });

  it('control: a copy differing by one byte collides', () => {
    const edited = vendored.replace('first.', 'first!');
    const { read } = disk(new Map([[rows[0]?.path ?? '', edited], [rows[1]?.path ?? '', original]]));
    expect(only(rows, settings(), read).state).toBe('collision');
  });

  it('strips the header from a file with no frontmatter too', () => {
    const plain = 'no frontmatter here\n';
    const copy = withSourceHeader(plain, '/somewhere/a.md', new Date('2026-09-18T00:00:00Z'));
    expect(comparableText(new TextEncoder().encode(copy))).toBe(plain);
  });

  it('compares bytes exactly, where a UTF-8 decode would fold two invalid sequences together', () => {
    const a = comparableText(new Uint8Array([0x61, 0xff]));
    const b = comparableText(new Uint8Array([0x61, 0xfe]));
    expect(new TextDecoder().decode(new Uint8Array([0xff]))).toBe(new TextDecoder().decode(new Uint8Array([0xfe])));
    expect(a).not.toBe(b);
  });

  it('serves a pinned holder, listing only its identical copies as copies', () => {
    const three = [...rows, row('user', 'tdd-guide', 'agent')];
    const { read } = disk(new Map([
      [three[0]?.path ?? '', 'project text\n'],
      [three[1]?.path ?? '', original],
      [three[2]?.path ?? '', vendored],
    ]));
    const pinned = settings({
      settingSources: ['user'],
      tiersAgents: new Map<string, TierPin>([['tdd-guide', 'rafa']]),
    });
    const item = servedItem(only(three, pinned, read));

    expect(item.winner.source).toBe('rafa');
    expect(item.copies.map((each) => each.source)).toEqual(['user']);
    expect(item.overridden.map((each) => each.source)).toEqual(['project']);
  });
});

describe('resolveTiers: tiers.rafa off', () => {
  const rows = [row('project', 'doc'), row('rafa', 'doc')];
  const off = settings({ tiersRafa: 'off' });

  it('keeps a rafa holder from colliding with the project', () => {
    const resolution = resolveTiers(rows, off, distinct(rows).read);
    const item = servedItem(only(rows, off, distinct(rows).read));

    expect(resolution.loadedTiers).toEqual(['project']);
    expect(resolution.collisions).toEqual([]);
    expect(item.winner.source).toBe('project');
  });

  it('control: the same holders collide with the tier on', () => {
    expect(only(rows, settings(), distinct(rows).read).state).toBe('collision');
  });

  it('reads a name only rafa holds as unloaded', () => {
    const rafa = [row('rafa', 'loop-implementer', 'agent')];
    expect(only(rafa, off, same(rafa).read).state).toBe('unloaded');
  });

  it('gives a pin to the rafa tier no effect', () => {
    const pinned = settings({ tiersRafa: 'off', tiersSkills: new Map<string, TierPin>([['doc', 'rafa']]) });
    const item = servedItem(only(rows, pinned, distinct(rows).read));

    expect(item.winner.source).toBe('project');
    expect(item.decidedBy).toBe('order');
  });
});

describe('pinLine', () => {
  it('quotes a name a flow mapping cannot carry bare', () => {
    expect(pinLine('skill', 'react-query', 'project')).toBe('tiers.skills: { react-query: project }');
    expect(pinLine('skill', 'a: b', 'user')).toBe('tiers.skills: { "a: b": user }');
  });
});

describe('findTierItem', () => {
  it('finds a name by kind, and answers undefined for one no tier holds', () => {
    const rows = [row('rafa', 'doc'), row('rafa', 'doc', 'agent')];
    const resolution = resolveTiers(rows, settings(), same(rows).read);

    expect(findTierItem(resolution, 'agent', 'doc')?.kind).toBe('agent');
    expect(findTierItem(resolution, 'skill', 'missing')).toBeUndefined();
  });
});

describe('readItemBytes', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rafa-resolve-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a file\'s bytes, and answers null for one that is not there', () => {
    const path = join(dir, 'SKILL.md');
    writeFileSync(path, 'body\n');

    expect(new TextDecoder().decode(readItemBytes(path) ?? new Uint8Array())).toBe('body\n');
    expect(readItemBytes(join(dir, 'absent.md'))).toBeNull();
  });
});
