/**
 * The contract suite run against the stand-in with one rule broken,
 * the fault {@link FAULT_ENV} names, so `contract.test.ts` can hold
 * that the suite fails an adapter breaking that rule. Named without
 * `.test` so the full suite never runs it: `contract.test.ts` spawns
 * `bun test` on this file's path, once per fault and once with
 * `none` as the control that the harness itself passes.
 *
 * Each fault wraps the working stand-in rather than forking it, so the
 * one rule it breaks is the only difference.
 */
import type { HubStore, HubStoreContext, HubStoreFactory } from '../port.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { hubStoreContract } from '../contract.js';

import { openMemoryHubStore } from './memory-store.js';

/** The environment variable naming the fault to plant. */
export const FAULT_ENV = 'RAFA_HUB_STORE_FAULT';

/** Offsets each push's `origin_seq` by, so a repeated row is a new one. */
const PUSH_OFFSET = 1_000;

/** `payload` with every row's origin pair passed through `change`. */
function reorigin(payload: WirePayload, change: (row: WireRow) => WireRow): WirePayload {
  const tables = Object.fromEntries(Object.entries(payload.tables).map(([table, rows]) => [table, rows.map(change)]));
  return { ...payload, tables };
}

/** Each fault, as a change to the working stand-in. */
const FAULTS: Readonly<Record<string, (store: HubStore) => HubStore>> = {
  'none': (store) => store,
  'keeps-own-origin': (store) => ({ ...store, pull: (request) => store.pull({ ...request, device: '' }) }),
  'ignores-cursor': (store) => ({ ...store, pull: (request) => store.pull({ ...request, since: {} }) }),
  'stamps-pusher': (store) => ({
    ...store,
    push: (request) => store.push({ ...request, payload: reorigin(request.payload, (row) => ({ ...row, origin_store: request.device })) }),
  }),
  'repeats-rows': (store) => {
    let pushes = 0;
    return {
      ...store,
      push: (request) => {
        pushes += 1;
        const offset = pushes * PUSH_OFFSET;
        return store.push({ ...request, payload: reorigin(request.payload, (row) => ({ ...row, origin_seq: Number(row['origin_seq']) + offset })) });
      },
    };
  },
  'forgets-last-push': (store) => ({ ...store, status: async () => ({ ...await store.status(), devices: [] }) }),
  'miscounts': (store) => ({ ...store, status: async () => ({ ...await store.status(), rows: {} }) }),
};

const fault = process.env[FAULT_ENV] ?? '';
const plant = FAULTS[fault];
if (plant === undefined) throw new Error(`${FAULT_ENV} is ${JSON.stringify(fault)}; expected one of ${Object.keys(FAULTS).join(', ')}`);

const factory: HubStoreFactory = (context: HubStoreContext) => plant(openMemoryHubStore(context));

hubStoreContract(fault, factory);
