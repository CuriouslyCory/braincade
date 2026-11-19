// @vitest-environment jsdom
import type { HostPlatform } from '@braincade/game-host';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A controllable stand-in for host/platform: each probe is a promise the test settles.
const probes = vi.hoisted(() => {
  const base = { platform: 'web', id: 'base' } as unknown as HostPlatform;
  const listeners = new Set<() => void>();
  let resolveCurrent: (p: HostPlatform) => void = () => {};
  let current = new Promise<HostPlatform>((r) => {
    resolveCurrent = r;
  });
  return {
    base,
    platformReady: () => current,
    onPlatformChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Start a new probe (as setReaderAccessCode does); returns how to settle it. */
    reprobe() {
      let resolve!: (p: HostPlatform) => void;
      current = new Promise<HostPlatform>((r) => {
        resolve = r;
      });
      for (const listener of listeners) listener();
      return resolve;
    },
    resolveFirst: (p: HostPlatform) => resolveCurrent(p),
  };
});

vi.mock('../host/platform', () => ({
  platform: probes.base,
  platformReady: probes.platformReady,
  onPlatformChange: probes.onPlatformChange,
}));

const { usePlatform } = await import('./use-platform');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: ReturnType<typeof usePlatform> | undefined;
function Probe() {
  seen = usePlatform();
  return null;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('usePlatform', () => {
  it('ignores a superseded probe that settles after the current one', async () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Probe />));
    expect(seen?.ready).toBe(false);

    // The grown-up fixes the code while the first (wrong-code) probe is still pending.
    const resolveSecond = probes.reprobe();
    const withReader = { ...probes.base, id: 'with-reader' } as unknown as HostPlatform;
    await act(async () => resolveSecond(withReader));
    expect(seen).toEqual({ platform: withReader, ready: true });

    // The stale probe finishing late must not take the reader away again.
    await act(async () => probes.resolveFirst(probes.base));
    expect(seen).toEqual({ platform: withReader, ready: true });

    // A screen mounted afterwards starts from the current result too.
    seen = undefined;
    await act(async () => root.render(<Probe key="remount" />));
    expect(seen).toEqual({ platform: withReader, ready: true });
    act(() => root.unmount());
  });

  it('keeps waiting for the current probe when a superseded one settles first', async () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<Probe />));
    const resolveOld = probes.reprobe();
    const resolveNew = probes.reprobe();

    // The old probe answers first: still not ready, and its result is never shown.
    await act(async () => resolveOld(probes.base));
    expect(seen).toEqual({ platform: probes.base, ready: false });

    const withReader = { ...probes.base, id: 'with-reader-2' } as unknown as HostPlatform;
    await act(async () => resolveNew(withReader));
    expect(seen).toEqual({ platform: withReader, ready: true });
    act(() => root.unmount());
  });
});
