/**
 * The service registry: the functions of a higher package that a lower
 * one calls, handed to core by the root so the lower package imports
 * core and never the higher one.
 *
 * ## Why it exists
 *
 * A package may not import a package that moves after it. Board moves
 * before run, pr and release, and release before pr and run, and a
 * command of a lower package, board or release, calls a function of a
 * higher one that reaches too far into its package to move into core:
 * four of board's commands and release's `rafa release settle`. Each
 * such function is a key of {@link RafaServices}; the lower package
 * calls it through {@link activeServices}, and the composition root
 * `src/service-registry.ts`, outside `packages/rafa/src/core/`, imports
 * the real function from the higher package's facade and registers it.
 * This module is the registry in the form of the adapter registry
 * (`packages/rafa/src/core/adapters/registry.ts`): a typed slot, a frozen
 * facade over it, and the functions that register, restore and read it.
 *
 * ## The rule for a key
 *
 * A key enters only when a lower package needs a higher package's
 * function that cannot move into core, and each key carries its reason
 * in {@link SERVICE_REASONS}: the lower package, the higher one, the
 * function's file and its reach, the count of files outside
 * `packages/rafa/` that file reaches on `docs/survey/import-graph.json`
 * over value and type edges, tests excluded, the home itself not
 * counted, read at aec5e4a for board's four keys and on the graph the
 * base of decouple 6 held, last written at 76ebfc2, for release's
 * `pullRequestsIn`. The
 * mapped type of {@link SERVICE_REASONS} makes a key with no reason a
 * `tsc` failure. A function that is pure, or reaches nothing past core,
 * moves into core instead and is no key here.
 *
 * ## The whole set, every time
 *
 * {@link registerServices} takes a whole {@link RafaServices}, never a
 * part of one, so a root that leaves a key out fails `tsc`, and the
 * root's `CORE_SERVICES` `satisfies RafaServices`, so a real function
 * that drifts from its key's type fails there too. At run time each
 * member is checked to be a function before any is held, and the set is
 * copied and frozen as it is accepted, so nothing changes it afterwards.
 *
 * ## The active set
 *
 * The one module-level value is the active set, null until something
 * registers, and it is replaced, never changed: {@link registerServices}
 * replaces it and answers the set it replaced, or null, and
 * {@link restoreServices} puts one back. Bun runs every test file in one
 * process, so a case that registers stubs puts the previous set back in
 * a `finally`, or every file after it calls its stubs.
 *
 * {@link activeServices} answers a frozen facade, never the set itself.
 * Each member reads the active set when it is called, so a caller may
 * take hold of the facade before the root runs, and while nothing is
 * registered each member throws an `Error` naming its key and the root.
 * `activeServices()` itself never throws.
 *
 * ## What core registers
 *
 * Nothing: this module imports `./shapes.ts`, for types, and no other
 * file. `registerCoreServices` of `src/service-registry.ts` registers
 * the real functions when it is called; importing it registers nothing.
 */
import type {
  AddStaleDocLineService,
  EndWithNextStepService,
  PullRequestsInService,
  ReadStaleDocsVersionService,
  TriageReportService,
} from './shapes.js';

/** What every refusal opens with. */
const REFUSAL = 'service registry';

/** The module that registers the real services, as a refusal names it. */
const COMPOSITION_ROOT = 'src/service-registry.ts';

/**
 * The functions a lower package calls of a higher one, one key each.
 * Each member is a property signature, as every port function is.
 */
export interface RafaServices {
  /** release's `addStaleDocLine`, for `rafa epic close`. */
  readonly addStaleDocLine: AddStaleDocLineService;
  /** run's `endWithNextStep`, for `rafa issue ready`. */
  readonly endWithNextStep: EndWithNextStepService;
  /** pr's `ghPullRequestsIn`, for `rafa release settle`. */
  readonly pullRequestsIn: PullRequestsInService;
  /** run's `readStaleDocsVersion`, for `rafa epic close`. */
  readonly readStaleDocsVersion: ReadStaleDocsVersionService;
  /** pr's `triageReport`, for `rafa epic close`. */
  readonly triageReport: TriageReportService;
}

/** Why one key is a service and not a move into core; see the module note. */
export interface ServiceReason {
  /** The lower package whose command calls the service, board or release. */
  readonly lower: 'board' | 'release';
  /** The package the function lives in. */
  readonly higher: 'pr' | 'release' | 'run';
  /** The function's file, repository-relative, where it stands now; its reach was read where it stood then; see the module note. */
  readonly home: string;
  /** The files outside `packages/rafa/` the home reaches on the import graph; see the module note. */
  readonly reach: number;
  /** One sentence: who calls it, and why it cannot move into core. */
  readonly why: string;
}

/** The reason of each key, frozen, keys sorted. */
export const SERVICE_REASONS: { readonly [K in keyof RafaServices]: ServiceReason } = Object.freeze({
  addStaleDocLine: Object.freeze<ServiceReason>({
    lower: 'board',
    higher: 'release',
    home: 'packages/rafa-release/src/docs/release-issue.ts',
    reach: 6,
    why: 'rafa epic close adds a docs-only criterion to the stale-docs issue, whose module reads the release version'
      + ' helpers of packages/rafa-release/src/release/.',
  }),
  endWithNextStep: Object.freeze<ServiceReason>({
    lower: 'board',
    higher: 'run',
    home: 'src/next/ending.ts',
    reach: 119,
    why: 'rafa issue ready ends naming the next step, which reads the whole next-step state and runs its action'
      + ' through run\'s dispatch.',
  }),
  pullRequestsIn: Object.freeze<ServiceReason>({
    lower: 'release',
    higher: 'pr',
    home: 'src/pr/gh.ts',
    reach: 9,
    why: 'rafa release settle opens its release pull request through the gh provider, which reaches board\'s gh runner'
      + ' and pr\'s check readers.',
  }),
  readStaleDocsVersion: Object.freeze<ServiceReason>({
    lower: 'board',
    higher: 'run',
    home: 'src/start/stale-docs.ts',
    reach: 165,
    why: 'rafa epic close titles the stale-docs issue by the release forecast, which run reads through the tracker'
      + ' chain and the release fold.',
  }),
  triageReport: Object.freeze<ServiceReason>({
    lower: 'board',
    higher: 'pr',
    home: 'src/triage/triage.ts',
    reach: 66,
    why: 'rafa epic close files each failed criterion as a bug, which pr\'s triage files, comments on or skips over'
      + ' its trackers and store.',
  }),
});

/** The keys, as a refusal and the check read them. */
const SERVICE_KEYS = Object.keys(SERVICE_REASONS) as readonly (keyof RafaServices)[];

/** The set {@link activeServices} reads at call time; null until something registers. */
let active: RafaServices | null = null;

/** How a refusal names a value that is not a function. */
function describeKind(value: unknown): string {
  return value === null
    ? 'null'
    : typeof value;
}

/**
 * A set as the registry keeps it: every key checked to be a function,
 * then copied and frozen.
 *
 * Throws a `TypeError` naming the first key whose member is not a
 * function, and one refusing the facade itself, whose members read the
 * active set and would call themselves once held.
 */
function accept(services: RafaServices): RafaServices {
  if (services === FACADE) {
    throw new TypeError(
      `${REFUSAL}: activeServices() reads the active set and cannot be held as one;`
        + ' hold what registerServices answered, or a set of functions',
    );
  }
  if (typeof services !== 'object' || services === null) {
    throw new TypeError(`${REFUSAL}: a service set is ${describeKind(services)}, expected a mapping`);
  }
  for (const key of SERVICE_KEYS) {
    const member: unknown = services[key];
    if (typeof member !== 'function') {
      throw new TypeError(`${REFUSAL}: ${key} is ${describeKind(member)}, expected a function`);
    }
  }
  return Object.freeze<RafaServices>({
    addStaleDocLine: services.addStaleDocLine,
    endWithNextStep: services.endWithNextStep,
    pullRequestsIn: services.pullRequestsIn,
    readStaleDocsVersion: services.readStaleDocsVersion,
    triageReport: services.triageReport,
  });
}

/**
 * Makes `services` the active set and answers the set it replaced, or
 * null when none was held, for {@link restoreServices}.
 *
 * Throws, leaving the active set as it was, when a member is not a
 * function or `services` is the facade {@link activeServices} answers.
 */
export function registerServices(services: RafaServices): RafaServices | null {
  const accepted = accept(services);
  const previous = active;
  active = accepted;
  return previous;
}

/**
 * Puts `previous` back as the active set: what {@link registerServices}
 * answered, null among it, which is the registry before anything
 * registered.
 *
 * Throws, leaving the active set as it was, on what
 * {@link registerServices} refuses.
 */
export function restoreServices(previous: RafaServices | null): void {
  active = previous === null
    ? null
    : accept(previous);
}

/** The active set, or a refusal naming `key` and the root. */
function held(key: keyof RafaServices): RafaServices {
  if (active === null) {
    throw new Error(
      `${REFUSAL}: no service is registered: call registerCoreServices() from ${COMPOSITION_ROOT}`
        + ` before calling ${key}`,
    );
  }
  return active;
}

/** The facade {@link activeServices} answers; see the module note. */
const FACADE: RafaServices = Object.freeze<RafaServices>({
  addStaleDocLine: (options) => held('addStaleDocLine').addStaleDocLine(options),
  endWithNextStep: (context, seams) => held('endWithNextStep').endWithNextStep(context, seams),
  pullRequestsIn: (root) => held('pullRequestsIn').pullRequestsIn(root),
  readStaleDocsVersion: (options) => held('readStaleDocsVersion').readStaleDocsVersion(options),
  triageReport: (options) => held('triageReport').triageReport(options),
});

/**
 * The services, as a frozen facade whose every member reads the active
 * set when it is called, so a caller holding it calls what was
 * registered after it took hold of it. Never throws; a member called
 * while nothing is registered throws an `Error` naming its key and
 * `src/service-registry.ts`.
 */
export function activeServices(): RafaServices {
  return FACADE;
}
