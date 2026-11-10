import type { Catalog } from '@braincade/game-host';
import type { LearnerProfile } from '@braincade/learning';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { loadCatalog } from './lib/catalog';
import { resolveBaseUrl } from './lib/config';
import { readSettings, type Settings, writeSettings } from './lib/settings';
import { learner } from './native-platform';

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: Catalog; source: 'network' | 'cache' }
  | { status: 'error'; message: string };

interface HostState {
  baseUrl: string | null;
  settings: Settings;
  profile: LearnerProfile | null;
  catalog: CatalogState;
  reload(): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  saveProfile(patch: Partial<LearnerProfile>): Promise<void>;
}

const HostContext = createContext<HostState | null>(null);

export function HostProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });

  const baseUrl = useMemo(
    () =>
      settings &&
      resolveBaseUrl({
        override: settings.serverUrl,
        envUrl: process.env.EXPO_PUBLIC_BRAINCADE_URL,
        devHostUri: __DEV__ ? Constants.expoConfig?.hostUri : null,
      }),
    [settings],
  );

  useEffect(() => {
    void readSettings(AsyncStorage).then(setSettings);
    void learner.getProfile().then(setProfile);
  }, []);

  const reload = useCallback(async () => {
    if (!settings) return;
    if (!baseUrl) {
      setCatalog({ status: 'error', message: 'Set the Braincade server URL in Grown-ups.' });
      return;
    }
    setCatalog({ status: 'loading' });
    try {
      const loaded = await loadCatalog({ baseUrl, fetchFn: fetch, cache: AsyncStorage });
      setCatalog({ status: 'ready', ...loaded });
    } catch (error) {
      setCatalog({
        status: 'error',
        message: `Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [baseUrl, settings]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<HostState | null>(
    () =>
      settings && {
        baseUrl,
        settings,
        profile,
        catalog,
        reload,
        saveSettings: async (next) => {
          await writeSettings(AsyncStorage, next);
          setSettings(next);
        },
        saveProfile: async (patch) => {
          setProfile(await learner.saveProfile(patch));
        },
      },
    [baseUrl, catalog, profile, reload, settings],
  );

  return value ? <HostContext.Provider value={value}>{children}</HostContext.Provider> : null;
}

export function useHost(): HostState {
  const value = useContext(HostContext);
  if (!value) throw new Error('useHost must be used inside HostProvider');
  return value;
}
