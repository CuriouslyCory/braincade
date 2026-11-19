import { fileURLToPath } from 'node:url';
import { wordLists } from '@braincade/content';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { braincadeGames } from './build/games-plugin';
import { handwritingDevApi } from './build/handwriting-dev-plugin';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// E2E builds add test-only fixture games (see e2e/fixtures/games).
const gamesDirs = [fromRoot('../../games')];
if (process.env.BRAINCADE_E2E_FIXTURES === '1') gamesDirs.push(fromRoot('./e2e/fixtures/games'));

export default defineConfig(({ mode }) => ({
  // Relative asset URLs so the build works from any path on any static host.
  base: './',
  plugins: [
    react(),
    braincadeGames({ gamesDirs, wordLists }),
    // `vite dev` only. ANTHROPIC_API_KEY may come from apps/web/.env.local.
    handwritingDevApi({ apiKey: loadEnv(mode, fromRoot('.'), '').ANTHROPIC_API_KEY }),
  ],
  build: {
    // three.js alone is ~530 kB; it is only loaded by games that use it.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      input: {
        main: fromRoot('./index.html'),
        play: fromRoot('./play.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
}));
