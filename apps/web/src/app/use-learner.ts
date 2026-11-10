import type { LearnerProfile } from '@braincade/learning';
import { useCallback, useEffect, useState } from 'react';
import { platform } from '../host/platform';

export function useProfile() {
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  useEffect(() => {
    let active = true;
    void platform.learner.getProfile().then((p) => active && setProfile(p));
    return () => {
      active = false;
    };
  }, []);
  const save = useCallback(async (patch: Partial<LearnerProfile>) => {
    setProfile(await platform.learner.saveProfile(patch));
  }, []);
  return { profile, save };
}
