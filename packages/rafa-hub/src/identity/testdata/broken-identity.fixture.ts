/**
 * The identity contract suite run against the stand-in with one rule
 * broken, the fault {@link FAULT_ENV} names, so `contract.test.ts` can
 * hold that the suite fails an adapter breaking that rule. Named
 * without `.test` so the full suite never runs it: `contract.test.ts`
 * spawns `bun test` on this file's path, once per fault and once with
 * `none` as the control that the harness itself passes.
 *
 * Each fault wraps the working stand-in rather than forking it, so the
 * one rule it breaks is the only difference.
 */
import type { HubIdentity, IdentityAnswer } from '../port.js';

import { identityContract } from '../contract.js';

import { memoryIdentitySubject } from './memory-identity.js';

/** The environment variable naming the fault to plant. */
export const FAULT_ENV = 'RAFA_HUB_IDENTITY_FAULT';

/** `identity` with every answer passed through `change`. */
function mapAnswers(identity: HubIdentity, change: (answer: IdentityAnswer, request: Request) => IdentityAnswer): HubIdentity {
  return { identify: async (request) => change(await identity.identify(request), request) };
}

/** `answer` with its refusal message replaced, when it is a refusal. */
function withMessage(answer: IdentityAnswer, message: string): IdentityAnswer {
  return answer.served
    ? answer
    : { ...answer, refusal: { ...answer.refusal, message } };
}

/** Each fault, as a change to the working stand-in. */
const FAULTS: Readonly<Record<string, (identity: HubIdentity) => HubIdentity>> = {
  'none': (identity) => identity,
  'serves-anonymous': (identity) => mapAnswers(identity, (answer, request) => request.headers.has('authorization')
    ? answer
    : { served: true, caller: { id: 'anonymous', provider: 'memory' }, may: ['status.read'] }),
  'forbids-unrecognised': (identity) => mapAnswers(identity, (answer) => !answer.served && answer.refusal.reason === 'unauthenticated'
    ? { ...answer, refusal: { ...answer.refusal, reason: 'forbidden' } }
    : answer),
  'unauthenticates-forbidden': (identity) => mapAnswers(identity, (answer) => !answer.served && answer.refusal.reason === 'forbidden'
    ? { ...answer, refusal: { ...answer.refusal, reason: 'unauthenticated' } }
    : answer),
  'echoes-credential': (identity) => mapAnswers(identity, (answer, request) => withMessage(answer, `Refused ${request.headers.get('authorization') ?? 'nothing'}.`)),
  'splits-message': (identity) => mapAnswers(identity, (answer) => withMessage(answer, 'Refused.\nAsk an admin.')),
  'grants-nothing': (identity) => mapAnswers(identity, (answer) => answer.served
    ? { ...answer, may: [] }
    : answer),
  'grants-unknown': (identity) => mapAnswers(identity, (answer) => answer.served
    ? { ...answer, may: [...answer.may, 'effort.delete' as never] }
    : answer),
  'repeats-action': (identity) => mapAnswers(identity, (answer) => answer.served
    ? { ...answer, may: [...answer.may, 'effort.pull'] }
    : answer),
  'drifts': (identity) => {
    let asked = 0;
    return mapAnswers(identity, (answer) => {
      asked += 1;
      return answer.served
        ? { ...answer, caller: { ...answer.caller, id: `caller-${String(asked)}` } }
        : answer;
    });
  },
  'route-bound': (identity) => mapAnswers(identity, (answer, request) => answer.served && request.method === 'POST'
    ? { ...answer, may: ['effort.push'] }
    : answer),
  'remembers-caller': (identity) => {
    let last: IdentityAnswer | undefined;
    return {
      identify: async (request) => {
        const answer = await identity.identify(request);
        if (answer.served) last = answer;
        return answer.served || last === undefined
          ? answer
          : last;
      },
    };
  },
  'reads-body': (identity) => ({
    identify: async (request) => {
      await request.text();
      return identity.identify(request);
    },
  }),
};

const fault = process.env[FAULT_ENV] ?? '';
const plant = FAULTS[fault];
if (plant === undefined) throw new Error(`${FAULT_ENV} is ${JSON.stringify(fault)}; expected one of ${Object.keys(FAULTS).join(', ')}`);

identityContract(fault, () => {
  const subject = memoryIdentitySubject();
  return { ...subject, identity: plant(subject.identity) };
});
