import {
  AutoProcessor,
  AutoTokenizer,
  env,
  type PreTrainedTokenizer,
  type Processor,
  RawImage,
  type Tensor,
  VisionEncoderDecoderModel,
} from '@huggingface/transformers';
import sharp from 'sharp';
import { findLines, inkMask, lineImage, toBrightness } from './lines.js';

// The handwriting reader: Microsoft's TrOCR (small, handwritten), an open model that runs
// on the function's CPU, so reading a photo costs nothing per call. It reads one line of
// writing at a time; lines.ts finds them.

const MODEL = 'Xenova/trocr-small-handwritten';
/** Pinned so a change to the model repo can't change what the reader does. */
const REVISION = '02bea33ca09a70e2e2d91140a7e6e1a729606a5b';
/** Words the model is less sure of than this come back unreadable (the game's gibberish). */
export const LEGIBLE_CONFIDENCE = 0.3;
/** Photos are scaled to this before finding lines; plenty for a page of writing. */
const MAX_SIDE = 1600;
const END_OF_TEXT = 2;

export interface ReadWord {
  text: string;
  legible: boolean;
}

export type HandwritingReader = (image: Uint8Array) => Promise<{ words: ReadWord[] }>;

// Vercel Functions can only write to /tmp; the model (~65 MB) downloads there on a cold start.
if (process.env.VERCEL) env.cacheDir = '/tmp/braincade-models';
env.allowLocalModels = false;

interface Model {
  processor: Processor;
  tokenizer: PreTrainedTokenizer;
  model: VisionEncoderDecoderModel;
}

let loading: Promise<Model> | undefined;

/** Load once per warm instance; a failed load is retried by the next request. */
function loadModel(): Promise<Model> {
  loading ??= (async () => {
    const options = { revision: REVISION };
    const [processor, tokenizer, model] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL, options),
      AutoTokenizer.from_pretrained(MODEL, options),
      VisionEncoderDecoderModel.from_pretrained(MODEL, { ...options, dtype: 'q8' }),
    ]);
    return { processor, tokenizer, model: model as VisionEncoderDecoderModel };
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/** Decode a photo to RGBA pixels: upright, at most MAX_SIDE, transparency on white paper. */
export async function decodePhoto(image: Uint8Array) {
  const { data, info } = await sharp(image, { failOn: 'none' })
    .rotate() // phone photos carry their orientation in EXIF
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    // A drawing exported as a transparent PNG: its background must read as paper, not as
    // black (transparent pixels are often stored as black).
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Read the handwriting in an encoded image (JPEG, PNG, or WebP). */
export const readHandwriting: HandwritingReader = async (image) => {
  const { data, width, height } = await decodePhoto(image);
  // Scale the lighting window with the photo: about a letter's height.
  const window = Math.max(15, Math.round(Math.max(width, height) * 0.022)) | 1;
  const brightness = toBrightness(data, width, height);
  const ink = inkMask(brightness, width, height, { window });
  const { labels, lines } = findLines(ink, width, height, { rgba: data });
  if (lines.length === 0) return { words: [] };

  const { processor, tokenizer, model } = await loadModel();
  const words: ReadWord[] = [];
  for (const found of lines) {
    const line = lineImage(labels, width, found, brightness);
    const { pixel_values } = await processor(new RawImage(line.rgb, line.width, line.height, 3));
    words.push(...(await readLine(model, tokenizer, pixel_values as Tensor)));
  }
  return { words };
};

/**
 * Generate the line's text, then score each generated token with one teacher-forced pass
 * (generate doesn't return scores). A word's confidence is its least likely token.
 */
async function readLine(
  model: VisionEncoderDecoderModel,
  tokenizer: PreTrainedTokenizer,
  pixel_values: Tensor,
): Promise<ReadWord[]> {
  const sequence = (await model.generate({ inputs: pixel_values, max_new_tokens: 48 })) as Tensor;
  const ids = Array.from(sequence.data as BigInt64Array, Number);
  const { logits } = (await model({ pixel_values, decoder_input_ids: sequence })) as {
    logits: Tensor;
  };
  const vocab = logits.dims[2] ?? 0;
  const values = logits.data as Float32Array;
  const probability = (position: number, token: number) => {
    const row = values.subarray(position * vocab, (position + 1) * vocab);
    let max = -Infinity;
    for (const v of row) if (v > max) max = v;
    let sum = 0;
    for (const v of row) sum += Math.exp(v - max);
    return Math.exp((row[token] ?? -Infinity) - max) / sum;
  };

  // Decode the growing prefix to see where each token's text starts a new word.
  const words: Array<{ text: string; confidence: number }> = [];
  let decoded = '';
  for (let t = 1; t < ids.length && ids[t] !== END_OF_TEXT; t++) {
    const p = probability(t - 1, ids[t] ?? 0);
    const text = tokenizer.decode(ids.slice(1, t + 1), { skip_special_tokens: true });
    const piece = text.slice(decoded.length);
    decoded = text;
    piece.split(' ').forEach((part, i) => {
      if (!part) return;
      const current = words.at(-1);
      if (i === 0 && current) {
        current.text += part;
        current.confidence = Math.min(current.confidence, p);
      } else {
        words.push({ text: part, confidence: p });
      }
    });
  }
  return (
    words
      // Stray marks read as lone punctuation ("." or "'") aren't words the child wrote.
      .filter((word) => /[\p{L}\p{N}]/u.test(word.text))
      .map((word) => ({ text: word.text.trim(), legible: word.confidence >= LEGIBLE_CONFIDENCE }))
  );
}
