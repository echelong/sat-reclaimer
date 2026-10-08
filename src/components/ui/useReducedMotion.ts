'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToPreference(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readPreference() {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Tracks `prefers-reduced-motion: reduce` as an external store.
 *
 * `useSyncExternalStore` is the right primitive here rather than an effect that
 * calls `setState`: it subscribes and unsubscribes for us, reads the live value
 * on every render, and — importantly — takes an explicit server snapshot, so the
 * server render and the hydration render agree and there is no cascading
 * re-render. The server snapshot is `false`, and components must treat `false` as
 * "animate", which is why every consumer also degrades safely if a single frame
 * of animation occurs.
 */
/** Server snapshot: there is no `matchMedia` on the server, so animations stay
 * enabled for that render and correct themselves on the client. */
const getServerSnapshot = () => false;

export function useReducedMotion() {
  // Both callbacks are module-level constants, so their identity is already
  // stable across renders and `useSyncExternalStore` never re-subscribes.
  return useSyncExternalStore(subscribeToPreference, readPreference, getServerSnapshot);
}
