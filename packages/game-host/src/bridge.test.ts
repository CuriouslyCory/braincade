// @vitest-environment jsdom
import {
  bootFrame,
  CHANNEL,
  createMemoryTransportPair,
  defineGame,
  type GameContext,
  type GameManifest,
  PROTOCOL_VERSION,
} from '@braincade/game-sdk';
import { createLearnerRepository, createMemoryStore, type WordList } from '@braincade/learning';
import type { PrintableDocument } from '@braincade/printables';
import { describe, expect, it, vi } from 'vitest';
import { createHostBridge, type HostBridgeOptions } from './bridge';

const manifest: GameManifest = {
  id: 'demo',
  title: 'Demo',
  description: 'Demo game',
  icon: '🧪',
  engine: 'dom',
  skills: ['spelling'],
  requires: [],
  status: 'draft',
  version: '1.0.0',
};

const wordLists: WordList[] = [
  {
    id: 'w',
    title: 'W',
    words: [
      { word: 'because', tags: [] },
      { word: 'their', tags: ['homophone'] },
    ],
  },
];

const flush = () => new Promise((r) => setTimeout(r, 0));

async function run(
  mount: (root: HTMLElement, ctx: GameContext) => (() => void) | undefined | Promise<undefined>,
  overrides: Partial<HostBridgeOptions> = {},
) {
  const [frameSide, hostSide] = createMemoryTransportPair();
  const learner = createLearnerRepository(createMemoryStore());
  await learner.saveProfile({ name: 'Sam', interests: ['soccer'] });
  const spoken: string[] = [];
  const printed: PrintableDocument[] = [];
  const onReady = vi.fn();
  const onGameExit = vi.fn();
  const onError = vi.fn();
  let clock = 1_000;
  const bridge = createHostBridge({
    transport: hostSide,
    game: manifest,
    platform: 'web',
    locale: 'en-US',
    learner,
    wordLists,
    speech: { speak: async (text) => void spoken.push(text), stop: () => {} },
    printer: { print: async (doc) => void printed.push(doc) },
    now: () => clock++,
    newId: () => 'session-1',
    onReady,
    onGameExit,
    onError,
    ...overrides,
  });
  const root = document.createElement('div');
  const frame = await bootFrame({
    games: [{ manifest, load: async () => ({ default: defineGame({ mount }) }) }],
    gameId: 'demo',
    root,
    transport: frameSide,
  });
  await flush();
  return {
    bridge,
    frame,
    learner,
    spoken,
    printed,
    onReady,
    onGameExit,
    onError,
    hostSide,
    frameSide,
  };
}

describe('host bridge + game frame', () => {
  it('serves a full game session end to end', async () => {
    let ctx!: GameContext;
    const t = await run((_root, c) => {
      ctx = c;
      return undefined;
    });
    expect(t.onReady).toHaveBeenCalledOnce();
    expect(ctx.session).toMatchObject({
      sessionId: 'session-1',
      learner: { name: 'Sam', interests: ['soccer'] },
      capabilities: ['storage', 'speech', 'print'],
    });

    const words = await ctx.words.next({ count: 5, tags: ['homophone'] });
    expect(words).toEqual([
      { word: 'their', tags: ['homophone'], listId: 'w', status: 'new', box: 0 },
    ]);

    await ctx.speech.speak('their');
    await ctx.print({ title: 'Sheet', pages: [{ blocks: [{ type: 'text', text: 'hi' }] }] });
    await ctx.progress.record([
      { word: 'their', correct: false, response: 'thier' },
      { word: 'because', correct: true },
    ]);
    await ctx.storage.set('level', 3);
    expect(await ctx.storage.get('level')).toBe(3);
    expect(await ctx.storage.get('missing')).toBeNull();

    await ctx.exit({ score: 42 });
    await flush();

    expect(t.spoken).toEqual(['their']);
    expect(t.printed[0]?.title).toBe('Sheet');
    expect((await t.learner.getMastery()).words.their?.lastResponse).toBe('thier');
    expect(t.onGameExit).toHaveBeenCalledOnce();
    expect(await t.learner.getSessions()).toEqual([
      expect.objectContaining({
        id: 'session-1',
        gameId: 'demo',
        gameVersion: '1.0.0',
        attempts: 2,
        correct: 1,
        score: 42,
      }),
    ]);

    // Words just missed come back first next time.
    expect((await ctx.words.next({ count: 1 }))[0]?.word).toBe('their');
  });

  it('asks the game to clean up on host exit and records the session once', async () => {
    const cleanup = vi.fn();
    const t = await run(() => cleanup);
    await t.bridge.requestExit({ timeoutMs: 500 });
    expect(cleanup).toHaveBeenCalledOnce();
    t.bridge.dispose();
    await flush();
    expect(await t.learner.getSessions()).toHaveLength(1);
  });

  it('still exits when the session cannot be saved', async () => {
    const learner = createLearnerRepository(createMemoryStore());
    learner.recordSession = async () => {
      throw new Error('QuotaExceededError');
    };
    let ctx!: GameContext;
    const t = await run(
      (_root, c) => {
        ctx = c;
        return undefined;
      },
      { learner },
    );
    await ctx.exit({ score: 1 });
    await flush();
    expect(t.onGameExit).toHaveBeenCalledOnce();
    await expect(t.bridge.requestExit({ timeoutMs: 50 })).resolves.toBeUndefined();
    expect(t.onError).toHaveBeenCalledWith({
      code: 'storage',
      message: 'Could not save the session: QuotaExceededError',
    });
  });

  it('rejects capabilities the platform does not have', async () => {
    let ctx!: GameContext;
    await run(
      (_root, c) => {
        ctx = c;
        return undefined;
      },
      { speech: undefined, printer: undefined },
    );
    expect(ctx.has('speech')).toBe(false);
    await expect(ctx.speech.speak('hi')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(ctx.print({ title: 'x', pages: [{ blocks: [] }] })).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('validates requests from the frame', async () => {
    const t = await run(() => undefined);
    const responses: unknown[] = [];
    t.frameSide.listen((m) => responses.push(m));
    const request = (id: number, method: string, params: unknown) =>
      t.frameSide.send({
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        type: 'request',
        id,
        method,
        params,
      });

    request(900, 'files.delete', {});
    request(901, 'speech.speak', { text: '' });
    request(902, 'print.document', {
      document: { title: 'x', pages: [{ blocks: [{ type: 'script' }] }] },
    });
    request(903, 'session.start', { gameId: 'other', version: '1.0.0' });
    await flush();

    const codes = Object.fromEntries(
      (responses as Array<{ id: number; error?: { code: string } }>).map((r) => [
        r.id,
        r.error?.code,
      ]),
    );
    expect(codes).toEqual({
      900: 'unknown-method',
      901: 'bad-request',
      902: 'bad-request',
      903: 'not-found',
    });
  });

  it('surfaces game errors to the host', async () => {
    const t = await run(() => {
      throw new Error('boom');
    });
    expect(t.onError).toHaveBeenCalledWith({ code: 'internal', message: 'boom' });
    expect(t.onReady).not.toHaveBeenCalled();
  });
});
