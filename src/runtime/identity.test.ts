/**
 * Tests for `readRuntimeIdentity` (`identity.ts`) over planted trees: a
 * checkout, a runtime copy, an npm install and a link, each under one
 * temporary directory, and the test process's own entry as the control
 * that the walk finds a real checkout.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { name as RAFA_PACKAGE_NAME } from '../../package.json';

import { readRuntimeIdentity } from './identity.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-identity-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let caseCount = 0;

/** A fresh directory under the temporary base. */
function freshDir(): string {
  caseCount += 1;
  const dir = join(tempBase, `case-${String(caseCount)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes `text` at `path`, making its directory, and answers the path. */
function plant(path: string, text = ''): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

/** Writes a `package.json` naming `name` in `dir`. */
function plantManifest(dir: string, name: string): void {
  plant(join(dir, 'package.json'), `${JSON.stringify({ name, version: '0.25.0' })}\n`);
}

/** A rafa checkout under a fresh directory: its manifest and `src/rafa.ts`. */
function plantCheckout(): string {
  const checkout = join(freshDir(), 'rafa');
  plantManifest(checkout, RAFA_PACKAGE_NAME);
  plant(join(checkout, 'src', 'rafa.ts'));
  return checkout;
}

describe('a development build', () => {
  it('is read from a checkout\'s src/rafa.ts, naming the checkout', () => {
    const checkout = plantCheckout();
    const entry = join(checkout, 'src', 'rafa.ts');

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'development', entry, checkout });
  });

  it('is read from the checkout\'s own dist/cli.js', () => {
    const checkout = plantCheckout();
    const entry = plant(join(checkout, 'dist', 'cli.js'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'development', entry, checkout });
  });

  it('is read from a test file under the checkout\'s src/', () => {
    const checkout = plantCheckout();
    const entry = plant(join(checkout, 'src', 'effort', 'store', 'bring-forward.test.ts'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'development', entry, checkout });
  });

  it('passes over a nearer package.json naming another package', () => {
    const checkout = plantCheckout();
    plantManifest(join(checkout, 'tools', 'probe'), 'probe');
    const entry = plant(join(checkout, 'tools', 'probe', 'cli.ts'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'development', entry, checkout });
  });

  it('passes over a nearer package.json that holds no JSON', () => {
    const checkout = plantCheckout();
    plant(join(checkout, 'tools', 'broken', 'package.json'), '{ not json');
    const entry = plant(join(checkout, 'tools', 'broken', 'cli.ts'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'development', entry, checkout });
  });

  it('is read through a link that points at a checkout\'s build', () => {
    const checkout = plantCheckout();
    const target = plant(join(checkout, 'dist', 'cli.js'));
    const link = join(dirname(checkout), 'bin', 'rafa');
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);

    expect(readRuntimeIdentity(link)).toEqual({ kind: 'development', entry: target, checkout });
  });

  it('is what the running test process reads as, naming this checkout', () => {
    const checkout = realpathSync(resolve(import.meta.dir, '..', '..'));

    expect(readRuntimeIdentity()).toMatchObject({ kind: 'development', checkout });
  });
});

describe('an installed runtime', () => {
  it('is read from a runtime copy, which holds no package.json', () => {
    const entry = plant(join(freshDir(), '.rafa', 'runtime', '0.24.1', 'cli.js'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'installed', entry });
  });

  it('is read from an npm install, whose package holds no src/', () => {
    const packageDir = join(freshDir(), 'node_modules', '@open-tomato', 'rafa');
    plantManifest(packageDir, RAFA_PACKAGE_NAME);
    const entry = plant(join(packageDir, 'dist', 'cli.js'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'installed', entry });
  });

  it('is read from an npm install inside a checkout, since the nearest manifest decides', () => {
    const checkout = plantCheckout();
    const packageDir = join(checkout, 'node_modules', '@open-tomato', 'rafa');
    plantManifest(packageDir, RAFA_PACKAGE_NAME);
    const entry = plant(join(packageDir, 'dist', 'cli.js'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'installed', entry });
  });

  it('is read from a checkout-shaped tree whose package.json names another package', () => {
    const fork = join(freshDir(), 'fork');
    plantManifest(fork, '@someone/else');
    const entry = plant(join(fork, 'src', 'rafa.ts'));

    expect(readRuntimeIdentity(entry)).toEqual({ kind: 'installed', entry });
  });

  it('is read through a link that points at a runtime copy', () => {
    const home = freshDir();
    const target = plant(join(home, '.rafa', 'runtime', '0.24.1', 'cli.js'));
    const link = join(home, '.rafa', 'bin', 'rafa');
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);

    expect(readRuntimeIdentity(link)).toEqual({ kind: 'installed', entry: target });
  });
});
