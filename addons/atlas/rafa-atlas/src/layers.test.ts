/**
 * Tests for `readAtlasLayers` and `layerOf`: an ordered list reads back
 * in its order, a module is placed by its package and by its folder, an
 * unlisted module has no place, an undefined or null section answers no
 * layers, and each kind of section that does not parse is refused with
 * every problem named at once.
 */
import { describe, expect, it } from 'bun:test';

import { AtlasConfigError } from './config.js';
import { ATLAS_SECTION, layerOf, readAtlasLayers } from './layers.js';

/** The problems `readAtlasLayers` refuses `value` with. */
function problemsOf(value: unknown): readonly string[] {
  let refusal: unknown = null;
  try {
    readAtlasLayers(value);
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(AtlasConfigError);
  return (refusal as AtlasConfigError).problems;
}

const twoLayers = {
  layers: [
    { name: 'core', modules: ['@open-tomato/rafa-core'] },
    { name: 'app', modules: ['src/commands', '@open-tomato/rafa-run'] },
  ],
};

describe('readAtlasLayers', () => {
  it('reads an ordered list back in its order', () => {
    const section = {
      layers: [
        { name: 'config', modules: ['@open-tomato/eslint-config'] },
        { name: 'core', modules: ['@open-tomato/rafa-core'] },
        { name: 'app', modules: ['src/cli', 'src/commands'] },
      ],
    };

    expect(readAtlasLayers(section)).toEqual(section.layers);
    expect(readAtlasLayers(section).map((layer) => layer.name)).toEqual(['config', 'core', 'app']);
  });

  it('answers no layers for an undefined section, a null one and one with no layers key', () => {
    expect(readAtlasLayers(undefined)).toEqual([]);
    expect(readAtlasLayers(null)).toEqual([]);
    expect(readAtlasLayers({})).toEqual([]);
  });

  it('takes a layer with no modules', () => {
    expect(readAtlasLayers({ layers: [{ name: 'empty', modules: [] }] })).toEqual([{ name: 'empty', modules: [] }]);
  });

  it.each([7, 'core', [1], true])('refuses a section that is not a mapping: %p', (value) => {
    expect(problemsOf(value)).toEqual([`the section is ${JSON.stringify(value)}, expected a mapping holding layers`]);
  });

  it('refuses layers that is not a list', () => {
    expect(problemsOf({ layers: { core: [] } })).toEqual(['layers is {"core":[]}, expected a list of { name, modules } mappings']);
  });

  it('refuses a layer that is not a mapping', () => {
    expect(problemsOf({ layers: ['core'] })).toEqual(['layers[0] is "core", expected a mapping holding name and modules']);
  });

  it('refuses a blank or missing layer name', () => {
    expect(problemsOf({ layers: [{ name: '  ', modules: [] }, { modules: [] }] })).toEqual([
      'layers[0].name is "  ", expected a layer name holding something',
      'layers[1].name is missing, expected a layer name holding something',
    ]);
  });

  it('refuses a repeated layer name', () => {
    expect(problemsOf({ layers: [{ name: 'core', modules: ['a'] }, { name: 'core', modules: ['b'] }] })).toEqual([
      'layer "core" is named more than once',
    ]);
  });

  it('refuses a module listed in two layers, and one listed twice in one', () => {
    expect(problemsOf({
      layers: [
        { name: 'core', modules: ['@open-tomato/rafa-core', 'src/cli', 'src/cli'] },
        { name: 'app', modules: ['@open-tomato/rafa-core'] },
      ],
    })).toEqual([
      'src/cli is listed twice in layer "core"',
      '@open-tomato/rafa-core is listed in layer "core" and in layer "app"',
    ]);
  });

  it('refuses modules that is not a list, and a module that is not a string holding something', () => {
    expect(problemsOf({ layers: [{ name: 'core', modules: 'x' }, { name: 'app', modules: ['', 3] }] })).toEqual([
      'layers[0].modules is "x", expected a list of package names or module folders',
      'layers[1].modules[0] is "", expected a package name or a module folder',
      'layers[1].modules[1] is 3, expected a package name or a module folder',
    ]);
  });

  it('refuses an unknown key in the section and in a layer', () => {
    expect(problemsOf({ layers: [{ name: 'core', modules: [], rank: 1 }], columns: 2 })).toEqual([
      'columns is not a key Atlas reads; it reads layers',
      'layers[0].rank is not a key Atlas reads; it reads layers[0].name and layers[0].modules',
    ]);
  });

  it('names every problem at once, and the section as their place', () => {
    const section = { layers: [{ name: '', modules: [] }, { name: 'a', modules: ['m'] }, { name: 'b', modules: ['m'] }], extra: true };
    let refusal: unknown = null;
    try {
      readAtlasLayers(section);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(AtlasConfigError);
    expect((refusal as AtlasConfigError).file).toBe(ATLAS_SECTION);
    expect((refusal as AtlasConfigError).message).toBe(`atlas: ${ATLAS_SECTION} holds 3 problems`);
    expect((refusal as AtlasConfigError).problems).toEqual([
      'extra is not a key Atlas reads; it reads layers',
      'layers[0].name is "", expected a layer name holding something',
      'm is listed in layer "a" and in layer "b"',
    ]);
  });
});

describe('layerOf', () => {
  const layers = readAtlasLayers(twoLayers);

  it('places a module listed by its package, with its layer\'s rank from 0', () => {
    expect(layerOf(layers, 'packages/rafa', '@open-tomato/rafa-core')).toEqual({ layer: 'core', rank: 0 });
    expect(layerOf(layers, 'packages/rafa-run', '@open-tomato/rafa-run')).toEqual({ layer: 'app', rank: 1 });
  });

  it('places a module with no package listed by its folder', () => {
    expect(layerOf(layers, 'src/commands', null)).toEqual({ layer: 'app', rank: 1 });
  });

  it('places a module with a package listed by its folder', () => {
    expect(layerOf(readAtlasLayers({ layers: [{ name: 'addon', modules: ['addons/atlas'] }] }), 'addons/atlas', '@open-tomato/atlas')).toEqual({ layer: 'addon', rank: 0 });
  });

  it('answers null for a module no layer lists', () => {
    expect(layerOf(layers, 'src/cli', null)).toBeNull();
    expect(layerOf(layers, 'packages/rafa-pr', '@open-tomato/rafa-pr')).toBeNull();
  });

  it('control: a folder that only starts like a listed one is not placed', () => {
    expect(layerOf(layers, 'src/commands-extra', null)).toBeNull();
  });

  it('answers null for every module when there are no layers', () => {
    expect(layerOf(readAtlasLayers(undefined), 'packages/rafa', '@open-tomato/rafa-core')).toBeNull();
  });
});
