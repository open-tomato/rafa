/**
 * The fixture scrub: what takes a machine's identity out of a text before
 * that text is written into a committed fixture, and the leak finder that
 * says whether any is left.
 *
 * Fixtures here are made from real text (board filings, store rows), and
 * real text names the machine it came from. Four kinds of leak are found
 * ({@link findLeaks}):
 *
 *   - a home path: `/home/<name>` or `/Users/<name>` anywhere in a path,
 *     or `<drive>:\Users\<name>`, with its backslashes single or doubled
 *     as a JSON file escapes them;
 *   - an email address, except a version pin: `pkg@1.2.3` and
 *     `pkg@1.2.3-rc.alpha` name a package, so a domain whose last label
 *     is not two or more letters, or that opens with two numeric labels,
 *     is no address;
 *   - the running host name, and its first label when it has a domain
 *     (`box.local` and `box`), as a whole name in any case: `box` is not
 *     found inside `sandbox`, and a blank host finds nothing;
 *   - the value of a named secret, reported by the secret's name and
 *     never by its value, so a refusal message cannot print the secret.
 *
 * {@link fixtureScrubber} redacts each kind in turn, then reads the text
 * again with {@link findLeaks} and throws {@link ScrubRefusal} on any leak
 * left. Secrets go first, since a token can hold an address or a path;
 * then local paths through {@link localPathRedactor}, which triage already
 * applies to filed text, so the repository root reads relative and the
 * home reads {@link HOME_MARKER}; then any home path that redactor leaves
 * (a relative `src/home/alice`, a Windows path), its `/home/<name>` or
 * `C:\Users\<name>` part written as the marker and the rest kept; then
 * addresses; then the host. Each step redacts what the finder reports of
 * its kind, so the refusal is the backstop for what a step cannot take
 * out: a marker that names a leak itself, as a machine called `host` is
 * found again in `[redacted: HOST]` and a secret whose value is
 * `redacted` in every marker.
 */
import type { NamedSecret, SecretEnvironment } from '../triage/triage.js';

import { homedir, hostname } from 'node:os';

import { HOME_MARKER, localPathRedactor } from '../triage/local-paths.js';
import { namedSecrets, redactSecrets } from '../triage/triage.js';

/** What stands for an email address in a scrubbed text. */
export const EMAIL_MARKER = '[redacted: EMAIL]';

/** What stands for the host name in a scrubbed text. */
export const HOST_MARKER = '[redacted: HOST]';

/** One leak {@link findLeaks} reports; a secret's `match` is its name. */
export interface Leak {
  readonly kind: 'email address' | 'home path' | 'host name' | 'named secret';
  readonly match: string;
}

/** What a scrub takes out: the machine's names and the secrets in its environment. */
export interface ScrubContext {
  /** The running machine's host name; blank names nothing. */
  readonly host: string;
  readonly secrets: readonly NamedSecret[];
  /** The checkout, whose paths are written relative to it. */
  readonly repoRoot: string;
  readonly home: string;
}

/** A Unix or macOS home directory path naming someone. */
const HOME_PATH_UNIX = /\/(?:home|Users)\/[^\s"'`,]+/g;

/** A Windows home directory path naming someone, its backslashes single or JSON-escaped. */
const HOME_PATH_WINDOWS = /[A-Za-z]:\\{1,2}Users\\{1,2}[^\s"'`,]+/g;

/** The `/home/<name>` or `/Users/<name>` part of a home path, which a redaction replaces. */
const HOME_ROOT_UNIX = /\/(?:home|Users)\/[^\s"'`,/\\]+/g;

/** The `<drive>:\\Users\\<name>` part of a Windows home path, which a redaction replaces. */
const HOME_ROOT_WINDOWS = /[A-Za-z]:\\{1,2}Users\\{1,2}[^\s"'`,/\\]+/g;

/** A word shaped like an email address; {@link isVersionPin} takes the pins back out. */
const ADDRESS_SHAPE = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;

/** A domain's last label as a real address ends: two or more letters. */
const LETTER_LABEL = /^[A-Za-z]{2,}$/;

/** A domain opening as a version does: two numeric labels. */
const NUMERIC_OPENING = /^\d+\.\d+/;

/** A character that continues a host name, so a match next to one is part of a longer word. */
const HOST_CHARACTER = '[A-Za-z0-9-]';

/** Whether the part after an `@` is a version (`1.2.3`) rather than a mail domain. */
function isVersionPin(domain: string): boolean {
  const last = domain.slice(domain.lastIndexOf('.') + 1);
  return !LETTER_LABEL.test(last) || NUMERIC_OPENING.test(domain);
}

/** A text matched literally inside a regular expression. */
function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The pattern finding `host` and its first label as whole names, or null for a blank host. */
function hostPattern(host: string): RegExp | null {
  const trimmed = host.trim();
  if (trimmed === '') return null;
  const names = [...new Set([trimmed, trimmed.split('.')[0]!])]
    .filter((name) => name !== '')
    .sort((a, b) => b.length - a.length)
    .map(literalPattern);
  return new RegExp(`(?<!${HOST_CHARACTER})(?:${names.join('|')})(?!${HOST_CHARACTER})`, 'gi');
}

/** Every email address of `text`, version pins left out. */
function addressesIn(text: string): string[] {
  return [...text.matchAll(ADDRESS_SHAPE)]
    .filter((match) => !isVersionPin(match[1]!))
    .map((match) => match[0]);
}

/**
 * Every leak of `text`, by kind in the order home path, email address,
 * host name, named secret; see the module note. `host` is the running
 * machine's {@link hostname}.
 */
export function findLeaks(text: string, host: string, secrets: readonly NamedSecret[] = []): Leak[] {
  const homes = [...text.matchAll(HOME_PATH_UNIX), ...text.matchAll(HOME_PATH_WINDOWS)]
    .map((match): Leak => ({ kind: 'home path', match: match[0] }));
  const addresses = addressesIn(text).map((match): Leak => ({ kind: 'email address', match }));
  const hosts = [...text.matchAll(hostPattern(host) ?? /(?!)/g)]
    .map((match): Leak => ({ kind: 'host name', match: match[0] }));
  const named = secrets
    .filter(({ value }) => value.trim() !== '' && (text.includes(value) || text.includes(value.trim())))
    .map(({ name }): Leak => ({ kind: 'named secret', match: name }));
  return [...homes, ...addresses, ...hosts, ...named];
}

/** Thrown when a scrubbed text still holds a leak; its message names each one. */
export class ScrubRefusal extends Error {
  readonly leaks: readonly Leak[];

  constructor(leaks: readonly Leak[]) {
    const named = leaks.map((leak) => `${leak.kind} ${JSON.stringify(leak.match)}`).join(', ');
    super(`refusing to write: ${named} left after redaction`);
    this.name = 'ScrubRefusal';
    this.leaks = leaks;
  }
}

/**
 * The scrub for one extract: a function that redacts every leak kind out
 * of a text, then throws {@link ScrubRefusal} when any is left; see the
 * module note. Built once per extract, since the path redactor it holds
 * compiles its pattern from the context.
 */
export function fixtureScrubber(context: ScrubContext): (text: string) => string {
  const local = localPathRedactor(context.repoRoot, context.home);
  const host = hostPattern(context.host);
  return (text) => {
    const paths = local(redactSecrets(text, context.secrets))
      .replace(HOME_ROOT_UNIX, HOME_MARKER)
      .replace(HOME_ROOT_WINDOWS, HOME_MARKER);
    const addresses = paths.replace(ADDRESS_SHAPE, (match: string, domain: string) => isVersionPin(domain)
      ? match
      : EMAIL_MARKER);
    const scrubbed = host === null
      ? addresses
      : addresses.replace(host, HOST_MARKER);
    const left = findLeaks(scrubbed, context.host, context.secrets);
    if (left.length > 0) throw new ScrubRefusal(left);
    return scrubbed;
  };
}

/**
 * The context of the running machine for a checkout at `repoRoot`: its
 * host name, its home, and the secrets `env` holds under the names triage
 * redacts when no project names more.
 */
export function machineScrubContext(repoRoot: string, env: SecretEnvironment = process.env): ScrubContext {
  return {
    host: hostname(),
    secrets: namedSecrets({ prerequisitesRequired: [], prerequisitesOptional: [] }, env),
    repoRoot,
    home: homedir(),
  };
}
