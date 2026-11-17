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
 *
 * With {@link FORBIDS_ENV} set to `false`, the stand-in registers with
 * `{ forbids: false }` and its subject names no forbidden headers, as
 * a scheme with no forbidden caller does; `contract.test.ts` holds that
 * the suite still fails a fault under it.
 *
 * The subject carries the stand-in's lifecycle hook and registers with
 * `{ lifecycle: true }` unless {@link LIFECYCLE_ENV} is `false`, which a
 * `forbids: false` run sets too, since the suite refuses the pair. A
 * lifecycle fault changes the subject, its hook and its adapter
 * together, rather than the adapter alone.
 */
import type { IdentityContractSubject } from '../contract.js';
import type { HubIdentity, IdentityAnswer } from '../port.js';

import { identityContract } from '../contract.js';

import { memoryIdentitySubject } from './memory-identity.js';

/** The environment variable naming the fault to plant. */
export const FAULT_ENV = 'RAFA_HUB_IDENTITY_FAULT';

/** The environment variable that, set to `false`, registers with `{ forbids: false }`. */
export const FORBIDS_ENV = 'RAFA_HUB_IDENTITY_FORBIDS';

/** The environment variable that, set to `false`, registers without the lifecycle hook. */
export const LIFECYCLE_ENV = 'RAFA_HUB_IDENTITY_LIFECYCLE';

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

/** The bearer header `request` carries, or the empty string. */
function authorizationOf(request: Request): string {
  return request.headers.get('authorization') ?? '';
}

/** `subject` with its lifecycle hook, which the stand-in always carries. */
function hookOf(subject: IdentityContractSubject): NonNullable<IdentityContractSubject['lifecycle']> {
  if (subject.lifecycle === undefined) throw new Error('broken identity fixture: the stand-in carries no lifecycle hook');
  return subject.lifecycle;
}

/** Each lifecycle fault, as a change to the working stand-in's subject. */
const LIFECYCLE_FAULTS: Readonly<Record<string, (subject: IdentityContractSubject) => IdentityContractSubject>> = {
  'misses-created': (subject) => {
    const hook = hookOf(subject);
    const created = new Set<string>();
    const unknown = new Request('http://hub.test/v1/status', { headers: subject.unrecognised });
    return {
      ...subject,
      identity: { identify: async (request) => created.has(authorizationOf(request))
        ? subject.identity.identify(unknown)
        : subject.identity.identify(request) },
      lifecycle: {
        ...hook,
        create: async (name) => {
          const headers = await hook.create(name);
          created.add(headers['authorization'] ?? '');
          return headers;
        },
      },
    };
  },
  'ignores-pause': (subject) => ({ ...subject, lifecycle: { ...hookOf(subject), pause: () => Promise.resolve() } }),
  'unnamed-pause': (subject) => ({
    ...subject,
    identity: mapAnswers(subject.identity, (answer) => !answer.served && answer.refusal.reason === 'forbidden'
      ? withMessage(answer, 'This credential is paused.')
      : answer),
  }),
  'pauses-every-key': (subject) => {
    const hook = hookOf(subject);
    const names: string[] = [];
    return {
      ...subject,
      lifecycle: {
        ...hook,
        create: (name) => {
          names.push(name);
          return hook.create(name);
        },
        pause: async () => {
          for (const name of names) await hook.pause(name);
        },
      },
    };
  },
  'ignores-delete': (subject) => ({ ...subject, lifecycle: { ...hookOf(subject), delete: () => Promise.resolve() } }),
  'tells-deleted': (subject) => {
    const hook = hookOf(subject);
    const byHeader = new Map<string, string>();
    const deleted = new Set<string>();
    return {
      ...subject,
      identity: mapAnswers(subject.identity, (answer, request) => {
        const name = byHeader.get(authorizationOf(request));
        return name !== undefined && deleted.has(name)
          ? withMessage(answer, `Key ${name} was deleted.`)
          : answer;
      }),
      lifecycle: {
        ...hook,
        create: async (name) => {
          const headers = await hook.create(name);
          byHeader.set(headers['authorization'] ?? '', name);
          return headers;
        },
        delete: async (name) => {
          deleted.add(name);
          await hook.delete(name);
        },
      },
    };
  },
  'serves-unknown': (subject) => {
    const hook = hookOf(subject);
    let createdAny = false;
    return {
      ...subject,
      identity: mapAnswers(subject.identity, (answer, request) => createdAny && authorizationOf(request) !== '' && !answer.served && answer.refusal.reason === 'unauthenticated'
        ? { served: true, caller: { id: 'anyone', provider: 'memory' }, may: ['status.read'] }
        : answer),
      lifecycle: {
        ...hook,
        create: (name) => {
          createdAny = true;
          return hook.create(name);
        },
      },
    };
  },
  'drops-lifecycle': (subject) => ({ ...subject, lifecycle: undefined }),
};

const fault = process.env[FAULT_ENV] ?? '';
const identityFault = FAULTS[fault];
const subjectFault = LIFECYCLE_FAULTS[fault];
const plant = identityFault === undefined
  ? subjectFault
  : (subject: IdentityContractSubject): IdentityContractSubject => ({ ...subject, identity: identityFault(subject.identity) });
if (plant === undefined) {
  throw new Error(`${FAULT_ENV} is ${JSON.stringify(fault)}; expected one of ${[...Object.keys(FAULTS), ...Object.keys(LIFECYCLE_FAULTS)].join(', ')}`);
}

const forbids = process.env[FORBIDS_ENV] !== 'false';
const lifecycle = process.env[LIFECYCLE_ENV] !== 'false';

identityContract(fault, () => {
  const { forbidden, lifecycle: hook, ...planted } = plant(memoryIdentitySubject());
  const withForbidden = forbids
    ? { ...planted, forbidden }
    : planted;
  return lifecycle && hook !== undefined
    ? { ...withForbidden, lifecycle: hook }
    : withForbidden;
}, { forbids, lifecycle });
