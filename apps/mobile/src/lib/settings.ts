import type { KeyValueStore } from '@braincade/learning';
import { z } from 'zod';

const KEY = 'braincade:mobile-settings';
/** Kept out of the settings JSON: it authorizes paid handwriting reads on the server. */
const READER_CODE_KEY = 'braincade.reader-access-code';

export const settingsSchema = z.object({
  /** Overrides EXPO_PUBLIC_BRAINCADE_URL, e.g. a LAN dev server. */
  serverUrl: z.string().default(''),
  /** The server's BRAINCADE_ACCESS_CODE, which turns on its handwriting reader for this device. */
  readerCode: z.string().default(''),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Encrypted storage for secrets (expo-secure-store in the app). */
export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export async function readSettings(store: KeyValueStore, secrets: SecretStore): Promise<Settings> {
  let stored: Record<string, unknown> = {};
  try {
    const raw = await store.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    // corrupt settings: use defaults
  }
  // Codes saved by earlier builds lived in the plain settings JSON: move them to secure storage.
  if (typeof stored.readerCode === 'string') {
    const { readerCode, ...rest } = stored;
    if (readerCode) await secrets.setItemAsync(READER_CODE_KEY, readerCode);
    await store.setItem(KEY, JSON.stringify(rest));
    stored = rest;
  }
  const parsed = settingsSchema.safeParse({
    ...stored,
    readerCode: (await secrets.getItemAsync(READER_CODE_KEY)) ?? '',
  });
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

export async function writeSettings(
  store: KeyValueStore,
  secrets: SecretStore,
  settings: Settings,
): Promise<void> {
  const { readerCode, ...plain } = settingsSchema.parse(settings);
  await store.setItem(KEY, JSON.stringify(plain));
  if (readerCode) await secrets.setItemAsync(READER_CODE_KEY, readerCode);
  else await secrets.deleteItemAsync(READER_CODE_KEY);
}
