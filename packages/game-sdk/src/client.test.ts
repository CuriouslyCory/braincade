import { describe, expect, it, vi } from 'vitest';
import { createHostClient } from './client';
import { createGameContext } from './context';
import type { GameManifest } from './manifest';
import {
  CHANNEL,
  HostError,
  PROTOCOL_VERSION,
  type RequestMessage,
  type SessionInfo,
} from './protocol';
import { createMemoryTransportPair } from './transport';

const SESSION: SessionInfo = {
  sessionId: 's',
  gameId: 'demo',
  platform: 'web',
  capabilities: ['speech'],
  learner: { name: '', interests: [] },
  locale: 'en-US',
};
const MANIFEST: GameManifest = {
  id: 'demo',
  title: 'Demo',
  description: 'Demo',
  icon: '🧪',
  engine: 'dom',
  skills: ['spelling'],
  requires: [],
  status: 'draft',
  version: '1.0.0',
};

function fakeHost(respond: (req: RequestMessage) => object) {
  const [frameSide, hostSide] = createMemoryTransportPair();
  const received: unknown[] = [];
  hostSide.listen((raw) => {
    received.push(raw);
    const msg = raw as RequestMessage;
    if (msg.type !== 'request') return;
    hostSide.send({
      channel: CHANNEL,
      v: PROTOCOL_VERSION,
      type: 'response',
      id: msg.id,
      ...respond(msg),
    });
  });
  return { frameSide, hostSide, received };
}

describe('createHostClient', () => {
  it('correlates responses with requests', async () => {
    const { frameSide } = fakeHost((req) => ({ ok: true, result: { echo: req.params } }));
    const client = createHostClient(frameSide);
    const [a, b] = await Promise.all([
      client.request('storage.get', { key: 'a' }),
      client.request('storage.get', { key: 'b' }),
    ]);
    expect(a).toEqual({ echo: { key: 'a' } });
    expect(b).toEqual({ echo: { key: 'b' } });
  });

  it('rejects with a HostError carrying the host error code', async () => {
    const { frameSide } = fakeHost(() => ({
      ok: false,
      error: { code: 'unsupported', message: 'No printer' },
    }));
    const client = createHostClient(frameSide);
    const error = await client.request('speech.stop', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostError);
    expect(error).toMatchObject({ code: 'unsupported', message: 'No printer' });
  });

  it('times out when the host never answers', async () => {
    vi.useFakeTimers();
    const [frameSide] = createMemoryTransportPair();
    const client = createHostClient(frameSide, { timeoutMs: 50 });
    const pending = client.request('speech.stop', {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toMatchObject({ code: 'timeout' });
    vi.useRealTimers();
  });

  it('lets a request override or disable the timeout', async () => {
    vi.useFakeTimers();
    try {
      const [frameSide] = createMemoryTransportPair();
      const client = createHostClient(frameSide, { timeoutMs: 50 });
      let settled = false;
      const longer = client.request('speech.stop', {}, { timeoutMs: 500 }).catch((e: unknown) => e);
      void client
        .request('speech.stop', {}, { timeoutMs: null })
        .finally(() => {
          settled = true;
        })
        .catch(() => {});
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(await longer).toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);
      client.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('delivers host events and ignores foreign messages', async () => {
    const [frameSide, hostSide] = createMemoryTransportPair();
    const client = createHostClient(frameSide);
    const onPause = vi.fn();
    client.onEvent('pause', onPause);
    hostSide.send({ some: 'other library message' });
    hostSide.send({ channel: CHANNEL, v: 999, type: 'event', name: 'pause' });
    hostSide.send({ channel: CHANNEL, v: PROTOCOL_VERSION, type: 'event', name: 'pause' });
    await Promise.resolve();
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('drops pending requests on dispose without settling them', async () => {
    const [frameSide] = createMemoryTransportPair();
    const client = createHostClient(frameSide, { timeoutMs: 5 });
    const settled = vi.fn();
    client.request('speech.stop', {}).then(settled, settled);
    client.dispose();
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).not.toHaveBeenCalled();
  });

  it('never surfaces fire-and-forget context calls as unhandled rejections on dispose', async () => {
    // Vitest fails the run on an unhandled rejection, so these calls are the assertion.
    const [frameSide] = createMemoryTransportPair();
    const client = createHostClient(frameSide);
    const ctx = createGameContext(client, SESSION, MANIFEST);
    void ctx.speech.speak('hi');
    void ctx.speech.speak('bye').then(() => {});
    client.dispose();
    await new Promise((r) => setTimeout(r, 10));
  });
});
