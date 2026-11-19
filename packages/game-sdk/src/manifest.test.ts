import { describe, expect, it } from 'vitest';
import { isListed, manifestFromPackageJson, missingCapabilities } from './manifest';

const pkg = {
  name: '@braincade/game-spell-race',
  version: '1.2.0',
  braincade: {
    id: 'spell-race',
    title: 'Spell Race',
    description: 'Hear a word, type it, win the race.',
    engine: 'dom',
    skills: ['spelling', 'typing'],
    requires: ['speech'],
  },
};

describe('manifestFromPackageJson', () => {
  it('reads the braincade field, applies defaults, and adds the package version', () => {
    expect(manifestFromPackageJson(pkg)).toEqual({
      ...pkg.braincade,
      version: '1.2.0',
      icon: '🎮',
      status: 'draft',
    });
  });

  it('explains what is wrong with an invalid manifest', () => {
    expect(() =>
      manifestFromPackageJson({ ...pkg, braincade: { ...pkg.braincade, id: 'Spell Race' } }),
    ).toThrow(/kebab-case/);
    expect(() =>
      manifestFromPackageJson({ ...pkg, braincade: { ...pkg.braincade, skills: ['juggling'] } }),
    ).toThrow(/skills/);
    expect(() => manifestFromPackageJson({ ...pkg, version: 'latest' })).toThrow(/semver/);
    expect(() => manifestFromPackageJson({ name: 'x', version: '1.0.0' })).toThrow(/braincade/);
  });
});

describe('launcher helpers', () => {
  it('reports capabilities the platform lacks', () => {
    expect(missingCapabilities({ requires: ['speech', 'camera'] }, ['storage', 'speech'])).toEqual([
      'camera',
    ]);
  });

  it('lists published games, drafts only on request, retired never', () => {
    expect(isListed({ status: 'published' }, false)).toBe(true);
    expect(isListed({ status: 'draft' }, false)).toBe(false);
    expect(isListed({ status: 'draft' }, true)).toBe(true);
    expect(isListed({ status: 'retired' }, true)).toBe(false);
  });
});
