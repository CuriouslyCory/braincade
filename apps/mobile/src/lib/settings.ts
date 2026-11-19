import type { KeyValueStore } from '@braincade/learning';
import { z } from 'zod';

const KEY = 'braincade:mobile-settings';

export const settingsSchema = z.object({
  /** Overrides EXPO_PUBLIC_BRAINCADE_URL, e.g. a LAN dev server. */
  serverUrl: z.string().default(''),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function readSettings(store: KeyValueStore): Promise<Settings> {
  try {
    const raw = await store.getItem(KEY);
    const parsed = settingsSchema.safeParse(raw ? JSON.parse(raw) : {});
    if (parsed.success) return parsed.data;
  } catch {
    // corrupt settings: use defaults
  }
  return settingsSchema.parse({});
}

export async function writeSettings(store: KeyValueStore, settings: Settings): Promise<void> {
  await store.setItem(KEY, JSON.stringify(settingsSchema.parse(settings)));
}
