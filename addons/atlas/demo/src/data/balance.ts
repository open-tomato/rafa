/**
 * The balance radar: a catalogue of indices, each pulled toward one of three
 * poles, with up to three switched on per pole. Every index is a share or a
 * rate over the same twelve weeks and the same store tables, divided by its
 * own twelve-week median, so 1.0 is "as usual" on every axis and the shape's
 * bulge reads as a tilt toward shipping, the fire or the foundation.
 *
 * Shipping 📦 (growth is good)
 *   feat-rate      feat changes landed per week                  changes.level, commits
 *   plan-done      plans completed / plans started               task_reports, plans
 *   releases       release tags per week                         git tags
 * Failing 🔥 (growth is bad)
 *   bug-intake     bugs filed per 100 task sessions              bug_routes, out_of_scope_bugs
 *   regressions    own-fallout / all bug routes                  bug_routes.kind
 *   red-ci         red readings / all readings                   plan_ci
 *   blocked        blocked + repeat sessions / task sessions     task_reports, sessions
 * Foundation 🛠️ (growth is investment)
 *   refactor-share refactor + chore minutes / all minutes        changes.level, sessions
 *   docs-share     docs changes + stale docs cleared / changes   changes, stale_docs
 */
import type { RadarAxis, RadarPole, RadarSeries } from '@open-tomato/charts';

export type PoleId = 'shipping' | 'failing' | 'foundation';

export const BALANCE_POLES: RadarPole[] = [
  { id: 'shipping', label: 'Shipping', icon: '📦', tone: 'pole-ship', coreTone: 'pole-ship-core' },
  { id: 'failing', label: 'Failing', icon: '🔥', tone: 'pole-fail', coreTone: 'pole-fail-core' },
  { id: 'foundation', label: 'Foundation', icon: '🛠️', tone: 'pole-base', coreTone: 'pole-base-core' },
];

/** How many indices one pole can show at once. */
export const BALANCE_MAX_PER_POLE = 3;

export interface BalanceIndex {
  id: string;
  label: string;
  pole: PoleId;
  /** What the ratio divides, in one phrase. */
  definition: string;
  /** The store tables the ratio reads. */
  tables: string;
  /** This week over the twelve-week median. */
  value: number;
  /** Switched on by default. */
  on: boolean;
}

/** The catalogue, in the order the axes are drawn (poles contiguous, clockwise from the top). */
export const BALANCE_CATALOGUE: BalanceIndex[] = [
  { id: 'feat-rate', label: 'features landed', pole: 'shipping', definition: 'feat changes landed per week', tables: 'changes.level, commits', value: 1.35, on: true },
  { id: 'plan-done', label: 'plans completed', pole: 'shipping', definition: 'plans completed / plans started', tables: 'task_reports, plans', value: 1.2, on: true },
  { id: 'releases', label: 'releases', pole: 'shipping', definition: 'release tags per week', tables: 'git tags', value: 1.5, on: true },
  { id: 'bug-intake', label: 'bugs per 100 tasks', pole: 'failing', definition: 'bugs filed per 100 task sessions', tables: 'bug_routes, out_of_scope_bugs', value: 1.1, on: true },
  { id: 'regressions', label: 'regression share', pole: 'failing', definition: 'own-fallout / all bug routes', tables: 'bug_routes.kind', value: 1.45, on: true },
  { id: 'red-ci', label: 'red CI share', pole: 'failing', definition: 'red readings / all readings', tables: 'plan_ci', value: 0.7, on: false },
  { id: 'blocked', label: 'blocked or repeated', pole: 'failing', definition: 'blocked + repeat sessions / task sessions', tables: 'task_reports, sessions', value: 1.25, on: true },
  { id: 'refactor-share', label: 'refactor + chore', pole: 'foundation', definition: 'refactor + chore minutes / all minutes', tables: 'changes.level, sessions', value: 0.55, on: true },
  { id: 'docs-share', label: 'docs kept current', pole: 'foundation', definition: 'docs changes + stale docs cleared / changes', tables: 'changes, stale_docs', value: 0.8, on: true },
];

export const BALANCE_MAX = 2;

/** The twelve-week window the medians come from. */
export const BALANCE_WINDOW_WEEKS = 12;

/** The ids switched on by default. */
export function defaultEnabled(catalogue: readonly BalanceIndex[] = BALANCE_CATALOGUE): ReadonlySet<string> {
  return new Set(catalogue.filter((index) => index.on).map((index) => index.id));
}

/** How many of a pole's indices are on. */
export function countOn(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>, pole: PoleId): number {
  return catalogue.filter((index) => index.pole === pole && enabled.has(index.id)).length;
}

/** True when `id` can be switched on: its pole still has room. */
export function canEnable(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>, id: string): boolean {
  const index = catalogue.find((entry) => entry.id === id);
  return index !== undefined && countOn(catalogue, enabled, index.pole) < BALANCE_MAX_PER_POLE;
}

/** The enabled set with `id` flipped, refusing a fourth index on a pole and an empty pole. */
export function toggleIndex(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const index = catalogue.find((entry) => entry.id === id);
  if (!index) return enabled;
  if (enabled.has(id)) {
    if (countOn(catalogue, enabled, index.pole) <= 1) return enabled;
    return new Set([...enabled].filter((entry) => entry !== id));
  }
  return canEnable(catalogue, enabled, id)
    ? new Set([...enabled, id])
    : enabled;
}

/** The enabled indices in catalogue order, as the radar's axes. */
export function balanceAxes(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>): RadarAxis[] {
  return catalogue.filter((index) => enabled.has(index.id)).map((index) => ({ id: index.id, label: index.label, pole: index.pole }));
}

/** This week's shape over the enabled axes. */
export function balanceSeries(catalogue: readonly BalanceIndex[], enabled: ReadonlySet<string>): RadarSeries[] {
  return [{ id: 'now', label: 'This week', tone: 'neutral', values: catalogue.filter((index) => enabled.has(index.id)).map((index) => index.value) }];
}
