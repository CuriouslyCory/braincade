import type { GameContext } from './context';
import type { GameManifest } from './manifest';

export type Cleanup = () => void | Promise<void>;

export interface GameDefinition {
  /**
   * Render the game into `root` (a full-viewport element). Return a cleanup
   * function that stops loops, removes listeners, and disposes WebGL resources.
   * The host draws its exit button over the top-left 60x60px, so keep that corner clear.
   */
  mount(root: HTMLElement, ctx: GameContext): Cleanup | undefined | Promise<Cleanup | undefined>;
}

/** Declare a game. The default export of a game's src/index.ts must be the result. */
export function defineGame(definition: GameDefinition): GameDefinition {
  return definition;
}

export function isGameDefinition(value: unknown): value is GameDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<GameDefinition>).mount === 'function'
  );
}

/** What a launcher registry holds per game: the manifest now, the code on demand. */
export interface RegisteredGame {
  manifest: GameManifest;
  load: () => Promise<{ default: unknown }>;
}
