import type { Catalog } from '@braincade/game-host';
import { type LearnerProfile, learnerProfileSchema } from '@braincade/learning';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  profile: LearnerProfile;
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
    void learner
      .getProfile()
      .then(setProfile)
      .catch(() => setProfile(learnerProfileSchema.parse({})));
  }, []);

  // Overlapping reloads (URL change, pull-to-refresh) must not let an older
  // response overwrite a newer one.
  const latestReload = useRef(0);
  const reload = useCallback(async () => {
    if (!settings) return;
    const requestId = ++latestReload.current;
    const isCurrent = () => requestId === latestReload.current;
    if (!baseUrl) {
      setCatalog({ status: 'error', message: 'Set the Braincade server URL in Grown-ups.' });
      return;
    }
    setCatalog({ status: 'loading' });
    try {
      const loaded = await loadCatalog({ baseUrl, fetchFn: fetch, cache: AsyncStorage });
      if (isCurrent()) setCatalog({ status: 'ready', ...loaded });
    } catch (error) {
      if (!isCurrent()) return;
      setCatalog({
        status: 'error',
        message: `Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [baseUrl, settings]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Wait for both settings and profile so screens never seed forms from a missing profile.
  const value = useMemo<HostState | null>(
    () =>
      settings &&
      profile && {
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
