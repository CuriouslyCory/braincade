// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { detectHostTransport, NATIVE_RECEIVE_GLOBAL, reactNativeTransport } from './transport';

describe('detectHostTransport', () => {
  it('returns null when the frame is opened standalone', () => {
    expect(detectHostTransport(window)).toBeNull();
  });

  it('uses the React Native bridge inside a WebView', () => {
    const postMessage = vi.fn();
    window.ReactNativeWebView = { postMessage };
    try {
      const transport = detectHostTransport(window);
      expect(transport).not.toBeNull();
      transport?.send({ hello: 'native' });
      expect(postMessage).toHaveBeenCalledWith('{"hello":"native"}');
    } finally {
      delete window.ReactNativeWebView;
    }
  });
});

describe('reactNativeTransport', () => {
  it('receives messages the native host injects through the global receiver', () => {
    const transport = reactNativeTransport(window);
    const handler = vi.fn();
    const stop = transport.listen(handler);
    window[NATIVE_RECEIVE_GLOBAL]?.({ type: 'event', name: 'pause' });
    expect(handler).toHaveBeenCalledWith({ type: 'event', name: 'pause' });
    stop();
    window[NATIVE_RECEIVE_GLOBAL]?.({ type: 'event', name: 'resume' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
