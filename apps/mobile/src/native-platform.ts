import type { HostPlatform } from '@braincade/game-host';
import { createLearnerRepository, type WordList } from '@braincade/learning';
import { renderPrintableHtml } from '@braincade/printables';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

/** Learner data on this device (word mastery, sessions, game saves). */
export const learner = createLearnerRepository(AsyncStorage);

/** Native implementations of the host capabilities games use. */
export function nativePlatform(wordLists: readonly WordList[]): HostPlatform {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
    learner,
    wordLists,
    speech: {
      speak: (text, { rate, language }) =>
        new Promise((resolve) => {
          Speech.speak(text, {
            ...(rate === undefined ? {} : { rate }),
            ...(language === undefined ? {} : { language }),
            onDone: () => resolve(),
            onStopped: () => resolve(),
            onError: () => resolve(),
          });
        }),
      stop: () => Speech.stop(),
    },
    printer: {
      print: async (document) => {
        await Print.printAsync({ html: renderPrintableHtml(document) });
      },
    },
  };
}
