/**
 * Which pull request provider a repository gets, and the one refusal
 * every `pr` action shares when that provider is not the GitHub CLI.
 *
 * `pr.provider` resolves to null in the config layer, and null there
 * means "nobody has said", not "off" (`src/config-schema.ts`). This
 * module is where that null becomes an answer: the spec's default is
 * `gh` when `origin` is a GitHub remote and `none` otherwise, which is
 * a reading off the repository and so cannot be a literal in the
 * defaults layer.
 *
 * ## What a reading carries, and why the remote is always read
 *
 * {@link resolvePrProvider} reads `origin` even when the config names
 * the provider, so a {@link PrProviderReading} always carries the
 * remote and its host when the repository has one. A reading is what
 * the next stage's preflight items are built from — `gh auth status`
 * is asked for THE REMOTE's host, not for github.com — and a reading
 * that skipped the probe because the config had already decided would
 * leave those items with no host to name. The cost is one
 * `git remote get-url origin`, the same probe `projectId` makes for
 * every effort row.
 *
 * `source` says which of the two answered, so a report can tell a
 * provider an operator chose from one this module inferred.
 *
 * ## Which remotes read as GitHub
 *
 * {@link isGitHubRemote} accepts a network remote whose host is
 * `github.com` or a subdomain of it, in any of the spellings git takes:
 * `https://github.com/o/r.git`, `git@github.com:o/r`,
 * `ssh://git@ssh.github.com:443/o/r` and `git://github.com/o/r` all
 * read as GitHub, a port on the host included. The host is taken from
 * `normalizeRemote` (`src/schema/project-id.ts`), which already strips
 * the scheme, any embedded credentials, the scp-style colon and a
 * trailing `.git`, so there is one parser for a remote URL in this
 * repository rather than two that can disagree. It leaves a port on the
 * host, measured, so {@link remoteHost} drops that itself.
 *
 * A GitHub Enterprise host — `github.example.com` — reads as NOT
 * GitHub, because its name says nothing: `gitlab.example.com` is spelled
 * the same way, and probing the host to find out would put a network
 * call behind reading the configuration. An Enterprise repository names
 * `pr.provider: gh` in its config, which is exactly what the setting is
 * for, and the reading then says `source: 'config'`.
 *
 * A filesystem remote — an absolute path, a relative one or a `file://`
 * URL — reads as not GitHub without being parsed for a host, so a clone
 * under a directory called `github.com` is not mistaken for the real
 * thing.
 *
 * ## The shared refusal
 *
 * {@link requireGhProvider} throws `CommandExit(2, PR_NEEDS_GH)`, and
 * the message is a CONSTANT: the spec has every `pr` action without a
 * usable `gh` exit 2 with the same message, so the message cannot be
 * built from the reading that produced it. `provider.test.ts` holds
 * that reading as an assertion over two refusals with different causes,
 * one from the config and one from a non-GitHub origin, being the same
 * string.
 *
 * What it does NOT check is whether `gh` is installed and authenticated.
 * That is two REQUIRED preflight items (`./preflight-items.ts`), checked
 * ahead of any session, and repeating the probes here would spawn `gh`
 * twice for every action. A reading of `gh` means the operator asked for
 * the GitHub CLI, not that the CLI answered.
 */
import type { PrProvider } from '../config-sections.js';

import { CommandExit } from '../cli/command.js';
import { gitRemoteUrl, normalizeRemote } from '../schema/project-id.js';

/** The host a GitHub remote names; its subdomains carry it as a suffix. */
const GITHUB_HOST = 'github.com';

/**
 * A port on the end of a host, which `normalizeRemote` leaves there.
 * Measured on bun 1.3.14: `ssh://git@ssh.github.com:443/o/r` normalizes
 * to `ssh.github.com:443/o/r`, so the host has to be read without it.
 */
const PORT_SUFFIX = /:\d+$/;

/** The exit code every `pr` action refuses with; the spec's own. */
export const PR_REFUSAL_EXIT = 2;

/**
 * The one message every `pr` action refuses with when the provider is
 * not `gh`. One string, for the reason in the module note.
 */
export const PR_NEEDS_GH = [
  'rafa pr needs the GitHub CLI, and this repository resolves to pr.provider: none.',
  'Set pr.provider: gh in .rafa/config.yaml when origin is a GitHub repository,',
  'install gh (https://cli.github.com) and run gh auth login.',
].join('\n');

/** Which of the two answers a reading came from. */
export type PrProviderSource = 'config' | 'remote';

/** The provider a repository gets, and what it was read from. */
export interface PrProviderReading {
  /** The provider every `pr` action goes through. */
  readonly provider: PrProvider;
  /** `config` when `pr.provider` named it, `remote` when `origin` decided. */
  readonly source: PrProviderSource;
  /** `origin`'s URL as git wrote it, or null when there is no origin. */
  readonly remote: string | null;
  /** The host `origin` names, or null when there is no origin or it names none. */
  readonly host: string | null;
}

/** A reading whose provider is the GitHub CLI. */
export type GhProviderReading = PrProviderReading & { readonly provider: 'gh' };

/** What {@link resolvePrProvider} is asked. */
export interface ResolvePrProviderOptions {
  /** `pr.provider` as the config resolved it: null when nobody has said. */
  readonly configured: PrProvider | null;
  /** The directory whose repository is read. */
  readonly dir: string;
  /** The `origin` probe. `gitRemoteUrl` when absent. */
  readonly readRemote?: (dir: string) => string | null;
}

/**
 * The host `url` names, or null when it names none — which every
 * filesystem remote does. See the module note on both.
 */
export function remoteHost(url: string): string | null {
  const trimmed = url.trim();
  const isPath = trimmed === ''
    || trimmed.startsWith('/')
    || trimmed.startsWith('.')
    || trimmed.startsWith('file://');
  if (isPath) return null;

  const named = normalizeRemote(trimmed).split('/')[0] ?? '';
  const host = named.replace(PORT_SUFFIX, '');
  return host === '' || !host.includes('.')
    ? null
    : host;
}

/** Whether `url` is a remote hosted on github.com; see the module note. */
export function isGitHubRemote(url: string): boolean {
  const host = remoteHost(url);
  return host !== null
    && (host === GITHUB_HOST || host.endsWith(`.${GITHUB_HOST}`));
}

/**
 * The provider the repository holding `options.dir` gets: what
 * `pr.provider` says, or `gh` when `origin` is a GitHub remote and
 * `none` otherwise. Never throws — a missing origin, a missing
 * repository and a missing git are one answer, the probe's own.
 */
export function resolvePrProvider(options: ResolvePrProviderOptions): PrProviderReading {
  const { configured, dir, readRemote = gitRemoteUrl } = options;
  const remote = readRemote(dir);
  const host = remote === null
    ? null
    : remoteHost(remote);
  const fromRemote: PrProvider = remote !== null && isGitHubRemote(remote)
    ? 'gh'
    : 'none';

  return configured === null
    ? { provider: fromRemote, source: 'remote', remote, host }
    : { provider: configured, source: 'config', remote, host };
}

/**
 * `reading` when its provider is `gh`, or the exit-2 refusal every `pr`
 * action shares. The message is {@link PR_NEEDS_GH} whatever the reading
 * said, for the reason in the module note.
 */
export function requireGhProvider(reading: PrProviderReading): GhProviderReading {
  if (reading.provider !== 'gh') throw new CommandExit(PR_REFUSAL_EXIT, PR_NEEDS_GH);
  return { ...reading, provider: 'gh' };
}
