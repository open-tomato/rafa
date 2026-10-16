/**
 * Tests for `tag-follow-ups.ts`: where a publish would go, read off a
 * manifest's text, and the push and publish lines a written tag gets.
 * Both are pure, so every case is driven from literals.
 *
 * Each `dir` case is paired with the same call without one, which
 * prints the bare command, so a wrap that fired for the root package
 * too, or never, would redden.
 */
import type { PublishTarget } from './tag-follow-ups.js';

import { describe, expect, it } from 'bun:test';

import { RELEASE_REMOTE } from '../../release/version.js';

import { ciPublishSentence, DEFAULT_REGISTRY, followUpsFor, readPublishTarget } from './tag-follow-ups.js';

const VERSION = '0.5.0';
const TAG = `v${VERSION}`;
const DEFAULT_PUBLISH = 'npm publish';

/** A publish target, narrowed by `over`. */
function target(over: Partial<PublishTarget> = {}): PublishTarget {
  return { registry: DEFAULT_REGISTRY, name: '@open-tomato/rafa', isPrivate: false, ...over };
}

describe('where a publish would go', () => {
  it('reads the name and the registry publishConfig names, and nothing off packageManager', () => {
    const manifest = JSON.stringify({
      name: '@open-tomato/rafa',
      version: VERSION,
      packageManager: 'bun@1.3.14',
      publishConfig: { registry: 'https://npm.example.com' },
    });

    expect(readPublishTarget(manifest)).toEqual({
      registry: 'https://npm.example.com',
      name: '@open-tomato/rafa',
      isPrivate: false,
    });
  });

  it('falls back to the npm registry when the manifest names none', () => {
    expect(readPublishTarget('{"name": "a", "version": "1.0.0"}'))
      .toEqual({ registry: DEFAULT_REGISTRY, name: 'a', isPrivate: false });
  });

  it('reads a private manifest as private', () => {
    expect(readPublishTarget('{"name": "a", "private": true}').isPrivate).toBe(true);
  });

  it('names no package for a text that is no JSON object, and for no text at all', () => {
    expect(readPublishTarget('not json').name).toBeNull();
    expect(readPublishTarget('[]').name).toBeNull();
    expect(readPublishTarget(null).name).toBeNull();
  });
});

describe('what the operator is told to do next', () => {
  it('names the push and the publish, the publish saying what goes where', () => {
    const followUps = followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH);

    expect(followUps.map((followUp) => followUp.command))
      .toEqual([`git push ${RELEASE_REMOTE} ${TAG}`, DEFAULT_PUBLISH]);
    expect(followUps[1]?.why).toBe(`publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`);
  });

  it('names the publish command it is handed, flags and all', () => {
    expect(followUpsFor(TAG, VERSION, target(), 'pnpm publish --tag next')[1]?.command)
      .toBe('pnpm publish --tag next');
  });

  it('names the push alone for a private package, where the same one public gets a publish line', () => {
    expect(followUpsFor(TAG, VERSION, target({ isPrivate: true }), DEFAULT_PUBLISH).map((each) => each.command))
      .toEqual([`git push ${RELEASE_REMOTE} ${TAG}`]);
    expect(followUpsFor(TAG, VERSION, target({ isPrivate: false }), DEFAULT_PUBLISH)).toHaveLength(2);
  });

  it('names the push alone when the version file names no package to publish', () => {
    expect(followUpsFor(TAG, VERSION, target({ name: null }), DEFAULT_PUBLISH)).toHaveLength(1);
  });

  it('names the remote it is handed in the push line', () => {
    expect(followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, { ahead: 0, branch: 'main' }, 'upstream')[0])
      .toEqual({ command: `git push upstream ${TAG}`, why: 'the tag is local until upstream has it' });
  });

  it('drops the push line once the run pushed the tag, keeping the publish line', () => {
    expect(followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, { ahead: 0, branch: 'main' }, null)
      .map((each) => each.command)).toEqual([DEFAULT_PUBLISH]);
    expect(followUpsFor(TAG, VERSION, target({ isPrivate: true }), DEFAULT_PUBLISH, { ahead: 0, branch: 'main' }, null))
      .toEqual([]);
  });
});

describe('a unit published from its own folder', () => {
  const pkgTag = '@scope/plugin@0.2.0';
  const plugin = target({ name: '@scope/plugin' });

  it('wraps the publish in a subshell in the folder, and leaves the root bare', () => {
    expect(followUpsFor(pkgTag, '0.2.0', plugin, DEFAULT_PUBLISH, { ahead: 0, branch: 'main', dir: 'packages/plugin' }, null))
      .toEqual([{
        command: `(cd packages/plugin && ${DEFAULT_PUBLISH})`,
        why: `publishes @scope/plugin@0.2.0 to ${DEFAULT_REGISTRY}`,
      }]);
    expect(followUpsFor(pkgTag, '0.2.0', plugin, DEFAULT_PUBLISH, { ahead: 0, branch: 'main', dir: null }, null)
      .map((each) => each.command)).toEqual([DEFAULT_PUBLISH]);
  });

  it('switches to the tag, publishes in the folder and switches back when HEAD is past the tag', () => {
    expect(followUpsFor(pkgTag, '0.2.0', plugin, DEFAULT_PUBLISH, { ahead: 2, branch: 'main', dir: 'packages/plugin' })
      .map((each) => each.command)).toEqual([
      `git push ${RELEASE_REMOTE} ${pkgTag}`,
      `git switch --detach ${pkgTag} && (cd packages/plugin && ${DEFAULT_PUBLISH}) && git switch main`,
    ]);
  });

  it('names no publish line for a private package, folder or not', () => {
    expect(followUpsFor(pkgTag, '0.2.0', target({ isPrivate: true }), DEFAULT_PUBLISH, { ahead: 0, branch: 'main', dir: 'packages/plugin' }, null))
      .toEqual([]);
  });
});

describe('a publish that CI runs, under release.publish: ci', () => {
  const onHead = { ahead: 0, branch: 'main' };
  const sentence = `Once pushed, ${TAG} publishes @open-tomato/rafa@${VERSION} to ${DEFAULT_REGISTRY}`
    + ' through .github/workflows/release-publish.yml (release.publish: ci).';

  it('names the push alone under ci, where the same call under manual adds the publish line', () => {
    expect(followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, onHead, RELEASE_REMOTE, 'ci')
      .map((each) => each.command)).toEqual([`git push ${RELEASE_REMOTE} ${TAG}`]);
    expect(followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, onHead, RELEASE_REMOTE, 'manual')
      .map((each) => each.command)).toEqual([`git push ${RELEASE_REMOTE} ${TAG}`, DEFAULT_PUBLISH]);
  });

  it('names nothing under ci once the run pushed the tag, behind HEAD and in a folder too', () => {
    expect(followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, onHead, null, 'ci')).toEqual([]);
    expect(followUpsFor(TAG, VERSION, target(), DEFAULT_PUBLISH, { ahead: 2, branch: 'main', dir: 'packages/plugin' }, null, 'ci'))
      .toEqual([]);
  });

  it('says the pushed tag publishes through the publish workflow, naming the package, version and registry', () => {
    expect(ciPublishSentence(TAG, VERSION, target())).toBe(sentence);
    expect(ciPublishSentence(TAG, VERSION, target({ registry: 'https://npm.example.com' })))
      .toContain('to https://npm.example.com through .github/workflows/release-publish.yml');
  });

  it('gives no sentence where there is nothing to publish: a private package or a file naming none', () => {
    expect(ciPublishSentence(TAG, VERSION, target({ isPrivate: true }))).toBeNull();
    expect(ciPublishSentence(TAG, VERSION, target({ name: null }))).toBeNull();
    expect(ciPublishSentence(TAG, VERSION, target({ isPrivate: false }))).not.toBeNull();
  });
});
