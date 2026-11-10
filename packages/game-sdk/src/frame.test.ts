// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { defineGame, type RegisteredGame } from './define';
import { bootFrame } from './frame';
import type { GameManifest } from './manifest';
import { CHANNEL, PROTOCOL_VERSION, type RequestMessage, type SessionInfo } from './protocol';
import { createMemoryTransportPair } from './transport';

const manifest: GameManifest = {
  id: 'demo',
  title: 'Demo',
  description: 'Demo game',
  icon: '🧪',
  engine: 'dom',
  skills: ['spelling'],
  requires: [],
  status: 'draft',
  version: '0.1.0',
};

const session: SessionInfo = {
  sessionId: 's1',
  gameId: 'demo',
  platform: 'web',
  capabilities: ['storage'],
  learner: { name: 'Sam', interests: [] },
  locale: 'en-US',
};

function setup() {
  const [frameSide, hostSide] = createMemoryTransportPair();
  const notifications: Array<{ name: string; data?: unknown }> = [];
  const requests: RequestMessage[] = [];
  hostSide.listen((raw) => {
    const msg = raw as RequestMessage | { type: 'notify'; name: string; data?: unknown };
    if (msg.type === 'notify') {
      notifications.push({ name: msg.name, data: msg.data });
      return;
    }
    requests.push(msg);
    hostSide.send({
      channel: CHANNEL,
      v: PROTOCOL_VERSION,
      type: 'response',
      id: msg.id,
      ok: true,
      result: msg.method === 'session.start' ? session : null,
    });
  });
  const sendEvent = (name: 'exit' | 'pause') =>
    hostSide.send({ channel: CHANNEL, v: PROTOCOL_VERSION, type: 'event', name });
  const root = document.createElement('div');
  return { frameSide, notifications, requests, sendEvent, root };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('bootFrame', () => {
  it('starts a session, mounts the game, reports ready, and cleans up on exit', async () => {
    const cleanup = vi.fn();
    const game = defineGame({
      mount(root, ctx) {
        root.textContent = `Hi ${ctx.session.learner.name}`;
        return cleanup;
      },
    });
    const games: RegisteredGame[] = [{ manifest, load: async () => ({ default: game }) }];
    const { frameSide, notifications, requests, sendEvent, root } = setup();

    const handle = await bootFrame({ games, gameId: 'demo', root, transport: frameSide });

    expect(handle.status).toBe('running');
    expect(root.textContent).toBe('Hi Sam');
    expect(requests[0]).toMatchObject({
      method: 'session.start',
      params: { gameId: 'demo', version: '0.1.0' },
    });
    await flush();
    expect(notifications).toEqual([{ name: 'ready', data: { gameId: 'demo', version: '0.1.0' } }]);

    sendEvent('exit');
    await flush();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(notifications.at(-1)?.name).toBe('exited');
  });

  it('reports unknown games to the host and the player', async () => {
    const { frameSide, notifications, root } = setup();
    const handle = await bootFrame({ games: [], gameId: 'nope', root, transport: frameSide });
    await flush();
    expect(handle.status).toBe('failed');
    expect(notifications[0]).toMatchObject({ name: 'error', data: { code: 'not-found' } });
    expect(root.querySelector('[role=alert]')?.textContent).toContain('nope');
  });

  it('fails cleanly when a game module has no defineGame default export', async () => {
    const games: RegisteredGame[] = [{ manifest, load: async () => ({ default: {} }) }];
    const { frameSide, notifications, root } = setup();
    const handle = await bootFrame({ games, gameId: 'demo', root, transport: frameSide });
    await flush();
    expect(handle.status).toBe('failed');
    expect(notifications[0]?.name).toBe('error');
  });

  it('reports errors thrown during mount', async () => {
    const game = defineGame({
      mount() {
        throw new Error('WebGL not available');
      },
    });
    const games: RegisteredGame[] = [{ manifest, load: async () => ({ default: game }) }];
    const { frameSide, notifications, root } = setup();
    await bootFrame({ games, gameId: 'demo', root, transport: frameSide });
    await flush();
    expect(notifications[0]).toMatchObject({
      name: 'error',
      data: { message: 'WebGL not available' },
    });
  });

  it('explains itself when opened outside a host', async () => {
    const root = document.createElement('div');
    const handle = await bootFrame({ games: [], gameId: 'demo', root, transport: null });
    expect(handle.status).toBe('standalone');
    expect(root.textContent).toContain('Open this game from Braincade');
  });
});
