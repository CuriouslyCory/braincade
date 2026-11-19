import { createHostBridge, type HostBridge, playUrl } from '@braincade/game-host';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { isSameOrigin, originOf } from '../../lib/config';
import { createWebViewTransport, type WebViewTransport } from '../../lib/webview-transport';
import { nativePlatform } from '../../native-platform';
import { useHost } from '../../state';
import { colors } from '../../theme';

type PlayerState = 'loading' | 'running' | 'error';

// react-native-webview defaults its extra-props generic to `undefined`, which turns every
// prop into `never`; pin it to `object`.
type GameWebView = WebView<object>;

export default function PlayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { catalog, baseUrl } = useHost();
  const loaded = catalog.status === 'ready' ? catalog.catalog : null;
  const game = loaded?.games.find((g) => g.id === id);
  const webViewRef = useRef<GameWebView>(null);
  const bridgeRef = useRef<{ bridge: HostBridge; transport: WebViewTransport } | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [state, setState] = useState<PlayerState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!game || !loaded) return;
    const transport = createWebViewTransport((script) =>
      webViewRef.current?.injectJavaScript(script),
    );
    const bridge = createHostBridge({
      ...nativePlatform(loaded.wordLists),
      transport,
      game,
      onReady: () => setState('running'),
      onError: (e) => {
        setError(e.message);
        setState('error');
      },
      onGameExit: () => router.back(),
    });
    bridgeRef.current = { bridge, transport };
    // Mount the WebView only once the bridge is listening.
    setBridgeReady(true);

    const appState = AppState.addEventListener('change', (next) =>
      next === 'active' ? bridge.resume() : bridge.pause(),
    );
    return () => {
      appState.remove();
      bridge.dispose();
      bridgeRef.current = null;
      setBridgeReady(false);
    };
  }, [game, loaded]);

  const exit = useCallback(async () => {
    await bridgeRef.current?.bridge.requestExit();
    router.back();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void exit();
      return true;
    });
    return () => sub.remove();
  }, [exit]);

  if (!game || !baseUrl) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.text}>Game not found.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back to games</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const origin = originOf(baseUrl) ?? baseUrl;

  return (
    <View style={styles.screen}>
      {bridgeReady && (
        <WebView<object>
          ref={webViewRef}
          source={{ uri: playUrl(baseUrl, game.id) }}
          originWhitelist={[origin]}
          onShouldStartLoadWithRequest={(request) => isSameOrigin(request.url, baseUrl)}
          onMessage={(event) => bridgeRef.current?.transport.receive(event.nativeEvent.data)}
          onError={(event) => {
            setError(event.nativeEvent.description);
            setState('error');
          }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          style={styles.webview}
        />
      )}
      {state === 'loading' && (
        <Text style={[styles.text, styles.overlay]}>Loading {game.title}…</Text>
      )}
      {state === 'error' && (
        <View style={[styles.center, styles.overlay]}>
          <Text style={styles.text}>Something went wrong: {error}</Text>
        </View>
      )}
      <SafeAreaView style={styles.exitArea} pointerEvents="box-none">
        <Pressable
          style={styles.exit}
          onPress={() => void exit()}
          accessibilityRole="button"
          accessibilityLabel="Exit game"
        >
          <Text style={styles.exitText}>✕</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  webview: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.bg,
    padding: 24,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  text: { color: colors.text, fontSize: 16 },
  link: { color: colors.accent2, fontSize: 16 },
  exitArea: { position: 'absolute', top: 0, left: 0 },
  exit: {
    margin: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  exitText: { color: '#fff', fontSize: 18 },
});
