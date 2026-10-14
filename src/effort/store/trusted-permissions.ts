/**
 * The repository permissions that are write access, which the store's
 * barrel exports on the `./store` subpath and `src/board/trust.ts`
 * re-exports for the trust reading that judges a login by them.
 *
 * They sit in core so the barrel exports them without importing the
 * `board` module above it.
 */

/**
 * The permissions that mean the login may change the repository. The
 * `./store` subpath exports it too (`src/effort/store/index.ts`), so a
 * workspace package checking a login spells write access as core does.
 */
export const TRUSTED_PERMISSIONS = ['admin', 'maintain', 'write'] as const;

/** One of the three permissions that are trust. */
export type TrustedPermission = (typeof TRUSTED_PERMISSIONS)[number];
