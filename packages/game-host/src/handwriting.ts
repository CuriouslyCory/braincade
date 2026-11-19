import { HANDWRITING_TIMEOUT_MS, HostError, handwritingReadingSchema } from '@braincade/game-sdk';
import { z } from 'zod';
import type { HandwritingCapability } from './bridge';

/** Path of the handwriting endpoint, relative to the Braincade server's base URL. */
export const HANDWRITING_ENDPOINT = 'api/handwriting';

export interface HandwritingService extends HandwritingCapability {
  /** Whether the server has a reader configured. Never throws; false when offline. */
  available(): Promise<boolean>;
}

/** Launching a game waits for the status check, so keep it short. */
const STATUS_TIMEOUT_MS = 4000;

/** A signal that aborts after `ms` (AbortSignal.timeout is missing on Hermes). */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

const statusSchema = z.object({ available: z.boolean() });
const errorSchema = z.object({ error: z.string() });

/**
 * Client for the server's handwriting reader (`GET` = status, `POST { image }` = read).
 * Web and mobile both use it: the web app calls its own origin, and the mobile app
 * calls the server it loads games from.
 */
export function createHandwritingService(
  baseUrl: string,
  { fetch: fetchImpl = globalThis.fetch }: { fetch?: typeof fetch } = {},
): HandwritingService {
  const url = new URL(HANDWRITING_ENDPOINT, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;

  return {
    async available() {
      try {
        const response = await fetchImpl(url, {
          headers: { accept: 'application/json' },
          signal: timeoutSignal(STATUS_TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const parsed = statusSchema.safeParse(await response.json());
        return parsed.success && parsed.data.available;
      } catch {
        return false;
      }
    },
    async read(image) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ image }),
          // The game stops waiting at this point, so don't leave a paid read running behind it.
          signal: timeoutSignal(HANDWRITING_TIMEOUT_MS),
        });
      } catch (error) {
        throw new HostError(
          'internal',
          `Could not reach the handwriting reader: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = errorSchema.safeParse(body);
        const message = detail.success ? detail.data.error : `HTTP ${response.status}`;
        throw new HostError(
          response.status === 503
            ? 'unsupported'
            : response.status === 400
              ? 'bad-request'
              : 'internal',
          `Handwriting reader failed: ${message}`,
        );
      }
      const reading = handwritingReadingSchema.safeParse(body);
      if (!reading.success) {
        throw new HostError('internal', 'Handwriting reader returned an unexpected response.');
      }
      return reading.data;
    },
  };
}
