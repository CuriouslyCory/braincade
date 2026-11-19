import type { KeyValueStore } from '@braincade/learning';
import { z } from 'zod';

const KEY = 'braincade:mobile-settings';
/**
 * Kept out of the settings JSON: it authorizes paid handwriting reads on the server.
 * Stored with the server URL it was entered for, so it is only ever sent to that server.
 */
const READER_CODE_KEY = 'braincade.reader-access-code';

export const settingsSchema = z.object({
  /** Overrides EXPO_PUBLIC_BRAINCADE_URL, e.g. a LAN dev server. */
  serverUrl: z.string().default(''),
  /** The server's BRAINCADE_ACCESS_CODE, which turns on its handwriting reader for this device. */
  readerCode: z.string().default(''),
});

export type Settings = z.infer<typeof settingsSchema>;

const boundCodeSchema = z.object({ serverUrl: z.string(), code: z.string() });

/** Encrypted storage for secrets (expo-secure-store in the app). */
export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface LoadedSettings {
  settings: Settings;
  /** Secure storage failed: the saved code (if any) is kept but can't be used right now. */
  readerCodeUnreadable: boolean;
}

/** Never rejects: a broken store or keychain must not keep the app from starting. */
export async function readSettings(
  store: KeyValueStore,
  secrets: SecretStore,
): Promise<LoadedSettings> {
  let stored: Record<string, unknown> = {};
  try {
    const raw = await store.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    // corrupt settings: use defaults
  }
  const plain = settingsSchema.omit({ readerCode: true }).safeParse(stored);
  const serverUrl = plain.success ? plain.data.serverUrl : '';

  // Codes saved by earlier builds lived in the plain settings JSON: move them to secure storage.
  if (typeof stored.readerCode === 'string') {
    const legacy = stored.readerCode;
    try {
      if (legacy) await secrets.setItemAsync(READER_CODE_KEY, bind(serverUrl, legacy));
      await store.setItem(KEY, JSON.stringify({ serverUrl }));
    } catch {
      // Try again next launch; meanwhile the code is still where it was.
    }
    return { settings: { serverUrl, readerCode: legacy }, readerCodeUnreadable: false };
  }

  let secret: string | null;
  try {
    secret = await secrets.getItemAsync(READER_CODE_KEY);
  } catch {
    return { settings: { serverUrl, readerCode: '' }, readerCodeUnreadable: true };
  }
  return {
    settings: { serverUrl, readerCode: boundCode(secret, serverUrl) },
    readerCodeUnreadable: false,
  };
}

/**
 * Save settings. `readerCode: undefined` leaves the stored code alone (it couldn't be read).
 * The code is written first and bound to its server URL, so a failure between the two
 * writes can't pair a new server with another server's code.
 */
export async function writeSettings(
  store: KeyValueStore,
  secrets: SecretStore,
  settings: { serverUrl: string; readerCode?: string | undefined },
): Promise<void> {
  const { serverUrl, readerCode } = settings;
  if (readerCode) await secrets.setItemAsync(READER_CODE_KEY, bind(serverUrl, readerCode));
  else if (readerCode === '') await secrets.deleteItemAsync(READER_CODE_KEY);
  await store.setItem(KEY, JSON.stringify({ serverUrl }));
}

function bind(serverUrl: string, code: string): string {
  return JSON.stringify({ serverUrl, code });
}

/** The stored code, if it was saved for this server URL. */
function boundCode(secret: string | null, serverUrl: string): string {
  if (!secret) return '';
  try {
    const parsed = boundCodeSchema.safeParse(JSON.parse(secret));
    return parsed.success && parsed.data.serverUrl === serverUrl ? parsed.data.code : '';
  } catch {
    return '';
  }
}
