/**
 * Tests for the merged loop's new pieces: per-plan tracker derivation,
 * --start-at time math, plan-prompt templating, and where the plan format
 * the prompt inlines is read from.
 *
 * Every file a `readPlanFormat` case plants sits under this file's own
 * temporary directory. The one case reading outside it reads this
 * checkout's dev-planner skill, the rafa tier's copy under
 * `src/bundled/skills`, and writes nothing. The case planting the two
 * copies the build used to read, `dist/SKILL.md` and the checkout's
 * `.claude/skills/dev-planner/SKILL.md`, and no tier copy holds that
 * neither is read any more.
 *
 * The rescan and dollar-sequence cases were shown to fail: with
 * `buildPlanPrompt` put back to chained `replaceAll` calls, one per slot,
 * those two reddened and every other case here stayed green.
 *
 * The deferral case sets a `sinkOutput` recording every level beside the
 * wait, so the announcement is read at its level and ahead of the sleep,
 * and puts the default output back after it. Sleeping ahead of the
 * announcement, driven on 2026-09-15 and restored sha256-identical,
 * reddened it alone.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import {
  buildPlanPrompt,
  formatProgressSection,
  formatRoutingSection,
  planFormatBody,
  planFormatPath,
  readPlanFormat,
  ROUTING_HEADING,
  stubFromSpecPath,
} from '../plan.js';
import { DEFAULT_ROUTES, DEFAULT_ROUTING } from '../tiers/routing.js';
import { deferUntil, msUntil } from '../utils/schedule.js';
import { trackerPathFor } from '../utils/tracker.js';

import { sinkOutput } from './output-sinks.js';

describe('trackerPathFor', () => {
  it('maps the default plan to the default tracker', () => {
    expect(trackerPathFor('/repo/PLAN.md')).toBe('/repo/PLAN_TRACKER.md');
  });

  it('keeps the stub suffix so plans get independent trackers', () => {
    expect(trackerPathFor('/repo/PLAN-auth-basic.md')).toBe('/repo/PLAN_TRACKER-auth-basic.md');
  });
});

describe('msUntil', () => {
  it('computes the delay to a later time today', () => {
    const now = new Date('2026-08-19T10:00:00');
    expect(msUntil('10:30', now)).toBe(30 * 60_000);
  });

  it('rolls to tomorrow when the time already passed', () => {
    const now = new Date('2026-08-19T23:30:00');
    expect(msUntil('23:00', now)).toBe(23.5 * 60 * 60_000);
  });

  it('rejects malformed input', () => {
    expect(() => msUntil('9pm')).toThrow(/HH:MM/);
    expect(() => msUntil('25:00')).toThrow(/valid time/);
  });
});

describe('deferUntil', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  it('announces the deferral through the active output info, then sleeps the delay msUntil answers', async () => {
    const now = new Date(2026, 8, 14, 22, 0, 0, 0);
    const seen: string[] = [];
    setActiveOutput(sinkOutput({
      info: (message) => {
        seen.push(`info:${message}`);
      },
      warn: (message) => {
        seen.push(`warn:${message}`);
      },
      error: (message) => {
        seen.push(`error:${message}`);
      },
    }));

    await deferUntil('23:00', now, (ms) => {
      seen.push(`sleep:${ms}`);
      return Promise.resolve();
    });

    expect(seen).toEqual(['info:Deferring execution. Sleeping 3600s until 23:00...', 'sleep:3600000']);
  });
});

describe('buildPlanPrompt', () => {
  const template = 'plan={PLAN_FILE} prereq={PREREQUISITES_FILE}\n{PROGRESS_SECTION}\n{PLAN_FORMAT}\n---\n{SPEC_CONTENT}';
  const format = '# Format\n\nOne task per line.\n';

  it('substitutes plan, prerequisites, format and spec placeholders into the plans directory', () => {
    const out = buildPlanPrompt(template, format, '# My spec', 'my-feature', '.rafa/plans');
    expect(out).toContain('plan=.rafa/plans/PLAN-my-feature.md');
    expect(out).toContain('prereq=.rafa/plans/PREREQUISITES-my-feature.md');
    expect(out).toContain('\n# Format\n\nOne task per line.\n---\n');
    expect(out).toContain('# My spec');
    expect(out).not.toContain('{SPEC_CONTENT}');
    expect(out).not.toContain('{PROGRESS_SECTION}');
    expect(out).not.toContain('{PLAN_FORMAT}');
  });

  it('names both files in whichever plans directory it is handed', () => {
    const out = buildPlanPrompt(template, format, '# My spec', 'my-feature', '.plans');
    expect(out).toContain('plan=.plans/PLAN-my-feature.md prereq=.plans/PREREQUISITES-my-feature.md\n');
  });

  it('injects progress findings as advisory context when provided', () => {
    const out = buildPlanPrompt(template, format, '# My spec', 'my-feature', '.rafa/plans', 'auth logic lives in src/auth');
    expect(out).toContain('Findings from previous runs');
    expect(out).toContain('auth logic lives in src/auth');
    expect(out).toContain('ADVISORY');
  });

  it('omits the progress section entirely when there is nothing to inject', () => {
    for (const progress of [undefined, '', '  \n ']) {
      const out = buildPlanPrompt(template, format, '# My spec', 'my-feature', '.rafa/plans', progress);
      expect(out).not.toContain('Findings from previous runs');
    }
  });

  it('inlines the skill without its frontmatter', () => {
    const skill = '---\nname: dev-planner\ndescription: a skill\n---\n\n# Format\n\nOne task per line.\n';
    expect(buildPlanPrompt('[{PLAN_FORMAT}]', skill, '', 'x', '.rafa/plans')).toBe('[# Format\n\nOne task per line.]');
  });

  it('never rescans filled text, so a slot name inside a spec, a progress note or the format stays as written', () => {
    const out = buildPlanPrompt(
      '{PROGRESS_SECTION}[{PLAN_FORMAT}]\n[{SPEC_CONTENT}]',
      'format naming {SPEC_CONTENT} and {PLAN_FILE}',
      'spec naming {PLAN_FORMAT}',
      'x',
      '.rafa/plans',
      'progress naming {SPEC_CONTENT}',
    );
    expect(out).toContain('\nprogress naming {SPEC_CONTENT}\n');
    expect(out).toContain('[format naming {SPEC_CONTENT} and {PLAN_FILE}]');
    expect(out.endsWith('\n[spec naming {PLAN_FORMAT}]')).toBe(true);
  });

  it('reads no replacement pattern in filled text, so a dollar sequence stays as written', () => {
    const out = buildPlanPrompt('[{PLAN_FORMAT}] [{SPEC_CONTENT}]', 'format $& $1 $$', 'spec $` $<name>', 'x', '.rafa/plans');
    expect(out).toBe('[format $& $1 $$] [spec $` $<name>]');
  });

  it('fills the routing slot from rafa\'s defaults when no routing is handed over', () => {
    const out = buildPlanPrompt('[{ROUTING}]', format, '', 'x', '.rafa/plans');
    expect(out).toBe(`[${formatRoutingSection(DEFAULT_ROUTING)}]`);
    expect(out).not.toContain('{ROUTING}');
  });

  it('fills the routing slot from the routing it is handed, not the defaults', () => {
    const routing = new Map<string, string | false>([['cleanup', 'refactor-cleaner']]);
    const out = buildPlanPrompt('[{ROUTING}]', format, '', 'x', '.rafa/plans', undefined, routing);
    expect(out).toContain('| `cleanup` | `refactor-cleaner` |');
    expect(out).not.toContain('`doc-updater`');
  });

  it('never rescans the routing table, so a shape naming a slot stays as written', () => {
    const routing = new Map<string, string | false>([['{SPEC_CONTENT}', 'doc-updater']]);
    const out = buildPlanPrompt('{ROUTING}\n{SPEC_CONTENT}', format, 'the spec', 'x', '.rafa/plans', undefined, routing);
    expect(out).toContain('| `{SPEC_CONTENT}` | `doc-updater` |');
    expect(out.endsWith('\nthe spec')).toBe(true);
  });
});

describe('formatRoutingSection', () => {
  it('lists every default row, in the defaults\' order, under its heading', () => {
    const lines = formatRoutingSection(DEFAULT_ROUTING).split('\n');
    expect(lines[0]).toBe(ROUTING_HEADING);
    const table = lines.slice(lines.indexOf('| Shape | Agent |'));
    expect(table).toEqual([
      '| Shape | Agent |',
      '| --- | --- |',
      ...DEFAULT_ROUTES.map(([shape, agent]) => `| \`${shape}\` | \`${agent}\` |`),
    ]);
  });

  it('leaves out a row the setting turns off with false, and keeps the rest', () => {
    const routing = new Map<string, string | false>([['prose', false], ['tests', 'tdd-guide']]);
    const out = formatRoutingSection(routing);
    expect(out).toContain('| `tests` | `tdd-guide` |');
    expect(out).not.toContain('prose');
  });

  it('says no shape is routed when every row is off, and prints no empty table', () => {
    const out = formatRoutingSection(new Map<string, string | false>([['prose', false]]));
    expect(out.startsWith(`${ROUTING_HEADING}\n`)).toBe(true);
    expect(out).toContain('routes no task shape to an agent');
    expect(out).not.toContain('| Shape | Agent |');
    expect(formatRoutingSection(new Map())).toBe(out);
  });

  it('escapes a pipe and fences a backtick, so a cell cannot end early or close its span', () => {
    const routing = new Map<string, string | false>([['a|b', 'x`y'], ['`edge', 'plain']]);
    const out = formatRoutingSection(routing);
    expect(out).toContain('| `a\\|b` | ``x`y`` |');
    expect(out).toContain('| `` `edge `` | `plain` |');
  });

  it('keeps the table on one line per row when a name holds a line break', () => {
    const out = formatRoutingSection(new Map<string, string | false>([['two\nlines', 'agent']]));
    expect(out).toContain('| `two lines` | `agent` |');
  });
});

describe('planFormatBody', () => {
  it('drops the frontmatter and the blank lines after it', () => {
    expect(planFormatBody('---\nname: x\n---\n\n\n# A\n')).toBe('# A');
  });

  it('keeps a file with no frontmatter whole, trailing whitespace aside', () => {
    expect(planFormatBody('# A\n\nB\n\n')).toBe('# A\n\nB');
  });

  it('drops only the opening block, keeping a later thematic break', () => {
    expect(planFormatBody('---\nname: x\n---\n# A\n\n---\n\nB\n')).toBe('# A\n\n---\n\nB');
  });
});

describe('readPlanFormat', () => {
  const root = mkdtempSync(join(tmpdir(), 'rafa-plan-format-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A package directory under the scratch root holding `files`, answering its `dist/`. */
  function plantPackage(name: string, files: Record<string, string>): string {
    const pkg = join(root, name);
    for (const [relative, content] of Object.entries(files)) {
      mkdirSync(dirname(join(pkg, relative)), { recursive: true });
      writeFileSync(join(pkg, relative), content, 'utf8');
    }
    const moduleDir = join(pkg, 'dist');
    mkdirSync(moduleDir, { recursive: true });
    return moduleDir;
  }

  it('reads the rafa tier under the module directory, and nowhere else', () => {
    expect(planFormatPath('/pkg/dist')).toBe('/pkg/dist/bundled/skills/dev-planner/SKILL.md');
  });

  it('reads the tier copy under the module directory', () => {
    const moduleDir = plantPackage('tier', { 'dist/bundled/skills/dev-planner/SKILL.md': 'tier' });
    expect(moduleDir.startsWith(root)).toBe(true);
    expect(readPlanFormat(moduleDir)).toBe('tier');
  });

  it('ignores the copies the build used to leave, beside the module and in the checkout', () => {
    const moduleDir = plantPackage('stale', {
      'dist/SKILL.md': 'beside',
      '.claude/skills/dev-planner/SKILL.md': 'checkout',
    });
    const skill = planFormatPath(moduleDir);
    expect(skill.startsWith(root)).toBe(true);
    expect(() => readPlanFormat(moduleDir)).toThrow(`The plan format is missing: no dev-planner SKILL.md at ${skill}`);
  });

  it('finds this checkout\'s rafa tier from src, where the module runs from source', () => {
    const src = fileURLToPath(new URL('../', import.meta.url));
    const skill = fileURLToPath(new URL('../bundled/skills/dev-planner/SKILL.md', import.meta.url));
    expect(readPlanFormat(src)).toBe(readFileSync(skill, 'utf8'));
  });
});

describe('formatProgressSection', () => {
  it('caps oversized progress files, keeping the most recent findings', () => {
    const old = 'OLD-FINDING '.repeat(2_000);
    const recent = 'RECENT-FINDING';
    const out = formatProgressSection(old + recent);
    expect(out).toContain('older findings truncated');
    expect(out).toContain(recent);
    expect(out.length).toBeLessThan(17_500);
  });
});

describe('stubFromSpecPath', () => {
  it('derives the stub from the spec basename', () => {
    expect(stubFromSpecPath('/repo/specs/auth-basic-strategy.md')).toBe('auth-basic-strategy');
  });
});
