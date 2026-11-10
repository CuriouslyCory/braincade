/**
 * A transport moves protocol messages between a game frame and its host.
 * Messages are plain JSON-compatible objects.
 */
export interface Transport {
  send(message: unknown): void;
  listen(handler: (message: unknown) => void): () => void;
}

declare global {
  interface Window {
    /** Injected by react-native-webview. */
    ReactNativeWebView?: { postMessage(data: string): void };
    /** Installed by the frame so the native host can deliver messages via injectJavaScript. */
    __braincadeReceive?: (message: unknown) => void;
  }
}

/** Name of the global the native host calls to deliver messages into the WebView. */
export const NATIVE_RECEIVE_GLOBAL = '__braincadeReceive';

/**
 * Frame side, web: talk to the parent window. The host page and the frame are
 * served from the same origin, so messages are pinned to that origin.
 */
export function parentWindowTransport(win: Window = window): Transport {
  const origin = win.location.origin;
  return {
    send: (message) => win.parent.postMessage(message, origin),
    listen: (handler) => {
      const onMessage = (event: MessageEvent) => {
        if (event.source !== win.parent || event.origin !== origin) return;
        handler(event.data);
      };
      win.addEventListener('message', onMessage);
      return () => win.removeEventListener('message', onMessage);
    },
  };
}

/** Frame side, mobile: talk to the React Native host through react-native-webview. */
export function reactNativeTransport(win: Window = window): Transport {
  const handlers = new Set<(message: unknown) => void>();
  win[NATIVE_RECEIVE_GLOBAL] = (message) => {
    for (const handler of handlers) handler(message);
  };
  return {
    send: (message) => win.ReactNativeWebView?.postMessage(JSON.stringify(message)),
    listen: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

/** Pick the transport for wherever this frame is running, or null when opened standalone. */
export function detectHostTransport(win: Window = window): Transport | null {
  if (win.ReactNativeWebView) return reactNativeTransport(win);
  if (win.parent && win.parent !== win) return parentWindowTransport(win);
  return null;
}

/**
 * Two connected in-memory transports. Delivery is asynchronous and messages are
 * JSON round-tripped, matching postMessage closely enough for tests.
 */
export function createMemoryTransportPair(): [Transport, Transport] {
  const make = (
    inbox: Set<(m: unknown) => void>,
    outbox: Set<(m: unknown) => void>,
  ): Transport => ({
    send: (message) => {
      const copy = JSON.parse(JSON.stringify(message)) as unknown;
      queueMicrotask(() => {
        for (const handler of outbox) handler(copy);
      });
    },
    listen: (handler) => {
      inbox.add(handler);
      return () => inbox.delete(handler);
    },
  });
  const a = new Set<(m: unknown) => void>();
  const b = new Set<(m: unknown) => void>();
  return [make(a, b), make(b, a)];
}
