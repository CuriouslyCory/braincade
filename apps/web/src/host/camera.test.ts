// @vitest-environment jsdom
import { type CapturedImage, MAX_IMAGE_DATA_URL_LENGTH } from '@braincade/game-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeJpeg, fitWithin, webCamera } from './camera';

const OPTIONS = { facing: 'environment', maxSize: 1600 } as const;
const PHOTO: CapturedImage = { image: 'data:image/jpeg;base64,AAAA', width: 1600, height: 1200 };

const sheet = () => document.querySelector<HTMLElement>('[data-testid="camera-sheet"]');
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === name);

function fakeMedia() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { track, mediaDevices: { getUserMedia: vi.fn(async () => stream) } };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('fitWithin', () => {
  it('scales the longest side down to maxSize', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never scales up and never returns zero', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10_000, 1, 320)).toEqual({ width: 320, height: 1 });
  });
});

describe('webCamera', () => {
  it('shows a dialog with the prompt and resolves null on Cancel, stopping the camera', async () => {
    const { track, mediaDevices } = fakeMedia();
    const photo = webCamera({ mediaDevices }).capture({ ...OPTIONS, prompt: 'Snap your page' });

    expect(sheet()?.getAttribute('role')).toBe('dialog');
    expect(sheet()?.getAttribute('aria-label')).toBe('Camera');
    expect(sheet()?.textContent).toContain('Snap your page');
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
    await vi.waitFor(() => expect(sheet()?.querySelector('video')?.hidden).toBe(false));

    button('Cancel')?.click();
    await expect(photo).resolves.toBeNull();
    expect(sheet()).toBeNull();
    expect(track.stop).toHaveBeenCalled();
  });

  it('resolves null on Escape', async () => {
    const photo = webCamera({ mediaDevices: undefined }).capture(OPTIONS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(photo).resolves.toBeNull();
    expect(sheet()).toBeNull();
  });

  it('falls back to uploading when the camera is unavailable', async () => {
    const decode = vi.fn(async () => ({
      source: {} as CanvasImageSource,
      width: 4000,
      height: 3000,
    }));
    const encode = vi.fn(() => PHOTO);
    const mediaDevices = {
      getUserMedia: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError');
      }),
    };
    const photo = webCamera({ mediaDevices, decode, encode }).capture({ ...OPTIONS, maxSize: 800 });

    await vi.waitFor(() => expect(sheet()?.textContent).toContain('not available'));
    expect(button('Take photo')?.hidden).toBe(true);

    const input = sheet()?.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toBe('image/*');
    // Without `capture`, phones let the learner pick the camera or an existing photo.
    expect(input?.hasAttribute('capture')).toBe(false);
    const file = new File(['x'], 'page.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input?.dispatchEvent(new Event('change'));

    await expect(photo).resolves.toEqual(PHOTO);
    expect(decode).toHaveBeenCalledWith(file);
    expect(encode).toHaveBeenCalledWith(expect.objectContaining({ width: 4000 }), 800);
    expect(sheet()).toBeNull();
  });

  it('stops a camera that starts after the sheet was closed', async () => {
    const { track, mediaDevices } = fakeMedia();
    const photo = webCamera({ mediaDevices }).capture(OPTIONS);
    button('Cancel')?.click();
    await expect(photo).resolves.toBeNull();
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
  });

  it('keeps Tab inside the dialog, wrapping at both ends', async () => {
    const photo = webCamera({ mediaDevices: undefined }).capture(OPTIONS);
    const input = sheet()?.querySelector<HTMLInputElement>('input[type="file"]');
    const cancel = button('Cancel');
    const tab = (shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    cancel?.focus();
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(tab(true)).toBe(true);
    expect(document.activeElement).toBe(cancel);
    cancel?.click();
    await photo;
  });

  it('uses only the latest upload when the learner picks again while one is decoding', async () => {
    const pending: Array<
      (frame: { source: CanvasImageSource; width: number; height: number }) => void
    > = [];
    const decode = vi.fn(
      () =>
        new Promise<{ source: CanvasImageSource; width: number; height: number }>((r) => {
          pending.push(r);
        }),
    );
    const encode = vi.fn((frame: { width: number }) => ({ ...PHOTO, width: frame.width }));
    const photo = webCamera({ mediaDevices: undefined, decode, encode }).capture(OPTIONS);
    const input = sheet()?.querySelector<HTMLInputElement>('input[type="file"]');
    const pick = (name: string) => {
      Object.defineProperty(input, 'files', {
        value: [new File(['x'], name, { type: 'image/jpeg' })],
        configurable: true,
      });
      input?.dispatchEvent(new Event('change'));
    };
    pick('a.jpg');
    pick('b.jpg');
    pending[1]?.({ source: {} as CanvasImageSource, width: 222, height: 1 });
    pending[0]?.({ source: {} as CanvasImageSource, width: 111, height: 1 });
    await expect(photo).resolves.toMatchObject({ width: 222 });
    expect(encode).toHaveBeenCalledOnce();
  });
});

describe('encodeJpeg', () => {
  /** A canvas whose JPEG size depends on quality and pixel count, like a busy photo. */
  function fakeDocument(bytesPerPixel: (quality: number) => number) {
    return {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: () => {} }),
          toDataURL: (_type: string, quality: number) =>
            `data:image/jpeg;base64,${'A'.repeat(
              Math.ceil(canvas.width * canvas.height * bytesPerPixel(quality)),
            )}`,
        };
        return canvas;
      },
    } as unknown as Document;
  }
  const frame = { source: {} as CanvasImageSource, width: 2048, height: 1536 };

  it('keeps the first encoding when it fits', () => {
    const photo = encodeJpeg(
      fakeDocument(() => 0.1),
      frame,
      2048,
    );
    expect(photo).toMatchObject({ width: 2048, height: 1536 });
  });

  it('lowers quality, then size, until the photo fits the protocol limit', () => {
    // At quality 0.85 this photo is ~4.7 M characters, over the 4 M limit.
    const photo = encodeJpeg(
      fakeDocument((q) => q * 1.75),
      frame,
      2048,
    );
    expect(photo.image.length).toBeLessThanOrEqual(MAX_IMAGE_DATA_URL_LENGTH);
    expect(photo.width).toBe(2048);

    const huge = encodeJpeg(
      fakeDocument(() => 5),
      frame,
      2048,
    );
    expect(huge.image.length).toBeLessThanOrEqual(MAX_IMAGE_DATA_URL_LENGTH);
    expect(huge.width).toBeLessThan(2048);
  });
});
