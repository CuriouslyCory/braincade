import type { HostPlatform } from '@braincade/game-host';
import { useEffect, useState } from 'react';
import { onPlatformChange, platform, platformReady } from '../host/platform';

let settled: HostPlatform | undefined;
const track = () => {
  settled = undefined;
  void platformReady().then((p) => {
    settled = p;
  });
};
track();
onPlatformChange(track);

/**
 * The web platform, re-rendering once the capability probe settles (at startup,
 * and again when a grown-up changes the reader access code). Until then
 * `platform` lacks the capabilities still being probed (handwriting) and
 * `ready` is false.
 */
export function usePlatform(): { platform: HostPlatform; ready: boolean } {
  const [current, setCurrent] = useState(settled);
  useEffect(() => {
    let active = true;
    const wait = () => {
      void platformReady().then((p) => active && setCurrent(p));
    };
    if (!current) wait();
    const off = onPlatformChange(() => {
      setCurrent(undefined);
      wait();
    });
    return () => {
      active = false;
      off();
    };
  }, [current]);
  return current ? { platform: current, ready: true } : { platform, ready: false };
}
