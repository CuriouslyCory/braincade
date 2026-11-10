import { createMemoryStore } from '@braincade/learning';
import { describe, expect, it } from 'vitest';
import { readSettings, writeSettings } from './settings';

describe('settings', () => {
  it('round-trips and defaults when missing or corrupt', async () => {
    const store = createMemoryStore();
    expect(await readSettings(store)).toEqual({ serverUrl: '' });
    await writeSettings(store, { serverUrl: 'http://192.168.1.20:5173' });
    expect(await readSettings(store)).toEqual({ serverUrl: 'http://192.168.1.20:5173' });
    store.data.set('braincade:mobile-settings', '{oops');
    expect(await readSettings(store)).toEqual({ serverUrl: '' });
  });
});
