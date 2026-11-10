import { NATIVE_RECEIVE_GLOBAL } from '@braincade/game-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createWebViewTransport, injectionScript } from './webview-transport';

describe('injectionScript', () => {
  it('calls the frame receiver with the message as a JS literal', () => {
    const receive = vi.fn();
    const window = { [NATIVE_RECEIVE_GLOBAL]: receive };
    const message = { type: 'event', name: 'pause', text: 'line\u2028sep </script>' };
    // Evaluate the script the way WebView.injectJavaScript would.
    new Function('window', injectionScript(message))(window);
    expect(receive).toHaveBeenCalledWith(message);
  });

  it('is a no-op before the frame has installed its receiver', () => {
    expect(() => new Function('window', injectionScript({ a: 1 }))({})).not.toThrow();
  });
});

describe('createWebViewTransport', () => {
  it('injects outgoing messages and parses incoming ones', () => {
    const inject = vi.fn();
    const transport = createWebViewTransport(inject);
    const handler = vi.fn();
    const stop = transport.listen(handler);

    transport.send({ hello: 'frame' });
    expect(inject.mock.calls[0]?.[0]).toContain('{"hello":"frame"}');

    transport.receive('{"type":"notify","name":"ready"}');
    transport.receive('not json');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: 'notify', name: 'ready' });

    stop();
    transport.receive('{"x":1}');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
