import {
  type Catalog,
  createHandwritingService,
  type HandwritingCapability,
} from '@braincade/game-host';
import { type LearnerProfile, learnerProfileSchema } from '@braincade/learning';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
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
import { originOf, resolveBaseUrl } from './lib/config';
import { readSettings, type ServerFor, type Settings, writeSettings } from './lib/settings';
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
  /** The server's handwriting reader, or null until a probe finds it configured. */
  handwriting: HandwritingCapability | null;
  /** Secure storage failed on launch: the saved reader code is kept but couldn't be read. */
  readerCodeUnreadable: boolean;
  reload(): Promise<void>;
  /** `readerCode: undefined` keeps the stored code (see readerCodeUnreadable). */
  saveSettings(settings: { serverUrl: string; readerCode?: string | undefined }): Promise<void>;
  saveProfile(patch: Partial<LearnerProfile>): Promise<void>;
}

/** Where the app loads games from for a saved server URL. */
const baseUrlFor = (serverUrl: string) =>
  resolveBaseUrl({
    override: serverUrl,
    envUrl: process.env.EXPO_PUBLIC_BRAINCADE_URL,
    devHostUri: __DEV__ ? Constants.expoConfig?.hostUri : null,
  });

/** The reader code is bound to the origin of the server actually in use. */
const serverFor: ServerFor = (serverUrl) => {
  const base = baseUrlFor(serverUrl);
  return base ? originOf(base) : null;
};

const HostContext = createContext<HostState | null>(null);

export function HostProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [handwriting, setHandwriting] = useState<HandwritingCapability | null>(null);
  const [readerCodeUnreadable, setReaderCodeUnreadable] = useState(false);

  const baseUrl = useMemo(() => settings && baseUrlFor(settings.serverUrl), [settings]);

  useEffect(() => {
    void readSettings(AsyncStorage, SecureStore, serverFor).then((loaded) => {
      setSettings(loaded.settings);
      setReaderCodeUnreadable(loaded.readerCodeUnreadable);
    });
    void learner
      .getProfile()
      .then(setProfile)
      .catch(() => setProfile(learnerProfileSchema.parse({})));
  }, []);

  // Overlapping reloads (URL change, pull-to-refresh) must not let an older
  // response overwrite a newer one. Each reload also re-probes the server's
  // handwriting reader, alongside the catalog.
  const latestReload = useRef(0);
  const reload = useCallback(async () => {
    if (!settings) return;
    const requestId = ++latestReload.current;
    const isCurrent = () => requestId === latestReload.current;
    setHandwriting(null);
    if (!baseUrl) {
      setCatalog({ status: 'error', message: 'Set the Braincade server URL in Grown-ups.' });
      return;
    }
    setCatalog({ status: 'loading' });
    const service = createHandwritingService(baseUrl, {
      fetch,
      accessCode: settings.readerCode || undefined,
    });
    void service.available().then((ok) => {
      if (ok && isCurrent()) setHandwriting(service);
    });
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
        handwriting,
        readerCodeUnreadable,
        reload,
        saveSettings: async (next) => {
          await writeSettings(AsyncStorage, SecureStore, next, serverFor);
          setSettings({
            serverUrl: next.serverUrl,
            readerCode: next.readerCode ?? settings.readerCode,
          });
          if (next.readerCode !== undefined) setReaderCodeUnreadable(false);
        },
        saveProfile: async (patch) => {
          setProfile(await learner.saveProfile(patch));
        },
      },
    [baseUrl, catalog, handwriting, profile, readerCodeUnreadable, reload, settings],
  );

  return value ? <HostContext.Provider value={value}>{children}</HostContext.Provider> : null;
}

export function useHost(): HostState {
  const value = useContext(HostContext);
  if (!value) throw new Error('useHost must be used inside HostProvider');
  return value;
}
