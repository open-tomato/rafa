/**
 * The exit code of a board refusal, in a module that imports nothing.
 *
 * It was `./plan-spec.ts`'s, and `./refs-gate.ts` imported it from there
 * for check 4's refusal. `plan-spec.ts` wires the whole board side of
 * `rafa plan create`, so for that one constant the gate imported every
 * module the wiring reaches; here the gate, and any other module that
 * refuses for the board's own state, takes the code without the wiring.
 *
 * The other refusal codes each stay with the check that throws them
 * (`TRUST_REFUSAL_EXIT` in `./trust.ts`, `LEAK_REFUSAL_EXIT` in
 * `./leak.ts`); this file holds only the one that had to move.
 */

/** The exit code a refusal for the board's own state carries; the spec's own. */
export const BOARD_REFUSAL_EXIT: number = 2;
