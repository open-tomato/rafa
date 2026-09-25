/**
 * The instinct record: one observation, as a file under
 * `<scope>/.rafa/instincts/`, and the four things the rest of rafa
 * asks of it — read it, write it, stamp it with the project it came
 * from, and hand it to the Learning port.
 *
 * The shape is continuous-learning-v2's, extended with the fields the
 * loop can fill deterministically from a task report. A record is YAML
 * frontmatter plus a body carrying {@link ACTION_HEADING} and
 * {@link CAUSE_HEADING}, and the two halves are read together:
 * {@link parseInstinct} takes whole file text because the action is
 * body prose, not a frontmatter value, and {@link Instinct.actionHash}
 * cannot be computed without it.
 *
 * ## Why `action_hash` is never a field
 *
 * The Learning port merges two records by `action_hash`
 * (`sha256(trim(lower(action)))`), so a stale hash silently merges two
 * different actions into one — the worst failure this schema can
 * produce, and a silent one. A hash STORED in the file goes stale the
 * moment somebody edits the Action section by hand, and nothing about
 * the file would say so. So the hash is computed at read time by
 * {@link actionHash} and the frontmatter key is a refusal
 * (`stored-action-hash`) rather than an ignored extra: a file carrying
 * one is a file somebody expected to be authoritative.
 *
 * ## What is checked, and what deliberately is not
 *
 * Every rule the spec names is here: the four closed vocabularies
 * ({@link INSTINCT_KINDS}, {@link INSTINCT_DOMAINS},
 * {@link INSTINCT_SCOPES}, {@link INSTINCT_SOURCES}), the signal pair,
 * `confidence` between {@link CONFIDENCE_MIN} and
 * {@link CONFIDENCE_MAX} inclusive, and evidence non-empty when
 * `source` is {@link EVIDENCE_REQUIRED_SOURCE}. Two things are not:
 *
 *   - **`id` uniqueness.** It is unique WITHIN A SCOPE, which is a
 *     property of a directory and not of a file; the checker owns it.
 *     This module only refuses an id that is not slug-shaped.
 *   - **An evidence entry's keys.** The spec's task-report evidence is
 *     `plan`/`task`/`session`/`outcome`, but the demotion pass writes
 *     evidence pointing at an extracted file's date instead, so a
 *     fixed key set would refuse half the corpus the first time it
 *     ran. An entry must be a non-empty mapping of scalars, and that
 *     is the whole rule.
 *
 * `project_id` is likewise optional. The scope directory a record
 * lives in already says which project it belongs to; the field is the
 * cross-machine identity continuous-learning-v2 files by, and a record
 * written in a checkout with no `origin` has none to write. Deriving
 * it is `./project-id.ts`, which reproduces that skill's own hashing
 * so the two stores agree; its two constants and its four functions
 * are re-exported here, so a caller filling a record reads one import.
 *
 * Nothing declared in this module throws or opens a file: the reader
 * takes text and the writer answers text. The one call that reaches
 * the world is `gitRemoteUrl`, re-exported from `./project-id.ts`,
 * which spawns git and answers null rather than throwing.
 */

import type { InstinctRecord } from '../ports/index.js';
import type { FindingKind, FindingSignal } from '../report/parse.js';

import { actionHash } from '../learning/identity.js';
import { FINDING_KINDS, FINDING_SIGNALS } from '../report/parse.js';

import { readFrontmatterDocument, renderFrontmatter } from './frontmatter.js';
import { PROJECT_ID_LENGTH, PROJECT_ID_PATTERN } from './project-id.js';

export type { ProjectIdSeams } from './project-id.js';

export { actionHash } from '../learning/identity.js';

export {
  PROJECT_ID_LENGTH,
  PROJECT_ID_PATTERN,
  gitRemoteUrl,
  normalizeRemote,
  projectId,
  projectIdFromRemote,
} from './project-id.js';

/**
 * What an instinct is about. The same closed set a task report's
 * finding uses, imported rather than respelled: a finding IS the
 * instinct the loop files from it, so the two drifting apart would
 * make the conversion lossy without anything failing.
 */
export const INSTINCT_KINDS = FINDING_KINDS;

/** One of {@link INSTINCT_KINDS}. */
export type InstinctKind = FindingKind;

/** Whether the failure the instinct is about announces itself. */
export const INSTINCT_SIGNALS = FINDING_SIGNALS;

/** One of {@link INSTINCT_SIGNALS}. */
export type InstinctSignal = FindingSignal;

/**
 * continuous-learning-v2's domains: the five its `SKILL.md` names, and
 * the three its `agents/observer.md` calls global-friendly, measured
 * on 2026-09-18. Its `instinct-cli.py` defaults an absent domain to
 * `general`, which is not one of these and is not accepted here; an
 * importer meeting one has to map it.
 */
export const INSTINCT_DOMAINS = [
  'code-style',
  'testing',
  'git',
  'debugging',
  'workflow',
  'security',
  'general-best-practices',
] as const;

/** One of {@link INSTINCT_DOMAINS}. */
export type InstinctDomain = typeof INSTINCT_DOMAINS[number];

/** Which tier holds the record. */
export const INSTINCT_SCOPES = ['project', 'user'] as const;

/** One of {@link INSTINCT_SCOPES}. */
export type InstinctScope = typeof INSTINCT_SCOPES[number];

/** Where the record came from. */
export const INSTINCT_SOURCES = ['task-report', 'loop-observed', 'imported', 'demoted'] as const;

/** One of {@link INSTINCT_SOURCES}. */
export type InstinctSource = typeof INSTINCT_SOURCES[number];

/** Lowest `confidence` a record may carry, inclusive. */
export const CONFIDENCE_MIN = 0.3;

/** Highest `confidence` a record may carry, inclusive. */
export const CONFIDENCE_MAX = 0.9;

/** `usage_count` when the key is absent: the one observation that filed it. */
export const DEFAULT_USAGE_COUNT = 1;

/** The source whose records cannot be evidence-free. */
export const EVIDENCE_REQUIRED_SOURCE: InstinctSource = 'task-report';

/** The heading whose section is the action, and the hashed text. */
export const ACTION_HEADING = '## Action';

/** The heading whose section says why the action is needed. */
export const CAUSE_HEADING = '## Cause';

/**
 * The shape an `id` takes: lowercase alphanumerics in hyphen-separated
 * runs, with no leading, trailing or doubled hyphen. The same shape a
 * skill name has and deliberately not the same constant: the two
 * vocabularies are independent, and an instinct id that stopped
 * looking like a skill name would break nothing.
 */
export const INSTINCT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * An ISO 8601 instant: a date, a `T`, a time, and either `Z` or an
 * offset. A date alone is refused, because two records are ordered by
 * comparing these strings and a date sorts before every instant on the
 * same day.
 */
export const TIMESTAMP_PATTERN
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The fields a record cannot omit. */
export const REQUIRED_INSTINCT_FIELDS = [
  'id',
  'trigger',
  'kind',
  'domain',
  'confidence',
  'signal',
  'scope',
  'source',
  'created_at',
  'updated_at',
] as const;

/** The key order {@link writeInstinct} emits, matching the spec's example. */
export const INSTINCT_KEY_ORDER = [
  'id',
  'trigger',
  'kind',
  'domain',
  'confidence',
  'usage_count',
  'artifact',
  'signal',
  'scope',
  'project_id',
  'source',
  'evidence',
  'created_at',
  'updated_at',
] as const;

/** Why a record was refused. One code per RULE, as on a skill. */
export type InstinctIssueCode =
  /** The text opens with no readable `---` block. */
  | 'missing-frontmatter'
  /** A required field is absent, or present carrying nothing. */
  | 'missing-field'
  /** A field present with a YAML type the schema cannot read. */
  | 'wrong-type'
  /** An `id` that is not {@link INSTINCT_ID_PATTERN}-shaped. */
  | 'invalid-id'
  /** `kind` outside {@link INSTINCT_KINDS}. */
  | 'unknown-kind'
  /** `domain` outside {@link INSTINCT_DOMAINS}. */
  | 'unknown-domain'
  /** `signal` outside {@link INSTINCT_SIGNALS}. */
  | 'unknown-signal'
  /** `scope` outside {@link INSTINCT_SCOPES}. */
  | 'unknown-scope'
  /** `source` outside {@link INSTINCT_SOURCES}. */
  | 'unknown-source'
  /** `confidence` outside {@link CONFIDENCE_MIN}..{@link CONFIDENCE_MAX}. */
  | 'confidence-out-of-range'
  /** `usage_count` that is not a positive whole number. */
  | 'invalid-usage-count'
  /** `project_id` that is not {@link PROJECT_ID_PATTERN}-shaped. */
  | 'invalid-project-id'
  /** A timestamp that is not an ISO 8601 instant, or names no real time. */
  | 'invalid-timestamp'
  /** No evidence under {@link EVIDENCE_REQUIRED_SOURCE}. */
  | 'missing-evidence'
  /** {@link ACTION_HEADING} or {@link CAUSE_HEADING} absent or empty. */
  | 'missing-section'
  /** An `action_hash` written into the file; see the module note. */
  | 'stored-action-hash';

/** Every code, in the order this module first documents them. */
export const INSTINCT_ISSUE_CODES: readonly InstinctIssueCode[] = [
  'missing-frontmatter',
  'missing-field',
  'wrong-type',
  'invalid-id',
  'unknown-kind',
  'unknown-domain',
  'unknown-signal',
  'unknown-scope',
  'unknown-source',
  'confidence-out-of-range',
  'invalid-usage-count',
  'invalid-project-id',
  'invalid-timestamp',
  'missing-evidence',
  'missing-section',
  'stored-action-hash',
];

/** One thing the record said that the schema cannot accept. */
export interface InstinctIssue {
  /** Which rule was broken. */
  readonly code: InstinctIssueCode;
  /**
   * The field it concerns, indexed where a list entry is at fault
   * (`evidence[0]`). A body section is named by its heading.
   */
  readonly field: string;
  /** A sentence a checker prints unedited, with no leading field name. */
  readonly message: string;
}

/** One observation backing a record: a mapping of scalars, keys open. */
export type InstinctEvidence = Readonly<Record<string, string | number | boolean>>;

/**
 * A record that passed every check, with the underscored keys given
 * camelCase names, every optional value defaulted, and the action
 * hashed. Building one is the only way to get an {@link actionHash}
 * that is certainly the file's.
 */
export interface Instinct {
  /** `id`, a slug unique within its scope directory. */
  readonly id: string;
  /** `trigger`, the situation the action belongs to. */
  readonly trigger: string;
  /** `kind`, one of {@link INSTINCT_KINDS}. */
  readonly kind: InstinctKind;
  /** `domain`, one of {@link INSTINCT_DOMAINS}. */
  readonly domain: InstinctDomain;
  /** `confidence`, {@link CONFIDENCE_MIN} to {@link CONFIDENCE_MAX}. */
  readonly confidence: number;
  /** `usage_count`, {@link DEFAULT_USAGE_COUNT} when the key is absent. */
  readonly usageCount: number;
  /** `artifact`, the byte string a recurrence matches on, or null. */
  readonly artifact: string | null;
  /** `signal`, one of {@link INSTINCT_SIGNALS}. */
  readonly signal: InstinctSignal;
  /** `scope`, one of {@link INSTINCT_SCOPES}. */
  readonly scope: InstinctScope;
  /** `project_id`, or null when the record names no project. */
  readonly projectId: string | null;
  /** `source`, one of {@link INSTINCT_SOURCES}. */
  readonly source: InstinctSource;
  /** `evidence`, possibly empty away from {@link EVIDENCE_REQUIRED_SOURCE}. */
  readonly evidence: readonly InstinctEvidence[];
  /** `created_at`, an ISO 8601 instant. */
  readonly createdAt: string;
  /** `updated_at`, an ISO 8601 instant. */
  readonly updatedAt: string;
  /** The {@link ACTION_HEADING} section, trimmed. */
  readonly action: string;
  /** The {@link CAUSE_HEADING} section, trimmed. */
  readonly cause: string;
  /** {@link actionHash} of {@link Instinct.action}; never stored. */
  readonly actionHash: string;
}

/** What {@link parseInstinct} answers. */
export interface InstinctParseResult {
  /** Every rule broken, in field order. Empty on a clean record. */
  readonly issues: readonly InstinctIssue[];
  /** The record read, or null when `issues` is non-empty. */
  readonly instinct: Instinct | null;
}

/** One issue, spelled once so every check reads the same. */
function issue(code: InstinctIssueCode, field: string, message: string): InstinctIssue {
  return { code, field, message };
}

/**
 * The YAML type of `value`, for a `wrong-type` message. The same words
 * `./skill.ts` uses, so two schema refusals of the same shape read
 * alike; each module keeps its own copy because neither owns the other.
 */
function typeName(value: unknown): string {
  if (value === null) return 'an empty value';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  if (typeof value === 'boolean') return 'a boolean';
  if (typeof value === 'number') return 'a number';
  return `a ${typeof value}`;
}

/**
 * The issues for a required string field: absent or blank is
 * `missing-field`, another type is `wrong-type`.
 */
function requiredString(
  data: Readonly<Record<string, unknown>>,
  field: string,
): InstinctIssue[] {
  const value = data[field];
  if (value === undefined || value === null) {
    return [issue('missing-field', field, `${field} is required and is absent`)];
  }
  if (typeof value !== 'string') {
    return [issue('wrong-type', field, `${field} must be a string, not ${typeName(value)}`)];
  }
  if (value.trim() === '') {
    return [issue('missing-field', field, `${field} is required and is empty`)];
  }
  return [];
}

/** A required string drawn from `allowed`, refused under `code` when it is not. */
function requiredChoice(
  data: Readonly<Record<string, unknown>>,
  field: string,
  allowed: readonly string[],
  code: InstinctIssueCode,
): InstinctIssue[] {
  const issues = requiredString(data, field);
  if (issues.length > 0) return issues;

  const value = data[field] as string;
  return allowed.includes(value)
    ? []
    : [issue(code, field, `${field} "${value}" is not one of ${allowed.join(', ')}`)];
}

/** `id`: required, and slug-shaped. */
function checkId(data: Readonly<Record<string, unknown>>): InstinctIssue[] {
  const issues = requiredString(data, 'id');
  if (issues.length > 0) return issues;

  const id = data['id'] as string;
  return INSTINCT_ID_PATTERN.test(id)
    ? []
    : [issue('invalid-id', 'id', `id "${id}" is not lowercase words joined by single hyphens`)];
}

/** `confidence`: required, a number, and inside the range. */
function checkConfidence(data: Readonly<Record<string, unknown>>): InstinctIssue[] {
  const value = data['confidence'];
  if (value === undefined || value === null) {
    return [issue('missing-field', 'confidence', 'confidence is required and is absent')];
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return [issue(
      'wrong-type',
      'confidence',
      `confidence must be a number, not ${typeName(value)}`,
    )];
  }
  return value >= CONFIDENCE_MIN && value <= CONFIDENCE_MAX
    ? []
    : [issue(
      'confidence-out-of-range',
      'confidence',
      `confidence ${value} is outside ${CONFIDENCE_MIN} to ${CONFIDENCE_MAX}`,
    )];
}

/** `usage_count`: optional, and a whole number of at least one. */
function checkUsageCount(data: Readonly<Record<string, unknown>>): InstinctIssue[] {
  const value = data['usage_count'];
  if (value === undefined) return [];
  if (typeof value !== 'number') {
    return [issue(
      'wrong-type',
      'usage_count',
      `usage_count must be a number, not ${typeName(value)}`,
    )];
  }
  return Number.isInteger(value) && value >= DEFAULT_USAGE_COUNT
    ? []
    : [issue(
      'invalid-usage-count',
      'usage_count',
      `usage_count ${value} is not a whole number of at least ${DEFAULT_USAGE_COUNT}`,
    )];
}

/** `artifact`: optional, a string, and allowed to be empty. */
function checkArtifact(data: Readonly<Record<string, unknown>>): InstinctIssue[] {
  const value = data['artifact'];
  if (value === undefined || typeof value === 'string') return [];
  return [issue('wrong-type', 'artifact', `artifact must be a string, not ${typeName(value)}`)];
}

/** `project_id`: optional, and the hash {@link projectIdFromRemote} makes. */
function checkProjectId(data: Readonly<Record<string, unknown>>): InstinctIssue[] {
  const value = data['project_id'];
  if (value === undefined) return [];
  if (typeof value !== 'string') {
    return [issue(
      'wrong-type',
      'project_id',
      `project_id must be a string, not ${typeName(value)}`,
    )];
  }
  return PROJECT_ID_PATTERN.test(value)
    ? []
    : [issue(
      'invalid-project-id',
      'project_id',
      `project_id "${value}" is not ${PROJECT_ID_LENGTH} lowercase hex characters`,
    )];
}

/** A required timestamp: an ISO 8601 instant naming a real time. */
function checkTimestamp(
  data: Readonly<Record<string, unknown>>,
  field: string,
): InstinctIssue[] {
  const issues = requiredString(data, field);
  if (issues.length > 0) return issues;

  const value = data[field] as string;
  return TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
    ? []
    : [issue(
      'invalid-timestamp',
      field,
      `${field} "${value}" is not an ISO 8601 instant such as 2026-09-11T10:00:00Z`,
    )];
}

/** Whether `value` is a YAML scalar an evidence entry may carry. */
function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** One evidence entry: a mapping with at least one key, all scalar. */
function checkEvidenceEntry(entry: unknown, index: number): InstinctIssue[] {
  const field = `evidence[${index}]`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return [issue('wrong-type', field, `evidence entries must be mappings, and this one is ${typeName(entry)}`)];
  }

  const entries = Object.entries(entry as Record<string, unknown>);
  if (entries.length === 0) {
    return [issue('wrong-type', field, 'evidence entries must say something, and this one is empty')];
  }

  return entries.flatMap(([key, value]) => (isScalar(value)
    ? []
    : [issue(
      'wrong-type',
      `${field}.${key}`,
      `evidence values must be text, numbers or booleans, and this one is ${typeName(value)}`,
    )]));
}

/**
 * `evidence`: a list of entries, required non-empty exactly when
 * `source` is {@link EVIDENCE_REQUIRED_SOURCE}.
 */
function checkEvidence(data: Readonly<Record<string, unknown>>): InstinctIssue[] {
  const value = data['evidence'];
  const owed = data['source'] === EVIDENCE_REQUIRED_SOURCE;

  if (value === undefined || value === null) return owed
    ? [missingEvidence('is absent')]
    : [];

  if (!Array.isArray(value)) {
    return [issue('wrong-type', 'evidence', `evidence must be a list, not ${typeName(value)}`)];
  }
  if (value.length === 0) return owed
    ? [missingEvidence('is an empty list')]
    : [];

  return value.flatMap((entry, index) => checkEvidenceEntry(entry, index));
}

/** The one evidence refusal, spelled once for both ways of owing it. */
function missingEvidence(state: string): InstinctIssue {
  return issue(
    'missing-evidence',
    'evidence',
    `a ${EVIDENCE_REQUIRED_SOURCE} record must name what it was learned from, and evidence ${state}`,
  );
}

/** `action_hash`: never written down; see the module note. */
function checkStoredHash(data: Readonly<Record<string, unknown>>): InstinctIssue[] {
  if (!Object.hasOwn(data, 'action_hash')) return [];
  return [issue(
    'stored-action-hash',
    'action_hash',
    'action_hash is computed from the Action section at read time and is never stored, '
    + 'because a hand edit would leave a stored one stale',
  )];
}

/**
 * Every rule `data` breaks, in the order {@link INSTINCT_KEY_ORDER}
 * names the fields. The body is not read here; {@link parseInstinct}
 * adds its issues. An empty list means the frontmatter is a record.
 */
export function checkInstinctFrontmatter(
  data: Readonly<Record<string, unknown>>,
): readonly InstinctIssue[] {
  return [
    ...checkId(data),
    ...requiredString(data, 'trigger'),
    ...requiredChoice(data, 'kind', INSTINCT_KINDS, 'unknown-kind'),
    ...requiredChoice(data, 'domain', INSTINCT_DOMAINS, 'unknown-domain'),
    ...checkConfidence(data),
    ...checkUsageCount(data),
    ...checkArtifact(data),
    ...requiredChoice(data, 'signal', INSTINCT_SIGNALS, 'unknown-signal'),
    ...requiredChoice(data, 'scope', INSTINCT_SCOPES, 'unknown-scope'),
    ...checkProjectId(data),
    ...requiredChoice(data, 'source', INSTINCT_SOURCES, 'unknown-source'),
    ...checkEvidence(data),
    ...checkTimestamp(data, 'created_at'),
    ...checkTimestamp(data, 'updated_at'),
    ...checkStoredHash(data),
  ];
}

/** Whether `line` opens or closes a fenced block. */
function isFence(line: string): boolean {
  return /^\s*(?:```|~~~)/.test(line);
}

/**
 * The text under the `## ` heading `heading` in `body`, trimmed, or
 * null when no such heading is there. The section runs to the next
 * `## ` heading or to the end, and lines inside a fenced block are
 * neither headings nor terminators — a shell block whose comment
 * starts with `## ` would otherwise cut the action in half.
 */
export function sectionText(body: string, heading: string): string | null {
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''));
  const collected: string[] = [];
  let fenced = false;
  let inside = false;

  for (const line of lines) {
    if (isFence(line)) fenced = !fenced;
    else if (!fenced && /^##\s/.test(line)) {
      if (inside) break;
      inside = line.trim() === heading;
      continue;
    }
    if (inside) collected.push(line);
  }

  return inside
    ? collected.join('\n').trim()
    : null;
}

/** One body section: present and non-empty, or a `missing-section`. */
function checkSection(body: string, heading: string): InstinctIssue[] {
  const text = sectionText(body, heading);
  if (text === null) {
    return [issue('missing-section', heading, `the body carries no ${heading} section`)];
  }
  return text === ''
    ? [issue('missing-section', heading, `the ${heading} section is empty`)]
    : [];
}

/** Every rule `body` breaks: its two sections, in the order they are written. */
export function checkInstinctBody(body: string): readonly InstinctIssue[] {
  return [...checkSection(body, ACTION_HEADING), ...checkSection(body, CAUSE_HEADING)];
}

/**
 * `text` read as a record, with every issue beside it. `instinct` is
 * null whenever `issues` is non-empty, so a caller never has to ask
 * which half of the file survived.
 */
export function parseInstinct(text: string): InstinctParseResult {
  const document = readFrontmatterDocument(text);
  if (document === null) {
    return {
      issues: [issue(
        'missing-frontmatter',
        'frontmatter',
        'the file opens with no --- block holding a YAML mapping',
      )],
      instinct: null,
    };
  }

  const issues = [
    ...checkInstinctFrontmatter(document.data),
    ...checkInstinctBody(document.body),
  ];

  return issues.length > 0
    ? { issues, instinct: null }
    : { issues, instinct: buildInstinct(document.data, document.body) };
}

/** The record `data` and `body` describe, called only once both check clean. */
function buildInstinct(
  data: Readonly<Record<string, unknown>>,
  body: string,
): Instinct {
  const action = sectionText(body, ACTION_HEADING) ?? '';
  const artifact = typeof data['artifact'] === 'string' && data['artifact'].trim() !== ''
    ? data['artifact']
    : null;

  return {
    id: data['id'] as string,
    trigger: data['trigger'] as string,
    kind: data['kind'] as InstinctKind,
    domain: data['domain'] as InstinctDomain,
    confidence: data['confidence'] as number,
    usageCount: typeof data['usage_count'] === 'number'
      ? data['usage_count']
      : DEFAULT_USAGE_COUNT,
    artifact,
    signal: data['signal'] as InstinctSignal,
    scope: data['scope'] as InstinctScope,
    projectId: typeof data['project_id'] === 'string'
      ? data['project_id']
      : null,
    source: data['source'] as InstinctSource,
    evidence: Array.isArray(data['evidence'])
      ? (data['evidence'] as InstinctEvidence[])
      : [],
    createdAt: data['created_at'] as string,
    updatedAt: data['updated_at'] as string,
    action,
    cause: sectionText(body, CAUSE_HEADING) ?? '',
    actionHash: actionHash(action),
  };
}

/**
 * `instinct` as the frontmatter mapping a file carries: the keys of
 * {@link INSTINCT_KEY_ORDER} in that order, with `artifact`,
 * `project_id` and an empty `evidence` left out rather than written
 * blank, and no `action_hash`.
 */
export function instinctFrontmatter(instinct: Instinct): Record<string, unknown> {
  const written: Record<string, unknown> = {
    id: instinct.id,
    trigger: instinct.trigger,
    kind: instinct.kind,
    domain: instinct.domain,
    confidence: instinct.confidence,
    usage_count: instinct.usageCount,
    signal: instinct.signal,
    scope: instinct.scope,
    source: instinct.source,
    created_at: instinct.createdAt,
    updated_at: instinct.updatedAt,
  };

  if (instinct.artifact !== null) written['artifact'] = instinct.artifact;
  if (instinct.projectId !== null) written['project_id'] = instinct.projectId;
  if (instinct.evidence.length > 0) written['evidence'] = instinct.evidence;

  return Object.fromEntries(
    INSTINCT_KEY_ORDER.filter((key) => Object.hasOwn(written, key))
      .map((key) => [key, written[key]]),
  );
}

/**
 * `instinct` as a file: its frontmatter, then {@link ACTION_HEADING}
 * and {@link CAUSE_HEADING} with a blank line between the sections and
 * a trailing newline. Reading the result back with
 * {@link parseInstinct} answers the same record, which is what
 * `instinct.test.ts` measures; the file's BYTES are not promised to
 * survive a read and a write, because the frontmatter is re-rendered
 * by `Bun.YAML.stringify`. A caller changing one key of somebody
 * else's file wants `updateFrontmatter` in `./frontmatter.js` instead.
 */
export function writeInstinct(instinct: Instinct, newline = '\n'): string {
  const block = renderFrontmatter(instinctFrontmatter(instinct), newline);

  return [
    '---',
    block,
    '---',
    '',
    ACTION_HEADING,
    instinct.action,
    '',
    CAUSE_HEADING,
    instinct.cause,
    '',
  ].join(newline);
}

/**
 * `instinct` as the Learning port reads it: the merge fields and
 * nothing else. `status` is `active` because a record is only flagged
 * by a merge that found a rival action, which is the port's decision
 * and never the file's; `kind`, `domain`, `scope`, `project_id`,
 * `source`, `evidence` and the cause stay behind in the file, which
 * remains the record of where the instinct came from.
 *
 * `artifact` is omitted rather than written empty when the record
 * names none, so a payload never claims a recurrence key of `''`.
 */
export function toLearningRecord(instinct: Instinct): InstinctRecord {
  const record: InstinctRecord = {
    id: instinct.id,
    trigger: instinct.trigger,
    action: instinct.action,
    action_hash: instinct.actionHash,
    confidence: instinct.confidence,
    usage_count: instinct.usageCount,
    signal: instinct.signal,
    status: 'active',
    created_at: instinct.createdAt,
    updated_at: instinct.updatedAt,
  };

  return instinct.artifact === null
    ? record
    : { ...record, artifact: instinct.artifact };
}
