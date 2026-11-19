import { attemptSchema, type SelectedWord } from '@braincade/learning';
import { printableDocumentSchema } from '@braincade/printables';
import { z } from 'zod';
import type { Capability } from './manifest';

/**
 * Wire protocol between a game frame (iframe on web, WebView on mobile) and
 * its host. Games never touch storage, speech, or printing directly: they ask
 * the host, which keeps behaviour identical on every platform and lets the
 * host own learner data.
 */
export const CHANNEL = 'braincade';
export const PROTOCOL_VERSION = 1;

export type Platform = 'web' | 'ios' | 'android';

export interface SessionInfo {
  sessionId: string;
  gameId: string;
  platform: Platform;
  capabilities: Capability[];
  learner: { name: string; interests: string[] };
  locale: string;
}

/** A word chosen for practice, with where the learner stands on it. */
export type GameWord = Omit<SelectedWord, 'key'>;

/** Longest image data URL accepted over the protocol (~3 MB of JPEG). */
export const MAX_IMAGE_DATA_URL_LENGTH = 4_000_000;

export const imageDataUrlSchema = z
  .string()
  .max(MAX_IMAGE_DATA_URL_LENGTH)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'must be a base64 image data URL');

/** A photo taken by the host's camera, downscaled so it can cross the bridge. */
export const capturedImageSchema = z.object({
  /** `data:image/jpeg;base64,...` */
  image: imageDataUrlSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CapturedImage = z.infer<typeof capturedImageSchema>;

/**
 * What the host's handwriting reader saw. Words are in reading order and keep the
 * writer's spelling: the reader must not correct mistakes. Words it could not read
 * are marked `legible: false` (their `text` is a best guess, possibly empty).
 */
export const handwritingReadingSchema = z.object({
  words: z.array(z.object({ text: z.string().max(60), legible: z.boolean() })).max(200),
});
export type HandwritingReading = z.infer<typeof handwritingReadingSchema>;

export interface EndResult {
  /** Game-defined score, stored with the session history. */
  score?: number;
  summary?: string;
}

export const methodParamSchemas = {
  'session.start': z.object({ gameId: z.string(), version: z.string() }),
  'words.next': z.object({
    count: z.number().int().min(1).max(100).default(10),
    tags: z.array(z.string()).optional(),
    includeMastered: z.boolean().optional(),
  }),
  'progress.record': z.object({ attempts: z.array(attemptSchema).min(1).max(200) }),
  'speech.speak': z.object({
    text: z.string().min(1).max(1000),
    rate: z.number().min(0.25).max(2).optional(),
    language: z.string().max(20).optional(),
  }),
  'speech.stop': z.object({}),
  'print.document': z.object({ document: printableDocumentSchema }),
  'storage.get': z.object({ key: z.string().min(1).max(100) }),
  'storage.set': z.object({ key: z.string().min(1).max(100), value: z.unknown() }),
  'session.end': z.object({
    score: z.number().optional(),
    summary: z.string().max(500).optional(),
  }),
  'camera.capture': z.object({
    /** Short instruction the host shows while the camera is open ("Snap your sentence"). */
    prompt: z.string().max(200).optional(),
    facing: z.enum(['environment', 'user']).default('environment'),
    /** Longest side of the returned image, in pixels. */
    maxSize: z.number().int().min(320).max(2048).default(1600),
  }),
  'handwriting.read': z.object({ image: imageDataUrlSchema }),
} as const;

export type MethodName = keyof typeof methodParamSchemas;
export type MethodParams<M extends MethodName> = z.input<(typeof methodParamSchemas)[M]>;
export type ParsedMethodParams<M extends MethodName> = z.output<(typeof methodParamSchemas)[M]>;

export interface MethodResults {
  'session.start': SessionInfo;
  'words.next': GameWord[];
  'progress.record': null;
  'speech.speak': null;
  'speech.stop': null;
  'print.document': null;
  'storage.get': unknown;
  'storage.set': null;
  'session.end': null;
  /** `null` when the learner closed the camera without taking a photo. */
  'camera.capture': CapturedImage | null;
  'handwriting.read': HandwritingReading;
}

export const HOST_EVENTS = ['pause', 'resume', 'exit'] as const;
export type HostEvent = (typeof HOST_EVENTS)[number];
export const FRAME_NOTIFICATIONS = ['ready', 'exited', 'error'] as const;
export type FrameNotification = (typeof FRAME_NOTIFICATIONS)[number];

export const ERROR_CODES = [
  'bad-request',
  'unknown-method',
  'unsupported',
  /** The learner or a grown-up turned off access (e.g. camera permission). */
  'permission-denied',
  'not-found',
  'internal',
  'timeout',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const envelope = { channel: z.literal(CHANNEL), v: z.literal(PROTOCOL_VERSION) };

export const requestMessageSchema = z.object({
  ...envelope,
  type: z.literal('request'),
  id: z.number().int(),
  method: z.string(),
  params: z.unknown(),
});

export const responseMessageSchema = z.discriminatedUnion('ok', [
  z.object({
    ...envelope,
    type: z.literal('response'),
    id: z.number().int(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    ...envelope,
    type: z.literal('response'),
    id: z.number().int(),
    ok: z.literal(false),
    error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }),
  }),
]);

export const eventMessageSchema = z.object({
  ...envelope,
  type: z.literal('event'),
  name: z.enum(HOST_EVENTS),
});

export const notifyMessageSchema = z.object({
  ...envelope,
  type: z.literal('notify'),
  name: z.enum(FRAME_NOTIFICATIONS),
  data: z.unknown().optional(),
});

/** Anything the host may receive from a frame. */
export const frameMessageSchema = z.union([requestMessageSchema, notifyMessageSchema]);
/** Anything a frame may receive from its host. */
export const hostMessageSchema = z.union([responseMessageSchema, eventMessageSchema]);

export type RequestMessage = z.infer<typeof requestMessageSchema>;
export type ResponseMessage = z.infer<typeof responseMessageSchema>;
export type EventMessage = z.infer<typeof eventMessageSchema>;
export type NotifyMessage = z.infer<typeof notifyMessageSchema>;
export type FrameMessage = z.infer<typeof frameMessageSchema>;
export type HostMessage = z.infer<typeof hostMessageSchema>;

export class HostError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'HostError';
    this.code = code;
  }
}

export function isMethodName(value: string): value is MethodName {
  return Object.hasOwn(methodParamSchemas, value);
}
