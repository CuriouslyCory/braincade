import { wordLists } from '@braincade/content';
import { createHandwritingService, type HostPlatform } from '@braincade/game-host';
import { createLearnerRepository } from '@braincade/learning';
import { webCamera } from './camera';
import { webPrinter } from './printer';
import { webSpeech } from './speech';

/** Everything the web launcher provides to games. Learner data lives in localStorage. */
export function createWebPlatform(): HostPlatform {
  const speech = webSpeech();
  return {
    platform: 'web',
    locale: navigator.language || 'en-US',
    learner: createLearnerRepository(window.localStorage),
    wordLists,
    printer: webPrinter(),
    camera: webCamera(),
    ...(speech ? { speech } : {}),
  };
}

/** The platform before the handwriting probe settles: everything except `handwriting`. */
export const platform = createWebPlatform();

const READER_CODE_KEY = 'braincade:reader-access-code';

/** The robot reader access code a grown-up entered on this device ('' if none). */
export function readerAccessCode(): string {
  try {
    return window.localStorage.getItem(READER_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The handwriting reader lives on this site's server (`api/handwriting`), which may
 * require an access code this device doesn't have, so ask the server. Never
 * rejects: offline or no server means no handwriting.
 */
function probe(): Promise<HostPlatform> {
  const handwriting = createHandwritingService(new URL('.', document.baseURI).href, {
    accessCode: readerAccessCode() || undefined,
  });
  return handwriting
    .available()
    .then((available) => (available ? { ...platform, handwriting } : platform));
}

let ready = probe();
const listeners = new Set<() => void>();

/** The full platform, once the startup probe settles. */
export function platformReady(): Promise<HostPlatform> {
  return ready;
}

/** Called when the platform is probed again (see setReaderAccessCode). */
export function onPlatformChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Save (or clear) this device's access code and ask the server again. */
export function setReaderAccessCode(code: string): Promise<HostPlatform> {
  try {
    if (code) window.localStorage.setItem(READER_CODE_KEY, code);
    else window.localStorage.removeItem(READER_CODE_KEY);
  } catch {
    // Storage blocked: the probe below still runs with the old code.
  }
  ready = probe();
  for (const listener of listeners) listener();
  return ready;
}
