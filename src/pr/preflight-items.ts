/**
 * The two REQUIRED preflight items a `gh` provider contributes, built
 * from a provider reading.
 *
 * `pr.provider: gh` makes the GitHub CLI a dependency of the run, and
 * the spec has it checked BEFORE any session is paid for: `gh` on
 * `PATH`, and `gh auth status` exiting 0 for the remote's host. Both
 * are checked ahead of the configured tiers, and both are required, so
 * a machine without the CLI halts in preflight rather than finishing
 * every task and failing at the pull request. A `none` provider
 * contributes nothing, which is why `src/config.ts` can go on requiring
 * nothing by default: a `local`-tracker machine never sees these items.
 *
 * ## Why both items carry a probe
 *
 * `runPreflight` proves a `tool` item with no probe through `Bun.which`
 * and words the failure itself: `presence check: gh is not on PATH`.
 * That is true and says nothing about what to do next, and the failure
 * string is the only part of a check the halt prints. So both items
 * here carry a probe, and each probe writes its own one-line remedy to
 * stderr and exits 1 — `probeVerdict` takes the first non-blank stderr
 * line into the failure, so the halt reads:
 *
 *     preflight halted: 2 required items failed
 *       tool "gh": probe `...` exited 1: gh is not on PATH: install it
 *         with brew install gh (...), then run gh auth login --hostname github.com
 *
 * The cost is that the probe text is repeated in the halt line ahead of
 * the message, which is `runPreflight`'s wording and not this module's
 * to change.
 *
 * Both probes send the checked command's own output to `/dev/null`,
 * stderr included. `gh auth status` writes a readable refusal of its
 * own — `You are not logged into any GitHub hosts.` — and keeping it
 * would make it, not the remedy, the first non-blank line and so the
 * whole of the failure. The remedy names the state as well as the fix,
 * so nothing is lost by dropping it.
 *
 * ## Which host is asked about
 *
 * The auth item asks about the REMOTE's host, which is why
 * {@link ghPreflightItems} takes a whole {@link PrProviderReading}
 * rather than a provider: `resolvePrProvider` reads `origin` even when
 * the config named the provider, exactly so this module has a host to
 * name (`./provider.ts`). A reading with no host — no `origin`, or a
 * filesystem one — falls back to {@link DEFAULT_GH_HOST}, because a
 * repository whose config says `pr.provider: gh` has asked for the
 * GitHub CLI and `github.com` is the only host that answer can mean.
 *
 * The host reaches a shell, so it is quoted ({@link shellQuote}) rather
 * than trusted: a remote is read off the checkout's git config and a
 * host carrying a quote or a space would otherwise end the probe's own
 * string. A host of plain word characters is left unquoted so the halt
 * line stays readable.
 */
import type { PrProviderReading } from './provider.js';
import type { PrerequisiteItem } from '../config-sections.js';

/** The host asked about when a reading names none; see the module note. */
export const DEFAULT_GH_HOST = 'github.com';

/** How the failures say to get the CLI. The spec's install line. */
export const GH_INSTALL_LINE = 'brew install gh (https://cli.github.com on every other platform)';

/** A word a shell takes as it stands; anything else is quoted. */
const PLAIN_WORD = /^[A-Za-z0-9._:/-]+$/;

/** The quote a shell word is wrapped in. */
const QUOTE = '\'';

/** A single quote inside a single-quoted shell word: `'\''`. */
const QUOTED_QUOTE = '\'\\\'\'';

/** `word` as one shell word: quoted unless it is plain; see the module note. */
export function shellQuote(word: string): string {
  return PLAIN_WORD.test(word)
    ? word
    : QUOTE + word.split(QUOTE).join(QUOTED_QUOTE) + QUOTE;
}

/** The `gh auth login` line a failure for `host` tells the operator to run. */
export function ghAuthLine(host: string): string {
  return `gh auth login --hostname ${host}`;
}

/** What the `PATH` item's failure says; one line, the first of its stderr. */
export function ghMissingMessage(host: string): string {
  return `gh is not on PATH: install it with ${GH_INSTALL_LINE}, then run ${ghAuthLine(host)}`;
}

/** What the auth item's failure says; one line, the first of its stderr. */
export function ghUnauthenticatedMessage(host: string): string {
  return `gh is not authenticated for ${host}: run ${ghAuthLine(host)}, `
    + `or install gh with ${GH_INSTALL_LINE} when it is not there`;
}

/**
 * A probe that runs `command` with its output dropped and, when that
 * fails, writes `message` to stderr and exits 1; see the module note.
 */
function probeWithRemedy(command: string, message: string): string {
  return `${command} >/dev/null 2>&1 || { echo ${shellQuote(message)} >&2; exit 1; }`;
}

/** The item proving `gh` resolves on the run's `PATH`. */
export function ghOnPathItem(host: string): PrerequisiteItem {
  return Object.freeze({
    kind: 'tool',
    name: 'gh',
    probe: probeWithRemedy('command -v gh', ghMissingMessage(host)),
  });
}

/** The item proving `gh auth status` exits 0 for `host`. */
export function ghAuthItem(host: string): PrerequisiteItem {
  const status = `gh auth status --hostname ${shellQuote(host)}`;
  return Object.freeze({
    kind: 'service',
    name: `https://${host}`,
    probe: probeWithRemedy(status, ghUnauthenticatedMessage(host)),
  });
}

/** The reading's host, or {@link DEFAULT_GH_HOST}; see the module note. */
export function ghHostOf(reading: PrProviderReading): string {
  return reading.host ?? DEFAULT_GH_HOST;
}

/** No items, for a provider that contributes none. */
const NO_ITEMS: readonly PrerequisiteItem[] = Object.freeze([]);

/**
 * The REQUIRED items `reading`'s provider contributes, in the order a
 * preflight checks them: `gh` on `PATH`, then `gh auth status` for the
 * remote's host. A provider that is not `gh` contributes none.
 */
export function ghPreflightItems(reading: PrProviderReading): readonly PrerequisiteItem[] {
  if (reading.provider !== 'gh') return NO_ITEMS;
  const host = ghHostOf(reading);
  return Object.freeze([ghOnPathItem(host), ghAuthItem(host)]);
}
