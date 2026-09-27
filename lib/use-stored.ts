"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "go-replay-stored";
// Values written in this tab; used when localStorage refuses writes.
const written = new Map<string, string>();

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function read(key: string, fallback: string): string {
  const mine = written.get(key);
  if (mine !== undefined) return mine;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** A string setting kept in this browser's localStorage; every reader of the key sees changes. */
export function useStoredString(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback
  );
  const set = useCallback(
    (next: string) => {
      written.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {}
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key]
  );
  return [value, set];
}
