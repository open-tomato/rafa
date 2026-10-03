import { describe, expect, it } from 'bun:test';

import { readCurrentRange } from './update-range.js';

describe('readCurrentRange', () => {
  it('adopts a project with no recorded version', () => {
    expect(readCurrentRange(null, '0.34.0')).toEqual({ kind: 'adopt', to: '0.34.0' });
  });

  it('answers same for the installed version', () => {
    expect(readCurrentRange('0.34.0', '0.34.0')).toEqual({ kind: 'same', to: '0.34.0' });
  });

  it('moves to a newer patch of the same minor', () => {
    expect(readCurrentRange('0.34.0', '0.34.2')).toEqual({ kind: 'patch', from: '0.34.0', to: '0.34.2' });
  });

  it('refuses a newer minor, naming update next', () => {
    const reading = readCurrentRange('0.33.1', '0.34.0');

    expect(reading.kind).toBe('refused');
    expect(reading.kind === 'refused' && reading.reason).toBe('newer-minor');
    expect(reading.kind === 'refused' && reading.message).toContain('rafa update next');
  });

  it('refuses a newer major, naming update latest', () => {
    const reading = readCurrentRange('0.34.0', '1.0.0');

    expect(reading.kind === 'refused' && reading.reason).toBe('newer-major');
    expect(reading.kind === 'refused' && reading.message).toContain('rafa update latest');
  });

  it('refuses an installed rafa older than the recorded one: no downgrade', () => {
    const reading = readCurrentRange('0.34.2', '0.34.0');

    expect(reading.kind === 'refused' && reading.reason).toBe('older');
    expect(reading.kind === 'refused' && reading.message).toContain('0.34.2');
  });

  it('moves a lock past its own release candidate, as a newer patch', () => {
    expect(readCurrentRange('0.34.0-rc.1', '0.34.0')).toEqual({ kind: 'patch', from: '0.34.0-rc.1', to: '0.34.0' });
  });

  it('refuses a release candidate installed over its release as a downgrade', () => {
    const reading = readCurrentRange('0.34.1', '0.34.1-rc.2');

    expect(reading.kind === 'refused' && reading.reason).toBe('older');
  });

  it('reads two builds of one version as the same, build metadata ignored', () => {
    expect(readCurrentRange('0.34.0+a', '0.34.0+b')).toEqual({ kind: 'same', to: '0.34.0+b' });
  });

  it('refuses an installed version that is no version', () => {
    const reading = readCurrentRange('0.34.0', 'dev');

    expect(reading.kind === 'refused' && reading.reason).toBe('unreadable');
  });
});
