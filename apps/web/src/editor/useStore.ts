import { useSyncExternalStore } from 'react';
import type { EditorStore } from './store';

/** Re-render on every store change; returns the store version. */
export function useStore(store: EditorStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}
