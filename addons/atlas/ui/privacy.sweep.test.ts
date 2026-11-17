/**
 * The privacy sweep over `addons/atlas/`: no file git tracks, or would
 * track (untracked and not ignored), names a private host, the
 * self-hosted runner, a home path or a private repository.
 *
 * The tokenizer and the base list of hosts and paths live in
 * `src/tests/privacy-sweep.ts`, which says how to add a term without
 * spelling it. Atlas adds the two design workbench repositories.
 */
import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { BASE_BANNED, bannedHashOf, bannedIn, repositoryRoot, sweepFolder, sweptFiles } from '../../../src/tests/privacy-sweep.js';
import { SWEEP_TIMEOUT } from '../../../src/tests/sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

/** The folder swept, relative to the repository root. */
const SWEPT = 'addons/atlas';

/** The base list, plus the repositories Atlas must not name. */
const BANNED: ReadonlyMap<string, string> = new Map([
  ...BASE_BANNED,
  ['f247eb765fcd0ad4928cbbf055231fd82e43b42e9efa8c14ea13d6b830975d5c', 'the first design workbench repository'],
  ['2a95cb7247bd558821d7bd0468bf0112bcbf8821ee9cc187d642f149b9b581e0', 'the second design workbench repository'],
]);

describe('the privacy sweep', () => {
  it('control: finds a planted term on a word boundary and not inside a longer word', () => {
    const planted = new Map([[bannedHashOf('example-banned'), 'the planted term']]);

    expect(bannedIn('host: Example-Banned.org', planted)).toEqual(['the planted term']);
    expect(bannedIn('path /x/example-banned/y', planted)).toEqual(['the planted term']);
    expect(bannedIn('an example-banned-not word', planted)).toEqual(['the planted term']);
    expect(bannedIn('anexample-banned', planted)).toEqual([]);
  });

  it('control: reads a path prefix with its leading slash', () => {
    const planted = new Map([[bannedHashOf('/home/someone'), 'a home path']]);

    expect(bannedIn('cd /home/someone/projects', planted)).toEqual(['a home path']);
  });

  it('reads files under addons/atlas/', () => {
    expect(sweptFiles(repositoryRoot(), SWEPT).length).toBeGreaterThan(0);
  });

  it('finds no banned term in any file under addons/atlas/', async () => {
    const hits = await sweepFolder(SWEPT, BANNED);

    expect(hits.map((hit) => `${hit.file}: ${hit.label}`)).toEqual([]);
  });
});
