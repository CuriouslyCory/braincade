import { createHash, timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

// Server code imports only npm packages and relative files: Vercel's function
// bundler would get raw TypeScript from the workspace `@braincade/*` packages.
// The limits below mirror `handwritingReadingSchema` in packages/game-sdk/src/protocol.ts.

/** Largest request body accepted, in bytes. Camera photos are downscaled well below this. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_WORDS = 200;
const MAX_WORD_LENGTH = 60;

const MODEL = 'claude-opus-5-5';
/** A reading is at most 200 short words of JSON; this caps what one call can cost. */
const MAX_TOKENS = 4096;

/** The whole model call, retries and their waits included, inside the game's 45 s wait. */
const MODEL_DEADLINE_MS = 40_000;

/** Must match ACCESS_CODE_HEADER in packages/game-host/src/handwriting.ts. */
export const ACCESS_CODE_HEADER = 'x-braincade-access-code';

const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

const requestSchema = z.object({ image: z.string() });

/** What Claude returns. Kept free of length limits; the handler trims to the protocol's. */
const readingSchema = z.object({
  words: z.array(z.object({ text: z.string(), legible: z.boolean() })),
});

export type HandwritingReading = z.infer<typeof readingSchema>;

const SYSTEM_PROMPT = `You transcribe a child's handwriting from a photo for a spelling and handwriting practice game. The game checks the child's spelling against what they meant to write, so your transcription must show exactly what is on the paper, letter for letter.

Rules:
- Keep every misspelling exactly as written. Never correct spelling, grammar, capitalization, or punctuation, and never replace a word with the word you think the child meant.
- Read each word from its own letters. Do not use the rest of the sentence, or what a sentence like it would usually say, to decide what a word is.
- Return one entry per handwritten word, in reading order (left to right, then top to bottom). Keep punctuation the child wrote attached to the word it follows.
- If you cannot confidently read a word, set "legible" to false and put your best guess at its letters in "text", or "" if you have no guess.
- Transcribe handwriting only. Ignore printed or typed text, ruled lines, margins, and drawings or doodles.
- If the photo has no handwriting, return an empty "words" list.`;

/** The part of the Anthropic client the handler uses, so tests can pass a fake. */
export interface HandwritingModelClient {
  beta: {
    messages: {
      parse(
        params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        options?: Anthropic.RequestOptions,
      ): PromiseLike<{ stop_reason: string | null; parsed_output: unknown }>;
    };
  };
}

export interface HandwritingHandlerOptions {
  /** `ANTHROPIC_API_KEY`. Without it the reader reports itself unavailable. */
  apiKey?: string | undefined;
  /**
   * `BRAINCADE_ACCESS_CODE`. When set, callers must send it in the access-code header;
   * the key is paid for, and the endpoint is otherwise open to anyone with the URL.
   */
  accessCode?: string | undefined;
  /** Treat the reader as unconfigured unless `accessCode` is set (deployments). */
  requireAccessCode?: boolean;
  /** Defaults to a real Anthropic client using `apiKey`. */
  client?: HandwritingModelClient;
}

/** Compare codes in constant time (hashing first makes the lengths equal). */
function sameCode(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

/**
 * The handwriting endpoint (`api/handwriting`), as a plain Request → Response
 * function so the Vercel Function, the Vite dev server, and tests share it.
 *
 * - `GET` → `{ available }`: true when an API key is configured and the caller
 *   sent the right access code (if one is set).
 * - `POST { image: <data URL> }` → `{ words: [{ text, legible }] }`, read by Claude
 *   with the child's spelling kept as written. 401 without the access code.
 */
export async function handleHandwritingRequest(
  request: Request,
  options: HandwritingHandlerOptions,
): Promise<Response> {
  const configured =
    Boolean(options.apiKey) && (Boolean(options.accessCode) || !options.requireAccessCode);
  const authorized =
    !options.accessCode ||
    sameCode(request.headers.get(ACCESS_CODE_HEADER) ?? '', options.accessCode);
  if (request.method === 'GET') {
    return json(200, { available: configured && authorized });
  }
  if (request.method !== 'POST') {
    return json(405, { error: 'Use GET or POST.' }, { allow: 'GET, POST' });
  }
  // Turn away callers without the code before reading what they sent.
  if (!authorized) {
    return json(401, { error: 'Enter the robot reader access code on the Grown-ups page.' });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return json(413, { error: 'The photo is too large.' });
  const raw = await readBody(request, MAX_BODY_BYTES);
  if (raw === null) return json(413, { error: 'The photo is too large.' });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'The request body must be JSON.' });
  }
  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) {
    return json(400, { error: 'The request body must be { "image": "<data URL>" }.' });
  }
  const image = IMAGE_DATA_URL.exec(parsedBody.data.image);
  if (!image) {
    return json(400, { error: 'The image must be a base64 JPEG, PNG, or WebP data URL.' });
  }

  if (!configured) return json(503, { error: 'The handwriting reader is not configured.' });
  // Up to two 20 s tries, but never past MODEL_DEADLINE_MS overall (retry waits included):
  // the game stops waiting at 45 s and the function is stopped at 60 s.
  const client =
    options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: 20_000, maxRetries: 1 });

  try {
    const response = await client.beta.messages.parse(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // A quick transcription; low effort keeps it fast.
        output_config: { effort: 'low', format: betaZodOutputFormat(readingSchema) },
        // If a safety classifier declines the request, retry on the default fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image[1] as 'image/jpeg' | 'image/png' | 'image/webp',
                  data: image[2] as string,
                },
              },
              { type: 'text', text: 'Transcribe the handwriting in this photo.' },
            ],
          },
        ],
      },
      { signal: AbortSignal.timeout(MODEL_DEADLINE_MS) },
    );

    if (response.stop_reason === 'refusal') {
      return json(502, { error: 'The handwriting reader declined to read this photo.' });
    }
    const reading = readingSchema.safeParse(response.parsed_output);
    if (!reading.success) {
      return json(502, { error: 'The handwriting reader returned an unreadable answer.' });
    }
    return json(200, clampReading(reading.data));
  } catch (error) {
    // Log for the server; never send upstream details (or anything secret) to the client.
    console.error('[handwriting] read failed:', error instanceof Error ? error.message : error);
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    return json(502, {
      error: `The handwriting reader failed${status ? ` (HTTP ${status})` : ''}.`,
    });
  }
}

/**
 * Read the body as text, giving up (null) as soon as it passes `limit` bytes, so a
 * chunked upload without Content-Length is never buffered in full.
 */
async function readBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/** Trim a reading to the protocol's limits so the host's validation never rejects it. */
export function clampReading(reading: HandwritingReading): HandwritingReading {
  return {
    words: reading.words.slice(0, MAX_WORDS).map((word) => ({
      text: word.text.slice(0, MAX_WORD_LENGTH),
      legible: word.legible,
    })),
  };
}
