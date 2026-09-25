/**
 * Agent frontmatter: what a `.claude/agents/<name>.md` block has to say
 * for Claude Code to load it, and what its optional `provenance` says.
 *
 * Until this module the checker read skills and instincts only, and an
 * agent's frontmatter was read solely for its `name` (`agents/roster.ts`,
 * `utils/agent-definition.ts`). This is the agent check: a pure reading
 * of a parsed mapping, as `./skill.js` is for a skill. Nothing here opens
 * a file, reads the home or throws; `readFrontmatter` in
 * `./frontmatter.js` produces the mapping.
 *
 * ## The two required fields, measured
 *
 * Claude Code 2.1.280, asked for an agent no scope defines (`claude -p
 * --setting-sources project,local --agent no-such-agent-zzz`) in a
 * scratch repository under `/tmp`, exits before any model call and lists
 * the agents it could have run. With three definitions planted there, the
 * list held `probe-with-desc` (`name` and `description`) and `probe-prov`
 * (the same plus a `provenance` mapping) and NOT `probe-no-desc` (`name`
 * alone). So a definition without `description` is one the CLI silently
 * never loads, and `description` is required here; the listed
 * `probe-with-desc` is the control showing the directory was read. A
 * `name` is required because it is what `--agent` resolves by
 * (`agents/roster.ts` records that reading), and it has to be the bare
 * file stem `isAgentName` accepts, so no name can reach a path outside
 * `.claude/agents/`. The `probe-prov` reading is also why `provenance` is
 * safe to carry: the CLI loads a definition holding the mapping.
 *
 * Every other key — `tools`, `model`, `effort`, `color` — is Claude
 * Code's and is not read here: this module states what rafa relies on,
 * not the vendor's whole format.
 *
 * ## `provenance`
 *
 * `./provenance.js` reads it, the same module the skill schema reads it
 * through, so the codes and messages are the skill's. Optional here as
 * there.
 */
import type { Provenance, ProvenanceIssueCode } from './provenance.js';

import { isAgentName } from '../utils/declaration.js';

import { checkProvenance, readProvenance } from './provenance.js';

/** The fields an agent definition cannot omit. */
export const REQUIRED_AGENT_FIELDS = ['name', 'description'] as const;

/** Why an agent's frontmatter was refused. One code per rule. */
export type AgentIssueCode =
  | ProvenanceIssueCode
  /** A `name` that is not a bare file stem. */
  | 'invalid-name';

/** Every code, in the order this module first documents them. */
export const AGENT_ISSUE_CODES: readonly AgentIssueCode[] = [
  'missing-field',
  'wrong-type',
  'invalid-name',
  'unknown-provenance',
  'invalid-reviewed',
];

/** One thing the frontmatter said that the agent check cannot accept. */
export interface AgentIssue {
  /** Which rule was broken. */
  readonly code: AgentIssueCode;
  /** The field it concerns, `provenance.<key>` for a provenance entry. */
  readonly field: string;
  /** A sentence a checker prints unedited, with no leading field name. */
  readonly message: string;
}

/** A block that passed every check. */
export interface AgentFrontmatter {
  /** `name`, which `--agent` resolves by. */
  readonly name: string;
  /** `description`, without which Claude Code does not load the file. */
  readonly description: string;
  /** `provenance`, or null when the key is absent. */
  readonly provenance: Provenance | null;
}

/** What {@link parseAgentFrontmatter} answers. */
export interface AgentCheckResult {
  /** Every rule broken, in field order. Empty on a clean block. */
  readonly issues: readonly AgentIssue[];
  /** The block read, or null when `issues` is non-empty. */
  readonly agent: AgentFrontmatter | null;
}

/** The YAML type of `value`, for a `wrong-type` message. */
function typeName(value: unknown): string {
  if (value === null) return 'an empty value';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  if (typeof value === 'boolean') return 'a boolean';
  if (typeof value === 'number') return 'a number';
  return `a ${typeof value}`;
}

/** The issues for a required string field. */
function requiredString(data: Readonly<Record<string, unknown>>, field: string): AgentIssue[] {
  const value = data[field];
  if (value === undefined || value === null) {
    return [{ code: 'missing-field', field, message: `${field} is required and is absent` }];
  }
  if (typeof value !== 'string') {
    return [{ code: 'wrong-type', field, message: `${field} must be a string, not ${typeName(value)}` }];
  }
  if (value.trim() === '') {
    return [{ code: 'missing-field', field, message: `${field} is required and is empty` }];
  }
  return [];
}

/** `name`: required, and a bare file stem. */
function checkName(data: Readonly<Record<string, unknown>>): AgentIssue[] {
  const issues = requiredString(data, 'name');
  if (issues.length > 0) return issues;

  const name = data['name'] as string;
  return isAgentName(name)
    ? []
    : [{
      code: 'invalid-name',
      field: 'name',
      message: `name "${name}" is not a bare file stem of letters, digits, hyphens and underscores`,
    }];
}

/**
 * Every rule `data` breaks, in field order: `name`, `description`, then
 * `provenance`. An empty list means Claude Code loads the definition and
 * its provenance, if any, reads.
 */
export function checkAgentFrontmatter(
  data: Readonly<Record<string, unknown>>,
): readonly AgentIssue[] {
  return [
    ...checkName(data),
    ...requiredString(data, 'description'),
    ...checkProvenance(data),
  ];
}

/** `data` read as an agent definition, with every issue beside it. */
export function parseAgentFrontmatter(
  data: Readonly<Record<string, unknown>>,
): AgentCheckResult {
  const issues = checkAgentFrontmatter(data);
  if (issues.length > 0) return { issues, agent: null };

  return {
    issues,
    agent: {
      name: data['name'] as string,
      description: data['description'] as string,
      provenance: readProvenance(data),
    },
  };
}
