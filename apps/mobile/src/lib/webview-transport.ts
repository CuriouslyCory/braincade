import { NATIVE_RECEIVE_GLOBAL, type Transport } from '@braincade/game-sdk';

/** JS that delivers one message to the frame's receiver inside the WebView. */
export function injectionScript(message: unknown): string {
  // JSON is valid JS, except U+2028/U+2029 which older engines reject in source.
  const json = JSON.stringify(message)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const fn = `window.${NATIVE_RECEIVE_GLOBAL}`;
  return `${fn} && ${fn}(${json}); true;`;
}

export interface WebViewTransport extends Transport {
  /** Feed `onMessage` data from the WebView into the transport. */
  receive(data: string): void;
}

/** Host side of the native transport: injectJavaScript out, onMessage in. */
export function createWebViewTransport(inject: (script: string) => void): WebViewTransport {
  const handlers = new Set<(message: unknown) => void>();
  return {
    send: (message) => inject(injectionScript(message)),
    listen: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    receive: (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      for (const handler of handlers) handler(message);
    },
  };
}
