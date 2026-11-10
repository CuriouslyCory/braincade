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
}

export const HOST_EVENTS = ['pause', 'resume', 'exit'] as const;
export type HostEvent = (typeof HOST_EVENTS)[number];
export const FRAME_NOTIFICATIONS = ['ready', 'exited', 'error'] as const;
export type FrameNotification = (typeof FRAME_NOTIFICATIONS)[number];

export const ERROR_CODES = [
  'bad-request',
  'unknown-method',
  'unsupported',
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
