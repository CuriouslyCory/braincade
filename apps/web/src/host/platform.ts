import { wordLists } from '@braincade/content';
import type { HostPlatform } from '@braincade/game-host';
import { createLearnerRepository } from '@braincade/learning';
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
    ...(speech ? { speech } : {}),
  };
}

export const platform = createWebPlatform();
