import { createMemoryStore } from '@braincade/learning';
import { describe, expect, it } from 'vitest';
import {
  readSettings,
  type SecretStore,
  type ServerFor,
  settingsToSave,
  writeSettings,
} from './settings';

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

/** An empty URL field means the build's default server. */
const serverFor: ServerFor = (url) => (url ? new URL(url).origin : 'https://default.example');

const fail = async (): Promise<never> => {
  throw new Error('keychain unavailable');
};

describe('settings', () => {
  it('round-trips and defaults when missing or corrupt', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    expect((await readSettings(store, secrets, serverFor)).settings).toEqual({
      serverUrl: '',
      readerCode: '',
    });
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'tacos' }, serverFor);
    expect(await readSettings(store, secrets, serverFor)).toEqual({
      settings: { serverUrl: 'http://a', readerCode: 'tacos' },
      readerCodeUnreadable: false,
    });
    store.data.set(SETTINGS_KEY, '{oops');
    // The code was saved for http://a, not the default server, so it isn't used.
    expect((await readSettings(store, secrets, serverFor)).settings).toEqual({
      serverUrl: '',
      readerCode: '',
    });
  });

  it('keeps the reader code out of the plain settings JSON', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'tacos' }, serverFor);
    expect(store.data.get(SETTINGS_KEY)).not.toContain('tacos');

    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: '' }, serverFor);
    expect(secrets.data.size).toBe(0);
  });

  it('never pairs a server with another server’s code when a save fails part way', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'code-a' }, serverFor);

    // The secure write fails: nothing changed, server A keeps code A.
    await expect(
      writeSettings(
        store,
        { ...secrets, setItemAsync: fail },
        {
          serverUrl: 'http://b',
          readerCode: 'code-b',
        },
        serverFor,
      ),
    ).rejects.toThrow();
    expect((await readSettings(store, secrets, serverFor)).settings).toEqual({
      serverUrl: 'http://a',
      readerCode: 'code-a',
    });

    // The code is saved but the settings write fails: server A must not get code B.
    const brokenStore = { ...store, setItem: fail };
    await expect(
      writeSettings(
        brokenStore,
        secrets,
        { serverUrl: 'http://b', readerCode: 'code-b' },
        serverFor,
      ),
    ).rejects.toThrow();
    expect((await readSettings(store, secrets, serverFor)).settings).toEqual({
      serverUrl: 'http://a',
      readerCode: '',
    });
  });

  it('starts with ordinary settings when secure storage fails, keeping the saved code', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: 'http://a', readerCode: 'tacos' }, serverFor);

    expect(await readSettings(store, { ...secrets, getItemAsync: fail }, serverFor)).toEqual({
      settings: { serverUrl: 'http://a', readerCode: '' },
      readerCodeUnreadable: true,
    });
    // Saving other settings without retyping the code leaves it in place.
    await writeSettings(
      store,
      secrets,
      { serverUrl: 'http://a', readerCode: undefined },
      serverFor,
    );
    expect((await readSettings(store, secrets, serverFor)).settings.readerCode).toBe('tacos');
  });

  it('moves a code saved by an earlier build into secure storage', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    store.data.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'http://a', readerCode: 'tacos' }));
    expect((await readSettings(store, secrets, serverFor)).settings).toEqual({
      serverUrl: 'http://a',
      readerCode: 'tacos',
    });
    expect(store.data.get(SETTINGS_KEY)).toBe(JSON.stringify({ serverUrl: 'http://a' }));
    expect((await readSettings(store, secrets, serverFor)).settings.readerCode).toBe('tacos');
  });

  it('still starts, with the old code, when the migration write fails', async () => {
    const store = createMemoryStore();
    store.data.set(SETTINGS_KEY, JSON.stringify({ serverUrl: 'http://a', readerCode: 'tacos' }));
    const secrets = { ...memorySecrets(), setItemAsync: fail };
    expect(await readSettings(store, secrets, serverFor)).toEqual({
      settings: { serverUrl: 'http://a', readerCode: 'tacos' },
      readerCodeUnreadable: false,
    });
    // Nothing was lost: the next launch can migrate it.
    expect(store.data.get(SETTINGS_KEY)).toContain('tacos');
  });

  it('binds the code to the server actually in use, not the text in the URL field', async () => {
    const store = createMemoryStore();
    const secrets = memorySecrets();
    await writeSettings(store, secrets, { serverUrl: '', readerCode: 'tacos' }, serverFor);
    expect((await readSettings(store, secrets, serverFor)).settings.readerCode).toBe('tacos');

    // A new build (or dev machine) points the empty field at another server.
    const movedDefault: ServerFor = (url) => (url ? new URL(url).origin : 'https://other.example');
    expect((await readSettings(store, secrets, movedDefault)).settings.readerCode).toBe('');
    // The same server spelled differently is still the same server.
    await writeSettings(
      store,
      secrets,
      { serverUrl: 'https://a.example', readerCode: 'x' },
      serverFor,
    );
    expect(
      (await readSettings(store, secrets, () => 'https://a.example')).settings.readerCode,
    ).toBe('x');
  });
});

describe('settingsToSave', () => {
  const saved = { serverUrl: 'https://a.example', readerCode: 'code-a' };
  const form = { saved, readerCodeUnreadable: false };

  it("doesn't carry a saved code over to a new server", () => {
    expect(
      settingsToSave({ ...form, serverUrl: 'https://b.example', readerCode: 'code-a' }),
    ).toEqual({ serverUrl: 'https://b.example', readerCode: '' });
  });

  it('saves a code typed for the new server', () => {
    expect(
      settingsToSave({ ...form, serverUrl: 'https://b.example', readerCode: ' code-b ' }),
    ).toEqual({ serverUrl: 'https://b.example', readerCode: 'code-b' });
  });

  it('keeps the code when only other settings change, and keeps an unreadable code', () => {
    expect(
      settingsToSave({ ...form, serverUrl: 'https://a.example', readerCode: 'code-a' }),
    ).toEqual({ serverUrl: 'https://a.example', readerCode: 'code-a' });
    expect(
      settingsToSave({
        saved: { serverUrl: 'https://a.example', readerCode: '' },
        readerCodeUnreadable: true,
        serverUrl: 'https://a.example',
        readerCode: '',
      }),
    ).toEqual({ serverUrl: 'https://a.example', readerCode: undefined });
  });
});
