import { describe, expect, it, vi } from 'vitest';
import { createHostClient } from './client';
import { CHANNEL, HostError, PROTOCOL_VERSION, type RequestMessage } from './protocol';
import { createMemoryTransportPair } from './transport';

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

  it('rejects pending requests on dispose', async () => {
    const [frameSide] = createMemoryTransportPair();
    const client = createHostClient(frameSide);
    const pending = client.request('speech.stop', {});
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'internal' });
  });
});
