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

const handwriting = createHandwritingService(new URL('.', document.baseURI).href);

/**
 * The full platform. The handwriting reader lives on this site's server
 * (`api/handwriting`) and only exists when the deploy has an API key, so ask
 * once at startup. Never rejects: offline or no server means no handwriting.
 */
export const platformReady: Promise<HostPlatform> = handwriting
  .available()
  .then((available) => (available ? { ...platform, handwriting } : platform));
