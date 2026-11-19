import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { handwritingDevApi } from './handwriting-dev-plugin';

type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (error?: unknown) => void,
) => void;

let server: http.Server | undefined;
afterEach(() => server?.close());

/** Run the plugin's middleware on a real HTTP server, with the real handler module. */
async function listen(): Promise<string> {
  let middleware: Middleware | undefined;
  const fakeVite = {
    middlewares: {
      use: (_path: string, fn: Middleware) => {
        middleware = fn;
      },
    },
    ssrLoadModule: () => import('../server/handwriting'),
  };
  const plugin = handwritingDevApi({ apiKey: 'sk-test', accessCode: undefined });
  (plugin.configureServer as (server: unknown) => void)(fakeVite);
  const listening = http.createServer((req, res) =>
    middleware?.(req, res, (error) => {
      res.statusCode = 500;
      res.end(String(error));
    }),
  );
  server = listening;
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(listening.address() as AddressInfo).port}/api/handwriting`;
}

describe('handwritingDevApi', () => {
  it('answers 413 to an oversized chunked upload instead of resetting the connection', async () => {
    const url = await listen();
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(url, { method: 'POST' }, (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
        req.destroy();
      });
      req.on('error', reject);
      // No Content-Length: Node sends this chunked. 8 MiB is past the 6 MiB limit.
      const chunk = Buffer.alloc(256 * 1024, 'A');
      let sent = 0;
      const pump = () => {
        while (sent < 32) {
          sent++;
          if (!req.write(chunk)) {
            req.once('drain', pump);
            return;
          }
        }
        req.end();
      };
      pump();
    });
    expect(status).toBe(413);
  });
});
