import type { CameraCapability } from '@braincade/game-host';

export type CameraFacing = 'environment' | 'user';

/** The native pieces of a photo capture, injected so the flow is testable without Expo. */
export interface CameraDriver {
  /** Ask for camera access (prompting if needed). Resolve whether it was granted. */
  requestPermission(): Promise<boolean>;
  /** Open the system camera. Resolve the photo's file URI, or null when the learner cancels. */
  takePhoto(facing: CameraFacing): Promise<string | null>;
  /** Decode the photo so neither side exceeds `maxSize` and re-encode it as base64 JPEG. */
  encodeJpeg(
    uri: string,
    maxSize: number,
  ): Promise<{ base64: string; width: number; height: number }>;
}

export const CAMERA_PERMISSION_DENIED =
  'Camera access is turned off for Braincade. A grown-up can turn it on in the device settings.';

/**
 * Camera capability over the system camera UI. The native picker has no room for
 * the game's `prompt`, so the game shows its own instructions before capturing.
 */
export function createCameraCapability(driver: CameraDriver): CameraCapability {
  return {
    async capture({ facing, maxSize }) {
      if (!(await driver.requestPermission())) throw new Error(CAMERA_PERMISSION_DENIED);
      const uri = await driver.takePhoto(facing);
      if (uri === null) return null;
      const { base64, width, height } = await driver.encodeJpeg(uri, maxSize);
      return { image: jpegDataUrl(base64), width, height };
    },
  };
}

/** Scale `width`×`height` down (never up) so the longest side is at most `maxSize`. */
export function fitWithin(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  if (scale === 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function jpegDataUrl(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}
