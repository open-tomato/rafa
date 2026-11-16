/**
 * A stand-in hub store: the port held in memory, written for the tests
 * so the contract suite runs against an adapter that is not the SQLite
 * one, as the spec's definition of done asks. It keeps each table's rows
 * as pushed under a hub `seq` of its own, knows a row by its origin
 * pair, and merges nothing, so it is the port's rules and no more.
 *
 * It keeps one state per project its context lists, routing a request
 * naming no project to the first listed, and refusing one naming a
 * project not listed; a context listing none, or the `default` project
 * alone, keeps one state that every request is served in.
 *
 * Each push replaces the state with a new one rather than editing it.
 */
import type {
  HubCapabilities,
  HubContract,
  HubDevice,
  HubPullRequest,
  HubPushRequest,
  HubPushResult,
  HubServedProject,
  HubStore,
  HubStoreContext,
  HubStoreStatus,
} from '../port.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';

import { DEFAULT_PROJECT_ID } from '../../config.js';

/** Everything the stand-in holds. */
interface MemoryState {
  /** Each table's rows in hub `seq` order, `seq` the hub's own. */
  readonly tables: Readonly<Record<string, readonly WireRow[]>>;
  /** Every migration a push named, in the order first named. */
  readonly migrations: readonly string[];
  /** Each device's last push, ISO 8601. */
  readonly devices: Readonly<Record<string, string>>;
}

/** A state with nothing pushed. */
const EMPTY: MemoryState = { tables: {}, migrations: [], devices: {} };

/** The key every request is kept under when the context serves one project of before. */
const SHARED = '';

/** The refusal for a request naming a project the context does not list. */
function notServed(project: string): Error {
  return new Error(`rafa-hub: project ${project} is not served here; add it under hub.projects`);
}

/** Whether `projects` is the single-project hub of before: none listed, or `default` alone. */
function servesOne(projects: readonly HubServedProject[]): boolean {
  return projects.length === 0 || (projects.length === 1 && projects[0]?.id === DEFAULT_PROJECT_ID);
}

/** The stand-in has no capability beyond push, pull and status. */
const CAPABILITIES: HubCapabilities = { fts: false, vector: false, graph: false, projection: false };

/** How a row is known: its origin pair. */
function pairOf(row: WireRow): string {
  return `${String(row['origin_store'])}:${String(row['origin_seq'])}`;
}

/** `held` with the rows of `pushed` whose origin pair it lacks appended under new hub seqs. */
function appendNew(held: readonly WireRow[], pushed: readonly WireRow[]): readonly WireRow[] {
  return pushed.reduce<readonly WireRow[]>((rows, row) => {
    if (rows.some((kept) => pairOf(kept) === pairOf(row))) return rows;
    return [...rows, { ...row, seq: rows.length + 1 }];
  }, held);
}

/** Opens an empty stand-in; `directory` is left unused. */
export function openMemoryHubStore(context: HubStoreContext): HubStore {
  const projects = context.projects ?? [];
  const shared = servesOne(projects);
  let states: Readonly<Record<string, MemoryState>> = {};

  /** The key of the state a request naming `project` is served in; throws for a project not listed. */
  const keyOf = (project: string | undefined): string => {
    if (shared) return SHARED;
    const id = project ?? projects[0]?.id ?? SHARED;
    if (!projects.some((listed) => listed.id === id)) throw notServed(id);
    return id;
  };

  const push = (request: HubPushRequest): Promise<HubPushResult> => {
    const { device, payload } = request;
    let key: string;
    try {
      key = keyOf(request.project);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const state = states[key] ?? EMPTY;
    const at = context.now().toISOString();
    const pushed = Object.entries(payload.tables);
    const tables = Object.fromEntries(pushed.map(([table, rows]) => [table, appendNew(state.tables[table] ?? [], rows)]));
    const added = pushed.reduce((total, [table]) => total + (tables[table]?.length ?? 0) - (state.tables[table]?.length ?? 0), 0);
    states = {
      ...states,
      [key]: {
        tables: { ...state.tables, ...tables },
        migrations: [...state.migrations, ...payload.migrations.filter((id) => !state.migrations.includes(id))],
        devices: { ...state.devices, [device]: at },
      },
    };
    const received = pushed.reduce((total, [, rows]) => total + rows.length, 0);
    return Promise.resolve({ received, added, at });
  };

  const pull = (request: HubPullRequest): Promise<WirePayload> => {
    const { device, since } = request;
    let state: MemoryState;
    try {
      state = states[keyOf(request.project)] ?? EMPTY;
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const held = Object.entries(state.tables);
    const tables = Object.fromEntries(held.map(([table, rows]) => [
      table,
      rows.filter((row) => Number(row.seq) > (since[table] ?? 0) && row['origin_store'] !== device),
    ]));
    const cursor = { ...since, ...Object.fromEntries(held.map(([table, rows]) => [table, Math.max(since[table] ?? 0, rows.length)])) };
    return Promise.resolve({ format: WIRE_FORMAT, version: WIRE_VERSION, migrations: state.migrations, tables, cursor });
  };

  /** The state a request naming no project is served in: the first listed project's. */
  const first = (): MemoryState => states[keyOf(undefined)] ?? EMPTY;

  /**
   * Rows, migrations and devices are the first listed project's; `projects`
   * names every one the context lists, and is left out when it lists none.
   */
  const status = (): Promise<HubStoreStatus> => {
    const state = first();
    const rows = Object.fromEntries(Object.entries(state.tables).map(([table, held]) => [table, held.length]));
    const devices: HubDevice[] = Object.entries(state.devices)
      .map(([device, lastPushAt]) => ({ device, lastPushAt }))
      .sort((left, right) => left.device.localeCompare(right.device));
    const answered = { migrations: state.migrations, rows, devices };
    if (context.projects === undefined) return Promise.resolve(answered);
    return Promise.resolve({ ...answered, projects: context.projects.map(({ id, name }) => ({ id, name })) });
  };

  const contract = (): HubContract => ({ contractVersion: WIRE_CONTRACT_VERSION, migrations: first().migrations, capabilities: CAPABILITIES });

  return { push, pull, status, contract, close: () => Promise.resolve() };
}
