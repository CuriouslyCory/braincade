import type { Transport } from '@braincade/game-sdk';

/** Host side of the web transport: messages to and from one game iframe on this origin. */
export function iframeTransport(iframe: HTMLIFrameElement, win: Window = window): Transport {
  const origin = win.location.origin;
  return {
    send: (message) => iframe.contentWindow?.postMessage(message, origin),
    listen: (handler) => {
      const onMessage = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.origin !== origin) return;
        handler(event.data);
      };
      win.addEventListener('message', onMessage);
      return () => win.removeEventListener('message', onMessage);
    },
  };
}
