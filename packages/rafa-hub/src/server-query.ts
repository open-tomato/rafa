/**
 * The query readers of the hub's routes: the refusal of a query parameter
 * a route does not name, the `device` reader and the `contractVersion`
 * check. Each throws {@link RequestRefused} for a query it cannot read,
 * and the contract check throws {@link ContractUnsupported} for a version
 * the hub does not speak; `server.ts` answers both.
 *
 * @module
 */

import { WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';

/** A `contractVersion` as the query spells it: a whole number above zero, in digits with no leading zero. */
const CONTRACT_VERSION = /^[1-9][0-9]*$/;

/** A device, as `device` names it: 1 to 200 printable ASCII characters, as a store's origin is. */
const DEVICE = /^[!-~]{1,200}$/;

/** A request the route cannot read, answered with its status and one line. */
export class RequestRefused extends Error {
  override readonly name = 'RequestRefused';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A push or a pull naming a contract version the hub does not speak: `409`, with `contract-unsupported`. */
export class ContractUnsupported extends Error {
  override readonly name = 'ContractUnsupported';

  constructor(asked: number) {
    super(`The request speaks wire contract version ${String(asked)}; this hub speaks version ${String(WIRE_CONTRACT_VERSION)}.`);
  }
}

/** Refuses a query parameter `route` does not read, or one given twice. */
export function checkQuery(url: URL, allowed: readonly string[]): void {
  const names = [...url.searchParams.keys()];
  const unknown = names.find((name) => !allowed.includes(name));
  if (unknown !== undefined) {
    const expected = allowed.length === 0
      ? 'this route takes none'
      : `expected ${allowed.join(', ')}`;
    throw new RequestRefused(400, `The query names ${JSON.stringify(unknown)}; ${expected}.`);
  }
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) throw new RequestRefused(400, `The query names ${twice} more than once.`);
}

/** The `device` the query names, refused when absent or not an origin. */
export function readDevice(url: URL): string {
  const device = url.searchParams.get('device');
  if (device === null) throw new RequestRefused(400, 'The query names no device; expected device=<the store\'s origin>.');
  if (!DEVICE.test(device)) throw new RequestRefused(400, 'device is not a store origin; expected 1 to 200 printable ASCII characters.');
  return device;
}

/**
 * Refuses the contract version the query names unless it is the hub's,
 * `1` when left out: `400` for a value that is not a whole number above
 * zero, {@link ContractUnsupported} for another version.
 */
export function checkContractVersion(url: URL): void {
  const spelt = url.searchParams.get('contractVersion');
  if (spelt === null) return;

  const asked = Number(spelt);
  if (!CONTRACT_VERSION.test(spelt) || !Number.isSafeInteger(asked)) {
    throw new RequestRefused(400, `contractVersion is ${JSON.stringify(spelt)}; expected a whole number above zero, such as ${String(WIRE_CONTRACT_VERSION)}.`);
  }
  if (asked !== WIRE_CONTRACT_VERSION) throw new ContractUnsupported(asked);
}
