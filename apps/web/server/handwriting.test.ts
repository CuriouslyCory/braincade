import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_CODE_HEADER,
  clampReading,
  handleHandwritingRequest,
  MAX_BODY_BYTES,
} from './handwriting';
import type { HandwritingReader } from './trocr';

const IMAGE_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const IMAGE = `data:image/jpeg;base64,${Buffer.from(IMAGE_BYTES).toString('base64')}`;
const ENDPOINT = 'http://localhost/api/handwriting';

const post = (body: unknown, init: RequestInit = {}) =>
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

const readsAs = (words: Array<{ text: string; legible: boolean }>) =>
  vi.fn<HandwritingReader>(async () => ({ words }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('handleHandwritingRequest', () => {
  it('GET reports the reader available when no access code is set', async () => {
    const response = await handleHandwritingRequest(new Request(ENDPOINT), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true });
  });

  it('requires the access code when one is set', async () => {
    const reader = readsAs([{ text: 'Teh', legible: true }]);
    const options = { accessCode: 'tacos', reader };
    const get = (code?: string) =>
      handleHandwritingRequest(
        new Request(ENDPOINT, code ? { headers: { [ACCESS_CODE_HEADER]: code } } : {}),
        options,
      ).then((r) => r.json());
    expect(await get()).toEqual({ available: false });
    expect(await get('nachos')).toEqual({ available: false });
    expect(await get('tacos')).toEqual({ available: true });

    const denied = await handleHandwritingRequest(post({ image: IMAGE }), options);
    expect(denied.status).toBe(401);
    expect(reader).not.toHaveBeenCalled();

    const allowed = await handleHandwritingRequest(
      post({ image: IMAGE }, { headers: { [ACCESS_CODE_HEADER]: 'tacos' } }),
      options,
    );
    expect(allowed.status).toBe(200);
  });

  it('POST passes the decoded image to the reader and returns its words', async () => {
    const reader = readsAs([
      { text: 'Teh', legible: true },
      { text: 'cat', legible: false },
    ]);
    const response = await handleHandwritingRequest(post({ image: IMAGE }), { reader });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      words: [
        { text: 'Teh', legible: true },
        { text: 'cat', legible: false },
      ],
    });
    expect(reader).toHaveBeenCalledWith(IMAGE_BYTES);
  });

  it('trims readings to the protocol limits', () => {
    const long = 'x'.repeat(100);
    const words = Array.from({ length: 250 }, () => ({ text: long, legible: true }));
    const clamped = clampReading({ words });
    expect(clamped.words).toHaveLength(200);
    expect(clamped.words[0]?.text).toHaveLength(60);
  });

  it.each([
    ['not JSON', '{oops'],
    ['missing image', { picture: IMAGE }],
    ['not a data URL', { image: 'https://example.com/a.jpg' }],
    ['unsupported type', { image: 'data:image/gif;base64,R0lGOD==' }],
  ])('rejects a bad body (%s) with 400', async (_name, body) => {
    const reader = readsAs([]);
    const response = await handleHandwritingRequest(post(body), { reader });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
    expect(reader).not.toHaveBeenCalled();
  });

  it('rejects bodies over the size limit with 413', async () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(MAX_BODY_BYTES)}`;
    const response = await handleHandwritingRequest(post({ image: big }), { reader: readsAs([]) });
    expect(response.status).toBe(413);
  });

  it('stops reading a chunked body without Content-Length once it is too large', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(ENDPOINT, { method: 'POST', body, duplex: 'half' } as RequestInit);
    const response = await handleHandwritingRequest(request, { reader: readsAs([]) });
    expect(response.status).toBe(413);
    // An endless stream: the handler gave up just past the limit instead of buffering it all.
    expect(pulled).toBeLessThan(MAX_BODY_BYTES / chunk.byteLength + 4);
  });

  it('answers 502 without leaking details when the reader fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reader = vi.fn<HandwritingReader>(async () => {
      throw new Error('model download failed: /tmp/secret-path');
    });
    const response = await handleHandwritingRequest(post({ image: IMAGE }), { reader });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-path');
  });

  it('gives up with 502 when reading runs past the deadline', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reader = vi.fn<HandwritingReader>(() => new Promise(() => {}));
    const response = handleHandwritingRequest(post({ image: IMAGE }), { reader });
    await vi.advanceTimersByTimeAsync(40_000);
    expect((await response).status).toBe(502);
  });

  it('only allows GET and POST', async () => {
    const response = await handleHandwritingRequest(new Request(ENDPOINT, { method: 'PUT' }), {});
    expect(response.status).toBe(405);
  });
});
