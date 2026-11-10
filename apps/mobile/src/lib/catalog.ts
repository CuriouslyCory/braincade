import { type Catalog, parseCatalog } from '@braincade/game-host';
import type { KeyValueStore } from '@braincade/learning';

const CACHE_KEY = 'braincade:catalog';

/** The cached catalog remembers which server it came from; a different server never uses it. */
interface CachedCatalog {
  baseUrl: string;
  catalog: unknown;
}

export interface LoadedCatalog {
  catalog: Catalog;
  source: 'network' | 'cache';
}

/**
 * Fetch catalog.json from the web deployment, falling back to the last good
 * copy so the launcher still lists games offline. (Games themselves load from
 * the same server, so offline play needs the server reachable.) The cache only
 * applies to the server it was fetched from.
 */
export async function loadCatalog({
  baseUrl,
  fetchFn,
  cache,
  timeoutMs = 10_000,
}: {
  baseUrl: string;
  fetchFn: typeof fetch;
  cache: KeyValueStore;
  /** React Native fetch never times out on its own (e.g. a mistyped LAN IP). */
  timeoutMs?: number;
}): Promise<LoadedCatalog> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${baseUrl}/catalog.json`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`catalog.json returned ${response.status}`);
    const catalog = parseCatalog(await response.json());
    const entry: CachedCatalog = { baseUrl, catalog };
    await cache.setItem(CACHE_KEY, JSON.stringify(entry));
    return { catalog, source: 'network' };
  } catch (error) {
    const cached = await cache.getItem(CACHE_KEY);
    if (cached) {
      try {
        const entry = JSON.parse(cached) as Partial<CachedCatalog>;
        if (entry.baseUrl === baseUrl) {
          return { catalog: parseCatalog(entry.catalog), source: 'cache' };
        }
      } catch {
        // fall through to the original error
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
