import type { HostPlatform } from '@braincade/game-host';
import { useEffect, useState } from 'react';
import { platform, platformReady } from '../host/platform';

let settled: HostPlatform | undefined;
void platformReady.then((p) => {
  settled = p;
});

/**
 * The web platform, re-rendering once the startup capability probe settles.
 * Until then `platform` lacks the capabilities still being probed (handwriting)
 * and `ready` is false.
 */
export function usePlatform(): { platform: HostPlatform; ready: boolean } {
  const [current, setCurrent] = useState(settled);
  useEffect(() => {
    if (current) return;
    let active = true;
    void platformReady.then((p) => active && setCurrent(p));
    return () => {
      active = false;
    };
  }, [current]);
  return current ? { platform: current, ready: true } : { platform, ready: false };
}
