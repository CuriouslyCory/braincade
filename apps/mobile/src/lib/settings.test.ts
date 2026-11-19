import { createMemoryStore } from '@braincade/learning';
import { describe, expect, it } from 'vitest';
import { readSettings, type SecretStore, writeSettings } from './settings';

const SETTINGS_KEY = 'braincade:mobile-settings';

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    deleteItemAsync: async (key) => void data.delete(key),
  };
}

const fail = async (): Promise<never> => {
  throw new Error('keychain unavailable');
};

describe('settings', () => {
  it('round-trips and defaults when missing or corrupt', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    expect((await readSettings(store, secrets)).settings).toEqual({
      serverUrl: '',
      readerCode: '',
    });
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'tacos' });
    expect(await readSettings(store, secrets)).toEqual({
      settings: { serverUrl: 'http://a', readerCode: 'tacos' },
      readerCodeUnreadable: false,
    });
    store.data.set(SETTINGS_KEY, '{oops');
    // The code was saved for http://a, not the default server, so it isn't used.
    expect((await readSettings(store, secrets)).settings).toEqual({
      serverUrl: '',
      readerCode: '',
    });
  });

  it('keeps the reader code out of the plain settings JSON', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'tacos' });
    expect(store.data.get(SETTINGS_KEY)).not.toContain('tacos');

    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: '' });
    expect(secrets.data.size).toBe(0);
  });

  it('never pairs a server with another server’s code when a save fails part way', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'code-a' });

    // The secure write fails: nothing changed, server A keeps code A.
    await expect(
      writeSettings(
        store,
        { ...secrets, setItemAsync: fail },
        {
          serverUrl: 'http://b',
          readerCode: 'code-b',
        },
      ),
    ).rejects.toThrow();
    expect((await readSettings(store, secrets)).settings).toEqual({
      serverUrl: 'http://a',
      readerCode: 'code-a',
    });

    // The code is saved but the settings write fails: server A must not get code B.
    const brokenStore = { ...store, setItem: fail };
    await expect(
      writeSettings(brokenStore, secrets, { serverUrl: 'http://b', readerCode: 'code-b' }),
    ).rejects.toThrow();
    expect((await readSettings(store, secrets)).settings).toEqual({
      serverUrl: 'http://a',
      readerCode: '',
    });
  });

  it('starts with ordinary settings when secure storage fails, keeping the saved code', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'tacos' });

    expect(await readSettings(store, { ...secrets, getItemAsync: fail })).toEqual({
      settings: { serverUrl: 'http://a', readerCode: '' },
      readerCodeUnreadable: true,
    });
    // Saving other settings without retyping the code leaves it in place.
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: undefined });
    expect((await readSettings(store, secrets)).settings.readerCode).toBe('tacos');
  });

  it('moves a code saved by an earlier build into secure storage', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    store.data.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'http://a', readerCode: 'tacos' }));
    expect((await readSettings(store, secrets)).settings).toEqual({
      serverUrl: 'http://a',
      readerCode: 'tacos',
    });
    expect(store.data.get(SETTINGS_KEY)).toBe(JSON.stringify({ serverUrl: 'http://a' }));
    expect((await readSettings(store, secrets)).settings.readerCode).toBe('tacos');
  });

  it('still starts, with the old code, when the migration write fails', async () => {
    const store = createMemoryStore();
    store.data.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'http://a', readerCode: 'tacos' }));
    const secrets = { ...memorySecrets(), setItemAsync: fail };
    expect(await readSettings(store, secrets)).toEqual({
      settings: { serverUrl: 'http://a', readerCode: 'tacos' },
      readerCodeUnreadable: false,
    });
    // Nothing was lost: the next launch can migrate it.
    expect(store.data.get(SETTINGS_KEY)).toContain('tacos');
  });
});
