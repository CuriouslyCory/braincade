import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

type HandlerModule = typeof import('../server/handwriting');
const handlerPath = fileURLToPath(new URL('../server/handwriting.ts', import.meta.url));

/**
 * Serves `/api/handwriting` from `vite dev` with the same handler as the Vercel
 * Function, so the handwriting reader works locally with a key in `.env.local`.
 * Dev server only: `vite preview` (and so e2e) has no API, like a static host.
 */
export function handwritingDevApi({
  apiKey,
  accessCode,
}: {
  apiKey: string | undefined;
  /** Optional locally; deployments require one (see api/handwriting.ts). */
  accessCode: string | undefined;
}): Plugin {
  return {
    name: 'braincade-handwriting-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/handwriting', (req, res, next) => {
        // Loaded through the dev server: picks up edits, and builds never load the SDK.
        const handler = server.ssrLoadModule(handlerPath) as Promise<HandlerModule>;
        Promise.all([handler, toRequest(req)])
          .then(([{ handleHandwritingRequest }, request]) =>
            handleHandwritingRequest(request, { apiKey, accessCode }),
          )
          .then((response) => sendResponse(res, response))
          .catch(next);
      });
    },
  };
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = req.method ?? 'GET';
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request('http://localhost/api/handwriting', {
    method,
    headers,
    ...(body ? { body: new Uint8Array(body) } : {}),
  });
}

async function sendResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}
