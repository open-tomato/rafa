/**
 * The page's URL parameters: `?lens=`, `?theme=` and `?still` (no mount
 * animation, for captures). Read once where a module needs them, written
 * with `replaceState` so the address bar follows the shell's state.
 */

/** A parameter's value when it is one of `allowed`, otherwise null. */
export function readParam<T extends string>(name: string, allowed: readonly T[]): T | null {
  const value = new URLSearchParams(location.search).get(name);
  return allowed.find((entry) => entry === value) ?? null;
}

/** Sets a parameter, or drops it when `value` is null, without a navigation. */
export function writeParam(name: string, value: string | null): void {
  const search = new URLSearchParams(location.search);
  if (value === null) search.delete(name);
  else search.set(name, value);
  // A flag such as `still` has no value: keep it as `still`, not `still=`.
  history.replaceState(null, '', `?${search.toString().replaceAll(/=(?=&|$)/gu, '')}`);
}

/** Whether the page was opened with `?still`: every card then draws without animation. */
export function isStill(): boolean {
  return new URLSearchParams(location.search).has('still');
}
