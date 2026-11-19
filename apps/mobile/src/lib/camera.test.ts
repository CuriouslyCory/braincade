import { describe, expect, it } from 'vitest';
import {
  CAMERA_PERMISSION_DENIED,
  type CameraDriver,
  createCameraCapability,
  fitWithin,
  jpegDataUrl,
} from './camera';

function fakeDriver(overrides: Partial<CameraDriver> = {}) {
  const calls: string[] = [];
  const driver: CameraDriver = {
    requestPermission: async () => true,
    takePhoto: async (facing) => {
      calls.push(`take:${facing}`);
      return 'file:///photo.jpg';
    },
    encodeJpeg: async (uri, maxSize) => {
      calls.push(`encode:${uri}:${maxSize}`);
      return { base64: 'QUJD', width: 1600, height: 1200 };
    },
    ...overrides,
  };
  return { driver, calls };
}

describe('createCameraCapability', () => {
  it('takes, resizes, and returns a JPEG data URL', async () => {
    const { driver, calls } = fakeDriver();
    const photo = await createCameraCapability(driver).capture({
      facing: 'user',
      maxSize: 1600,
      prompt: 'Show me your writing',
    });
    expect(photo).toEqual({ image: 'data:image/jpeg;base64,QUJD', width: 1600, height: 1200 });
    expect(calls).toEqual(['take:user', 'encode:file:///photo.jpg:1600']);
  });

  it('resolves null when the learner cancels', async () => {
    const { driver, calls } = fakeDriver({ takePhoto: async () => null });
    expect(
      await createCameraCapability(driver).capture({ facing: 'environment', maxSize: 800 }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it('throws a readable error without opening the camera when permission is denied', async () => {
    const { driver, calls } = fakeDriver({ requestPermission: async () => false });
    await expect(
      createCameraCapability(driver).capture({ facing: 'environment', maxSize: 800 }),
    ).rejects.toThrow(CAMERA_PERMISSION_DENIED);
    expect(calls).toEqual([]);
  });
});

describe('fitWithin', () => {
  it('scales the longest side down to maxSize, keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(3000, 1000, 1000)).toEqual({ width: 1000, height: 333 });
  });

  it('never scales up', () => {
    expect(fitWithin(640, 480, 1600)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it('keeps tiny sides at least one pixel', () => {
    expect(fitWithin(10000, 1, 320)).toEqual({ width: 320, height: 1 });
  });
});

describe('jpegDataUrl', () => {
  it('prefixes base64 JPEG data', () => {
    expect(jpegDataUrl('QUJD')).toBe('data:image/jpeg;base64,QUJD');
  });
});
