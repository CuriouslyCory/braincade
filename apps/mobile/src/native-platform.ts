import type { HandwritingCapability, HostPlatform } from '@braincade/game-host';
import { createLearnerRepository, type WordList } from '@braincade/learning';
import { renderPrintableHtml } from '@braincade/printables';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { createCameraCapability, fitWithin } from './lib/camera';

/** Learner data on this device (word mastery, sessions, game saves). */
export const learner = createLearnerRepository(AsyncStorage);

/** Photos come from the system camera UI, shown over the WebView. */
const camera = createCameraCapability({
  requestPermission: async () => (await ImagePicker.requestCameraPermissionsAsync()).granted,
  takePhoto: async (facing) => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      cameraType: facing === 'user' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });
    return result.canceled ? null : (result.assets[0]?.uri ?? null);
  },
  encodeJpeg: async (uri, maxSize) => {
    // Bounding the decode keeps a 12+ MP photo from ever being loaded at full size.
    const context = ImageManipulator.manipulate(uri, { maxWidth: maxSize, maxHeight: maxSize });
    try {
      let image = await context.renderAsync();
      // The decoder should already be within bounds; resize in case a platform skipped it.
      if (Math.max(image.width, image.height) > maxSize) {
        image.release();
        image = await context.resize(fitWithin(image.width, image.height, maxSize)).renderAsync();
      }
      try {
        const saved = await image.saveAsync({
          base64: true,
          compress: 0.8,
          format: SaveFormat.JPEG,
        });
        if (!saved.base64) throw new Error('Could not encode the photo.');
        return { base64: saved.base64, width: saved.width, height: saved.height };
      } finally {
        image.release();
      }
    } finally {
      context.release();
    }
  },
});

/**
 * Native implementations of the host capabilities games use. `handwriting` is the
 * server's reader, passed only once its probe says it is configured.
 */
export function nativePlatform(
  wordLists: readonly WordList[],
  handwriting?: HandwritingCapability | null,
): HostPlatform {
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
    camera,
    ...(handwriting ? { handwriting } : {}),
  };
}
