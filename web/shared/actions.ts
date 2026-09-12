import type { Place } from './types';

/**
 * The write side, as one contract.
 *
 * These were Server Actions: nine exported async functions that Next turned
 * into POSTs and typed across the boundary for free. A Worker has no such
 * machinery, so the signatures are declared here instead — the Worker's
 * implementation is checked against this map, and the client's callers go
 * through it, which is what keeps the two ends from drifting apart.
 *
 * Every one of these is RPC rather than REST, and they stay that way. They are
 * nine independent operations on one reader's row, not nine resources; giving
 * each a URL and a verb would invent a taxonomy the app does not have.
 */
export type Actions = {
  toggleSaved: (clusterId: string) => Promise<boolean>;

  toggleInterest: (category: string) => Promise<{ hidden: string[]; categories: string[] }>;
  toggleHidden: (category: string) => Promise<{ hidden: string[]; categories: string[] }>;

  setCountry: (code: string) => Promise<string>;
  setPlaces: (labels: string[], ids: string[]) => Promise<void>;
  searchPlaces: (q: string) => Promise<Place[]>;

  setGeoConsent: (on: boolean) => Promise<void>;
  setGeoPlace: (lat: number, lon: number) => Promise<{ ok: boolean; label: string | null }>;
  clearGeo: () => Promise<void>;
};

export type ActionName = keyof Actions;

/** Every action is a mutation on the caller's own row, so one path serves all
 *  of them and the name travels in the body. */
export const ACTION_PATH = '/api/action';

export type ActionRequest<K extends ActionName = ActionName> = {
  name: K;
  args: Parameters<Actions[K]>;
};
