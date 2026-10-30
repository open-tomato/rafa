/**
 * Tests for the show view.
 *
 * The records are built by hand rather than through `buildInventory`:
 * precedence and state are that module's to decide and its tests' to
 * measure, and the view only has to carry what it is handed. One real
 * file is planted for {@link readShowView}'s default reader, so the
 * default read path is measured once against the disk; every other case
 * hands the text in.
 */
import type { InventoryRecord } from './record.js';
import type { ShowView } from './show.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'bun:test';

import {
  bodyHeadings,
  buildShowView,
  findShown,
  holdersOf,
  otherHolders,
  readShowView,
  renderShowView,
} from './show.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-show-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A record with filler fields, `overrides` applied. */
function record(overrides: Partial<InventoryRecord>): InventoryRecord {
  return {
    kind: 'skill',
    name: 'gate-order',
    source: 'project',
    path: '/project/.claude/skills/gate-order/SKILL.md',
    summary: 'Runs the gates in order',
    whenToUse: null,
    prevents: null,
    stack: [],
    tags: [],
    check: 'pass',
    state: 'enabled',
    visibleToLoop: true,
    ...overrides,
  };
}

const projectSkill = record({ stack: ['typescript'], tags: ['gates', 'ci'] });
const userSkill = record({
  source: 'user',
  path: '/home/.claude/skills/gate-order/SKILL.md',
  state: 'shadowed-by:project',
  visibleToLoop: false,
});
const pluginSkill = record({
  source: 'plugin:alpha',
  path: '/plugins/alpha/skills/gate-order/SKILL.md',
  state: 'shadowed-by:project',
  visibleToLoop: false,
});
const sameNameAgent = record({ kind: 'agent', path: '/project/.claude/agents/gate-order.md', check: null });
const otherSkill = record({ name: 'unrelated', path: '/project/.claude/skills/unrelated/SKILL.md' });

/** The inventory's rows in its own order: kind, then name, then precedence. */
const RECORDS: readonly InventoryRecord[] = [projectSkill, userSkill, pluginSkill, otherSkill, sameNameAgent];

const SKILL_TEXT = [
  '---',
  'name: gate-order',
  'description: Runs the gates in order',
  'model: sonnet',
  '---',
  '# Gate order',
  '',
  'Intro.',
  '',
  '## When',
  '',
  '```bash',
  '# not a heading, a shell comment',
  '```',
  '',
  '### Steps ###',
  '',
].join('\n');

describe('holdersOf and findShown', () => {
  test('every holder of the kind and name, in the order given', () => {
    expect(holdersOf(RECORDS, 'skill', 'gate-order')).toEqual([projectSkill, userSkill, pluginSkill]);
  });

  test('a skill and an agent of one name never meet', () => {
    expect(holdersOf(RECORDS, 'agent', 'gate-order')).toEqual([sameNameAgent]);
  });

  test('a name shows its first holder', () => {
    expect(findShown(RECORDS, 'skill', 'gate-order')).toBe(projectSkill);
  });

  test('a name nothing holds shows nothing', () => {
    expect(findShown(RECORDS, 'skill', 'no-such-skill')).toBeNull();
    expect(findShown(RECORDS, 'agent', 'unrelated')).toBeNull();
  });
});

describe('otherHolders', () => {
  test('from the answering holder, every holder it shadows, with its source', () => {
    expect(otherHolders(projectSkill, RECORDS)).toEqual([
      { source: 'user', state: 'shadowed-by:project', path: userSkill.path, visibleToLoop: false },
      { source: 'plugin:alpha', state: 'shadowed-by:project', path: pluginSkill.path, visibleToLoop: false },
    ]);
  });

  test('from a shadowed holder, the holder shadowing it comes first', () => {
    expect(otherHolders(userSkill, RECORDS).map((holder) => holder.source)).toEqual(['project', 'plugin:alpha']);
  });

  test('an item alone under its name has no other holder', () => {
    expect(otherHolders(otherSkill, RECORDS)).toEqual([]);
    expect(otherHolders(sameNameAgent, RECORDS)).toEqual([]);
  });

  test('two holders in one source are told apart by path', () => {
    const loose = record({ path: '/project/.claude/skills/gate-order.md', state: 'shadowed-by:project' });
    expect(otherHolders(projectSkill, [projectSkill, loose]).map((holder) => holder.path)).toEqual([loose.path]);
  });
});

describe('bodyHeadings', () => {
  test('ATX headings with their level and line', () => {
    expect(bodyHeadings('# One\ntext\n## Two\n###### Six\n')).toEqual([
      { level: 1, text: 'One', line: 1 },
      { level: 2, text: 'Two', line: 3 },
      { level: 6, text: 'Six', line: 4 },
    ]);
  });

  test('a # line inside a fence is code, and the heading after the fence is read', () => {
    const body = ['```sh', '# comment', '```', '~~~~', '# also code', '~~~', '# still code', '~~~~', '# Real'].join('\n');
    expect(bodyHeadings(body)).toEqual([{ level: 1, text: 'Real', line: 9 }]);
  });

  test('a backtick line does not close a tilde fence', () => {
    expect(bodyHeadings(['~~~', '```', '# code', '~~~', '# After'].join('\n'))).toEqual([
      { level: 1, text: 'After', line: 5 },
    ]);
  });

  test('seven #, a # with no space, and four spaces of indent are not headings', () => {
    expect(bodyHeadings(['####### seven', '#tag', '    # indented code'].join('\n'))).toEqual([]);
  });

  test('a closing # run is dropped, and a # alone is an empty heading', () => {
    expect(bodyHeadings('## Steps ##\n#\n# C# notes\n')).toEqual([
      { level: 2, text: 'Steps', line: 1 },
      { level: 1, text: '', line: 2 },
      { level: 1, text: 'C# notes', line: 3 },
    ]);
  });

  test('CRLF lines read as lines', () => {
    expect(bodyHeadings('# A\r\ntext\r\n## B\r\n')).toEqual([
      { level: 1, text: 'A', line: 1 },
      { level: 2, text: 'B', line: 3 },
    ]);
  });

  test('the first line offsets every heading line', () => {
    expect(bodyHeadings('# A', 6)).toEqual([{ level: 1, text: 'A', line: 6 }]);
  });
});

describe('buildShowView', () => {
  const view = buildShowView(projectSkill, RECORDS, SKILL_TEXT, false);

  test('carries the record unchanged', () => {
    expect(view.record).toBe(projectSkill);
  });

  test('carries the frontmatter parsed and as written, unread keys included', () => {
    expect(view.frontmatter).toEqual({ name: 'gate-order', description: 'Runs the gates in order', model: 'sonnet' });
    expect(view.frontmatterText).toBe('name: gate-order\ndescription: Runs the gates in order\nmodel: sonnet\n');
  });

  test('heading lines are the file\'s, frontmatter lines counted', () => {
    expect(view.headings).toEqual([
      { level: 1, text: 'Gate order', line: 6 },
      { level: 2, text: 'When', line: 10 },
      { level: 3, text: 'Steps', line: 16 },
    ]);
    const lines = SKILL_TEXT.split('\n');
    for (const heading of view.headings) expect(lines[heading.line - 1]).toStartWith('#');
  });

  test('without full the text is not carried, and with it the whole file is', () => {
    expect(view.text).toBeNull();
    expect(buildShowView(projectSkill, RECORDS, SKILL_TEXT, true).text).toBe(SKILL_TEXT);
  });

  test('a file with no frontmatter reads as none, and its whole text as the body', () => {
    const bare = buildShowView(projectSkill, RECORDS, '# Title\n\n## Part\n', false);
    expect(bare.frontmatter).toBeNull();
    expect(bare.frontmatterText).toBeNull();
    expect(bare.headings.map((heading) => heading.line)).toEqual([1, 3]);
  });

  test('a frontmatter block that does not parse reads as none, and the whole text as the body', () => {
    const broken = buildShowView(projectSkill, RECORDS, '---\ndescription: Probe: one\n---\n# T\n', false);
    expect(broken.frontmatter).toBeNull();
    expect(broken.headings).toEqual([{ level: 1, text: 'T', line: 4 }]);
  });

  test('the view is plain data json mode can carry whole', () => {
    const full = buildShowView(projectSkill, RECORDS, SKILL_TEXT, true);
    expect(JSON.parse(JSON.stringify(full)) as unknown).toEqual(full);
  });
});

describe('readShowView', () => {
  test('reads the record\'s own file from the disk by default', () => {
    const path = join(base, 'SKILL.md');
    writeFileSync(path, SKILL_TEXT);
    const onDisk = record({ path });
    const view = readShowView(onDisk, [onDisk], { full: true });
    expect(view.readError).toBeNull();
    expect(view.text).toBe(SKILL_TEXT);
    expect(view.headings).toHaveLength(3);
  });

  test('reads through the reader it is handed, at the record\'s path', () => {
    const asked: string[] = [];
    readShowView(projectSkill, RECORDS, {
      full: false,
      read: (path) => {
        asked.push(path);
        return SKILL_TEXT;
      },
    });
    expect(asked).toEqual([projectSkill.path]);
  });

  test('a file that does not read keeps the record and holders, and names why', () => {
    const view = readShowView(record({ path: join(base, 'gone.md') }), RECORDS, { full: true });
    expect(view.readError).toContain('ENOENT');
    expect(view.others).toHaveLength(3);
    expect(view.frontmatter).toBeNull();
    expect(view.headings).toEqual([]);
    expect(view.text).toBeNull();
  });
});

describe('renderShowView', () => {
  const view = buildShowView(projectSkill, RECORDS, SKILL_TEXT, false);
  const lines = renderShowView(view);

  test('opens with the record: title, then one labelled line per field', () => {
    expect(lines.slice(0, 9)).toEqual([
      'skill gate-order (project)',
      `  path     ${projectSkill.path}`,
      '  state    enabled',
      '  loop     resolved by a loop session',
      '  check    pass',
      '  summary  Runs the gates in order',
      '  stack    typescript',
      '  tags     gates, ci',
      '',
    ]);
  });

  test('lists every other holder with its source and state', () => {
    expect(lines).toContain('Other holders of skill gate-order:');
    expect(lines).toContain(`  user          shadowed-by:project  ${userSkill.path}`);
    expect(lines).toContain(`  plugin:alpha  shadowed-by:project  ${pluginSkill.path}`);
  });

  test('prints the frontmatter as written and the headings by level', () => {
    const at = lines.indexOf('Frontmatter:');
    expect(lines.slice(at, at + 4)).toEqual([
      'Frontmatter:',
      '  name: gate-order',
      '  description: Runs the gates in order',
      '  model: sonnet',
    ]);
    expect(lines.slice(lines.indexOf('Headings:'))).toEqual([
      'Headings:',
      '  # Gate order  (line 6)',
      '    ## When  (line 10)',
      '      ### Steps  (line 16)',
    ]);
  });

  test('without full no body line is printed', () => {
    expect(lines).not.toContain('Intro.');
  });

  test('under full the whole file replaces the frontmatter and headings sections', () => {
    const full = renderShowView(buildShowView(projectSkill, RECORDS, SKILL_TEXT, true));
    expect(full).not.toContain('Frontmatter:');
    expect(full).not.toContain('Headings:');
    const at = full.indexOf(`File ${projectSkill.path}:`);
    expect(at).toBeGreaterThan(0);
    expect(full.slice(at + 1).join('\n')).toBe(SKILL_TEXT.replace(/\n$/, ''));
  });

  test('an item alone, with no frontmatter or heading, says so in each section', () => {
    const bare = renderShowView(buildShowView(otherSkill, RECORDS, 'plain text\n', false));
    expect(bare).toContain('  (no other skill of this name)');
    expect(bare).toContain('  (none)');
    expect(bare).toContain('  (no heading)');
  });

  test('an agent with no checker verdict prints no check line, and its own fields do', () => {
    const agent = record({
      ...sameNameAgent,
      summary: '',
      whenToUse: 'after a diff',
      prevents: 'unreviewed merges',
      visibleToLoop: false,
    });
    const agentLines = renderShowView(buildShowView(agent, RECORDS, '# A\n', false));
    expect(agentLines[0]).toBe('agent gate-order (project)');
    expect(agentLines.some((line) => line.startsWith('  check'))).toBe(false);
    expect(agentLines).toContain('  summary   (no description)');
    expect(agentLines).toContain('  when      after a diff');
    expect(agentLines).toContain('  prevents  unreviewed merges');
    expect(agentLines).toContain('  loop      not resolved by a loop session');
  });

  test('a visible other holder is marked as resolved by a loop session', () => {
    const shown = renderShowView(buildShowView(userSkill, RECORDS, '', false));
    expect(shown).toContain(`  project       enabled              ${projectSkill.path}  (resolved by a loop session)`);
  });

  test('a file that did not read says why in place of its sections', () => {
    const failed: ShowView = { ...view, readError: 'ENOENT: gone', frontmatter: null, frontmatterText: null, headings: [] };
    const failedLines = renderShowView(failed);
    expect(failedLines.at(-1)).toBe('The file could not be read: ENOENT: gone');
    expect(failedLines).not.toContain('Headings:');
  });
});
