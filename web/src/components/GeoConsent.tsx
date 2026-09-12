
import { useState } from 'react';
import { clearGeoAction, setGeoConsentAction, setGeoPlaceAction } from '../lib/actions';
import { prefsChanged } from './prefsChanged';
import { Pin } from './icons';

/**
 * Two steps on purpose. The switch is the reader agreeing to be asked; the
 * button is the ask. navigator.geolocation is reached from that button's click
 * handler and nowhere else — never on mount, never in an effect — so no route
 * in the app can raise the browser prompt by being opened.
 *
 * The coordinates the browser hands back go straight into the server action
 * that resolves them. What comes back is a place name; that is the only thing
 * stored, and the only thing this component ever holds.
 */
export function GeoConsent({ initialConsent, initialLabel }:
                           { initialConsent: boolean; initialLabel: string | null }) {
  const [consent, setConsent] = useState(initialConsent);
  const [label, setLabel] = useState<string | null>(initialLabel);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(on: boolean) {
    setBusy(true);
    setNote(null);
    // Optimistic: the switch is the reader's own gesture, and leaving it lagging
    // behind a round trip reads as the app refusing them.
    setConsent(on);
    if (!on) setLabel(null);
    setGeoConsentAction(on)
      .then(prefsChanged)
      .catch(() => { setConsent(!on); setNote('That could not be saved. Try again in a moment.'); })
      .finally(() => setBusy(false));
  }

  function ask() {
    setNote(null);
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo) { setNote('This browser will not share a location.'); return; }
    setBusy(true);
    geo.getCurrentPosition(
      (pos) => {
        setGeoPlaceAction(pos.coords.latitude, pos.coords.longitude)
          .then((r) => {
            if (r.ok) { setLabel(r.label); setNote(null); prefsChanged(); }
            else setNote('No place we cover is close enough to where you are. Nothing was saved.');
          })
          .catch(() => setNote('That could not be saved. Try again in a moment.'))
          .finally(() => setBusy(false));
      },
      (err) => {
        setBusy(false);
        setNote(err.code === err.PERMISSION_DENIED
          ? 'Your browser kept the location private. You can add places by name above instead.'
          : 'The browser could not work out where you are. Nothing changed.');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
    );
  }

  function forget() {
    setBusy(true);
    clearGeoAction()
      .then(() => { setLabel(null); setNote('That place has been removed.'); prefsChanged(); })
      .catch(() => setNote('That could not be removed. Try again in a moment.'))
      .finally(() => setBusy(false));
  }

  return (
    <div className="panel">
      <div className="label">Location</div>

      <label className="switch">
        <input type="checkbox" checked={consent} disabled={busy}
               onChange={(e) => toggle(e.target.checked)} />
        <span className="switch__track" aria-hidden="true"><span className="switch__knob" /></span>
        <span className="switch__text">
          Let this app ask your browser where you are. Only the nearest place we
          already name is kept — never the coordinates themselves.
        </span>
      </label>

      {consent && (
        label ? (
          <div className="geo__on">
            <span className="chip" data-on="true">
              <span className="geo__pin"><Pin size={11} /></span>{label}
            </span>
            <button type="button" className="savebtn" onClick={forget} disabled={busy}>Forget this place</button>
            <button type="button" className="savebtn" onClick={() => toggle(false)} disabled={busy}>Turn off</button>
          </div>
        ) : (
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }}
                  onClick={ask} disabled={busy}>
            {busy ? 'Asking…' : 'Use my location'}
          </button>
        )
      )}

      {note && <p className="hint" role="status">{note}</p>}
    </div>
  );
}
