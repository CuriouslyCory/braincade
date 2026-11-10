import { buildCatalog } from '@braincade/game-host';
import { createMemoryStore } from '@braincade/learning';
import { describe, expect, it, vi } from 'vitest';
import { loadCatalog } from './catalog';

const catalog = buildCatalog({
  games: [],
  wordLists: [{ id: 'l', title: 'L', words: [{ word: 'their', tags: [] }] }],
  generatedAt: new Date('2026-11-09T00:00:00Z'),
});

const ok = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe('loadCatalog', () => {
  it('fetches catalog.json from the base URL and caches it', async () => {
    const fetchFn = ok(catalog);
    const cache = createMemoryStore();
    const result = await loadCatalog({ baseUrl: 'https://x.test', fetchFn, cache });
    expect(result).toEqual({ catalog, source: 'network' });
    expect(fetchFn).toHaveBeenCalledWith('https://x.test/catalog.json', expect.anything());
    expect(cache.data.size).toBe(1);
  });

  it('falls back to the cached copy when offline', async () => {
    const cache = createMemoryStore();
    await loadCatalog({ baseUrl: 'https://x.test', fetchFn: ok(catalog), cache });
    const offline = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await loadCatalog({ baseUrl: 'https://x.test', fetchFn: offline, cache })).toEqual({
      catalog,
      source: 'cache',
    });
  });

  it('does not use a catalog cached from a different server', async () => {
    const cache = createMemoryStore();
    await loadCatalog({ baseUrl: 'https://prod.test', fetchFn: ok(catalog), cache });
    const offline = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(
      loadCatalog({ baseUrl: 'https://preview.test', fetchFn: offline, cache }),
    ).rejects.toThrow('Network request failed');
  });

  it('rejects invalid catalogs and surfaces errors when nothing is cached', async () => {
    await expect(
      loadCatalog({
        baseUrl: 'https://x.test',
        fetchFn: ok({ nope: true }),
        cache: createMemoryStore(),
      }),
    ).rejects.toThrow();
    const notFound = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch;
    await expect(
      loadCatalog({ baseUrl: 'https://x.test', fetchFn: notFound, cache: createMemoryStore() }),
    ).rejects.toThrow(/404/);
  });
});
