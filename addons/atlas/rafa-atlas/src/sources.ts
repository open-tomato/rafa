/**
 * The table sources the registry serves so far, one spec per replica
 * bucket: `local.tasks` over `task_facts`, `local.daily` over
 * `daily_rollup`, `local.plans` over `plan_facts`, `local.bugs` over
 * `bug_facts`, `local.findings` over `finding_facts`, `local.ci` over
 * `ci_facts`, `local.commits` over `commit_facts`, `local.marks` over
 * `stretch_marks`, `local.issues` over `issue_facts`, `local.board`
 * over `board_snapshot` and `local.modules` over `module_facts`. The build stamps `local.changes` too, and no spec here
 * defines it yet. Each spec is the descriptor without its build stamps,
 * which `defineTableSource` reads from the replica's `atlas_sources` rows
 * at each call.
 *
 * Only the descriptor's field keys reach the engine's SQL, so a column
 * left out here cannot be read: the `origin_store` and `origin_seq` of
 * each bucket are the dedupe key of the build and are not exposed, nor is
 * `finding_facts.tracker_ref`, the stored issue reference.
 */
import type { Aggregate, FieldDescriptor, FieldType } from '@open-tomato/atlas-data/contract';
import type { TableSourceSpec } from '@open-tomato/atlas-data/source';

import { DAILY_SOURCE } from './build/daily.js';
import { PLANS_SOURCE } from './build/derive.js';
import { BOARD_SOURCE, ISSUES_SOURCE } from './ingest/board.js';
import { TASKS_SOURCE } from './ingest/effort.js';
import { BUGS_SOURCE, CI_SOURCE, FINDINGS_SOURCE } from './ingest/facts.js';
import { COMMITS_SOURCE, MARKS_SOURCE } from './ingest/git.js';
import { MODULES_SOURCE } from './ingest/modules.js';

/** The aggregates a numeric measure takes. */
const MEASURE_AGGREGATES: readonly Aggregate[] = ['sum', 'mean', 'min', 'max', 'p50', 'p90', 'p99'];

/** The aggregates a group key or an id takes. */
const COUNT_AGGREGATES: readonly Aggregate[] = ['count', 'count_distinct'];

/** A text field to group and filter by. */
function dimension(key: string, label: string, description?: string): FieldDescriptor {
  return {
    key,
    label,
    type: 'string',
    role: 'dimension',
    ...(description === undefined
      ? {}
      : { description }),
    aggregates: COUNT_AGGREGATES,
    filterable: true,
    groupable: true,
  };
}

/** A numeric field to aggregate and filter on. */
function measure(key: string, label: string, type: FieldType, unit: string): FieldDescriptor {
  return { key, label, type, role: 'measure', unit, aggregates: MEASURE_AGGREGATES, filterable: true, groupable: false };
}

/** A time field: the axis a window bounds and a grain buckets. */
function time(key: string, label: string, type: FieldType): FieldDescriptor {
  return { key, label, type, role: 'time', aggregates: ['count', 'min', 'max'], filterable: true, groupable: true };
}

/** The five kind suffixes of the `daily_rollup` columns, with their labels. */
const DAILY_KINDS: readonly (readonly [string, string])[] = [
  ['task', 'task'],
  ['plan', 'plan generation'],
  ['wrap_up', 'wrap-up'],
  ['ci_repair', 'ci-repair'],
  ['other', 'other'],
];

/** `local.tasks`: one row per Claude Code session, from `task_facts`. */
export const TASKS_SPEC: TableSourceSpec = {
  descriptor: {
    id: TASKS_SOURCE,
    source: 'local',
    channel: 'tasks',
    title: 'Sessions',
    description: 'One row per Claude Code session of the loop, read from the effort store.',
    timeField: 'started_at',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      { key: 'session_id', label: 'Session', type: 'string', role: 'id', aggregates: COUNT_AGGREGATES, filterable: true, groupable: false },
      dimension('kind', 'Kind', 'task, plan-generation, wrap-up, ci-repair, search or other'),
      dimension('plan_stub', 'Plan'),
      dimension('task_line', 'Task line'),
      dimension('branch_type', 'Branch type', 'feat on every loop branch; split by change level instead'),
      dimension('work_type', 'Work type', 'feature, fix or chore, read from the session\'s highest change level (a proxy)'),
      dimension('agent', 'Agent'),
      dimension('model', 'Model', 'the model that answered most of the session\'s turns'),
      dimension('effort', 'Effort'),
      dimension('status', 'Status', 'the task report\'s status: done or blocked'),
      measure('budget_usd', 'Budget', 'number', 'USD'),
      time('started_at', 'Started', 'datetime'),
      time('ended_at', 'Ended', 'datetime'),
      { ...time('day', 'Day', 'date'), role: 'dimension' },
      measure('minutes', 'Minutes', 'number', 'min'),
      measure('input_tokens', 'Input tokens', 'integer', 'tokens'),
      measure('output_tokens', 'Output tokens', 'integer', 'tokens'),
      measure('cache_read_tokens', 'Cache read tokens', 'integer', 'tokens'),
      measure('cache_creation_tokens', 'Cache creation tokens', 'integer', 'tokens'),
      measure('tokens', 'Tokens', 'integer', 'tokens'),
      measure('attempt', 'Attempt', 'integer', 'attempts'),
      measure('findings', 'Findings', 'integer', 'findings'),
      measure('bugs', 'Bugs', 'integer', 'bugs'),
      measure('blockers', 'Blockers', 'integer', 'blockers'),
      measure('skills_used', 'Skills used', 'integer', 'skills'),
    ],
  },
  table: 'task_facts',
};

/** `local.daily`: one row per calendar day, from `daily_rollup`. */
export const DAILY_SPEC: TableSourceSpec = {
  descriptor: {
    id: DAILY_SOURCE,
    source: 'local',
    channel: 'daily',
    title: 'Days',
    description: 'One row per calendar day a session started or a preflight ran on: minutes and tokens by session kind.',
    timeField: 'day',
    grains: ['day', 'week', 'month', 'all'],
    fields: [
      time('day', 'Day', 'date'),
      ...DAILY_KINDS.map(([suffix, label]) => measure(`minutes_${suffix}`, `Minutes, ${label}`, 'number', 'min')),
      ...DAILY_KINDS.map(([suffix, label]) => measure(`tokens_${suffix}`, `Tokens, ${label}`, 'integer', 'tokens')),
      measure('tokens_total', 'Tokens', 'integer', 'tokens'),
      measure('sessions', 'Sessions', 'integer', 'sessions'),
      measure('task_sessions', 'Task sessions', 'integer', 'sessions'),
      measure('tasks_done', 'Tasks done', 'integer', 'tasks'),
      measure('tasks_blocked', 'Tasks blocked', 'integer', 'tasks'),
      measure('findings', 'Findings', 'integer', 'findings'),
      measure('bugs', 'Bugs', 'integer', 'bugs'),
      measure('changes', 'Changes', 'integer', 'changes'),
      measure('commits', 'Commits', 'integer', 'commits'),
      measure('prs_merged', 'Pull requests merged', 'integer', 'pull requests'),
      measure('preflight_runs', 'Preflight runs', 'integer', 'runs'),
      measure('preflight_halts', 'Preflight halts', 'integer', 'runs'),
    ],
  },
  table: 'daily_rollup',
};

/** `local.plans`: one row per plan the plan folder holds or a session or CI reading names, from `plan_facts`. */
export const PLANS_SPEC: TableSourceSpec = {
  descriptor: {
    id: PLANS_SOURCE,
    source: 'local',
    channel: 'plans',
    title: 'Plans',
    description: 'One row per plan: its task counts from the plan file, and its sessions and CI readings from the effort store.',
    timeField: 'first_at',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      dimension('plan_stub', 'Plan'),
      dimension('plan_source', 'Plan source', 'where the plan was read: tracker, plan or missing'),
      dimension('epic_slug', 'Epic'),
      dimension('ci_last_verdict', 'Last CI verdict'),
      { ...measure('issue_number', 'Issue', 'integer', 'issue'), role: 'id', aggregates: COUNT_AGGREGATES },
      { ...measure('pr_number', 'Pull request', 'integer', 'pull request'), role: 'id', aggregates: COUNT_AGGREGATES },
      measure('tasks_planned', 'Tasks planned', 'integer', 'tasks'),
      measure('tasks_done', 'Tasks done', 'integer', 'tasks'),
      measure('tasks_blocked', 'Tasks blocked', 'integer', 'tasks'),
      measure('sessions', 'Sessions', 'integer', 'sessions'),
      measure('task_sessions', 'Task sessions', 'integer', 'sessions'),
      measure('reports_done', 'Reports done', 'integer', 'reports'),
      measure('reports_blocked', 'Reports blocked', 'integer', 'reports'),
      measure('repeat_sessions', 'Repeat sessions', 'integer', 'sessions'),
      measure('ci_repair_sessions', 'CI-repair sessions', 'integer', 'sessions'),
      time('first_at', 'First session', 'datetime'),
      time('last_at', 'Last session', 'datetime'),
      time('merged_at', 'Merged', 'datetime'),
      measure('minutes', 'Minutes', 'number', 'min'),
      measure('tokens', 'Tokens', 'integer', 'tokens'),
      measure('ci_red_readings', 'Red CI readings', 'integer', 'readings'),
      measure('completed', 'Completed', 'integer', 'plans'),
    ],
  },
  table: 'plan_facts',
};

/** An id field: counted, filtered, never grouped. */
function id(key: string, label: string): FieldDescriptor {
  return { key, label, type: 'string', role: 'id', aggregates: COUNT_AGGREGATES, filterable: true, groupable: false };
}

/** An issue or pull request number: an id that is an integer. */
function numberId(key: string, label: string, unit: string): FieldDescriptor {
  return { ...measure(key, label, 'integer', unit), role: 'id', aggregates: COUNT_AGGREGATES };
}

/** The fields every report-row bucket opens with: its id, the session and the task it came from. */
function reportFields(): FieldDescriptor[] {
  return [
    id('id', 'Id'),
    id('session_id', 'Session'),
    dimension('plan_stub', 'Plan'),
    dimension('task_line', 'Task line'),
  ];
}

/** `local.bugs`: one row per out-of-scope bug a task reported, and one per route the loop gave one, from `bug_facts`. */
export const BUGS_SPEC: TableSourceSpec = {
  descriptor: {
    id: BUGS_SOURCE,
    source: 'local',
    channel: 'bugs',
    title: 'Bugs',
    description: 'One row per out-of-scope bug a task reported, and one per route the loop gave a bug, read from the effort store.',
    timeField: 'day',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      ...reportFields(),
      dimension('source', 'Source', 'out_of_scope: the bug as reported; routed: the route the loop gave it, the same entry again'),
      dimension('what', 'What'),
      dimension('artifact', 'Artifact'),
      dimension('module', 'Module', 'the longest module path the artifact, then the what, names; NULL when neither names one'),
      { ...measure('security', 'Security', 'integer', 'bugs'), description: '1 for a bug reported as a security issue; out-of-scope bugs only' },
      dimension('scope', 'Scope', 'out-of-scope bugs only'),
      dimension('kind', 'Kind', 'bug, own-fallout, own-gap, convention, docs or machine; routed bugs only'),
      dimension('route', 'Route', 'filed, private, machine, inherited, repair, follow-up, pr-body or docs; routed bugs only'),
      dimension('outcome', 'Outcome', 'the outcome of the task that reported the bug: done or blocked'),
      numberId('issue_number', 'Issue', 'issue'),
      time('day', 'Day', 'date'),
    ],
  },
  table: 'bug_facts',
};

/** `local.findings`: one row per finding with a kind and one per blocker a task reported, from `finding_facts`. */
export const FINDINGS_SPEC: TableSourceSpec = {
  descriptor: {
    id: FINDINGS_SOURCE,
    source: 'local',
    channel: 'findings',
    title: 'Findings',
    description: 'One row per finding with a kind and one per blocker a task reported, read from the effort store.',
    timeField: 'day',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      ...reportFields(),
      dimension('source', 'Source', 'finding or blocker'),
      dimension('kind', 'Kind', 'gotcha, pattern, location or skill-suggestion; findings only'),
      dimension('signal', 'Signal', 'loud or silent; findings only'),
      dimension('trigger', 'Trigger'),
      dimension('what', 'What'),
      dimension('artifact', 'Artifact'),
      dimension('module', 'Module', 'the longest module path the artifact, then the what, names; NULL when neither names one'),
      dimension('outcome', 'Outcome', 'the outcome of the task that reported the row: done or blocked'),
      time('day', 'Day', 'date'),
    ],
  },
  table: 'finding_facts',
};

/** `local.ci`: one row per CI reading of a plan's head, from `ci_facts`. */
export const CI_SPEC: TableSourceSpec = {
  descriptor: {
    id: CI_SOURCE,
    source: 'local',
    channel: 'ci',
    title: 'CI readings',
    description: 'One row per CI reading of a plan\'s head commit, read from the effort store.',
    timeField: 'read_at',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      dimension('plan_stub', 'Plan'),
      numberId('pr', 'Pull request', 'pull request'),
      id('head_sha', 'Head commit'),
      dimension('verdict', 'Verdict', 'green, red or none (no check ran)'),
      { ...dimension('failing_json', 'Failing checks', 'the names of the checks that failed, as a JSON array'), type: 'json' },
      measure('failing_count', 'Failing checks', 'integer', 'checks'),
      time('read_at', 'Read', 'datetime'),
      { ...time('day', 'Day', 'date'), role: 'dimension' },
      { ...measure('flipped', 'Flipped', 'integer', 'readings'), description: '1 on every reading of a head read red and, at a later reading, green' },
    ],
  },
  table: 'ci_facts',
};

/** `local.commits`: one row per first-parent commit of the base branch, from `commit_facts`. */
export const COMMITS_SPEC: TableSourceSpec = {
  descriptor: {
    id: COMMITS_SOURCE,
    source: 'local',
    channel: 'commits',
    title: 'Commits',
    description: 'One row per first-parent commit of the branch origin/HEAD names (HEAD when it names none), read from git in the project root.',
    timeField: 'committed_at',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      id('sha', 'Commit'),
      time('committed_at', 'Committed', 'datetime'),
      { ...time('day', 'Day', 'date'), role: 'dimension' },
      dimension('subject', 'Subject'),
      dimension('type', 'Type', 'the conventional prefix: feat, fix, chore, docs and the rest; NULL for a subject with none'),
      dimension('plan_stub', 'Plan', 'the plan whose pull request the commit landed, through plan_facts.pr_number'),
      numberId('pr_number', 'Pull request', 'pull request'),
      measure('files_changed', 'Files changed', 'integer', 'files'),
      measure('insertions', 'Insertions', 'integer', 'lines'),
      measure('deletions', 'Deletions', 'integer', 'lines'),
      { ...measure('is_merge', 'Merge', 'integer', 'commits'), description: '1 for a commit with two parents or more' },
      dimension('release_tag', 'Release tag', 'the v* tag on the commit, an annotated tag peeled; NULL for an untagged commit'),
    ],
  },
  table: 'commit_facts',
};

/** `local.marks`: one row per stretch end the base branch's merge subjects name, from `stretch_marks`. */
export const MARKS_SPEC: TableSourceSpec = {
  descriptor: {
    id: MARKS_SOURCE,
    source: 'local',
    channel: 'marks',
    title: 'Stretch marks',
    description: 'One row per stretch end, read from the merge subjects Stretch <n> (#<pr>) and Merge pull request #<pr> from <owner>/stretch/<n>.',
    timeField: 'ended_at',
    grains: ['day', 'week', 'month', 'all'],
    fields: [
      numberId('number', 'Stretch', 'stretch'),
      { ...measure('part', 'Part', 'integer', 'part'), role: 'dimension', aggregates: COUNT_AGGREGATES, groupable: true, description: '1, then 2 for a stretch number merged again' },
      dimension('lane', 'Lane', 'M for a three-digit stretch number, A for one or two digits'),
      time('ended_at', 'Ended', 'datetime'),
      numberId('pr_number', 'Pull request', 'pull request'),
    ],
  },
  table: 'stretch_marks',
};

/** A 0-or-1 column, summed to count the rows it holds for. */
function flagMeasure(key: string, label: string, unit: string, description: string): FieldDescriptor {
  return { ...measure(key, label, 'integer', unit), description };
}

/** `local.issues`: one row per issue the board cache holds, from `issue_facts`. */
export const ISSUES_SPEC: TableSourceSpec = {
  descriptor: {
    id: ISSUES_SOURCE,
    source: 'local',
    channel: 'issues',
    title: 'Issues',
    description: 'One row per issue of the board cache rafa keeps, read offline as of its watermark; created and closed times come from the GitHub source.',
    timeField: 'created_at',
    grains: ['day', 'week', 'month', 'all'],
    fields: [
      numberId('number', 'Issue', 'issue'),
      dimension('title', 'Title'),
      dimension('state', 'State', 'OPEN or CLOSED'),
      dimension('state_reason', 'Close reason', 'GitHub\'s value: COMPLETED, NOT_PLANNED or DUPLICATE; NULL while open'),
      { ...dimension('labels_json', 'Labels', 'the label names, as a JSON array'), type: 'json' },
      flagMeasure('is_bug', 'Bug', 'issues', '1 for an issue labelled type:bug or bug'),
      flagMeasure('is_epic', 'Epic', 'issues', '1 for an issue labelled type:epic'),
      dimension('epic_slug', 'Epic', 'the slug of the first epic: label'),
      numberId('parent_number', 'Parent epic', 'issue'),
      time('created_at', 'Created', 'datetime'),
      time('closed_at', 'Closed', 'datetime'),
      dimension('stage', 'Stage', 'the board Stage its state and labels read; NULL for an epic'),
      dimension('stage_basis', 'Stage basis', 'labels offline; labels+prs when the GitHub source read the closing pull requests'),
      dimension('horizon', 'Horizon', 'now, next or later for an epic; NULL for any other issue'),
      dimension('plan_stub', 'Plan', 'the plan its body names in a ## Plan block or a follow-ups comment; NULL for one filed by hand'),
      dimension('module', 'Module', 'the module:<x> label\'s value'),
      dimension('priority', 'Priority', 'the priority:<x> label\'s value'),
    ],
  },
  table: 'issue_facts',
};

/** `local.board`: one row per day and board stage a build counted, from `board_snapshot`. */
export const BOARD_SPEC: TableSourceSpec = {
  descriptor: {
    id: BOARD_SOURCE,
    source: 'local',
    channel: 'board',
    title: 'Board snapshots',
    description: 'One row per day and board stage: the issues in the stage on the day a build ran, carried from build to build.',
    timeField: 'day',
    grains: ['day', 'week', 'month', 'all'],
    fields: [
      time('day', 'Day', 'date'),
      time('taken_at', 'Taken', 'datetime'),
      dimension('stage', 'Stage'),
      measure('count', 'Issues', 'integer', 'issues'),
    ],
  },
  table: 'board_snapshot',
};

/** `local.modules`: one row per module of the project's tree, from `module_facts`. */
export const MODULES_SPEC: TableSourceSpec = {
  descriptor: {
    id: MODULES_SOURCE,
    source: 'local',
    channel: 'modules',
    title: 'Modules',
    description: 'One row per module folder of the project tree: its size, its @open-tomato imports, and the bugs, findings and changes the effort store attributes to it.',
    timeField: null,
    grains: ['all'],
    fields: [
      dimension('path', 'Module', 'the module folder, relative to the project root'),
      dimension('package', 'Package', 'the name of the module\'s own package.json; NULL for a folder with none'),
      measure('files', 'Files', 'integer', 'files'),
      measure('loc', 'Lines of code', 'integer', 'lines'),
      measure('test_files', 'Test files', 'integer', 'files'),
      measure('test_loc', 'Test lines of code', 'integer', 'lines'),
      { ...measure('fan_in', 'Fan-in', 'integer', 'modules'), description: 'the other modules importing its package' },
      { ...measure('fan_out', 'Fan-out', 'integer', 'modules'), description: 'the other modules whose package it imports' },
      { ...dimension('imports_json', 'Imports', 'the @open-tomato packages it imports, its own left out, as a JSON array'), type: 'json' },
      {
        ...measure('upward_edges', 'Upward edges', 'integer', 'edges'),
        description: 'the upward imports docs/survey/cut-table.json lists from its files; NULL with no cut table or for a module it does not cover',
      },
      measure('bugs', 'Bugs', 'integer', 'bugs'),
      measure('findings', 'Findings', 'integer', 'findings'),
      measure('changes', 'Changes', 'integer', 'changes'),
    ],
  },
  table: 'module_facts',
};

/** Every source spec the registry defines, in the order `/sources` lists them. */
export const SOURCE_SPECS: readonly TableSourceSpec[] = [
  TASKS_SPEC, DAILY_SPEC, PLANS_SPEC, BUGS_SPEC, FINDINGS_SPEC, CI_SPEC, COMMITS_SPEC, MARKS_SPEC, ISSUES_SPEC, BOARD_SPEC,
  MODULES_SPEC,
];
