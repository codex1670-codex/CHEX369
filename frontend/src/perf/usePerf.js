import { useSyncExternalStore } from 'react';
import { getPerfSnapshot, subscribePerf } from './perfProfile.js';

/** Current performance profile: { fps, level, tier, refresh, mode, reason, delivered, … }. Re-renders when it changes. */
export function usePerf() {
  return useSyncExternalStore(subscribePerf, getPerfSnapshot, getPerfSnapshot);
}
