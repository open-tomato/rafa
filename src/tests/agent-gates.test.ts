/**
 * The gate prose four agents carry in two copies each —
 * `.claude/agents/<name>.md` and `src/bundled/agents/<name>.md`, for
 * `loop-implementer` (a `## Verification` section), and
 * `build-error-resolver`, `code-reviewer` and `tdd-guide` (a
 * `## Rafa Gates` section, plus `tdd-guide`'s `## TDD Workflow`
 * section). This file reads every gate-shaped command those sections
 * name and holds it to the rules `context/verification.md` states: no
 * pipe without `set -o pipefail` or an `exit=$?` capture, no
 * `until`/`while` paired with `sleep` inside one command, no bare
 * full-suite `bun test`, `--changed=` present, and the two copies of
 * each changed section identical.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLAUDE_AGENTS_DIR = join(REPO_ROOT, '.claude', 'agents');
const BUNDLED_AGENTS_DIR = join(REPO_ROOT, 'src', 'bundled', 'agents');

interface AgentSection {
  readonly agent: string;
  readonly heading: string;
}

const GATE_SECTIONS: readonly AgentSection[] = [
  { agent: 'loop-implementer', heading: '## Verification' },
  { agent: 'build-error-resolver', heading: '## Rafa Gates' },
  { agent: 'code-reviewer', heading: '## Rafa Gates' },
  { agent: 'tdd-guide', heading: '## Rafa Gates' },
  { agent: 'tdd-guide', heading: '## TDD Workflow' },
];

/** Reads an agent's two copies as `[claudeText, bundledText]`. */
function readCopies(agent: string): readonly [string, string] {
  const claudeText = readFileSync(join(CLAUDE_AGENTS_DIR, `${agent}.md`), 'utf8');
  const bundledText = readFileSync(join(BUNDLED_AGENTS_DIR, `${agent}.md`), 'utf8');
  return [claudeText, bundledText];
}

/**
 * Slices one `##`-level section out of a file's text, from `heading`
 * through the line before the next `## ` heading (or end of file).
 * Throws if `heading` is absent, so a renamed or removed section fails
 * loud instead of silently checking nothing.
 */
function extractSection(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`section "${heading}" not found`);
  }
  const rest = lines.slice(start + 1);
  const relativeEnd = rest.findIndex((line) => line.startsWith('## '));
  const end =
    relativeEnd === -1
      ? lines.length
      : start + 1 + relativeEnd;
  return lines.slice(start, end).join('\n');
}

interface CodeSpan {
  readonly text: string;
  /** The 40 characters of prose right after the closing backtick. */
  readonly trailingContext: string;
}

/** Every inline-code span (backtick-delimited) in `section`, with trailing context. */
function codeSpans(section: string): readonly CodeSpan[] {
  const matches = [...section.matchAll(/`([^`]+)`/g)];
  return matches.map((match) => ({
    text: match[1] ?? '',
    trailingContext: section.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 40),
  }));
}

/**
 * Spans that look like an actual command a session is told to run, not a
 * bare keyword like `until`, a pipe fragment like `| tail`, or a mention
 * of the tool's own behavior like "`bun test` runs files one after
 * another" (kept verbatim by the plan as advice about Bun's own output).
 */
function commandSpans(section: string): readonly string[] {
  return codeSpans(section)
    .filter((span) => /^[a-zA-Z][\w-]*\s/.test(span.text))
    .filter((span) => !/^\s+runs\b/.test(span.trailingContext))
    .map((span) => span.text);
}

describe('agent gate sections match across both copies', () => {
  const agents = [...new Set(GATE_SECTIONS.map((section) => section.agent))];

  for (const agent of agents) {
    it(`${agent}: both copies carry the same gate sections`, () => {
      const [claudeText, bundledText] = readCopies(agent);
      const headings = GATE_SECTIONS.filter((section) => section.agent === agent).map(
        (section) => section.heading,
      );
      for (const heading of headings) {
        const claudeSection = extractSection(claudeText, heading);
        const bundledSection = extractSection(bundledText, heading);
        expect(bundledSection).toBe(claudeSection);
      }
    });
  }
});

describe('agent gate commands follow the verification rules', () => {
  for (const { agent, heading } of GATE_SECTIONS) {
    const [claudeText] = readCopies(agent);
    const section = extractSection(claudeText, heading);

    describe(`${agent} ${heading}`, () => {
      it('names --changed= for bun test', () => {
        expect(section).toContain('--changed=');
      });

      it('never runs a bare full-suite `bun test`', () => {
        const bareFullSuite = commandSpans(section).some((span) => span.trim() === 'bun test');
        expect(bareFullSuite).toBe(false);
      });

      it('never pipes a command without set -o pipefail or an exit=$? capture', () => {
        const unsafePipes = commandSpans(section).filter((span) => {
          const hasPipe = /\s\|\s/.test(span);
          if (!hasPipe) return false;
          const guarded = span.includes('pipefail') || span.includes('exit=$?');
          return !guarded;
        });
        expect(unsafePipes).toEqual([]);
      });

      it('never pairs until/while with sleep inside one command', () => {
        const pollingCommands = commandSpans(section).filter(
          (span) => /\b(until|while)\b/i.test(span) && /\bsleep\b/i.test(span),
        );
        expect(pollingCommands).toEqual([]);
      });
    });
  }
});

describe('the exit-code and no-polling rules are stated in prose', () => {
  const statedIn = [
    { agent: 'loop-implementer', heading: '## Verification' },
    { agent: 'build-error-resolver', heading: '## Rafa Gates' },
    { agent: 'code-reviewer', heading: '## Rafa Gates' },
    { agent: 'tdd-guide', heading: '## Rafa Gates' },
  ];

  for (const { agent, heading } of statedIn) {
    it(`${agent}: ${heading} states the exit-code and no-polling rules`, () => {
      const [claudeText] = readCopies(agent);
      const section = extractSection(claudeText, heading);
      expect(section).toContain('set -o pipefail');
      expect(section).toContain('exit=$?');
      expect(section).toMatch(/never poll with[\s\S]*until[\s\S]*while[\s\S]*sleep/i);
    });
  }
});
