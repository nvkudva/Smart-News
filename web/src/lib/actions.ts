import { ACTION_PATH, type ActionName, type Actions } from '../../shared/actions';

/**
 * The client half of the write side.
 *
 * Next generated this: a Server Action imported into a component became a POST
 * with the arguments serialised and the return value typed. This is that, by
 * hand — one request shape, and one wrapper per action so the five components
 * that call them change an import path and nothing else.
 *
 * The answer is wrapped in { value } rather than returned bare. Three of these
 * resolve to void, and JSON has no way to say undefined: Response.json of it
 * produces a body that will not parse. An envelope makes the empty case a
 * missing key, which reads back as undefined without a special case.
 */
type Envelope = { value?: unknown; error?: string };

async function call<K extends ActionName>(
  name: K, ...args: Parameters<Actions[K]>
): Promise<Awaited<ReturnType<Actions[K]>>> {
  const res = await fetch(ACTION_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Same-origin, so the cookie rides along and the Worker resolves the
    // reader the same way it does for a read.
    body: JSON.stringify({ name, args }),
  });

  const body = await res.json().catch(() => ({}) as Envelope) as Envelope;
  if (!res.ok) throw new Error(body.error ?? `${name} failed: ${res.status}`);
  return body.value as Awaited<ReturnType<Actions[K]>>;
}

// Names kept exactly as src/app/actions.ts exported them.
export const toggleSavedAction = (clusterId: string) => call('toggleSaved', clusterId);
export const toggleInterestAction = (category: string) => call('toggleInterest', category);
export const toggleHiddenAction = (category: string) => call('toggleHidden', category);
export const setCountryAction = (code: string) => call('setCountry', code);
export const setPlacesAction = (labels: string[], ids: string[]) =>
  call('setPlaces', labels, ids);
export const searchPlacesAction = (q: string) => call('searchPlaces', q);
export const setGeoConsentAction = (on: boolean) => call('setGeoConsent', on);
export const setGeoPlaceAction = (lat: number, lon: number) => call('setGeoPlace', lat, lon);
export const clearGeoAction = () => call('clearGeo');
