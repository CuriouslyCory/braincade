import type { GameManifest } from '@braincade/game-sdk';
import { describe, expect, it } from 'vitest';
import { launcherEntries } from './launcher';

const game = (id: string, overrides: Partial<GameManifest> = {}) => ({
  manifest: {
    id,
    title: id,
    description: 'd',
    icon: '🎮',
    engine: 'dom',
    skills: ['spelling'],
    requires: [],
    status: 'published',
    version: '1.0.0',
    ...overrides,
  } satisfies GameManifest,
});

describe('launcherEntries', () => {
  const games = [
    game('camera-hunt', { requires: ['camera'] }),
    game('word-race'),
    game('beta-idea', { status: 'draft' }),
    game('old-game', { status: 'retired' }),
    game('another', { requires: ['speech'] }),
  ];

  it('hides drafts and retired games by default and sorts playable games first', () => {
    const entries = launcherEntries(games, {
      showDrafts: false,
      capabilities: ['storage', 'speech'],
    });
    expect(entries.map((e) => [e.manifest.id, e.missing])).toEqual([
      ['another', []],
      ['word-race', []],
      ['camera-hunt', ['camera']],
    ]);
  });

  it('shows drafts when asked', () => {
    const entries = launcherEntries(games, { showDrafts: true, capabilities: ['storage'] });
    expect(entries.map((e) => e.manifest.id)).toEqual([
      'beta-idea',
      'word-race',
      'another',
      'camera-hunt',
    ]);
  });
});
