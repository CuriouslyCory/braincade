import {
  CHANNEL,
  type FrameNotification,
  HostError,
  type HostEvent,
  hostMessageSchema,
  type MethodName,
  type MethodParams,
  type MethodResults,
  PROTOCOL_VERSION,
} from './protocol';
import type { Transport } from './transport';

export interface HostClient {
  request<M extends MethodName>(method: M, params: MethodParams<M>): Promise<MethodResults[M]>;
  notify(name: FrameNotification, data?: unknown): void;
  onEvent(name: HostEvent, listener: () => void): () => void;
  dispose(): void;
}

/** Frame-side RPC client. Requests time out so a missing host never hangs a game. */
export function createHostClient(
  transport: Transport,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): HostClient {
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const listeners = new Map<HostEvent, Set<() => void>>();

  const stop = transport.listen((raw) => {
    const parsed = hostMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'event') {
      for (const listener of listeners.get(message.name) ?? []) listener();
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new HostError(message.error.code, message.error.message));
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new HostError('timeout', `Host did not answer "${method}" in ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        transport.send({
          channel: CHANNEL,
          v: PROTOCOL_VERSION,
          type: 'request',
          id,
          method,
          params,
        });
      });
    },
    notify(name, data) {
      transport.send({ channel: CHANNEL, v: PROTOCOL_VERSION, type: 'notify', name, data });
    },
    onEvent(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
    dispose() {
      stop();
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new HostError('internal', 'Client disposed'));
      }
      pending.clear();
      listeners.clear();
    },
  };
}
