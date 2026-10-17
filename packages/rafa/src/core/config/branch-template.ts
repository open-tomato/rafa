/**
 * Reading a plan's branch back through the `naming.branch` template.
 *
 * `config-readers.ts` builds a branch from the template
 * (`branchFromTemplate`); this file runs the other way, for a reader that
 * lists or names branches and has to know which of them are rafa's.
 * {@link branchGlob} is the pattern a `git branch --list` or
 * `git for-each-ref` takes, and {@link stubOfBranch} the stub a branch
 * name carries under the template, or null.
 *
 * Only the template given is read. A branch named under another template
 * is no plan branch here, whatever its stub: under `work/{stub}`,
 * `feat/rafa-12-x` answers null. A stub is rafa's when it opens with
 * `rafa-`, the prefix every plan stub carries, so the glob and the
 * reader agree on which branches they take.
 *
 * The template is expected to hold `{stub}` exactly once, as the
 * `naming.branch` reader (`branchTemplate`) holds it; given one that
 * does not, {@link stubOfBranch} answers null for every branch rather
 * than guess which marker the stub sits at.
 */
import { BRANCH_STUB, isBranchTemplate } from './config-readers.js';

/** The prefix every plan stub opens with. */
const STUB_PREFIX = 'rafa-';

/**
 * The glob matching every plan branch the template names: the template
 * with `{stub}` replaced by `rafa-*`.
 *
 * @param template - A `naming.branch` template, such as `feat/{stub}`.
 * @returns The glob, `feat/rafa-*` for the default template.
 */
export function branchGlob(template: string): string {
  return template.replace(BRANCH_STUB, () => `${STUB_PREFIX}*`);
}

/**
 * The stub a branch carries under the template: what lies between the
 * template's part before `{stub}` and its part after, when the branch
 * opens with the one, closes with the other, and the stub between opens
 * with `rafa-`.
 *
 * @param template - A `naming.branch` template, such as `feat/{stub}`.
 * @param branch - A branch name, without `refs/heads/`.
 * @returns The stub, `rafa-12-x` for `feat/rafa-12-x` under the default
 *   template; null for a branch the template does not name.
 */
export function stubOfBranch(template: string, branch: string): string | null {
  if (!isBranchTemplate(template)) return null;
  const [prefix = '', suffix = ''] = template.split(BRANCH_STUB);
  if (branch.length < prefix.length + suffix.length) return null;
  if (!branch.startsWith(prefix) || !branch.endsWith(suffix)) return null;

  const stub = branch.slice(prefix.length, branch.length - suffix.length);
  return stub.startsWith(STUB_PREFIX)
    ? stub
    : null;
}
