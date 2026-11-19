import type { GameManifest } from '@braincade/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildCatalog, parseCatalog, playUrl } from './catalog';

const game = (id: string, title: string): GameManifest => ({
  id,
  title,
  description: 'd',
  icon: '🎮',
  engine: 'dom',
  skills: ['spelling'],
  requires: [],
  status: 'published',
  version: '1.0.0',
});

describe('catalog', () => {
  it('builds a sorted, parseable catalog', () => {
    const catalog = buildCatalog({
      games: [game('b', 'Zebra'), game('a', 'Apple')],
      wordLists: [{ id: 'l', title: 'L', words: [{ word: 'x', tags: [] }] }],
      generatedAt: new Date('2026-11-09T00:00:00Z'),
    });
    expect(catalog.games.map((g) => g.id)).toEqual(['a', 'b']);
    expect(parseCatalog(JSON.parse(JSON.stringify(catalog)))).toEqual(catalog);
  });

  it('rejects duplicate game ids', () => {
    expect(() => buildCatalog({ games: [game('a', 'A'), game('a', 'B')], wordLists: [] })).toThrow(
      /Duplicate/,
    );
  });

  it('builds frame URLs', () => {
    expect(playUrl('https://example.com/braincade/', 'spell race')).toBe(
      'https://example.com/braincade/play.html?game=spell%20race',
    );
  });
});
