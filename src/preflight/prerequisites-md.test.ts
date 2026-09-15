/**
 * Tests for the PREREQUISITES markdown reader
 * (`src/preflight/prerequisites-md.ts`).
 *
 * The source's suite, open-tomato's
 * `services/orchestrator/src/prerequisites/parser.test.ts` at commit
 * `e96fbb29e953d32705b4d39f737bf93dd4e0c099` (2026-04-21), is ported to
 * `bun:test` case for case under "the source rules", with `probeCommand`
 * read as `probe` and an absent probe as null.
 *
 * The cases after it hold what the copy changes, each beside a control
 * read through the same function, so no case passes on a reader that
 * reads nothing: a sibling heading ending an `auto` section beside a
 * deeper heading inheriting it; a probe on an item's second line beside
 * the same line after a blank one; a fenced item and comment beside the
 * same lines unfenced.
 *
 * The mapping, the merge and the loader follow. The merge reads a config
 * resolved by the real config reader. No case reads a plan under
 * `.plans/`, which a fresh clone does not hold: the operator steps fixture
 * is written here in the shape those files take. Every file the loader
 * reads is written under the case's own temporary directory, and each
 * loader case asserts the path it names resolves under that directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { parseConfigText, resolveConfig } from '../config.js';

import {
  loadPlanPrerequisites,
  mergePlanPrerequisites,
  parsePrerequisites,
  planPrerequisites,
  prerequisitesPathForPlan,
} from './prerequisites-md.js';

/** A config naming one item on each tier. */
const CONFIG_YAML = [
  'version: 1',
  'prerequisites:',
  '  required:',
  '    - tool: bun',
  '      probe: bun --version',
  '  optional:',
  '    - tool: mgrep',
  '      probe: mgrep --version',
  '      reason: "faster search; grep is the fallback"',
].join('\n');

/** The settings {@link CONFIG_YAML} resolves to, through the config reader. */
function configuredSettings() {
  return resolveConfig({ file: parseConfigText(CONFIG_YAML, 'fixture/.rafa/config.yaml') }).config;
}

/**
 * A plan file in the shape of the ones under `.plans/`: ticked checks, a
 * shell block, and unticked steps for after the merge that quote commands.
 */
const OPERATOR_STEPS_FILE = [
  '# Prerequisites — Phase 9, fixture',
  '',
  '## Toolchain',
  '',
  '- [x] `bun --version` — measured `1.3.14`',
  '- [x] `gh auth status` — measured, logged in',
  '',
  '```bash',
  'for a in tdd-guide code-reviewer; do',
  '  test -f ~/.claude/agents/$a.md && echo "ok $a" || echo "MISSING $a"',
  'done',
  '```',
  '',
  '## Operator steps after the plan merges',
  '',
  'Not prerequisites for the run — listed here so they are not lost.',
  '',
  '- [ ] On `main`, pulled to the merge: `bun run snapshot`. From this',
  '      phase it writes `~/.rafa/bin/rafa`.',
  '- [ ] Publish with `npm publish` under the maintainer credentials.',
].join('\n');

describe('parsePrerequisites: the source rules', () => {
  it('returns an empty array for empty content', () => {
    expect(parsePrerequisites('')).toEqual([]);
  });

  it('returns an empty array when all items are already checked', () => {
    const content = '- [x] Already done\n- [X] Also done\n';
    expect(parsePrerequisites(content)).toEqual([]);
  });

  it('ignores BLOCKED items', () => {
    const content = '- [BLOCKED] Stuck item\n';
    expect(parsePrerequisites(content)).toEqual([]);
  });

  it('parses a single unchecked item with no tag (defaults to human)', () => {
    const content = '- [ ] Confirm backup completed\n';
    const items = parsePrerequisites(content);
    expect(items).toHaveLength(1);
    expect(items[0]?.description).toBe('Confirm backup completed');
    expect(items[0]?.tag).toBe('human');
    expect(items[0]?.lineIndex).toBe(0);
  });

  it('respects explicit [auto] inline tag', () => {
    const content = '- [ ] [auto] Bun is installed (`bun --version`)\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.tag).toBe('auto');
    expect(items[0]?.description).toBe('Bun is installed (`bun --version`)');
    expect(items[0]?.probe).toBe('bun --version');
  });

  it('respects explicit [human] inline tag', () => {
    const content = '- [ ] [human] Approve the deployment plan\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.tag).toBe('human');
    expect(items[0]?.probe).toBeNull();
  });

  it('inherits auto tag from [auto] section header', () => {
    const content = '## Automated Checks [auto]\n\n- [ ] Node ≥ 20 installed (`node --version`)\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.tag).toBe('auto');
    expect(items[0]?.probe).toBe('node --version');
  });

  it('inherits human tag from Manual section header', () => {
    const content = '## Manual Steps\n\n- [ ] Review the release notes\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.tag).toBe('human');
  });

  it('inherits human tag from Sign-Off section header', () => {
    const content = '## Sign-Off Required\n\n- [ ] Tech lead sign-off\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.tag).toBe('human');
  });

  it('inline tag overrides section-header default', () => {
    const content = '## Automated Checks [auto]\n\n- [ ] [human] Manual override item\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.tag).toBe('human');
  });

  it('extracts probe command from backtick-wrapped token', () => {
    const content = '- [ ] [auto] Docker is running (`docker info`)\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.probe).toBe('docker info');
  });

  it('does not extract a probe for human items', () => {
    const content = '- [ ] [human] Run `some-command` manually\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.probe).toBeNull();
  });

  it('sets probe to null when no backtick token present', () => {
    const content = '- [ ] [auto] Check that the service is reachable\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.probe).toBeNull();
  });

  it('parses a realistic mixed document correctly', () => {
    const content = [
      '# Prerequisites',
      '',
      '## Automated Checks [auto]',
      '',
      '- [x] Already done',
      '- [ ] Bun installed (`bun --version`)',
      '- [ ] [human] Override to human',
      '',
      '## Manual Steps',
      '',
      '- [ ] Confirm backup',
      '- [x] Already confirmed',
    ].join('\n');

    const items = parsePrerequisites(content);
    expect(items).toHaveLength(3);

    expect(items[0]?.tag).toBe('auto');
    expect(items[0]?.probe).toBe('bun --version');

    expect(items[1]?.tag).toBe('human');
    expect(items[1]?.probe).toBeNull();

    expect(items[2]?.description).toBe('Confirm backup');
    expect(items[2]?.tag).toBe('human');
  });

  it('preserves the original raw line', () => {
    const raw = '- [ ] [auto] Raw line (`cmd`)';
    const items = parsePrerequisites(raw);
    expect(items[0]?.raw).toBe(raw);
  });
});

describe('parsePrerequisites: what the copy changes', () => {
  it('ends an auto section at a sibling heading with no tag of its own', () => {
    const content = [
      '## Checks [auto]',
      '',
      '- [ ] Bun (`bun --version`)',
      '',
      '## Operator steps after the plan merges',
      '',
      '- [ ] Publish with `npm publish`',
    ].join('\n');

    const items = parsePrerequisites(content);
    expect(items.map((item) => [item.tag, item.probe])).toEqual([
      ['auto', 'bun --version'],
      ['human', null],
    ]);
  });

  it('keeps an auto section over a deeper heading with no tag of its own', () => {
    const content = '## Checks [auto]\n\n### Publishing\n\n- [ ] Registry reachable (`npm ping`)\n';
    const items = parsePrerequisites(content);
    expect(items.map((item) => [item.tag, item.probe])).toEqual([['auto', 'npm ping']]);
  });

  it('takes the tag of the nearest shallower heading once a deeper tagged one ends', () => {
    const content = [
      '# Prerequisites [auto]',
      '',
      '### Sign-off',
      '',
      '- [ ] Lead approves (`echo deep`)',
      '',
      '## Toolchain',
      '',
      '- [ ] Bun (`bun --version`)',
    ].join('\n');

    const items = parsePrerequisites(content);
    expect(items.map((item) => [item.tag, item.probe])).toEqual([
      ['human', null],
      ['auto', 'bun --version'],
    ]);
  });

  it('reads a probe quoted on the second line of a wrapped item', () => {
    const content = '## Checks [auto]\n\n- [ ] Tracker clean:\n      `grep -c task .plans` exits 1\n';
    const items = parsePrerequisites(content);
    expect(items).toHaveLength(1);
    expect(items[0]?.description).toBe('Tracker clean: `grep -c task .plans` exits 1');
    expect(items[0]?.probe).toBe('grep -c task .plans');
    expect(items[0]?.raw).toBe('- [ ] Tracker clean:');
    expect(items[0]?.lineIndex).toBe(2);
  });

  it('does not run an item on over a blank line or one holding only spaces', () => {
    for (const blank of ['', '   ']) {
      const content = `- [ ] [auto] Tracker clean:\n${blank}\n      \`grep -c task .plans\` exits 1\n`;
      const items = parsePrerequisites(content);
      expect(items.map((item) => [item.description, item.probe])).toEqual([['Tracker clean:', null]]);
    }
  });

  it('joins a probe wrapped across a line break with one space', () => {
    const content = '- [ ] [auto] No tracker has a task left: `grep -c task\n      .plans/PLAN_TRACKER-*.md` exits 1\n';
    const items = parsePrerequisites(content);
    expect(items[0]?.probe).toBe('grep -c task .plans/PLAN_TRACKER-*.md');
  });

  it('does not join a nested list item into the item above it', () => {
    const content = '- [ ] [auto] Bun (`bun --version`)\n  - [ ] [auto] nested (`echo nested`)\n  1. numbered\n';
    const items = parsePrerequisites(content);
    expect(items.map((item) => item.description)).toEqual(['Bun (`bun --version`)']);
  });

  it('reads nothing inside a fenced block', () => {
    const content = [
      '## Checks [auto]',
      '',
      '```bash',
      '# install manually',
      '- [ ] [auto] fenced (`echo fenced`)',
      '```',
      '',
      '- [ ] Bun (`bun --version`)',
    ].join('\n');

    const items = parsePrerequisites(content);
    expect(items.map((item) => [item.description, item.tag, item.probe])).toEqual([
      ['Bun (`bun --version`)', 'auto', 'bun --version'],
    ]);
  });

  it('reads the same lines as a heading and an item outside a fence', () => {
    const content = [
      '## Checks [auto]',
      '',
      '# install manually',
      '- [ ] [auto] fenced (`echo fenced`)',
      '',
      '- [ ] Bun (`bun --version`)',
    ].join('\n');

    const items = parsePrerequisites(content);
    expect(items.map((item) => [item.description, item.tag, item.probe])).toEqual([
      ['fenced (`echo fenced`)', 'auto', 'echo fenced'],
      ['Bun (`bun --version`)', 'human', null],
    ]);
  });

  it('closes a fence only with a run of its own mark as long as the opening one', () => {
    const content = [
      '~~~~',
      '``````',
      '- [ ] [auto] after a longer run of the other mark (`echo other`)',
      '~~~',
      '- [ ] [auto] after a shorter run of the same mark (`echo shorter`)',
      '~~~~~',
      '- [ ] [auto] outside (`echo outside`)',
    ].join('\n');

    const items = parsePrerequisites(content);
    expect(items.map((item) => item.probe)).toEqual(['echo outside']);
  });

  it('reads a span holding only whitespace as no probe', () => {
    const items = parsePrerequisites('- [ ] [auto] Blank probe (`  `)\n');
    expect(items[0]?.probe).toBeNull();
  });

  it('answers a frozen list of frozen items', () => {
    const items = parsePrerequisites('- [ ] [auto] Bun (`bun --version`)\n');
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(items[0])).toBe(true);
  });
});

describe('planPrerequisites', () => {
  it('maps an auto item with a probe to a required tool item named by its description', () => {
    const plan = planPrerequisites('## Toolchain [auto]\n\n- [ ] Bun installed: `bun --version`\n');
    expect(plan.required).toEqual([
      { kind: 'tool', name: 'Bun installed: `bun --version`', probe: 'bun --version' },
    ]);
    expect(plan.reminders).toEqual([]);
  });

  it('maps a human item to a reminder and never to a required item', () => {
    const plan = planPrerequisites('## Credentials [human]\n\n- [ ] Token minted: `gh auth token`\n');
    expect(plan.required).toEqual([]);
    expect(plan.reminders).toEqual([
      { description: 'Token minted: `gh auth token`', tag: 'human', line: 3 },
    ]);
  });

  it('maps an auto item with no probe to a reminder tagged auto', () => {
    const plan = planPrerequisites('- [ ] [auto] The service is reachable\n');
    expect(plan.required).toEqual([]);
    expect(plan.reminders).toEqual([
      { description: 'The service is reachable', tag: 'auto', line: 1 },
    ]);
  });

  it('reads the unticked operator steps of a plan file as reminders alone', () => {
    const plan = planPrerequisites(OPERATOR_STEPS_FILE);
    expect(plan.required).toEqual([]);
    expect(plan.reminders).toEqual([
      {
        description: 'On `main`, pulled to the merge: `bun run snapshot`. From this phase it writes `~/.rafa/bin/rafa`.',
        tag: 'human',
        line: 18,
      },
      { description: 'Publish with `npm publish` under the maintainer credentials.', tag: 'human', line: 20 },
    ]);
  });

  it('reads the same steps as required items once their heading carries [auto]', () => {
    const tagged = OPERATOR_STEPS_FILE.replace(
      '## Operator steps after the plan merges',
      '## Operator steps after the plan merges [auto]',
    );
    const plan = planPrerequisites(tagged);
    expect(plan.required.map((item) => item.probe)).toEqual(['main', 'npm publish']);
    expect(plan.reminders).toEqual([]);
  });

  it('answers frozen lists of frozen entries', () => {
    const plan = planPrerequisites('- [ ] [auto] Bun (`bun --version`)\n- [ ] Backup confirmed\n');
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.required)).toBe(true);
    expect(Object.isFrozen(plan.required[0])).toBe(true);
    expect(Object.isFrozen(plan.reminders)).toBe(true);
    expect(Object.isFrozen(plan.reminders[0])).toBe(true);
  });
});

describe('mergePlanPrerequisites', () => {
  const PLAN_A = '## Checks [auto]\n\n- [ ] Docker running: `docker info`\n\n## After [human]\n\n- [ ] Tag the release\n';
  const PLAN_B = '- [ ] [auto] Registry reachable: `npm ping`\n';

  it('puts the plan required items after the config ones and keeps the config optional items', () => {
    const merged = mergePlanPrerequisites(configuredSettings(), PLAN_A);
    expect(merged.required).toEqual([
      { kind: 'tool', name: 'bun', probe: 'bun --version' },
      { kind: 'tool', name: 'Docker running: `docker info`', probe: 'docker info' },
    ]);
    expect(merged.optional).toEqual([
      { kind: 'tool', name: 'mgrep', probe: 'mgrep --version', reason: 'faster search; grep is the fallback' },
    ]);
    expect(merged.reminders).toEqual([{ description: 'Tag the release', tag: 'human', line: 7 }]);
  });

  it('merges nothing when the plan has no PREREQUISITES file', () => {
    const settings = configuredSettings();
    const merged = mergePlanPrerequisites(settings, null);
    expect(merged.required).toEqual(settings.prerequisitesRequired);
    expect(merged.optional).toEqual(settings.prerequisitesOptional);
    expect(merged.reminders).toEqual([]);
  });

  it('writes nothing into the settings, so a second plan sees none of the first', () => {
    const configured = configuredSettings();
    const settings = {
      prerequisitesRequired: [...configured.prerequisitesRequired],
      prerequisitesOptional: [...configured.prerequisitesOptional],
    };

    const first = mergePlanPrerequisites(settings, PLAN_A);
    const second = mergePlanPrerequisites(settings, PLAN_B);

    expect(first.required.map((item) => item.probe)).toEqual(['bun --version', 'docker info']);
    expect(second.required.map((item) => item.probe)).toEqual(['bun --version', 'npm ping']);
    expect(second.reminders).toEqual([]);
    expect(settings.prerequisitesRequired.map((item) => item.probe)).toEqual(['bun --version']);
    expect(settings.prerequisitesOptional).toHaveLength(1);
  });

  it('answers a new frozen set', () => {
    const settings = configuredSettings();
    const merged = mergePlanPrerequisites(settings, PLAN_A);
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.required)).toBe(true);
    expect(Object.isFrozen(merged.optional)).toBe(true);
    expect(merged.optional).not.toBe(settings.prerequisitesOptional);
  });
});

describe('prerequisitesPathForPlan', () => {
  it('names the PREREQUISITES file beside a PLAN-<stub>.md', () => {
    expect(prerequisitesPathForPlan('/repo/.plans/PLAN-phase-1.md')).toBe('/repo/.plans/PREREQUISITES-phase-1.md');
    expect(prerequisitesPathForPlan('.rafa/plans/PLAN-v1.2.md')).toBe('.rafa/plans/PREREQUISITES-v1.2.md');
    expect(prerequisitesPathForPlan('PLAN-x.md')).toBe('PREREQUISITES-x.md');
  });

  it('answers null for a plan not named PLAN-<stub>.md', () => {
    const names = ['/repo/PLAN.md', '/repo/PLAN-.md', '/repo/plan-x.md', '/repo/PLAN-x.txt', '/repo/MY-PLAN-x.md'];
    expect(names.map(prerequisitesPathForPlan)).toEqual([null, null, null, null, null]);
  });
});

describe('loadPlanPrerequisites', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rafa-prerequisites-md-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** True when `path` is `root` or lies under it. */
  function isUnderRoot(path: string): boolean {
    const offset = relative(root, path);
    return !offset.startsWith('..') && !isAbsolute(offset);
  }

  /** Writes `content` at `path` under the root, making its directory. */
  function plant(path: string, content: string): string {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
    return absolute;
  }

  it('merges the PREREQUISITES file beside the plan into the config items', async () => {
    const planPath = plant('.plans/PLAN-a.md', '# Plan: a\n');
    const prerequisitesPath = plant('.plans/PREREQUISITES-a.md', '- [ ] [auto] Docker running: `docker info`\n');
    expect(prerequisitesPathForPlan(planPath)).toBe(prerequisitesPath);
    expect(isUnderRoot(prerequisitesPath)).toBe(true);

    const merged = await loadPlanPrerequisites(planPath, configuredSettings());
    expect(merged.required.map((item) => item.probe)).toEqual(['bun --version', 'docker info']);
  });

  it('merges nothing for a plan in the same directory with no file of its own', async () => {
    plant('.plans/PREREQUISITES-a.md', '- [ ] [auto] Docker running: `docker info`\n');
    const planPath = plant('.plans/PLAN-b.md', '# Plan: b\n');
    expect(isUnderRoot(prerequisitesPathForPlan(planPath) ?? '/')).toBe(true);

    const merged = await loadPlanPrerequisites(planPath, configuredSettings());
    expect(merged.required.map((item) => item.probe)).toEqual(['bun --version']);
    expect(merged.reminders).toEqual([]);
  });

  it('reads no file for a hand-written PLAN.md', async () => {
    const planPath = plant('PLAN.md', '# Plan\n');
    plant('PREREQUISITES.md', '- [ ] [auto] Docker running: `docker info`\n');

    const merged = await loadPlanPrerequisites(planPath, configuredSettings());
    expect(merged.required.map((item) => item.probe)).toEqual(['bun --version']);
  });

  it('refuses a directory at the PREREQUISITES path, naming the path', async () => {
    const planPath = plant('.plans/PLAN-c.md', '# Plan: c\n');
    const directory = join(root, '.plans', 'PREREQUISITES-c.md');
    mkdirSync(directory);
    expect(isUnderRoot(directory)).toBe(true);

    await expect(loadPlanPrerequisites(planPath, configuredSettings()))
      .rejects.toThrow(`${directory}: cannot be read`);
  });
});
