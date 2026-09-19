/**
 * Tests for the board trust check (`src/board/trust.ts`): the one
 * permission reading, the allow-list beside it, the failed lookup that
 * refuses rather than passes, and the sentence a refusal carries.
 *
 * The `gh` route is driven through the strict recorded fake
 * (`src/pr/gh-fake.ts`), which models
 * `api repos/<repo>/collaborators/<login>/permission` and answers a 404
 * for a login nobody planted. Everything the fake does not model — a
 * connection failure, a payload with one permission field, a payload
 * that is not JSON — is driven through {@link stubGh}, a runner
 * answering one recorded result, so no case spawns a process, reaches
 * GitHub or reads the configuration `gh` keeps under the home.
 *
 * A trust check is the shape of test that passes while wrong most
 * easily: a reading stuck at "trusted" satisfies every case that
 * asserts a pass, and a reading stuck at "refused" satisfies every case
 * that asserts a refusal. So each leg is paired with its opposite over
 * the SAME seam:
 *
 *  - every refusal below (an outsider, a triager, a failed lookup, a
 *    404, a login that is no login) is asserted beside a write-holder
 *    read through the same fake or the same stub, which must pass;
 *  - the allow-list cases assert the lookup was NOT spent, against a
 *    counting seam, and sit beside a login the list does not name,
 *    which must still be asked;
 *  - the two refusal reasons are asserted apart, so a reading that
 *    collapsed `lookup-failed` onto `no-write-access` would tell an
 *    operator their colleague has no access when an expired token was
 *    what happened.
 *
 * Seven mutations of `trust.ts` were driven against this file on
 * 2026-09-19, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each. 33 pass either side, and
 * each count below is the run's own:
 *
 *  - a failed lookup answered as trusted, the mutation this whole
 *    module exists to prevent: 4 fail, both failed-lookup readings, the
 *    sentence that carries the failure and the exit-2 case over it.
 *  - `isTrustedPermission` asked about the legacy `permission` field
 *    alone: 1 fail, the role_name-only case. A maintainer's legacy
 *    field reads `write`, so that case is the only one which can see
 *    this, which is why it is written as a role_name with no legacy
 *    field beside it.
 *  - the allow-list compared case-sensitively: 1 fail, the mixed-case
 *    case.
 *  - the login shape check dropped from `readAuthorTrust`: 1 fail, the
 *    case that plants `app/dependabot` on the allow-list.
 *  - the same check dropped from `createGhPermissions`, so a login
 *    reaches the path unchecked: 1 fail, the case asserting the
 *    traversal and the flag send no command.
 *  - one sentence used for both refusals: 2 fail, the failed-lookup
 *    sentence and its empty-detail fallback.
 *  - `TRUST_REFUSAL_EXIT` at 1 rather than 2: 2 fail, both
 *    `requireTrustedAuthor` refusals.
 *
 * One mutation of the reader behind the setting was driven the same way
 * against `config-sections.test.ts` and this file's own config case:
 * `isGitHubLogin` accepting any non-whitespace string reddened 8 cases
 * there, including the `board.trustedAuthors` refusal in
 * `config.test.ts`.
 */
import type { PermissionReading, Permissions, TrustReading } from './trust.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createFakePrGh } from '../pr/gh-fake.js';

import {
  createGhPermissions,
  readAuthorTrust,
  requireTrustedAuthor,
  TRUSTED_PERMISSIONS,
  trustRefusalMessage,
} from './trust.js';

/** The path every lookup sends, with the placeholders `gh` expands. */
const PATH = 'repos/{owner}/{repo}/collaborators/octocat/permission';

/** The issue every refusal case names. */
const ISSUE = { kind: 'issue', number: 12, repo: 'open-tomato/rafa' } as const;

/** A runner answering `result` to every command, recording what it was handed. */
function stubGh(result: GhResult): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  let calls: readonly (readonly string[])[] = [];
  return {
    run: (args) => {
      calls = [...calls, Object.freeze([...args])];
      return Promise.resolve(result);
    },
    calls: () => calls,
  };
}

/** A `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A `gh` result that failed, writing `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** A permission seam answering `reading`, counting the logins it was asked about. */
function countingPermissions(reading: (login: string) => PermissionReading): {
  permissions: Permissions;
  asked: () => readonly string[];
} {
  let asked: readonly string[] = [];
  return {
    permissions: (login) => {
      asked = [...asked, login];
      return Promise.resolve(reading(login));
    },
    asked: () => asked,
  };
}

/** A seam answering one permission to every login, asked about nothing else. */
function answering(permission: string | null, roleName: string | null = permission): Permissions {
  return (login) => Promise.resolve({ login, permission, roleName, detail: '' });
}

/** A seam whose lookup always fails, with `detail`. */
function failing(detail: string): Permissions {
  return (login) => Promise.resolve({ login, permission: null, roleName: null, detail });
}

/** The trust of `login` over `permissions`, with `trustedAuthors` listed. */
function trustOf(
  login: string,
  permissions: Permissions,
  trustedAuthors: readonly string[] = [],
): Promise<TrustReading> {
  return readAuthorTrust({ login, permissions, trustedAuthors });
}

describe('createGhPermissions', () => {
  it('sends one gh api command at the collaborators path, with the repository placeholders', async () => {
    const fake = createFakePrGh();
    fake.plantPermission('octocat', 'write');

    const reading = await createGhPermissions({ gh: fake.run })('octocat');

    expect(fake.calls()).toEqual([['api', PATH]]);
    expect(reading).toEqual({ login: 'octocat', permission: 'write', roleName: 'write', detail: '' });
  });

  it('reads a 404 on a login the repository does not know as a failed lookup, naming it', async () => {
    const fake = createFakePrGh();
    fake.plantPermission('octocat', 'admin');

    const missing = await createGhPermissions({ gh: fake.run })('nobody');
    // The control: the same fake answers the planted login, so the
    // failure above is the 404 and not a reader that fails at everything.
    const known = await createGhPermissions({ gh: fake.run })('octocat');

    expect(missing.permission).toBeNull();
    expect(missing.roleName).toBeNull();
    expect(missing.detail).toBe(
      'gh api repos/{owner}/{repo}/collaborators/nobody/permission failed: gh: nobody is not a user (HTTP 404)',
    );
    expect(known.detail).toBe('');
    expect(known.permission).toBe('admin');
  });

  it('reads a command that could not run at all as a failed lookup', async () => {
    const stub = stubGh(failed('gh: could not connect to api.github.com\n'));

    const reading = await createGhPermissions({ gh: stub.run })('octocat');

    expect(reading.permission).toBeNull();
    expect(reading.detail).toBe(
      `gh api ${PATH} failed: gh: could not connect to api.github.com`,
    );
  });

  it('names a failure that wrote nothing, rather than reporting an empty detail', async () => {
    const stub = stubGh({ ok: false, stdout: '', stderr: '' });

    const reading = await createGhPermissions({ gh: stub.run })('octocat');

    expect(reading.detail).toBe(`gh api ${PATH} failed and wrote nothing`);
  });

  it('reads output that is not JSON, and a payload that is no mapping, as failed lookups', async () => {
    const notJson = await createGhPermissions({ gh: stubGh(wrote('<html>rate limited</html>')).run })('octocat');
    const notMapping = await createGhPermissions({ gh: stubGh(wrote('["octocat"]')).run })('octocat');
    // The control: the same stub shape carrying a payload reads clean.
    const usable = await createGhPermissions({ gh: stubGh(wrote('{"permission":"write"}')).run })('octocat');

    expect(notJson.detail).toStartWith(`gh api ${PATH} wrote output that is not JSON:`);
    expect(notMapping.detail).toBe(`gh api ${PATH} answered a list, expected a mapping`);
    expect(usable.detail).toBe('');
  });

  it('reads a payload carrying neither permission field as a failed lookup', async () => {
    const stub = stubGh(wrote('{"user":{"login":"octocat"}}'));

    const reading = await createGhPermissions({ gh: stub.run })('octocat');

    expect(reading.detail).toBe(`gh api ${PATH} answered neither a permission nor a role_name`);
  });

  it('reads each permission field on its own, so a role the other field collapses survives', async () => {
    const roleOnly = await createGhPermissions({ gh: stubGh(wrote('{"role_name":"maintain"}')).run })('octocat');
    const legacyOnly = await createGhPermissions({ gh: stubGh(wrote('{"permission":"read"}')).run })('octocat');

    expect(roleOnly).toEqual({ login: 'octocat', permission: null, roleName: 'maintain', detail: '' });
    expect(legacyOnly).toEqual({ login: 'octocat', permission: 'read', roleName: null, detail: '' });
  });

  it('sends no command at all for a login it could not put in the path', async () => {
    const fake = createFakePrGh();
    fake.plantPermission('octocat', 'write');
    const permissions = createGhPermissions({ gh: fake.run });

    const traversal = await permissions('../../evil');
    const flagged = await permissions('-X');
    // The control: a login the reader accepts does reach `gh`.
    await permissions('octocat');

    expect(traversal.detail).toBe('"../../evil" is not a GitHub login, so no permission was read');
    expect(flagged.detail).toBe('"-X" is not a GitHub login, so no permission was read');
    expect(fake.calls()).toEqual([['api', PATH]]);
  });
});

describe('readAuthorTrust over a permission', () => {
  it.each([...TRUSTED_PERMISSIONS])('trusts a login holding %s', async (permission) => {
    const reading = await trustOf('octocat', answering(permission));

    expect(reading.trusted).toBe(true);
    expect(reading.source).toBe('permission');
    expect(reading.refusal).toBeNull();
  });

  it.each([['read'], ['triage'], ['none'], ['pull']])('refuses a login holding %s', async (permission) => {
    const refused = await trustOf('octocat', answering(permission));
    // The control: the same seam shape answering write trusts, so the
    // refusal is the permission and not a check that refuses everything.
    const trusted = await trustOf('octocat', answering('write'));

    expect(refused.trusted).toBe(false);
    expect(refused.refusal).toBe('no-write-access');
    expect(refused.source).toBeNull();
    expect(trusted.trusted).toBe(true);
  });

  it('trusts a role the legacy permission field collapses onto a lesser one', async () => {
    const maintainer = await trustOf('octocat', answering('write', 'maintain'));
    const triager = await trustOf('octocat', answering('read', 'triage'));

    expect(maintainer.trusted).toBe(true);
    expect(triager.trusted).toBe(false);
  });

  it('trusts a login whose role_name alone names write access', async () => {
    const reading = await trustOf('octocat', answering(null, 'admin'));

    expect(reading.trusted).toBe(true);
  });

  it('carries the lookup behind a reading, so a report can name what GitHub said', async () => {
    const reading = await trustOf('octocat', answering('read'));

    expect(reading.permission).toEqual({
      login: 'octocat',
      permission: 'read',
      roleName: 'read',
      detail: '',
    });
  });
});

describe('readAuthorTrust over a failed lookup', () => {
  it('refuses a lookup that did not answer, and never passes it', async () => {
    const refused = await trustOf('octocat', failing('gh api failed: HTTP 403'));
    // The control: the same login through a lookup that DOES answer is
    // trusted, so the refusal is the failure and not the login.
    const trusted = await trustOf('octocat', answering('admin'));

    expect(refused.trusted).toBe(false);
    expect(refused.refusal).toBe('lookup-failed');
    expect(refused.permission?.detail).toBe('gh api failed: HTTP 403');
    expect(trusted.trusted).toBe(true);
  });

  it('holds the two refusals apart, so a failure is never reported as a lack of access', async () => {
    const failure = await trustOf('octocat', failing('gh: not logged in'));
    const outsider = await trustOf('octocat', answering('read'));

    expect(failure.refusal).toBe('lookup-failed');
    expect(outsider.refusal).toBe('no-write-access');
  });

  it('refuses a login that is no GitHub login without asking the lookup or the list', async () => {
    const counting = countingPermissions(() => ({
      login: 'x',
      permission: 'admin',
      roleName: 'admin',
      detail: '',
    }));

    const refused = await trustOf('app/dependabot', counting.permissions, ['app/dependabot']);
    // The control: a login the check accepts IS asked about, over the
    // same seam and the same list.
    const trusted = await trustOf('octocat', counting.permissions, []);

    expect(refused.trusted).toBe(false);
    expect(refused.refusal).toBe('lookup-failed');
    expect(refused.permission?.detail)
      .toBe('"app/dependabot" is not a GitHub login, so no permission was read');
    expect(trusted.trusted).toBe(true);
    expect(counting.asked()).toEqual(['octocat']);
  });
});

describe('readAuthorTrust over the allow-list', () => {
  it('trusts a listed login and spends no lookup on it', async () => {
    const counting = countingPermissions((login) => ({
      login,
      permission: 'read',
      roleName: 'read',
      detail: '',
    }));

    const listed = await trustOf('dependabot[bot]', counting.permissions, ['dependabot[bot]']);
    // The control: a login the list does not name is still asked about,
    // and the lookup's answer stands.
    const unlisted = await trustOf('octocat', counting.permissions, ['dependabot[bot]']);

    expect(listed.trusted).toBe(true);
    expect(listed.source).toBe('allow-list');
    expect(listed.permission).toBeNull();
    expect(unlisted.trusted).toBe(false);
    expect(counting.asked()).toEqual(['octocat']);
  });

  it('matches a listed login whatever its case, as GitHub does', async () => {
    const reading = await trustOf('OctoCat', failing('no lookup should have been made'), ['octocat']);
    const other = await trustOf('octocat', failing('no lookup should have been made'), ['OCTOCAT']);

    expect(reading.trusted).toBe(true);
    expect(other.trusted).toBe(true);
  });

  it('trusts nothing off an empty list, which is the default', async () => {
    const outsider = await trustOf('mallory', answering('read'), []);
    const holder = await trustOf('octocat', answering('write'), []);

    expect(outsider.trusted).toBe(false);
    expect(holder.trusted).toBe(true);
  });

  it('does not let one listed login trust another', async () => {
    const reading = await trustOf('mallory', answering('read'), ['octocat', 'hubot']);

    expect(reading.trusted).toBe(false);
    expect(reading.refusal).toBe('no-write-access');
  });
});

describe('trustRefusalMessage', () => {
  it('spells the refusal the spec gives for an issue whose author holds no write access', async () => {
    const reading = await trustOf('mallory', answering('read'));

    expect(trustRefusalMessage(ISSUE, reading)).toBe(
      'issue #12 was opened by mallory, who has no write access to open-tomato/rafa;'
        + ' a member must open the spec',
    );
  });

  it('names a pull request as itself, with the remedy that item takes', async () => {
    const reading = await trustOf('mallory', answering('read'));
    const item = { kind: 'pull request', number: 33, repo: 'open-tomato/rafa' } as const;

    expect(trustRefusalMessage(item, reading)).toBe(
      'pull request #33 was opened by mallory, who has no write access to open-tomato/rafa;'
        + ' a member must open the pull request',
    );
  });

  it('says a failed lookup could not be read, carrying what failed, rather than claiming no access', async () => {
    const reading = await trustOf('mallory', failing('gh api ... failed: HTTP 403'));

    expect(trustRefusalMessage(ISSUE, reading)).toBe(
      'issue #12 was opened by mallory, whose write access to open-tomato/rafa could not be read'
        + ' (gh api ... failed: HTTP 403); a member must open the spec',
    );
  });

  it('names a failure that reported nothing, so the sentence never trails off empty', () => {
    const reading: TrustReading = {
      login: 'mallory',
      trusted: false,
      source: null,
      refusal: 'lookup-failed',
      permission: { login: 'mallory', permission: null, roleName: null, detail: '' },
    };

    expect(trustRefusalMessage(ISSUE, reading)).toBe(
      'issue #12 was opened by mallory, whose write access to open-tomato/rafa could not be read'
        + ' (the lookup wrote nothing); a member must open the spec',
    );
  });

  it('refuses to spell a refusal for a trusted reading', async () => {
    const reading = await trustOf('octocat', answering('write'));

    expect(() => trustRefusalMessage(ISSUE, reading))
      .toThrow('board trust: octocat is trusted, and has no refusal to name');
  });
});

describe('requireTrustedAuthor', () => {
  it('lets a trusted reading through without throwing', async () => {
    const reading = await trustOf('octocat', answering('write'));

    expect(() => requireTrustedAuthor(ISSUE, reading)).not.toThrow();
  });

  it.each([
    ['an outsider', answering('read')],
    ['a failed lookup', failing('gh: not logged in')],
  ])('refuses %s with exit 2 and the sentence the message spells', async (_label, permissions) => {
    const reading = await trustOf('mallory', permissions);

    let thrown: unknown;
    try {
      requireTrustedAuthor(ISSUE, reading);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(2);
    expect((thrown as CommandExit).message).toBe(trustRefusalMessage(ISSUE, reading));
  });
});
