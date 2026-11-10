import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildCatalog } from '@braincade/game-host';
import { type GameManifest, manifestFromPackageJson } from '@braincade/game-sdk';
import type { WordList } from '@braincade/learning';
import { normalizePath, type Plugin, type ViteDevServer } from 'vite';

export const VIRTUAL_GAMES_ID = 'virtual:braincade/games';
const RESOLVED_ID = `\0${VIRTUAL_GAMES_ID}`;

export interface DiscoveredGame {
  manifest: GameManifest;
  dir: string;
  entry: string;
}

/**
 * Find every game package: a folder with a package.json that has a `braincade`
 * manifest and a src/index.ts entry. Errors for all games are collected so one
 * run reports every broken manifest.
 */
export function discoverGames(gamesDirs: readonly string[]): DiscoveredGame[] {
  const found: DiscoveredGame[] = [];
  const errors: string[] = [];
  for (const gamesDir of gamesDirs) {
    if (!existsSync(gamesDir)) continue;
    for (const name of readdirSync(gamesDir, { withFileTypes: true })) {
      if (!name.isDirectory() || name.name.startsWith('.') || name.name.startsWith('_')) continue;
      const dir = path.join(gamesDir, name.name);
      const pkgPath = path.join(dir, 'package.json');
      if (!existsSync(pkgPath)) continue;
      try {
        const manifest = manifestFromPackageJson(JSON.parse(readFileSync(pkgPath, 'utf8')));
        if (manifest.id !== name.name) {
          throw new Error(`manifest id "${manifest.id}" must match its folder name "${name.name}"`);
        }
        const entry = path.join(dir, 'src', 'index.ts');
        if (!existsSync(entry)) throw new Error('missing src/index.ts');
        found.push({ manifest, dir, entry });
      } catch (error) {
        errors.push(`${pkgPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const seen = new Map<string, string>();
  for (const game of found) {
    const other = seen.get(game.manifest.id);
    if (other) errors.push(`duplicate game id "${game.manifest.id}" in ${other} and ${game.dir}`);
    seen.set(game.manifest.id, game.dir);
  }
  if (errors.length) throw new Error(`Invalid games:\n${errors.join('\n')}`);
  return found.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

/** Source of `virtual:braincade/games`: manifests inline, game code lazy-loaded. */
export function registryModuleSource(games: readonly DiscoveredGame[]): string {
  const entries = games.map(
    (g) =>
      `  { manifest: ${JSON.stringify(g.manifest)}, load: () => import(${JSON.stringify(normalizePath(g.entry))}) },`,
  );
  return `export const games = [\n${entries.join('\n')}\n];\n`;
}

export interface BraincadeGamesOptions {
  gamesDirs: string[];
  wordLists: readonly WordList[];
}

/**
 * Discovers games at dev/build time, exposes them as a virtual module, and
 * publishes catalog.json (games + word lists) for the mobile app.
 */
export function braincadeGames(options: BraincadeGamesOptions): Plugin {
  const catalogJson = () =>
    JSON.stringify(
      buildCatalog({
        games: discoverGames(options.gamesDirs).map((g) => g.manifest),
        wordLists: options.wordLists,
      }),
      null,
      2,
    );

  const isGamePackageJson = (file: string) =>
    options.gamesDirs.some((dir) => {
      const rel = path.relative(dir, file);
      return rel.split(path.sep).length === 2 && rel.endsWith('package.json');
    });

  const isGameEntry = (file: string) =>
    options.gamesDirs.some((dir) => {
      const parts = path.relative(dir, file).split(path.sep);
      return parts.length === 3 && parts[1] === 'src' && parts[2] === 'index.ts';
    });

  function watchGames(server: ViteDevServer) {
    for (const dir of options.gamesDirs) server.watcher.add(dir);
    const refresh = (file: string) => {
      if (!isGamePackageJson(file) && !isGameEntry(file)) return;
      const graph = server.environments.client.moduleGraph;
      const mod = graph.getModuleById(RESOLVED_ID);
      if (mod) graph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
    };
    server.watcher.on('add', refresh);
    server.watcher.on('unlink', refresh);
    server.watcher.on('change', (file) => {
      if (isGamePackageJson(file)) refresh(file);
    });
  }

  return {
    name: 'braincade-games',
    resolveId(id) {
      return id === VIRTUAL_GAMES_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const games = discoverGames(options.gamesDirs);
      for (const game of games) this.addWatchFile(path.join(game.dir, 'package.json'));
      return registryModuleSource(games);
    },
    configureServer(server) {
      watchGames(server);
      server.middlewares.use('/catalog.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(catalogJson());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'catalog.json', source: catalogJson() });
    },
  };
}
