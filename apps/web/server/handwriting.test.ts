import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  clampReading,
  type HandwritingModelClient,
  handleHandwritingRequest,
  MAX_BODY_BYTES,
} from './handwriting';

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const ENDPOINT = 'http://localhost/api/handwriting';

const post = (body: unknown, init: RequestInit = {}) =>
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

type ParseParams = Parameters<HandwritingModelClient['beta']['messages']['parse']>[0];

function fakeClient(
  respond: () => Promise<{ stop_reason: string | null; parsed_output: unknown }>,
) {
  const parse = vi.fn((_params: ParseParams) => respond());
  const client: HandwritingModelClient = { beta: { messages: { parse } } };
  return { client, parse };
}

const readsAs = (words: Array<{ text: string; legible: boolean }>) =>
  fakeClient(async () => ({ stop_reason: 'end_turn', parsed_output: { words } }));

describe('handleHandwritingRequest', () => {
  it('GET reports whether a key is configured', async () => {
    const on = await handleHandwritingRequest(new Request(ENDPOINT), { apiKey: 'sk-test' });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ available: true });

    const off = await handleHandwritingRequest(new Request(ENDPOINT), {});
    expect(await off.json()).toEqual({ available: false });
  });

  it('POST reads the photo with Claude, keeping the spelling', async () => {
    const { client, parse } = readsAs([
      { text: 'The', legible: true },
      { text: 'shoos', legible: true },
      { text: '', legible: false },
    ]);
    const response = await handleHandwritingRequest(post({ image: IMAGE }), {
      apiKey: 'sk-test',
      client,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      words: [
        { text: 'The', legible: true },
        { text: 'shoos', legible: true },
        { text: '', legible: false },
      ],
    });
    const params = parse.mock.calls[0]?.[0];
    expect(params?.model).toBe('claude-opus-5-5');
    expect(params?.output_config?.effort).toBe('low');
    expect(params?.fallbacks).toBe('default');
    expect(params?.system).toContain('Keep every misspelling exactly as written');
    expect(params?.messages[0]?.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' },
    });
  });

  it('trims readings to the protocol limits', () => {
    const long = { text: 'x'.repeat(80), legible: true };
    const clamped = clampReading({ words: Array.from({ length: 250 }, () => long) });
    expect(clamped.words).toHaveLength(200);
    expect(clamped.words[0]?.text).toHaveLength(60);
  });

  it.each([
    ['not JSON', 'nope'],
    ['missing image', { picture: IMAGE }],
    ['not a data URL', { image: 'https://example.com/a.jpg' }],
    ['unsupported type', { image: 'data:image/gif;base64,R0lGOD==' }],
  ])('rejects a bad body (%s) with 400', async (_name, body) => {
    const { client, parse } = readsAs([]);
    const response = await handleHandwritingRequest(post(body), { apiKey: 'sk-test', client });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects bodies over the size limit with 413', async () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(MAX_BODY_BYTES)}`;
    const response = await handleHandwritingRequest(post({ image: big }), { apiKey: 'sk-test' });
    expect(response.status).toBe(413);
  });

  it('answers 503 when no key is configured', async () => {
    const { client, parse } = readsAs([]);
    const response = await handleHandwritingRequest(post({ image: IMAGE }), { client });
    expect(response.status).toBe(503);
    expect(parse).not.toHaveBeenCalled();
  });

  it('answers 502 without leaking details when Claude fails', async () => {
    const { client } = fakeClient(async () => {
      throw new Anthropic.APIError(529, undefined, 'overloaded sk-secret', new Headers());
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleHandwritingRequest(post({ image: IMAGE }), {
      apiKey: 'sk-secret',
      client,
    });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain('HTTP 529');
    expect(text).not.toContain('sk-secret');
  });

  it('answers 502 when Claude declines or returns no reading', async () => {
    for (const result of [
      { stop_reason: 'refusal', parsed_output: null },
      { stop_reason: 'end_turn', parsed_output: null },
      { stop_reason: 'max_tokens', parsed_output: { words: 'cut off' } },
    ]) {
      const { client } = fakeClient(async () => result);
      const response = await handleHandwritingRequest(post({ image: IMAGE }), {
        apiKey: 'sk-test',
        client,
      });
      expect(response.status).toBe(502);
    }
  });

  it('only allows GET and POST', async () => {
    const response = await handleHandwritingRequest(new Request(ENDPOINT, { method: 'PUT' }), {});
    expect(response.status).toBe(405);
  });
});
