import type { KeyValueStore } from '@braincade/learning';
import { z } from 'zod';

const KEY = 'braincade:mobile-settings';
/**
 * Kept out of the settings JSON: it authorizes paid handwriting reads on the server.
 * Stored with the origin of the server it was entered for (the server the app actually
 * talks to, which may come from the build or the dev machine when the URL field is
 * empty), so it is only ever sent to that server.
 */
const READER_CODE_KEY = 'braincade.reader-access-code';

export const settingsSchema = z.object({
  /** Overrides EXPO_PUBLIC_BRAINCADE_URL, e.g. a LAN dev server. */
  serverUrl: z.string().default(''),
  /** The server's BRAINCADE_ACCESS_CODE, which turns on its handwriting reader for this device. */
  readerCode: z.string().default(''),
});

export type Settings = z.infer<typeof settingsSchema>;

const boundCodeSchema = z.object({ server: z.string(), code: z.string() });

/** The origin the app would talk to for a saved `serverUrl` (null: no server). */
export type ServerFor = (serverUrl: string) => string | null;

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
  serverFor: ServerFor,
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
      const server = serverFor(serverUrl);
      if (legacy && server) await secrets.setItemAsync(READER_CODE_KEY, bind(server, legacy));
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
    settings: { serverUrl, readerCode: boundCode(secret, serverFor(serverUrl)) },
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
  serverFor: ServerFor,
): Promise<void> {
  const { serverUrl, readerCode } = settings;
  const server = serverFor(serverUrl);
  if (readerCode && server) await secrets.setItemAsync(READER_CODE_KEY, bind(server, readerCode));
  else if (readerCode !== undefined) await secrets.deleteItemAsync(READER_CODE_KEY);
  await store.setItem(KEY, JSON.stringify({ serverUrl }));
}

function bind(server: string, code: string): string {
  return JSON.stringify({ server, code });
}

/** The stored code, if it was saved for this server. */
function boundCode(secret: string | null, server: string | null): string {
  if (!secret || !server) return '';
  try {
    const parsed = boundCodeSchema.safeParse(JSON.parse(secret));
    return parsed.success && parsed.data.server === server ? parsed.data.code : '';
  } catch {
    return '';
  }
}

/**
 * What the settings form should save. A saved code belongs to its server, so changing
 * the server clears it unless a code is typed; a code that couldn't be read is kept
 * (`undefined`) unless a new one is typed.
 */
export function settingsToSave(form: {
  saved: Settings;
  serverUrl: string;
  readerCode: string;
  readerCodeUnreadable: boolean;
}): { serverUrl: string; readerCode: string | undefined } {
  const serverUrl = form.serverUrl.trim();
  const code = form.readerCode.trim();
  const typed = form.readerCode !== form.saved.readerCode;
  if (serverUrl !== form.saved.serverUrl && !typed) return { serverUrl, readerCode: '' };
  if (form.readerCodeUnreadable && !code) return { serverUrl, readerCode: undefined };
  return { serverUrl, readerCode: code };
}
