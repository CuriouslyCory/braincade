import { describe, expect, it, vi } from 'vitest';
import { createHostClient } from './client';
import { createGameContext, speechTimeoutMs } from './context';
import type { GameManifest } from './manifest';
import { CHANNEL, PROTOCOL_VERSION, type RequestMessage, type SessionInfo } from './protocol';
import { createMemoryTransportPair } from './transport';

const manifest: GameManifest = {
  id: 'demo',
  title: 'Demo',
  description: 'Demo',
  icon: '🧪',
  engine: 'dom',
  skills: ['spelling'],
  requires: [],
  status: 'draft',
  version: '0.1.0',
};

const session: SessionInfo = {
  sessionId: 's',
  gameId: 'demo',
  platform: 'web',
  capabilities: ['storage', 'speech', 'print'],
  learner: { name: '', interests: [] },
  locale: 'en-US',
};

/** A host that answers every request only after `delayMs`, like a long utterance or open print dialog. */
function slowHost(delayMs: number) {
  const [frameSide, hostSide] = createMemoryTransportPair();
  hostSide.listen((raw) => {
    const msg = raw as RequestMessage;
    setTimeout(() => {
      hostSide.send({
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        type: 'response',
        id: msg.id,
        ok: true,
        result: null,
      });
    }, delayMs);
  });
  return createGameContext(createHostClient(frameSide), session, manifest);
}

describe('createGameContext timeouts', () => {
  it('waits for long utterances instead of timing out at the default', async () => {
    vi.useFakeTimers();
    try {
      const text = 'a'.repeat(1000);
      const ctx = slowHost(60_000);
      const result = ctx.speech.speak(text, { rate: 0.5 }).then(
        () => 'spoke',
        (e: unknown) => e,
      );
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await result).toBe('spoke');
      expect(speechTimeoutMs(text, 0.5)).toBeGreaterThan(300_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never times out while the print dialog is open', async () => {
    vi.useFakeTimers();
    try {
      const ctx = slowHost(5 * 60_000);
      const result = ctx
        .print({ title: 'Sheet', pages: [{ blocks: [{ type: 'text', text: 'hi' }] }] })
        .then(
          () => 'printed',
          (e: unknown) => e,
        );
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
      expect(await result).toBe('printed');
    } finally {
      vi.useRealTimers();
    }
  });
});
