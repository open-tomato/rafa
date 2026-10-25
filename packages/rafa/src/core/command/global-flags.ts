/**
 * The flags every command reads, as the root help lists them.
 *
 * {@link GLOBAL_FLAGS} are core's rather than the CLI's because two
 * readers outside one package take them: `src/cli/help.ts`, which lists
 * them in the root help, and `packages/rafa-board/src/refs/verify.ts`, a board file, which
 * reads their names as flags no command declares and still `present`.
 * Board imports core and no CLI file, so the flags sit here, beside the
 * command contract both readers already import.
 *
 * The file imports nothing.
 */

/** A flag every command reads, as the root help lists it. */
export interface GlobalFlag {
  /** The spellings, as a person types them. */
  readonly spelling: string;
  /** What the flag does, in a phrase. */
  readonly note: string;
}

/**
 * The flags the root help lists: the two `assembleContext` reads for
 * every command, typed ahead of the subject or after the action, then
 * `--version`, which `routeLine` reads and which is typed alone.
 */
export const GLOBAL_FLAGS: readonly GlobalFlag[] = Object.freeze([
  { spelling: '--output=json', note: 'NDJSON events instead of text (also RAFA_OUTPUT=json)' },
  { spelling: '--output=events', note: 'one rafa· line per loop event (also RAFA_OUTPUT=events)' },
  { spelling: '-v, --verbose', note: 'up to 3 times, or --verbose=N (also RAFA_VERBOSITY=N)' },
  { spelling: '--version', note: 'print "rafa <version>" and exit; typed alone, no short form' },
]);
