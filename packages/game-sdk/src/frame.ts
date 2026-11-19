import { createHostClient, type HostClient } from './client';
import { createGameContext, type GameContext } from './context';
import { type Cleanup, isGameDefinition, type RegisteredGame } from './define';
import { detectHostTransport, type Transport } from './transport';

export interface BootFrameOptions {
  games: readonly RegisteredGame[];
  gameId: string | null;
  root: HTMLElement;
  /** Defaults to the transport detected from the environment (iframe or WebView). */
  transport?: Transport | null;
  timeoutMs?: number;
}

export interface FrameHandle {
  status: 'running' | 'failed' | 'standalone';
  ctx?: GameContext;
  dispose(): Promise<void>;
}

function showMessage(root: HTMLElement, title: string, detail: string) {
  root.replaceChildren();
  const box = root.ownerDocument.createElement('div');
  box.setAttribute('role', 'alert');
  box.dataset.braincadeError = '';
  box.style.cssText =
    'font:16px system-ui;padding:24px;max-width:480px;margin:10vh auto;text-align:center';
  const heading = root.ownerDocument.createElement('h1');
  heading.textContent = title;
  heading.style.fontSize = '20px';
  const text = root.ownerDocument.createElement('p');
  text.textContent = detail;
  box.append(heading, text);
  root.append(box);
}

/**
 * Entry point of the game frame (play.html): connect to the host, start a
 * session, load the requested game, mount it, and handle exit requests.
 */
export async function bootFrame(options: BootFrameOptions): Promise<FrameHandle> {
  const { games, gameId, root } = options;
  const transport = options.transport === undefined ? detectHostTransport() : options.transport;

  if (!transport) {
    showMessage(root, 'Open this game from Braincade', 'Game frames run inside the launcher.');
    return { status: 'standalone', dispose: async () => {} };
  }

  const client: HostClient = createHostClient(
    transport,
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
  );
  let cleanup: Cleanup | undefined;
  let disposed = false;

  const fail = (code: string, message: string): FrameHandle => {
    client.notify('error', { code, message });
    showMessage(root, 'This game could not start', message);
    return {
      status: 'failed',
      dispose: async () => client.dispose(),
    };
  };

  const entry = games.find((g) => g.manifest.id === gameId);
  if (!entry) return fail('not-found', `No game with id "${gameId ?? ''}".`);

  try {
    const session = await client.request('session.start', {
      gameId: entry.manifest.id,
      version: entry.manifest.version,
    });
    const module = await entry.load();
    if (!isGameDefinition(module.default)) {
      return fail('internal', `${entry.manifest.id} must default-export defineGame({...}).`);
    }
    const ctx = createGameContext(client, session, entry.manifest);
    root.replaceChildren();
    cleanup = (await module.default.mount(root, ctx)) ?? undefined;

    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      try {
        await cleanup?.();
      } finally {
        client.notify('exited');
        client.dispose();
      }
    };
    client.onEvent('exit', () => void dispose());
    client.notify('ready', { gameId: entry.manifest.id, version: entry.manifest.version });
    return { status: 'running', ctx, dispose };
  } catch (error) {
    return fail('internal', error instanceof Error ? error.message : String(error));
  }
}
