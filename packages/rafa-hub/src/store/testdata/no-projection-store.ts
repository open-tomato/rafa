/**
 * A fixture hub store answering `projection: false`: the in-memory
 * stand-in with that capability named outright, so the contract suite's
 * refusal case (a `409` with `missing` from the hub's route) runs over a
 * store whose answer is its own and not the stand-in's default.
 */
import type { HubStore, HubStoreContext } from '../port.js';

import { openMemoryHubStore } from './memory-store.js';

/** Opens a stand-in store whose `capabilities().projection` is `false`. */
export function openNoProjectionHubStore(context: HubStoreContext): HubStore {
  const store = openMemoryHubStore(context);
  return {
    ...store,
    contract: () => {
      const contract = store.contract();
      return { ...contract, capabilities: { ...contract.capabilities, projection: false } };
    },
  };
}
