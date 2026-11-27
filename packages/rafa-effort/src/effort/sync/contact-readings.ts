/**
 * The readings a hub contact answers (`contact.ts` beside this file):
 * what each direction of a run came to, what a run did, the hub line's
 * facts, and what a `sync()` run did step by step. They live apart from
 * the contact so that module holds its behaviour alone; `contact.ts`
 * re-exports every one of them, and the module note there is the
 * authority for what each field means.
 */
import type { SyncPullResult, SyncPushResult } from '@open-tomato/rafa/ports';

/**
 * Which directions a run takes, in order: a push then a pull under
 * `effort.syncMerge: merge`, a pull then a push under `ff-only`, or a
 * pull alone.
 */
export type HubContactDirection = 'push-then-pull' | 'pull-then-push' | 'pull';

/** What one direction of a run came to. */
export type HubContactStep<Result> =
  /** The strategy answered. */
  | { readonly outcome: 'done'; readonly result: Result }
  /** The hub was unreachable; `problem` is why, as the error said it. */
  | { readonly outcome: 'unreachable'; readonly problem: string }
  /** The hub speaks another contract version; `problem` is the line, written through `warn` once per contact. */
  | { readonly outcome: 'mismatch'; readonly problem: string }
  /**
   * The hub or this rafa is behind the other's migrations; `problem` is
   * the line, written through `warn` once per contact. Under `sync()`
   * also a missing token or a project the hub does not serve.
   */
  | { readonly outcome: 'refused'; readonly problem: string }
  /** The strategy refused or failed for another reason, written through `warn`. */
  | { readonly outcome: 'failed'; readonly problem: string }
  /**
   * Not run: the push before it found the hub unreachable or speaking
   * another contract, the pull before it under `pull-then-push` did not
   * answer, or under `sync()`'s dry run a push to a strategy with no dry
   * run.
   */
  | { readonly outcome: 'skipped' };

/** What one run of a contact did. */
export type HubContactReading =
  /** `effort.sync` is core's `local` or `file`: nothing was loaded, selected or contacted. */
  | { readonly state: 'not-contacted'; readonly strategy: string }
  /** No `Sync` could be selected; `problem` was written through `warn` once. */
  | { readonly state: 'unselected'; readonly strategy: string; readonly problem: string }
  /** The selected `Sync` was run; `push` is null for a pull alone, and `skipped` after a pull first that did not answer. */
  | {
    readonly state: 'contacted';
    readonly strategy: string;
    readonly push: HubContactStep<SyncPushResult> | null;
    readonly pull: HubContactStep<SyncPullResult>;
  };

/** The hub's own facts the hub line names, each null when the strategy answered none; see the module note's `The hub line`. */
export interface HubFacts {
  /** The wire contract version the hub speaks. */
  readonly contractVersion: number | null;
  /** The project push and pull name. */
  readonly projectId: string | null;
  /** The hub's name for that project. */
  readonly projectName: string | null;
}

/** Everything the hub line says: the hub's facts and what the pull before it merged. */
export interface HubLineFacts extends HubFacts {
  /** The rows the pull's merge added; 0 when it had nothing to merge. */
  readonly pulled: number;
  /** The rows the pull's merge held back for a later refill; 0 for a pull that was not projected. */
  readonly heldBack: number;
}

/** What a `status()` run did: a pull's reading, a contacted one also saying what the hub line names. */
export type HubStatusReading =
  | Exclude<HubContactReading, { readonly state: 'contacted' }>
  | (Extract<HubContactReading, { readonly state: 'contacted' }> & {
    /** The hub line's facts, or `skipped` when the pull did not answer and its own line stands in the hub line's place. */
    readonly hub: HubContactStep<HubLineFacts>;
  });

/** Where a `sync()` run stops: after the skew check, or after a push and pull that write nothing. */
export type HubSyncStop = 'status' | 'dry-run';

/** What a `sync()` run is asked. */
export interface HubSyncOptions {
  /** Where the run stops; absent or null runs every step. See the module note's `The sync`. */
  readonly stop?: HubSyncStop | null;
}

/** Why a `sync()` run was refused, each the cause `rafa effort sync` exits 1 for. */
export type HubRefusalCause = 'skew' | 'contract' | 'project' | 'token';

/** A `sync()` run's refusal: its cause and the one line written for it. */
export interface HubRefusal {
  readonly cause: HubRefusalCause;
  /** The line written through `warn`, once per contact, in the hub line's place. */
  readonly line: string;
}

/** What the hub status read, a `sync()` run's first step, answered; each fact null when the strategy answered none. */
export interface HubSyncStatus extends HubFacts {
  /** The migration ids the hub holds, in its order. */
  readonly migrations: readonly string[] | null;
}

/** The hub line's facts after a `sync()` run's pull, with the conflicts its merge recorded, or would have under a dry run. */
export interface HubSyncLineFacts extends HubLineFacts {
  /** The rows the merge found in conflict; 0 when it had nothing to merge. */
  readonly conflicts: number;
}

/** What a contacted `sync()` run did, step by step; a step it never reached is null. */
export interface HubSyncContacted {
  readonly state: 'contacted';
  readonly strategy: string;
  /** Where the run was asked to stop; null for a whole sync. */
  readonly stop: HubSyncStop | null;
  /** Step 1, the hub status read. */
  readonly status: HubContactStep<HubSyncStatus>;
  /** The refusal the run stopped at, from any step; null when there was none. */
  readonly refusal: HubRefusal | null;
  /**
   * The rows waiting to push: under `status` the strategy's
   * `pendingPush()`, under `dry-run` the rows its dry-run push counted;
   * a `done` null when the strategy counts none, and null when no count
   * was asked.
   */
  readonly pending: HubContactStep<number | null> | null;
  /** Step 3, the push; `skipped` under `dry-run` for a strategy with no dry run. */
  readonly push: HubContactStep<SyncPushResult> | null;
  /** Step 4, the pull and its merge. */
  readonly pull: HubContactStep<SyncPullResult> | null;
  /** Step 5, the hub line's facts, or `skipped` when the pull did not answer or was not run. */
  readonly hub: HubContactStep<HubSyncLineFacts>;
}

/** What a `sync()` run did. */
export type HubSyncReading =
  | Exclude<HubContactReading, { readonly state: 'contacted' }>
  | HubSyncContacted;
