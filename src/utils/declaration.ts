/**
 * Reading a task's routing declaration off the end of its own line, read
 * at its old path.
 *
 * Re-export kept for importers outside core; the third step of core's
 * move into its package (#1090) removes it.
 *
 * The code and its module note live in `src/core/plan/declaration.ts`,
 * behind the barrel `src/core/plan/index.ts`. This file re-exports
 * that barrel's names under the same names, so an importer that names
 * this path reads the same bindings.
 */
export type {
  AgentEffortLookup,
  DeclarationEntry,
  DeclarationIssue,
  DeclarationIssueReason,
  DeclarationKey,
  DocsRole,
  EffortLevel,
  GranularKey,
  ParsedTask,
  ResolvedFlags,
  TaskDeclaration,
  TestScope,
} from '../core/plan/index.js';

export {
  AGENT_OWNED_KEYS,
  BUDGET_FLAG,
  DECLARATION_KEYS,
  DEFAULT_TEST_SCOPE,
  DOCS_ROLES,
  EFFORT_LEVELS,
  GRANULAR_KEYS,
  isAgentName,
  isDocsRole,
  isEffortLevel,
  isModelValue,
  isTestScope,
  MODEL_ALIASES,
  parseBudgetUsd,
  parseSkillList,
  parseTaskDeclaration,
  parseToolList,
  readDocsRole,
  readTestScope,
  resolveDeclarationFlags,
  stripTaskDeclaration,
  TEST_SCOPES,
} from '../core/plan/index.js';
