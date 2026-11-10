import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverGames, registryModuleSource } from './games-plugin';

let root: string;

function writeGame(
  folder: string,
  braincade: Record<string, unknown> | null,
  { entry = true } = {},
) {
  const dir = path.join(root, folder);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  const pkg = {
    name: `@braincade/game-${folder}`,
    version: '0.1.0',
    ...(braincade ? { braincade } : {}),
  };
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  if (entry) writeFileSync(path.join(dir, 'src', 'index.ts'), 'export default {}');
}

const manifest = (id: string) => ({
  id,
  title: id.toUpperCase(),
  description: 'A game',
  engine: 'dom',
  skills: ['spelling'],
});

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'braincade-games-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discoverGames', () => {
  it('finds valid games sorted by id and ignores dot/underscore folders and stray files', () => {
    writeGame('zeta', manifest('zeta'));
    writeGame('alpha', manifest('alpha'));
    writeGame('_template', manifest('_template'));
    mkdirSync(path.join(root, 'no-package'));
    writeFileSync(path.join(root, 'README.md'), '# games');

    const games = discoverGames([root, path.join(root, 'does-not-exist')]);
    expect(games.map((g) => g.manifest.id)).toEqual(['alpha', 'zeta']);
    expect(games[0]?.manifest.version).toBe('0.1.0');
    expect(games[0]?.entry).toBe(path.join(root, 'alpha', 'src', 'index.ts'));
  });

  it('returns nothing for an empty games folder', () => {
    expect(discoverGames([root])).toEqual([]);
  });

  it('reports every broken game at once', () => {
    writeGame('wrong-folder', manifest('right-id'));
    writeGame('no-entry', manifest('no-entry'), { entry: false });
    writeGame('no-manifest', null);
    writeGame('bad-skill', { ...manifest('bad-skill'), skills: ['juggling'] });

    let message = '';
    try {
      discoverGames([root]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('must match its folder name');
    expect(message).toContain('missing src/index.ts');
    expect(message).toContain('missing a "braincade" manifest');
    expect(message).toContain('skills');
  });

  it('rejects the same id in two game folders', () => {
    const other = mkdtempSync(path.join(tmpdir(), 'braincade-games-'));
    try {
      writeGame('dupe', manifest('dupe'));
      const dir = path.join(other, 'dupe');
      mkdirSync(path.join(dir, 'src'), { recursive: true });
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version: '1.0.0', braincade: manifest('dupe') }),
      );
      writeFileSync(path.join(dir, 'src', 'index.ts'), '');
      expect(() => discoverGames([root, other])).toThrow(/duplicate game id "dupe"/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('registryModuleSource', () => {
  it('inlines manifests and lazy-imports entries', () => {
    writeGame('alpha', manifest('alpha'));
    const source = registryModuleSource(discoverGames([root]));
    expect(source).toContain('"id":"alpha"');
    expect(source).toMatch(/load: \(\) => import\(".*alpha\/src\/index\.ts"\)/);
  });
});
