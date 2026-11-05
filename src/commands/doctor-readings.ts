/**
 * The readings interfaces of `rafa doctor` (`./doctor.ts`): the plan's
 * preflight as it was checked, the start-only tier, the board rows, and
 * the json `data` of a run that exits 0. Types only; the command reads
 * and renders them.
 *
 * @module
 */

import type { DoctorBoardReadings } from './doctor-board.js';
import type { DoctorCleanupReading } from './doctor-cleanup.js';
import type { DeepReading } from './doctor-deep.js';
import type { DoctorEffortSchemaReading } from './doctor-effort-schema.js';
import type { PreviousCopiesReading } from './doctor-previous.js';
import type { DoctorProjectReading } from './doctor-project.js';
import type { DoctorReleaseReading } from './doctor-release.js';
import type { DoctorTiersReading } from './doctor-tiers.js';
import type { PreInitDirsReading } from '../project/pre-init-dirs.js';
import type { RafaConfig, ResolvedConfig } from '@open-tomato/rafa/core/config';
import type { PrProvider } from '@open-tomato/rafa/core/config/sections';
import type { PrerequisiteReminder } from '@open-tomato/rafa/preflight/prerequisites-md';
import type { PreflightCheck, PreflightReport } from '@open-tomato/rafa/preflight/run';
import type { BinPathReading } from '@open-tomato/rafa/project/bin-path';
import type { LegacyStoreReading } from '@open-tomato/rafa/store/legacy';
import type { DoctorRefsReading } from '@open-tomato/rafa-board';
import type { DoctorEffortSyncReading } from '@open-tomato/rafa-effort';

/**
 * How a report read the plan's start-only `[start]` items: probed on a
 * first dispatch, passed over on a resume. See the module note.
 */
export interface DoctorStartTier {
  /** How many of them were checked: the plan's own on a first dispatch, none on a resume. */
  readonly checked: number;
  /** How many of them this resume passed over unchecked; 0 on a first dispatch. */
  readonly skipped: number;
  /** The tracker whose ticked task made this a resume, by its base name; null on a first dispatch. */
  readonly tracker: string | null;
}

/** The preflight of one plan, checked with no run started. */
export interface DoctorPreflight {
  /** The project root each probe ran in. */
  readonly root: string;
  /** The plan the items were read for, absolute; null when there is none. */
  readonly plan: string | null;
  /** Where the default plan was looked for, in order, when there is no plan; empty otherwise. */
  readonly lookedFor: readonly string[];
  /** The plan's PREREQUISITES file that was merged in, absolute; null when none was. */
  readonly prerequisitesFile: string | null;
  /** How many of the checked items the pull request provider contributed; 0 or 2. */
  readonly automatic: number;
  /** The pull request provider the project resolves to, which decided those items and the board rows. */
  readonly provider: PrProvider;
  /** How the plan's start-only `[start]` items were read, and how many of the checked items are theirs. */
  readonly startTier: DoctorStartTier;
  /** Every check, and the halt and the `known-missing:` lines the runner worded. */
  readonly report: PreflightReport;
  /** The steps the PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
  /** The config the preflight resolved, which the plan's risk total reads too. */
  readonly config: RafaConfig;
  /** That config with where each key came from, which the `--deep` reading reads. */
  readonly resolved: ResolvedConfig;
  /** Whether the line asked for the `--deep` sections. */
  readonly deep: boolean;
}

/** What json mode gives as the terminal result's `data`, for a run `doctor` exits 0 from. */
export interface DoctorResult {
  /** The project root each probe ran in. */
  readonly root: string;
  /** The plan the items were read for, absolute; null when there is none. */
  readonly plan: string | null;
  /** The plan's PREREQUISITES file that was merged in, absolute; null when none was. */
  readonly prerequisitesFile: string | null;
  /** Every check, the required tier first. */
  readonly checks: readonly PreflightCheck[];
  /** How many of them the pull request provider contributed, which are the first of the required tier. */
  readonly automatic: number;
  /** How the plan's start-only `[start]` items were read: how many were checked, and how many a resume passed over. */
  readonly startTier: DoctorStartTier;
  /** The `known-missing:` line of each failed optional item, as every task prompt would carry it. */
  readonly knownMissing: readonly string[];
  /** The steps the PREREQUISITES file names and nothing checks. */
  readonly reminders: readonly PrerequisiteReminder[];
  /** Where `~/.rafa/bin` sits on the `PATH` handed in. */
  readonly binPath: BinPathReading;
  /** Which store files each effort directory holds; null when they could not be checked. */
  readonly legacyStore: LegacyStoreReading | null;
  /** Which of `plan.dir` and `specs.dir` still name a pre-init directory; null for a config that could not be loaded. */
  readonly preInitDirs: PreInitDirsReading | null;
  /** How many previous copies `previous/` under `specs.dir` holds; null when they could not be counted. */
  readonly previousCopies: PreviousCopiesReading | null;
  /** Every part of the GitHub board as it was read; null for a project with no GitHub board. */
  readonly board: DoctorBoardReadings['board'];
  /** Every open issue labelled `spec:blocked`, read; null for a project with no GitHub board or in `native` mode. */
  readonly blocked: DoctorBoardReadings['blocked'];
  /** Every issue carrying two `epic:` labels and every orphan `epic:` label; null for a project with no GitHub board or in `native` mode. */
  readonly epics: DoctorBoardReadings['epics'];
  /** Every truncated relationship list (`./doctor-relations.ts`); in `native` mode only, left out otherwise. */
  readonly relations?: DoctorBoardReadings['relations'];
  /** Every mark of the mode `board.relationships` does not name (`./doctor-marks.ts`); left out when no layer sets the key. */
  readonly marks?: DoctorBoardReadings['marks'];
  /** Every unresolved board owner, unlabelled Roadmap and lost position slot; null for a project with no GitHub board. */
  readonly boards: DoctorBoardReadings['boards'];
  /** The project rows (`./doctor-project.ts`); null without a `gh` provider or `board.project.number`. */
  readonly project: DoctorProjectReading | null;
  /** How many rows each group `rafa cleanup` lists holds, read without fetching, or why git refused. */
  readonly cleanup: DoctorCleanupReading;
  /** The suspect, dangling and unknown references of every saved copy under `specs.dir`, or why it could not be listed. */
  readonly refs: DoctorRefsReading;
  /** The release row (`./doctor-release.ts`): `{ enabled: false }` for a project whose release is off. */
  readonly release: DoctorReleaseReading;
  /** The skill tier rows and the Claude Code version they were read against (`./doctor-tiers.ts`). */
  readonly tiers: DoctorTiersReading;
  /** The `effort store schema` row (`./doctor-effort-schema.ts`); a failing one gives no `data`. */
  readonly effortSchema: DoctorEffortSchemaReading;
  /** The `effort sync` row (`./doctor-effort-sync.ts`); a failing one gives no `data`. */
  readonly effortSync: DoctorEffortSyncReading;
  /** Every `--deep` section as it was read; null without `--deep`. */
  readonly deep: DeepReading | null;
}

/** The readings of the GitHub board, each null for a project that has none, and the rows every repository gets. */
export interface BoardReadings extends DoctorBoardReadings {
  readonly project: DoctorProjectReading | null;
  readonly cleanup: DoctorCleanupReading;
  readonly refs: DoctorRefsReading;
  readonly release: DoctorReleaseReading;
  readonly tiers: DoctorTiersReading;
  readonly effortSchema: DoctorEffortSchemaReading;
  readonly effortSync: DoctorEffortSyncReading;
}
