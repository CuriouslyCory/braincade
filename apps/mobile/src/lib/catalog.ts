import { type Catalog, parseCatalog } from '@braincade/game-host';
import type { KeyValueStore } from '@braincade/learning';

const CACHE_KEY = 'braincade:catalog';

export interface LoadedCatalog {
  catalog: Catalog;
  source: 'network' | 'cache';
}

/**
 * Fetch catalog.json from the web deployment, falling back to the last good
 * copy so the launcher still lists games offline. (Games themselves load from
 * the same server, so offline play needs the server reachable.)
 */
export async function loadCatalog({
  baseUrl,
  fetchFn,
  cache,
}: {
  baseUrl: string;
  fetchFn: typeof fetch;
  cache: KeyValueStore;
}): Promise<LoadedCatalog> {
  try {
    const response = await fetchFn(`${baseUrl}/catalog.json`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`catalog.json returned ${response.status}`);
    const catalog = parseCatalog(await response.json());
    await cache.setItem(CACHE_KEY, JSON.stringify(catalog));
    return { catalog, source: 'network' };
  } catch (error) {
    const cached = await cache.getItem(CACHE_KEY);
    if (cached) {
      try {
        return { catalog: parseCatalog(JSON.parse(cached)), source: 'cache' };
      } catch {
        // fall through to the original error
      }
    }
    throw error;
  }
}
