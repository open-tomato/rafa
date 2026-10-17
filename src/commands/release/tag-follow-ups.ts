/**
 * What `rafa release tag` tells the operator to type once a tag is
 * written: the push line, and the publish line for the registry the
 * unit's manifest names. Moved out of `./tag.ts`, which decides and
 * writes the tag; the module note there says why the publish line is
 * text and when a unit gets none.
 *
 * ## A unit in a folder
 *
 * The root package publishes from the checkout's root, so its publish
 * line is `release.publishCommand` as the config spells it. A workspace
 * package publishes from its own folder, so a {@link TagPlace} with a
 * `dir` wraps the command as `(cd <dir> && <publishCommand>)`: the
 * subshell leaves the operator's shell where it was, and the line after
 * it, `git switch <branch>` for a tag behind HEAD, still runs from the
 * root.
 *
 * ## A publish that CI runs
 *
 * Under `release.publish: ci` a pushed tag starts
 * `.github/workflows/release-publish.yml`, which publishes the unit
 * itself, so a command for the operator to type would publish the same
 * version twice. {@link followUpsFor} then names the push line alone,
 * and {@link ciPublishSentence} gives the one sentence that stands where
 * the publish line stood, for exactly the units that would have had
 * one. The workflow path is the ladder's {@link PUBLISH_WORKFLOW}, so
 * the sentence and the doctor row name the same file, and the sentence
 * names the ladder's {@link PUBLISH_SWITCH_VARIABLE} too, since the
 * publish job runs only while that repository variable is `ci`.
 */
import type { ReleasePublishMode } from '@open-tomato/rafa/core/config/sections';

import { PUBLISH_SWITCH_VARIABLE, PUBLISH_WORKFLOW } from '../../release/ladder.js';
import { RELEASE_REMOTE } from '../../release/version.js';

/** The registry a publish reaches when the manifest names none. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** Where a publish would go, read off the version file; see `./tag.ts`'s module note. */
export interface PublishTarget {
  /** `publishConfig.registry`, or {@link DEFAULT_REGISTRY}. */
  readonly registry: string;
  /** The package name, or null when the file names none. */
  readonly name: string | null;
  /** True when the manifest declares `"private": true`. */
  readonly isPrivate: boolean;
}

/** One command the run names for the operator to type next. */
export interface ReleaseFollowUp {
  /** The whole command, as the operator types it. */
  readonly command: string;
  /** Why it applies, in a phrase, lower case and with no full stop. */
  readonly why: string;
}

/** Where the tag went relative to the checkout: how far HEAD is past it, on which branch. */
export interface TagPlace {
  /** First-parent commits HEAD is past the tagged commit. */
  readonly ahead: number;
  /** The branch checked out, which the publish line switches back to. */
  readonly branch: string;
  /**
   * The unit's folder relative to the root, which the publish runs in,
   * or null and absent for the root package; see the module note.
   */
  readonly dir?: string | null;
}

/** A string with something in it, trimmed, or null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === ''
    ? null
    : trimmed;
}

/** `value` as a JSON object's fields, or null when it is anything else. */
function fieldsOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** What a version file that is no manifest at all reads as: nothing to publish. */
const NO_PACKAGE: PublishTarget = Object.freeze({
  registry: DEFAULT_REGISTRY,
  name: null,
  isPrivate: false,
});

/**
 * Where a publish of `text` would go. A text that is no JSON object
 * reads as {@link NO_PACKAGE}, which names no package and so gets no
 * publish line.
 */
export function readPublishTarget(text: string | null): PublishTarget {
  if (text === null) return NO_PACKAGE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_PACKAGE;
  }
  const fields = fieldsOf(parsed);
  if (fields === null) return NO_PACKAGE;

  const publishConfig = fieldsOf(fields['publishConfig']);
  return {
    registry: trimmedOrNull(publishConfig?.['registry']) ?? DEFAULT_REGISTRY,
    name: trimmedOrNull(fields['name']),
    isPrivate: fields['private'] === true,
  };
}

/**
 * The place of a tag written on HEAD itself. `main` is `./tag.ts`'s
 * `DEFAULT_RELEASE_BRANCH`, spelled here because importing it would
 * close a cycle with the module that imports this one.
 */
const ON_HEAD: TagPlace = Object.freeze({ ahead: 0, branch: 'main', dir: null });

/** `publish` as typed from the root: bare for the root package, in a subshell for a folder. */
function publishFrom(publish: string, dir: string | null | undefined): string {
  return dir === null || dir === undefined || dir === ''
    ? publish
    : `(cd ${dir} && ${publish})`;
}

/**
 * The sentence that stands in for the publish line of `tag` under
 * `release.publish: ci`, or null when `target` has nothing to publish,
 * as {@link followUpsFor} would name no publish line for it either.
 */
export function ciPublishSentence(tag: string, version: string, target: PublishTarget): string | null {
  if (target.name === null || target.isPrivate) return null;
  return `Once pushed, ${tag} publishes ${target.name}@${version} to ${target.registry}`
    + ` through ${PUBLISH_WORKFLOW.path} when the repository variable`
    + ` ${PUBLISH_SWITCH_VARIABLE} is ci (release.publish: ci).`;
}

/**
 * What the operator does next once `tag` is written: push it to
 * `pushTo`, unless `pushTo` is `null` because the run pushed it
 * already, and publish `version` with
 * `publish`, `release.publishCommand`, when there is something to
 * publish — in the unit's folder when `place` names one, and from the
 * tag when HEAD is past it. Under `mode` `ci` the publish line is left
 * out, CI publishing the pushed tag; see the module note. Pure and total.
 */
export function followUpsFor(
  tag: string,
  version: string,
  target: PublishTarget,
  publish: string,
  place: TagPlace = ON_HEAD,
  pushTo: string | null = RELEASE_REMOTE,
  mode: ReleasePublishMode = 'manual',
): readonly ReleaseFollowUp[] {
  const push: readonly ReleaseFollowUp[] = pushTo === null
    ? []
    : [{ command: `git push ${pushTo} ${tag}`, why: `the tag is local until ${pushTo} has it` }];
  if (mode === 'ci' || target.name === null || target.isPrivate) return push;
  const publishes = `publishes ${target.name}@${version} to ${target.registry}`;
  const command = publishFrom(publish, place.dir);
  if (place.ahead === 0) return [...push, { command, why: publishes }];
  return [
    ...push,
    {
      command: `git switch --detach ${tag} && ${command} && git switch ${place.branch}`,
      why: `${publishes} from the tagged commit, not HEAD; skip it if ${target.registry} has that version already`,
    },
  ];
}
