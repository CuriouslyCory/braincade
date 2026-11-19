import type { CameraCapability } from '@braincade/game-host';
import type { CapturedImage } from '@braincade/game-sdk';

const JPEG_QUALITY = 0.85;

/** An image ready to draw: a video frame or a decoded upload. */
export interface Frame {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface WebCameraOptions {
  document?: Document;
  /** Live preview source. Missing on insecure origins (e.g. the dev server over a LAN IP). */
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'> | undefined;
  /** Decode an uploaded file. Replaceable in tests: jsdom can't decode images. */
  decode?: (file: Blob) => Promise<Frame>;
  /** Scale a frame to fit `maxSize` and encode it as JPEG. Replaceable in tests. */
  encode?: (frame: Frame, maxSize: number) => CapturedImage;
}

/** Scale `width × height` so the longest side is at most `maxSize`. Never scales up. */
export function fitWithin(width: number, height: number, maxSize: number) {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The web camera. Games run in an iframe, so the host page shows the camera as a
 * sheet above the player: a live preview when the browser allows it, and an
 * "Upload a photo" picker that always works (no webcam, permission denied, iOS).
 */
export function webCamera({
  document: doc = document,
  mediaDevices = globalThis.navigator?.mediaDevices,
  decode = decodeFile,
  encode = (frame, maxSize) => encodeJpeg(doc, frame, maxSize),
}: WebCameraOptions = {}): CameraCapability {
  return {
    capture: ({ prompt, facing, maxSize }) =>
      new Promise((resolve) => {
        const win = doc.defaultView ?? window;
        let stream: MediaStream | undefined;
        let closed = false;

        const sheet = element(doc, 'div', 'camera-sheet');
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Camera');
        sheet.dataset.testid = 'camera-sheet';

        const panel = element(doc, 'div', 'camera-panel');
        const promptText = element(doc, 'p', 'camera-prompt');
        promptText.textContent = prompt ?? 'Take a photo';
        const video = element(doc, 'video', 'camera-preview');
        // Muted inline autoplay starts the preview without a play() call, on iOS too.
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.hidden = true;
        const status = element(doc, 'p', 'camera-status');
        status.setAttribute('role', 'status');

        const actions = element(doc, 'div', 'camera-actions');
        const shoot = element(doc, 'button', 'camera-shoot');
        shoot.type = 'button';
        shoot.textContent = 'Take photo';
        shoot.disabled = true;
        const upload = element(doc, 'label', 'camera-upload');
        const file = element(doc, 'input', 'visually-hidden');
        file.type = 'file';
        file.accept = 'image/*';
        file.setAttribute('capture', facing);
        upload.append(file, 'Upload a photo');
        const cancel = element(doc, 'button', 'camera-cancel');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        actions.append(shoot, upload, cancel);

        panel.append(promptText, video, status, actions);
        sheet.append(panel);
        doc.body.append(sheet);
        cancel.focus();

        const finish = (photo: CapturedImage | null) => {
          if (closed) return;
          closed = true;
          stopStream();
          doc.removeEventListener('keydown', onKey);
          win.removeEventListener('hashchange', onLeave);
          sheet.remove();
          resolve(photo);
        };
        const stopStream = () => {
          for (const track of stream?.getTracks() ?? []) track.stop();
          video.srcObject = null;
        };
        const noCamera = (message: string) => {
          status.textContent = message;
          shoot.hidden = true;
        };
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') finish(null);
        };
        // Leaving the player (browser back) must not leave the sheet behind.
        const onLeave = () => finish(null);
        doc.addEventListener('keydown', onKey);
        win.addEventListener('hashchange', onLeave);

        cancel.addEventListener('click', () => finish(null));
        shoot.addEventListener('click', () => {
          if (!video.videoWidth || !video.videoHeight) return;
          try {
            finish(
              encode(
                { source: video, width: video.videoWidth, height: video.videoHeight },
                maxSize,
              ),
            );
          } catch {
            status.textContent = 'That photo did not work. Try again, or upload a photo.';
          }
        });
        file.addEventListener('change', () => {
          const picked = file.files?.[0];
          if (!picked) return;
          status.textContent = 'Loading the photo…';
          decode(picked)
            .then((frame) => finish(encode(frame, maxSize)))
            .catch(() => {
              status.textContent = 'That file could not be opened. Try another photo.';
            });
        });

        if (!mediaDevices?.getUserMedia) {
          noCamera('Upload a photo of your work.');
          return;
        }
        status.textContent = 'Starting the camera…';
        mediaDevices
          .getUserMedia({ video: { facingMode: facing }, audio: false })
          .then((media) => {
            if (closed) {
              for (const track of media.getTracks()) track.stop();
              return;
            }
            stream = media;
            video.srcObject = media;
            video.hidden = false;
            video.addEventListener(
              'loadedmetadata',
              () => {
                status.textContent = '';
                shoot.disabled = false;
              },
              { once: true },
            );
          })
          .catch(() => {
            if (!closed) noCamera('The camera is not available. Upload a photo instead.');
          });
      }),
  };
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string) {
  const el = doc.createElement(tag);
  el.className = className;
  return el;
}

/** Decode an image file through an <img>, which applies the photo's EXIF rotation. */
function decodeFile(file: Blob): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode the image'));
    };
    img.src = url;
  });
}

function encodeJpeg(doc: Document, frame: Frame, maxSize: number): CapturedImage {
  const { width, height } = fitWithin(frame.width, frame.height, maxSize);
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  context.drawImage(frame.source, 0, 0, width, height);
  return { image: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width, height };
}
