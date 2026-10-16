/**
 * The four `claim` commands as declarations: each command less its
 * `run`, with the subject they sit under and the flags their help spells.
 *
 * ## Why the declarations sit apart from the commands
 *
 * A declaration is every field routing, help, `describe` and the spend
 * guard read (`CommandDeclaration`, `@open-tomato/rafa/core/command`).
 * `createClaimReleaseCommand`, `createClaimHandCommand`,
 * `createClaimAcceptCommand` and `createClaimTakeCommand` each spread
 * their declaration under their own `run`, so the command a module
 * exports carries the fields declared here, and `RUN_FEATURE`
 * (`./index.ts`) can name, route and render the four without loading
 * any of them. None starts a session, so none declares `spends`.
 *
 * ## What this file imports
 *
 * Types alone, from `@open-tomato/rafa/core/command`, and no module
 * under `src/`: a value import of a command's helper would load it with
 * the roster and undo the laziness. So the constants a declaration
 * spells and a module also reads live here, and the modules import them
 * from here: `CLAIM_HAND_TO_FLAG` and `CLAIM_HAND_WITHDRAW_FLAG`
 * (`hand.ts`) and `CLAIM_TAKE_STALE_FLAG` (`take.ts`).
 */
import type { CommandDeclaration, SubjectSpec } from '@open-tomato/rafa/core/command';

/** The `claim` subject: its routing word and its roster line. */
export const CLAIM_SUBJECT: SubjectSpec = Object.freeze({
  name: 'claim',
  summary: 'give up this device\'s claim on an issue; hand it to another store or withdraw the offer; accept a handover; take over a stale claim',
});

/** The flag of `claim hand` naming the receiving store. */
export const CLAIM_HAND_TO_FLAG = 'to';

/** The flag of `claim hand` taking a pending handover back. */
export const CLAIM_HAND_WITHDRAW_FLAG = 'withdraw';

/** The flag of `claim take` that widens a takeover to a claim in development. */
export const CLAIM_TAKE_STALE_FLAG = 'stale';

/** `rafa claim release <n>`: see `release.ts` for what it reads and pushes. */
export const CLAIM_RELEASE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'claim release',
  subject: 'claim',
  action: 'release',
  summary: 'give up this device\'s claim on an issue, and take its stage label off',
  description: 'Pushes one release commit to the issue\'s claim branch on origin, leased on the tip it'
    + ' read, so no other device\'s push is overwritten, then takes `rafa:claimed` or'
    + ' `rafa:in-development` off the issue; a label that cannot be written is a warning beside a'
    + ' release that stands. Refused when this device does not own the claim, when the branch moved'
    + ' meanwhile, and when origin cannot be reached. No local branch moves. With `--output=json`'
    + ' the issue, the branch, the store and the release commit are the data of the terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The issue number whose claim this device gives up.',
      type: 'string',
      required: true,
    },
  ],
  flags: [],
  examples: [
    {
      cmd: 'rafa claim release 324',
      note: 'Releases this device\'s claim on #324 and takes its stage label off.',
    },
    {
      cmd: 'rafa claim release 324 --output=json',
      note: 'Writes a start event, then a result event whose data holds the branch and the release commit.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `rafa claim hand <n> --to=<store id> [--withdraw]`: see `hand.ts` for what it reads and pushes. */
export const CLAIM_HAND_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'claim hand',
  subject: 'claim',
  action: 'hand',
  summary: 'offer this device\'s claim on an issue to another store, or withdraw the offer',
  description: 'Pushes one handover commit naming the receiving store to the issue\'s claim branch on'
    + ' origin, leased on the tip it read, so no other device\'s push is overwritten. This device stays'
    + ' the owner until the receiver runs `rafa claim accept`, and until then `--withdraw` pushes a'
    + ' withdraw commit that ends the offer. Refused when this device does not own the claim, for a'
    + ' repeat handover to the same store, for a withdraw with no handover pending, when the branch'
    + ' moved meanwhile, and when origin cannot be reached. No label and no local branch moves. With'
    + ' `--output=json` the issue, the branch, the stores and the commit are the data of the terminal'
    + ' result event.',
  args: [
    {
      name: 'n',
      description: 'The issue number whose claim this device hands over.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: CLAIM_HAND_TO_FLAG,
      description: 'The store id to offer the claim to: the receiving store\'s `store_meta.store_id`.',
      type: 'string',
    },
    {
      name: CLAIM_HAND_WITHDRAW_FLAG,
      description: 'Take a pending handover back instead; this device keeps the claim.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa claim hand 324 --to=0b9c6f1e-4d2a-4c55-9a8e-2f7d1c3b5a60',
      note: 'Offers the claim on #324 to that store; it becomes the owner once it accepts.',
    },
    {
      cmd: 'rafa claim hand 324 --withdraw',
      note: 'Takes the pending offer back before the receiver accepts it.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `rafa claim accept <n>`: see `accept.ts` for what it reads and pushes. */
export const CLAIM_ACCEPT_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'claim accept',
  subject: 'claim',
  action: 'accept',
  summary: 'take up a handover of an issue\'s claim offered to this device',
  description: 'Pushes one accept commit naming this device\'s store to the issue\'s claim branch on'
    + ' origin, leased on the tip it read, so this device owns the claim from then on and no other'
    + ' device\'s push is overwritten. Refused when no handover pending on the branch names this'
    + ' device\'s store, when the handover was withdrawn or replaced, when the branch moved meanwhile,'
    + ' and when origin cannot be reached. No label and no local branch moves. With `--output=json`'
    + ' the issue, the branch, the stores and the commits are the data of the terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The issue number whose handover this device accepts.',
      type: 'string',
      required: true,
    },
  ],
  flags: [],
  examples: [
    {
      cmd: 'rafa claim accept 324',
      note: 'Accepts the handover of #324 offered to this device\'s store; this device owns the claim from then on.',
    },
    {
      cmd: 'rafa claim accept 324 --output=json',
      note: 'Writes a start event, then a result event whose data holds the branch and the accept commit.',
    },
  ],
  outputs: ['text', 'json'],
});

/** `rafa claim take <n> [--stale]`: see `take.ts` for what it reads and pushes. */
export const CLAIM_TAKE_DECLARATION: CommandDeclaration = Object.freeze<CommandDeclaration>({
  name: 'claim take',
  subject: 'claim',
  action: 'take',
  summary: 'take over another device\'s stale claim on an issue',
  description: 'Pushes one take commit naming this device\'s store to the issue\'s claim branch on'
    + ' origin, leased on the tip it read, so this device owns the claim from then on and an owner'
    + ' that pushed meanwhile is never overwritten. Refused while the claim has stood less than'
    + ' `claims.staleAfter`, whenever that is `disabled`, and for a stale claim in development'
    + ' (`rafa:in-development`, or labels that cannot be read) unless `--stale` is given. A released'
    + ' claim is taken as it is. No label and no local branch moves. With `--output=json` the issue,'
    + ' the branch, the stores and the take commit are the data of the terminal result event.',
  args: [
    {
      name: 'n',
      description: 'The issue number whose claim this device takes over.',
      type: 'string',
      required: true,
    },
  ],
  flags: [
    {
      name: CLAIM_TAKE_STALE_FLAG,
      description: 'Also take a stale claim in development, which is never taken over without it.',
      type: 'boolean',
    },
  ],
  examples: [
    {
      cmd: 'rafa claim take 324',
      note: 'Takes over the claim on #324 once it has stood claims.staleAfter at rafa:claimed.',
    },
    {
      cmd: 'rafa claim take 324 --stale',
      note: 'Takes over a stale claim whose loop was started, at rafa:in-development.',
    },
  ],
  outputs: ['text', 'json'],
});
