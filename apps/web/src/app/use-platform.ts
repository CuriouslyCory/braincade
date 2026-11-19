import type { HostPlatform } from '@braincade/game-host';
import { useEffect, useState } from 'react';
import { onPlatformChange, platform, platformReady } from '../host/platform';

let settled: HostPlatform | undefined;
// A probe superseded by a newer one (the code changed again) must not overwrite its result.
const track = () => {
  settled = undefined;
  const probe = platformReady();
  void probe.then((p) => {
    if (probe === platformReady()) settled = p;
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
      const probe = platformReady();
      void probe.then((p) => {
        if (active && probe === platformReady()) setCurrent(p);
      });
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
