import { createMemoryStore } from '@braincade/learning';
import { describe, expect, it } from 'vitest';
import { readSettings, type SecretStore, writeSettings } from './settings';

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    deleteItemAsync: async (key) => void data.delete(key),
  };
}

describe('settings', () => {
  it('round-trips and defaults when missing or corrupt', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    expect(await readSettings(store, secrets)).toEqual({ serverUrl: '', readerCode: '' });
    await writeSettings(store, secrets, {
      serverUrl: 'http://192.168.1.20:5173',
      readerCode: 'tacos',
    });
    expect(await readSettings(store, secrets)).toEqual({
      serverUrl: 'http://192.168.1.20:5173',
      readerCode: 'tacos',
    });
    store.data.set('braincade:mobile-settings', '{oops');
    expect(await readSettings(store, secrets)).toEqual({ serverUrl: '', readerCode: 'tacos' });
  });

  it('keeps the reader code out of the plain settings JSON', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: 'http://x', readerCode: 'tacos' });
    expect(store.data.get('braincade:mobile-settings')).not.toContain('tacos');
    expect([...secrets.data.values()]).toEqual(['tacos']);

    await writeSettings(store, secrets, { serverUrl: 'http://x', readerCode: '' });
    expect(secrets.data.size).toBe(0);
  });

  it('moves a code saved by an earlier build into secure storage', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    store.data.set(
      'braincade:mobile-settings',
      JSON.stringify({ serverUrl: 'http://x', readerCode: 'tacos' }),
    );
    expect(await readSettings(store, secrets)).toEqual({
      serverUrl: 'http://x',
      readerCode: 'tacos',
    });
    expect(store.data.get('braincade:mobile-settings')).toBe(
      JSON.stringify({ serverUrl: 'http://x' }),
    );
    expect([...secrets.data.values()]).toEqual(['tacos']);
  });
});
