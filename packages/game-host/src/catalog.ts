import { catalogGameSchema, type GameManifest } from '@braincade/game-sdk';
import { type WordList, wordListSchema } from '@braincade/learning';
import { z } from 'zod';

/**
 * catalog.json is published next to the web app. The mobile app fetches it to
 * list games and get word lists, so publishing the web app updates both.
 */
export const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  games: z.array(catalogGameSchema),
  wordLists: z.array(wordListSchema),
});

export type Catalog = z.infer<typeof catalogSchema>;

export function buildCatalog(input: {
  games: readonly GameManifest[];
  wordLists: readonly WordList[];
  generatedAt?: Date;
}): Catalog {
  const ids = new Set<string>();
  for (const game of input.games) {
    if (ids.has(game.id)) throw new Error(`Duplicate game id "${game.id}"`);
    ids.add(game.id);
  }
  return catalogSchema.parse({
    schemaVersion: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    games: [...input.games].sort((a, b) => a.title.localeCompare(b.title)),
    wordLists: input.wordLists,
  });
}

export function parseCatalog(json: unknown): Catalog {
  return catalogSchema.parse(json);
}

/** URL of the game frame for a game, relative to where the web app is hosted. */
export function playUrl(baseUrl: string, gameId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/play.html?game=${encodeURIComponent(gameId)}`;
}
