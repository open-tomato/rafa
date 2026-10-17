/**
 * The release ladder, read: which of the five levels three `release`
 * settings put a project at, which workflow files each level needs,
 * and which of a level's preconditions a set of readings shows to be
 * missing.
 *
 * ```text
 * ladderLevel(settings)                → level, name, misfit
 * ladderPreconditions(level, readings) → the missing items, in order
 * ```
 *
 * The module is pure. It reads no file and runs no command: a caller
 * (the doctor's ladder row) stats the workflow files, reads the publish
 * workflow's text, parses the version file's manifest and checks for
 * `.github/dependabot.yml`, and hands the answers in as
 * {@link LadderReadings}. So every rule here is drivable from a literal.
 *
 * ## The levels and the keys they are read off
 *
 * | Level | `release.settle` | `release.tag` | `release.publish` |
 * |---|---|---|---|
 * | 0 Manual | any | `manual` | `manual` |
 * | 1 Settle tags | `push` | `settle` | `manual` |
 * | 2 CI publishes | `push` | `manual` | `ci` |
 * | 3 Release PR | `pr` | `settle` | `ci` |
 * | 4 Continuous | `push` | `settle` | `ci` |
 *
 * A level is chosen by the keys that make it ({@link LADDER_ROWS}'s
 * `decides`): levels 3 and 4 by all three, level 1 by `settle: push`
 * with `tag: settle`, level 2 by `publish: ci` alone, and level 0 is the
 * floor every combination stands on. The highest level whose deciding
 * keys all hold is the reading. Its full spelling is then compared key
 * by key with the settings, and a key that differs is the
 * {@link LadderLevelReading.misfit}: `settle: pr` with `tag: manual` and
 * `publish: ci` reads as level 2 with `release.settle` named, and
 * `settle: pr` with `tag: settle` and `publish: manual` reads as level 0
 * with `release.tag` named, since a `pr` delivery never tags
 * (`./settle-tag.ts`). Over the eight combinations at most one key
 * differs, which the unit tests check for every one of them.
 *
 * ## What each level needs
 *
 * {@link LADDER_WORKFLOWS} is the roster of the four workflow files
 * under `.github/workflows/`. The publish workflow is needed from level
 * 2 up, the tag workflow at level 3 and the settle workflow at level 4.
 * The bot fragment workflow is needed at levels 3 and 4 only when
 * `.github/dependabot.yml` exists, since a bot pull request then merges
 * with nobody there to write its fragment.
 *
 * From level 2 up the version file's manifest is published, so it must
 * carry a `name` and must not be `private`, and the publish workflow
 * must grant `id-token: write`, without which npm trusted publishing
 * gets no token. A workflow path holding a directory, or anything else
 * that is not a regular file, is as missing as an absent one.
 *
 * The publish job of each workflow that publishes runs only while the
 * repository variable {@link PUBLISH_SWITCH_VARIABLE} reads `ci`; unset,
 * or holding anything else, GitHub skips the job and the run still
 * passes. Doctor cannot read a repository variable from the checkout,
 * so the variable is never one of {@link ladderPreconditions}' missing
 * items: it is named, alongside {@link PUBLISH_WORKFLOW}, by the readers
 * that tell the operator what publishing waits for.
 */
import type {
  ReleasePublishMode,
  ReleaseSettleMode,
  ReleaseTagMode,
} from '@open-tomato/rafa/core/config/sections';

/** The five rungs, from nothing on its own to a release on every merge. */
export type LadderLevel = 0 | 1 | 2 | 3 | 4;

/** The three settings the level is read off, named as `ResolvedConfig` names them. */
export interface LadderSettings {
  /** `release.settle`. */
  readonly releaseSettle: ReleaseSettleMode;
  /** `release.tag`. */
  readonly releaseTag: ReleaseTagMode;
  /** `release.publish`. */
  readonly releasePublish: ReleasePublishMode;
}

/** One config key as the ladder names it. */
export type LadderKey = 'release.settle' | 'release.tag' | 'release.publish';

/** One level's row of the table in the module note. */
export interface LadderRow {
  readonly level: LadderLevel;
  /** The level's name, as the doctor row prints it. */
  readonly name: string;
  /** The level's full spelling; a null key is one the level leaves free. */
  readonly settle: ReleaseSettleMode | null;
  readonly tag: ReleaseTagMode;
  readonly publish: ReleasePublishMode;
  /** The keys whose values choose this level; see the module note. */
  readonly decides: readonly LadderKey[];
}

/** Level 0, the floor every combination of keys stands on. */
const MANUAL_ROW: LadderRow = {
  level: 0,
  name: 'Manual',
  settle: null,
  tag: 'manual',
  publish: 'manual',
  decides: [],
};

/** The table in the module note, lowest level first. */
export const LADDER_ROWS: readonly LadderRow[] = [
  MANUAL_ROW,
  {
    level: 1,
    name: 'Settle tags',
    settle: 'push',
    tag: 'settle',
    publish: 'manual',
    decides: ['release.settle', 'release.tag'],
  },
  {
    level: 2,
    name: 'CI publishes',
    settle: 'push',
    tag: 'manual',
    publish: 'ci',
    decides: ['release.publish'],
  },
  {
    level: 3,
    name: 'Release PR',
    settle: 'pr',
    tag: 'settle',
    publish: 'ci',
    decides: ['release.settle', 'release.tag', 'release.publish'],
  },
  {
    level: 4,
    name: 'Continuous',
    settle: 'push',
    tag: 'settle',
    publish: 'ci',
    decides: ['release.settle', 'release.tag', 'release.publish'],
  },
];

/** A key whose value is not the one the read level spells. */
export interface LadderMisfit {
  readonly key: LadderKey;
  /** The value the settings hold. */
  readonly value: string;
  /** The value the level's row spells. */
  readonly expected: string;
}

/** What {@link ladderLevel} answers. */
export interface LadderLevelReading {
  readonly level: LadderLevel;
  readonly name: string;
  /** The key that does not fit the level's row, or null when all do. */
  readonly misfit: LadderMisfit | null;
}

/** The value a row expects for one key, or null when the row leaves it free. */
function rowValue(row: LadderRow, key: LadderKey): string | null {
  if (key === 'release.settle') return row.settle;
  if (key === 'release.tag') return row.tag;
  return row.publish;
}

/** The value the settings hold for one key. */
function settingValue(settings: LadderSettings, key: LadderKey): string {
  if (key === 'release.settle') return settings.releaseSettle;
  if (key === 'release.tag') return settings.releaseTag;
  return settings.releasePublish;
}

const LADDER_KEYS: readonly LadderKey[] = ['release.settle', 'release.tag', 'release.publish'];

/**
 * The level three settings put a project at: the highest row whose
 * deciding keys all hold, with the first key that differs from the
 * row's full spelling named as the misfit.
 *
 * @param settings - `release.settle`, `release.tag` and `release.publish`.
 * @returns The level, its name and the misfit, null when every key fits.
 */
export function ladderLevel(settings: LadderSettings): LadderLevelReading {
  const holds = (row: LadderRow): boolean => row.decides.every(
    key => rowValue(row, key) === settingValue(settings, key),
  );
  const row = [...LADDER_ROWS].reverse().find(holds) ?? MANUAL_ROW;
  const misfitKey = LADDER_KEYS.find(key => {
    const expected = rowValue(row, key);

    return expected !== null && expected !== settingValue(settings, key);
  });
  const misfit = misfitKey === undefined
    ? null
    : {
      key: misfitKey,
      value: settingValue(settings, misfitKey),
      expected: rowValue(row, misfitKey) ?? '',
    };

  return { level: row.level, name: row.name, misfit };
}

/** One workflow file of the roster. */
export interface LadderWorkflow {
  /** The file name under `.github/workflows/`. */
  readonly file: string;
  /** The path relative to the repository root. */
  readonly path: string;
  /** What the workflow does, as a doctor line names it. */
  readonly serves: string;
  /** The levels at which the workflow is needed. */
  readonly levels: readonly LadderLevel[];
  /** True when it is needed only while `.github/dependabot.yml` exists. */
  readonly onlyWithDependabot: boolean;
}

/** The directory every ladder workflow sits in. */
export const LADDER_WORKFLOW_DIR = '.github/workflows';

/** The Dependabot config whose presence makes the bot fragment workflow needed. */
export const DEPENDABOT_CONFIG = '.github/dependabot.yml';

function workflow(
  file: string,
  serves: string,
  levels: readonly LadderLevel[],
  onlyWithDependabot = false,
): LadderWorkflow {
  return { file, path: `${LADDER_WORKFLOW_DIR}/${file}`, serves, levels, onlyWithDependabot };
}

/** The publish workflow, whose text the `id-token: write` check reads. */
export const PUBLISH_WORKFLOW: LadderWorkflow = workflow(
  'release-publish.yml',
  'the publish on a pushed tag or a workflow_call',
  [2, 3, 4],
);

/**
 * The repository variable whose value `ci` lets a publish job run, read
 * by each publish job's `if:` condition, `vars.RAFA_RELEASE_PUBLISH == 'ci'`.
 */
export const PUBLISH_SWITCH_VARIABLE = 'RAFA_RELEASE_PUBLISH';

/** The bot fragment workflow, needed while `.github/dependabot.yml` exists. */
export const BOT_FRAGMENT_WORKFLOW: LadderWorkflow = workflow(
  'release-bot-fragment.yml',
  'the fragment for a bot pull request',
  [3, 4],
  true,
);

/** The tag workflow, needed at level 3. */
export const TAG_WORKFLOW: LadderWorkflow = workflow(
  'release-tag.yml',
  'tagging and publishing when the release pull request merges',
  [3],
);

/** The settle workflow, needed at level 4. */
export const SETTLE_WORKFLOW: LadderWorkflow = workflow(
  'release-settle.yml',
  'settle, tag and publish on every push to the base',
  [4],
);

/** The four workflow files of the ladder, in the order a doctor row lists them. */
export const LADDER_WORKFLOWS: readonly LadderWorkflow[] = [
  PUBLISH_WORKFLOW,
  TAG_WORKFLOW,
  SETTLE_WORKFLOW,
  BOT_FRAGMENT_WORKFLOW,
];

/** What a stat found at a path: a regular file, something else, or nothing. */
export type LadderFileKind = 'file' | 'not-a-file' | 'absent';

/** One workflow file as the caller found it. */
export interface LadderWorkflowReading {
  readonly kind: LadderFileKind;
  /** The file's text when `kind` is `file`; read for the publish workflow only. */
  readonly text?: string;
}

/** The version file's manifest, as far as a publish cares. */
export interface LadderManifestReading {
  /** The version file's path relative to the repository root. */
  readonly path: string;
  /** True when the manifest says `"private": true`. */
  readonly private: boolean;
  /** The manifest's `name`, or null when it has none. */
  readonly name: string | null;
}

/** Everything {@link ladderPreconditions} reads, read by its caller. */
export interface LadderReadings {
  /** Each roster workflow, keyed by its `path`; a path left out reads as absent. */
  readonly workflows: ReadonlyMap<string, LadderWorkflowReading>;
  /** The version file's manifest, or null when there is none to read. */
  readonly manifest: LadderManifestReading | null;
  /** True when `.github/dependabot.yml` is a regular file. */
  readonly dependabot: boolean;
}

/** One precondition of a level that the readings show to be missing. */
export type LadderMissing =
  | {
    readonly kind: 'workflow';
    readonly workflow: LadderWorkflow;
    readonly found: Exclude<LadderFileKind, 'file'>;
  }
  | {
    readonly kind: 'bot-workflow';
    readonly workflow: LadderWorkflow;
    readonly found: Exclude<LadderFileKind, 'file'>;
    readonly dependabot: string;
  }
  | { readonly kind: 'id-token'; readonly workflow: LadderWorkflow }
  | { readonly kind: 'manifest-private'; readonly path: string }
  | { readonly kind: 'manifest-unnamed'; readonly path: string };

/**
 * A line granting the job an OIDC token: `id-token: write`, the value
 * optionally quoted, with an optional trailing comment. A commented-out
 * line does not match, since the `#` comes before the key.
 */
const ID_TOKEN_WRITE = /^\s*id-token\s*:\s*(['"]?)write\1\s*(#.*)?$/m;

/**
 * True when a workflow is needed at a level, given whether
 * `.github/dependabot.yml` exists.
 *
 * @param entry - One roster workflow.
 * @param level - The level read off the settings.
 * @param dependabot - Whether the Dependabot config is present.
 * @returns Whether the level needs the workflow.
 */
export function ladderWorkflowNeeded(
  entry: LadderWorkflow,
  level: LadderLevel,
  dependabot: boolean,
): boolean {
  return entry.levels.includes(level) && (dependabot || !entry.onlyWithDependabot);
}

function workflowMissing(entry: LadderWorkflow, readings: LadderReadings): LadderMissing[] {
  const reading = readings.workflows.get(entry.path) ?? { kind: 'absent' };

  if (reading.kind !== 'file') {
    return entry.onlyWithDependabot
      ? [{ kind: 'bot-workflow', workflow: entry, found: reading.kind, dependabot: DEPENDABOT_CONFIG }]
      : [{ kind: 'workflow', workflow: entry, found: reading.kind }];
  }
  if (entry === PUBLISH_WORKFLOW && !ID_TOKEN_WRITE.test(reading.text ?? '')) {
    return [{ kind: 'id-token', workflow: entry }];
  }

  return [];
}

function manifestMissing(manifest: LadderManifestReading | null): LadderMissing[] {
  if (manifest === null) return [];
  const missing: LadderMissing[] = [];

  if (manifest.private) missing.push({ kind: 'manifest-private', path: manifest.path });
  if (manifest.name === null || manifest.name.trim() === '') {
    missing.push({ kind: 'manifest-unnamed', path: manifest.path });
  }

  return missing;
}

/**
 * The preconditions of a level the readings show to be missing: each
 * needed workflow that is not a regular file, in roster order, then the
 * manifest's, empty when the level has everything it needs.
 *
 * @param level - The level read off the settings.
 * @param readings - The caller's readings of the files the level needs.
 * @returns The missing items, empty at level 0 and 1.
 */
export function ladderPreconditions(level: LadderLevel, readings: LadderReadings): LadderMissing[] {
  if (level < 2) return [];
  const workflows = LADDER_WORKFLOWS
    .filter(entry => ladderWorkflowNeeded(entry, level, readings.dependabot))
    .flatMap(entry => workflowMissing(entry, readings));

  return [...workflows, ...manifestMissing(readings.manifest)];
}
