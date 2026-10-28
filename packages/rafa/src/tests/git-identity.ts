/**
 * The git identity every isolating test fixture hands git, so a commit
 * in a scratch repository never depends on an identity the host holds.
 *
 * A fixture that points `GIT_CONFIG_GLOBAL` at a scratch file, or at
 * `/dev/null`, hides the operator's `~/.gitconfig`, and with it the
 * `user.name` and `user.email` git needs to commit: on a host whose
 * identity lives only there, such a commit fails with
 * `Author identity unknown`. Git reads the four `GIT_AUTHOR_*` and
 * `GIT_COMMITTER_*` variables before any configuration file, so
 * spreading {@link gitIdentityEnv} into the same environment object
 * that sets `GIT_CONFIG_GLOBAL` makes the commit succeed wherever the
 * fixture runs.
 *
 * @module tests/git-identity
 */

/** The name every isolating fixture commits under. */
const TEST_NAME = 'rafa test';

/** The address every isolating fixture commits under, in the reserved `example.test` domain. */
const TEST_EMAIL = 'rafa@example.test';

/**
 * The four identity variables git reads before any configuration file,
 * set to a fixed test name and address. Spread it into every
 * environment object that sets `GIT_CONFIG_GLOBAL`; see the module note.
 * Each call answers a new object.
 */
export function gitIdentityEnv(): Readonly<Record<string, string>> {
  return {
    GIT_AUTHOR_NAME: TEST_NAME,
    GIT_AUTHOR_EMAIL: TEST_EMAIL,
    GIT_COMMITTER_NAME: TEST_NAME,
    GIT_COMMITTER_EMAIL: TEST_EMAIL,
  };
}
