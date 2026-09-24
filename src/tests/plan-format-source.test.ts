/**
 * The dev-planner skill in the rafa tier
 * (`src/bundled/skills/dev-planner/SKILL.md`) is the single source of the
 * plan format: `src/plan-prompt.md` carries only a `{PLAN_FORMAT}` slot,
 * and {@link buildPlanPrompt} (`src/plan.ts`) fills it with the skill's
 * body verbatim. This file pins that invariant three ways.
 *
 * ## The source the prompt reads
 *
 * {@link readPlanFormat}, handed `src/` as a checkout run hands it, is
 * held to the tier file's bytes and its path to {@link SKILL_PATH},
 * spelled here, so the reader drifting to another copy (the
 * `.claude/skills` one this repository also carries, or a `SKILL.md`
 * beside the module as the build once wrote) fails a case rather than
 * agreeing with itself. Every other case below reads the same file.
 *
 * ## The restatement check
 *
 * {@link restatedRuleBullets} reads every top-level `* ` bullet out of
 * the skill's body — joining a wrapped bullet's continuation lines into
 * one string first, since a bullet here wraps across a line break the
 * same way the routing table's prose pin does (`routing-table-agents.
 * test.ts`) — and reports which of them, whitespace-normalised, also
 * appear in the RAW template on disk: the file as tracked, never the
 * built prompt, since the built prompt legitimately carries the whole
 * skill once, through the `{PLAN_FORMAT}` slot. A hit means the template
 * restates a rule instead of pointing at the skill that owns it.
 *
 * The live claim is an empty offender list. An always-empty list reads
 * the same whether the check works or has stopped finding anything, so
 * its control plants one real bullet from the skill into a copy of the
 * template and asserts the SAME function reports it.
 *
 * ## The byte-for-byte pin
 *
 * {@link buildPlanPrompt}'s output is asserted to CONTAIN the skill's
 * parser contract section unchanged: the section naming the checklist
 * grammar the loop's own parser reads (`- [ ]` lines, `# Stage:`
 * headings, one atomic action per task, and the rest). Frontmatter
 * stripping happens before this section and trailing-whitespace
 * trimming happens after it, so neither touches these bytes, and the
 * slot substitution itself only ever inserts a value — it never rewrites
 * one (see the doc comment on `buildPlanPrompt` in `src/plan.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { buildPlanPrompt, planFormatBody, planFormatPath, readPlanFormat } from '../plan.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKILL_PATH = 'src/bundled/skills/dev-planner/SKILL.md';
const PROMPT_PATH = 'src/plan-prompt.md';

/** The heading naming the section {@link buildPlanPrompt}'s output is pinned against. */
const PARSER_CONTRACT_HEADING = '## Structured plan format (parser contract)';

/** A bullet shorter than this is not distinctive enough to check as a rule. */
const MIN_RULE_LENGTH = 30;

const SKILL_RAW = readFileSync(join(REPO_ROOT, SKILL_PATH), 'utf8');
const PROMPT_RAW = readFileSync(join(REPO_ROOT, PROMPT_PATH), 'utf8');

/** The skill as {@link buildPlanPrompt} inlines it: frontmatter dropped. */
const SKILL_BODY = planFormatBody(SKILL_RAW);

/** Collapses whitespace, so a bullet's own wrap point never breaks a match. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Every top-level `* ` bullet in `body`, each joined from its wrapped
 * continuation lines into one string. A continuation line is anything
 * indented under the bullet that is not itself a new bullet, a blank
 * line, or a heading — the same shape the skill's own bullets wrap in
 * (two-space hanging indent; see the parser contract section itself).
 */
export function extractRuleBullets(body: string): string[] {
  const lines = body.split('\n');
  const bullets: string[] = [];
  let current: string[] = [];
  let inBullet = false;

  for (const line of lines) {
    if (line.startsWith('* ')) {
      if (inBullet) bullets.push(current.join(' '));
      current = [line.slice(2).trim()];
      inBullet = true;
      continue;
    }
    const trimmed = line.trim();
    const isContinuation = inBullet
      && trimmed !== ''
      && /^\s/.test(line)
      && !/^#{1,6}\s/.test(trimmed);
    if (isContinuation) {
      current.push(trimmed);
      continue;
    }
    if (inBullet) {
      bullets.push(current.join(' '));
      current = [];
      inBullet = false;
    }
  }
  if (inBullet) bullets.push(current.join(' '));

  return bullets;
}

/**
 * The skill's rule bullets that also appear, whitespace-normalised, in
 * `promptRaw` — the plan prompt as tracked, never as built. A non-empty
 * result names the template restating a rule the skill already owns.
 */
export function restatedRuleBullets(promptRaw: string, skillBody: string): string[] {
  const normalizedPrompt = normalize(promptRaw);
  const seen = new Set<string>();
  const offenders: string[] = [];

  for (const bullet of extractRuleBullets(skillBody)) {
    const rule = normalize(bullet);
    if (rule.length < MIN_RULE_LENGTH) continue;
    if (seen.has(rule)) continue;
    if (!normalizedPrompt.includes(rule)) continue;
    seen.add(rule);
    offenders.push(rule);
  }

  return offenders;
}

/**
 * One level-2 (`## `) section of `body`: the heading line through the
 * line before the next level-2 heading, or through the end of `body`
 * when there is none. A level-3 (`### `) heading nested under it stays
 * part of the section, matching how the parser contract's own
 * "Plan layout" and "Structured blocks" subsections read as part of it.
 */
export function extractSection(body: string, heading: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new Error(`heading ${JSON.stringify(heading)} not found`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('the plan format\'s source', () => {
  it('is the rafa tier\'s dev-planner skill, read from src as a checkout run reads it', () => {
    const src = join(REPO_ROOT, 'src');

    expect(planFormatPath(src)).toBe(join(REPO_ROOT, SKILL_PATH));
    expect(readPlanFormat(src)).toBe(SKILL_RAW);
  });
});

describe('the plan prompt restates no plan-format rule', () => {
  it('has rule bullets to check against, so an empty offender list is not vacuous', () => {
    expect(extractRuleBullets(SKILL_BODY).length).toBeGreaterThan(10);
  });

  it('carries none of the skill\'s rule bullets in its raw template', () => {
    // This is the regression case: it goes red the moment plan-prompt.md
    // restates, word for word (modulo a line wrap), a rule the skill
    // already states — which is exactly what five contradictions once
    // did before the parser contract moved into the skill.
    expect(restatedRuleBullets(PROMPT_RAW, SKILL_BODY)).toEqual([]);
  });

  it('reports a planted restatement, so the check above is not toothless', () => {
    const [target] = extractRuleBullets(extractSection(SKILL_BODY, PARSER_CONTRACT_HEADING));
    if (target === undefined) throw new Error('no parser-contract bullet to plant');

    const planted = `${PROMPT_RAW}\n\n${target}\n`;
    expect(restatedRuleBullets(planted, SKILL_BODY)).toEqual([normalize(target)]);

    // The control: the unplanted template is what stayed clean above,
    // so the plant — not some drift in the fixture — is what moved.
    expect(restatedRuleBullets(PROMPT_RAW, SKILL_BODY)).toEqual([]);
  });
});

describe('buildPlanPrompt inlines the parser contract section unchanged', () => {
  it('is a real, sizeable section to pin against, not an empty match', () => {
    const section = extractSection(SKILL_BODY, PARSER_CONTRACT_HEADING);
    expect(section.length).toBeGreaterThan(500);
    expect(section).toContain('never nest tasks.');
  });

  it('carries the section byte for byte in the built prompt', () => {
    const section = extractSection(SKILL_BODY, PARSER_CONTRACT_HEADING);
    const prompt = buildPlanPrompt(PROMPT_RAW, SKILL_RAW, 'a spec, for this pin only', 'a-stub', '.rafa/plans');

    expect(prompt).toContain(section);
  });
});
