import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { HandwritingReader } from './trocr.js';

// Server code imports only npm packages and relative files: Vercel's function
// bundler would get raw TypeScript from the workspace `@braincade/*` packages.
// The limits below mirror `handwritingReadingSchema` in packages/game-sdk/src/protocol.ts.

/** Largest request body accepted, in bytes. Camera photos are downscaled well below this. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_WORDS = 200;
const MAX_WORD_LENGTH = 60;

/** Answer inside the game's 45 s wait, cold start (model download) included. */
const READ_DEADLINE_MS = 40_000;

/** Must match ACCESS_CODE_HEADER in packages/game-host/src/handwriting.ts. */
export const ACCESS_CODE_HEADER = 'x-braincade-access-code';

const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

const requestSchema = z.object({ image: z.string() });

export interface HandwritingReading {
  words: Array<{ text: string; legible: boolean }>;
}

export interface HandwritingHandlerOptions {
  /**
   * `BRAINCADE_ACCESS_CODE`. When set, callers must send it in the access-code header.
   * Reading is free per photo, but it runs on the deployment's CPU, so a deployment keeps
   * strangers who find the URL from using it up.
   */
  accessCode?: string | undefined;
  /** Treat the reader as off unless `accessCode` is set (deployments). */
  requireAccessCode?: boolean;
  /** Defaults to the TrOCR reader in trocr.ts, loaded on first use. */
  reader?: HandwritingReader;
  /** Defaults to one shared limiter per server instance (see createReadLimiter). */
  limiter?: ReadLimiter;
}

export interface ReadLimiter {
  /** A slot to read in (call the release function when done), or null when too busy. */
  acquire(): Promise<() => void> | null;
}

/**
 * Bound the CPU one instance spends reading: `running` reads at a time, up to `waiting`
 * more queued, and anyone beyond that is told to try again. A slot is released when the
 * read really finishes, not when the request gives up waiting for it, since the model
 * keeps computing either way.
 */
export function createReadLimiter({ running = 1, waiting = 2 } = {}): ReadLimiter {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active--;
  };
  return {
    acquire() {
      if (active < running) {
        active++;
        return Promise.resolve(release);
      }
      if (queue.length >= waiting) return null;
      return new Promise((resolve) => queue.push(() => resolve(release)));
    },
  };
}

const sharedLimiter = createReadLimiter();

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
 * - `GET` → `{ available }`: false when an access code is required but not configured, or
 *   is set and the caller didn't send it.
 * - `POST { image: <data URL> }` → `{ words: [{ text, legible }] }`, read by an open
 *   handwriting model on this server. 401 without the access code.
 */
export async function handleHandwritingRequest(
  request: Request,
  options: HandwritingHandlerOptions,
): Promise<Response> {
  const configured = Boolean(options.accessCode) || !options.requireAccessCode;
  const authorized =
    !options.accessCode ||
    sameCode(request.headers.get(ACCESS_CODE_HEADER) ?? '', options.accessCode);
  if (request.method === 'GET') {
    return json(200, { available: configured && authorized });
  }
  if (request.method !== 'POST') {
    return json(405, { error: 'Use GET or POST.' }, { allow: 'GET, POST' });
  }
  if (!configured) {
    return json(503, { error: 'The handwriting reader is off until an access code is set.' });
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
  // The label is only a claim: check the bytes, since the decoder accepts many more formats.
  const bytes = Uint8Array.from(Buffer.from(image[2] as string, 'base64'));
  if (!imageFormat(bytes)) {
    return json(400, { error: 'The image must be a JPEG, PNG, or WebP.' });
  }

  const slot = (options.limiter ?? sharedLimiter).acquire();
  if (!slot) {
    return json(
      429,
      { error: 'The robot reader is busy. Try again in a moment.' },
      { 'retry-after': '5' },
    );
  }

  try {
    const reader = options.reader ?? (await import('./trocr.js')).readHandwriting;
    let expired = false;
    const work = slot.then(async (release) => {
      try {
        // Gave up while queued: don't start a read nobody is waiting for.
        if (expired) throw new Error('Gave up waiting for a turn to read');
        return await reader(bytes);
      } finally {
        release();
      }
    });
    work.catch(() => {}); // Handled below; the deadline may win the race.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new Error('Reading took too long'));
      }, READ_DEADLINE_MS);
    });
    try {
      return json(200, clampReading(await Promise.race([work, deadline])));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // Log for the server; never send internal details to the client.
    console.error('[handwriting] read failed:', error instanceof Error ? error.message : error);
    return json(502, { error: 'The handwriting reader failed.' });
  }
}

/** The image's actual format, from its first bytes (null: not JPEG, PNG, or WebP). */
export function imageFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  const starts = (offset: number, ...values: number[]) =>
    values.every((value, i) => bytes[offset + i] === value);
  if (starts(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  // RIFF....WEBP
  if (starts(0, 0x52, 0x49, 0x46, 0x46) && starts(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
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
