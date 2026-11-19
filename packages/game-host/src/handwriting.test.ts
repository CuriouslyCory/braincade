import { describe, expect, it, vi } from 'vitest';
import { createHandwritingService } from './handwriting';

const IMAGE = 'data:image/png;base64,AAAA';

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    respond(String(input), init),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createHandwritingService', () => {
  it('resolves the endpoint against the server base URL', async () => {
    const fetch = fakeFetch(() => json({ available: true }));
    await createHandwritingService('https://braincade.example', { fetch }).available();
    await createHandwritingService('https://braincade.example/sub/', { fetch }).available();
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://braincade.example/api/handwriting',
      'https://braincade.example/sub/api/handwriting',
    ]);
  });

  it('reports availability from the server and treats failures as unavailable', async () => {
    const base = 'https://b.example';
    expect(
      await createHandwritingService(base, {
        fetch: fakeFetch(() => json({ available: true })),
      }).available(),
    ).toBe(true);
    expect(
      await createHandwritingService(base, {
        fetch: fakeFetch(() => json({ available: false })),
      }).available(),
    ).toBe(false);
    expect(
      await createHandwritingService(base, {
        fetch: fakeFetch(() => new Response('nope', { status: 404 })),
      }).available(),
    ).toBe(false);
    expect(
      await createHandwritingService(base, {
        fetch: fakeFetch(() => {
          throw new TypeError('offline');
        }),
      }).available(),
    ).toBe(false);
  });

  it('gives up on a status check that hangs', async () => {
    vi.useFakeTimers();
    try {
      const fetch = fakeFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
      const available = createHandwritingService('https://b.example', { fetch }).available();
      await vi.advanceTimersByTimeAsync(4000);
      await expect(available).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts the image and validates the reading', async () => {
    const reading = {
      words: [
        { text: 'Teh', legible: true },
        { text: '', legible: false },
      ],
    };
    const fetch = fakeFetch(() => json(reading));
    const service = createHandwritingService('https://b.example', { fetch });
    await expect(service.read(IMAGE)).resolves.toEqual(reading);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ image: IMAGE });
  });

  it('turns server errors into host errors', async () => {
    const read = (response: Response) =>
      createHandwritingService('https://b.example', { fetch: fakeFetch(() => response) }).read(
        IMAGE,
      );
    await expect(read(json({ error: 'not configured' }, 503))).rejects.toMatchObject({
      code: 'unsupported',
      message: expect.stringContaining('not configured'),
    });
    await expect(read(json({ error: 'bad image' }, 400))).rejects.toMatchObject({
      code: 'bad-request',
    });
    await expect(read(new Response('oops', { status: 502 }))).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('HTTP 502'),
    });
    await expect(read(json({ words: 'nope' }))).rejects.toMatchObject({ code: 'internal' });
  });
});
