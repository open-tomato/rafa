/**
 * Tests for the merged loop's new pieces: per-plan tracker derivation,
 * --start-at time math, plan-prompt templating, and where the plan format
 * the prompt inlines is read from.
 *
 * Every file a `readPlanFormat` case plants sits under this file's own
 * temporary directory. The one case reading outside it reads this
 * checkout's dev-planner skill, and writes nothing.
 *
 * The rescan and dollar-sequence cases were shown to fail: with
 * `buildPlanPrompt` put back to chained `replaceAll` calls, one per slot,
 * those two reddened and every other case here stayed green.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  buildPlanPrompt,
  formatProgressSection,
  planFormatBody,
  planFormatCandidates,
  readPlanFormat,
  stubFromSpecPath,
} from '../plan.js';
import { msUntil } from '../utils/schedule.js';
import { trackerPathFor } from '../utils/tracker.js';

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

describe('buildPlanPrompt', () => {
  const template = 'plan={PLAN_FILE} prereq={PREREQUISITES_FILE}\n{PROGRESS_SECTION}\n{PLAN_FORMAT}\n---\n{SPEC_CONTENT}';
  const format = '# Format\n\nOne task per line.\n';

  it('substitutes plan, prerequisites, format and spec placeholders into .plans/', () => {
    const out = buildPlanPrompt(template, format, '# My spec', 'my-feature');
    expect(out).toContain('plan=.plans/PLAN-my-feature.md');
    expect(out).toContain('prereq=.plans/PREREQUISITES-my-feature.md');
    expect(out).toContain('\n# Format\n\nOne task per line.\n---\n');
    expect(out).toContain('# My spec');
    expect(out).not.toContain('{SPEC_CONTENT}');
    expect(out).not.toContain('{PROGRESS_SECTION}');
    expect(out).not.toContain('{PLAN_FORMAT}');
  });

  it('injects progress findings as advisory context when provided', () => {
    const out = buildPlanPrompt(template, format, '# My spec', 'my-feature', 'auth logic lives in src/auth');
    expect(out).toContain('Findings from previous runs');
    expect(out).toContain('auth logic lives in src/auth');
    expect(out).toContain('ADVISORY');
  });

  it('omits the progress section entirely when there is nothing to inject', () => {
    for (const progress of [undefined, '', '  \n ']) {
      const out = buildPlanPrompt(template, format, '# My spec', 'my-feature', progress);
      expect(out).not.toContain('Findings from previous runs');
    }
  });

  it('inlines the skill without its frontmatter', () => {
    const skill = '---\nname: dev-planner\ndescription: a skill\n---\n\n# Format\n\nOne task per line.\n';
    expect(buildPlanPrompt('[{PLAN_FORMAT}]', skill, '', 'x')).toBe('[# Format\n\nOne task per line.]');
  });

  it('never rescans filled text, so a slot name inside a spec, a progress note or the format stays as written', () => {
    const out = buildPlanPrompt(
      '{PROGRESS_SECTION}[{PLAN_FORMAT}]\n[{SPEC_CONTENT}]',
      'format naming {SPEC_CONTENT} and {PLAN_FILE}',
      'spec naming {PLAN_FORMAT}',
      'x',
      'progress naming {SPEC_CONTENT}',
    );
    expect(out).toContain('\nprogress naming {SPEC_CONTENT}\n');
    expect(out).toContain('[format naming {SPEC_CONTENT} and {PLAN_FILE}]');
    expect(out.endsWith('\n[spec naming {PLAN_FORMAT}]')).toBe(true);
  });

  it('reads no replacement pattern in filled text, so a dollar sequence stays as written', () => {
    const out = buildPlanPrompt('[{PLAN_FORMAT}] [{SPEC_CONTENT}]', 'format $& $1 $$', 'spec $` $<name>', 'x');
    expect(out).toBe('[format $& $1 $$] [spec $` $<name>]');
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

  it('looks beside the module first, then at the checkout skill one directory up', () => {
    expect(planFormatCandidates('/pkg/dist')).toEqual([
      '/pkg/dist/SKILL.md',
      '/pkg/.claude/skills/dev-planner/SKILL.md',
    ]);
  });

  it('reads the copy beside the module when both exist', () => {
    const moduleDir = plantPackage('both', {
      'dist/SKILL.md': 'beside',
      '.claude/skills/dev-planner/SKILL.md': 'checkout',
    });
    expect(moduleDir.startsWith(root)).toBe(true);
    expect(readPlanFormat(moduleDir)).toBe('beside');
  });

  it('falls back to the checkout skill when nothing sits beside the module', () => {
    const moduleDir = plantPackage('checkout', { '.claude/skills/dev-planner/SKILL.md': 'checkout' });
    expect(readPlanFormat(moduleDir)).toBe('checkout');
  });

  it('throws naming both paths when neither exists', () => {
    const moduleDir = plantPackage('none', {});
    const [beside, checkout] = planFormatCandidates(moduleDir);
    expect(beside?.startsWith(root)).toBe(true);
    expect(checkout?.startsWith(root)).toBe(true);
    expect(() => readPlanFormat(moduleDir)).toThrow(`${beside} or ${checkout}`);
  });

  it('finds this checkout skill from src, where the module runs from source', () => {
    const src = fileURLToPath(new URL('../', import.meta.url));
    const skill = fileURLToPath(new URL('../../.claude/skills/dev-planner/SKILL.md', import.meta.url));
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
