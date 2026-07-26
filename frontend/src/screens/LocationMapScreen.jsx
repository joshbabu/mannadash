import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Same Hyderabad bias used for forward search in AddressPickerScreen — duplicated rather
// than shared, matching how this codebase keeps small per-file constants (see uniquePhone
// in the e2e specs) instead of introducing a shared-utils file for a few lines.
const HYDERABAD_VIEWBOX = '78.20,17.60,78.70,17.20';
const DEFAULT_CENTER = { lat: 17.4435, lng: 78.3772 }; // Hitech City, Hyderabad

// Three-step flow modeled on the reference screenshots:
//   'prompt' (add mode only) — "Get the fastest delivery" / turn-on-location + a search box,
//     matching the interstitial before Swiggy's add-address map opens.
//   'map'    — drag-the-map-to-place-the-center-pin, with a live reverse-geocoded address
//     shown in a bottom sheet, matching the "place the pin at exact delivery location" screen.
//   'label'  — (add mode only) name the address before saving; edit mode skips this and
//     keeps the existing label, since repositioning a pin isn't renaming it.
export default function LocationMapScreen({ mode, initialCenter, initialLabel, onClose, onSave, startAtMap }) {
  const [step, setStep] = useState(mode === 'edit' || startAtMap ? 'map' : 'prompt');
  const [center, setCenter] = useState(initialCenter || DEFAULT_CENTER);
  const [resolvedAddress, setResolvedAddress] = useState('');
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [promptQuery, setPromptQuery] = useState('');
  const [promptResults, setPromptResults] = useState([]);
  const [promptSearching, setPromptSearching] = useState(false);
  const [mapSearchOpen, setMapSearchOpen] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearchResults, setMapSearchResults] = useState([]);
  const [mapSearching, setMapSearching] = useState(false);
  const [label, setLabel] = useState(initialLabel || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  // Debounced forward search on the 'prompt' step (add mode) — picking a result jumps
  // straight into the map step centered there.
  useEffect(() => {
    if (step !== 'prompt') return undefined;
    const query = promptQuery.trim();
    if (query.length < 3) {
      setPromptResults([]);
      setPromptSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    setPromptSearching(true);
    const timer = setTimeout(() => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=${HYDERABAD_VIEWBOX}&bounded=0&countrycodes=in&limit=6`;
      fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
        .then((res) => res.json())
        .then((results) => setPromptResults(results || []))
        .catch((err) => { if (err.name !== 'AbortError') setPromptResults([]); })
        .finally(() => setPromptSearching(false));
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [promptQuery, step]);

  // Same debounced forward search, but for the search box on the map step — picking a
  // result re-centers the existing map instance instead of switching steps.
  useEffect(() => {
    if (step !== 'map' || !mapSearchOpen) return undefined;
    const query = mapSearchQuery.trim();
    if (query.length < 3) {
      setMapSearchResults([]);
      setMapSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    setMapSearching(true);
    const timer = setTimeout(() => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=${HYDERABAD_VIEWBOX}&bounded=0&countrycodes=in&limit=6`;
      fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
        .then((res) => res.json())
        .then((results) => setMapSearchResults(results || []))
        .catch((err) => { if (err.name !== 'AbortError') setMapSearchResults([]); })
        .finally(() => setMapSearching(false));
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mapSearchQuery, mapSearchOpen, step]);

  function reverseGeocode(lat, lng) {
    setResolvingAddress(true);
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, {
      headers: { Accept: 'application/json' },
    })
      .then((res) => res.json())
      .then((result) => setResolvedAddress(result?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`))
      .catch(() => setResolvedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`))
      .finally(() => setResolvingAddress(false));
  }

  function goToMap(nextCenter) {
    setCenter(nextCenter);
    setStep('map');
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => goToMap({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => goToMap(DEFAULT_CENTER),
    );
  }

  // Map is only mounted during the 'map' step, so it's created fresh each time this step
  // is entered rather than kept alive underneath the 'prompt'/'label' steps.
  useEffect(() => {
    if (step !== 'map' || !mapContainerRef.current || mapRef.current) return undefined;

    const map = L.map(mapContainerRef.current, { zoomControl: false }).setView([center.lat, center.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    reverseGeocode(center.lat, center.lng);

    let debounceTimer;
    map.on('moveend', () => {
      const c = map.getCenter();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => reverseGeocode(c.lat, c.lng), 300);
    });

    mapRef.current = map;

    return () => {
      clearTimeout(debounceTimer);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function selectMapSearchResult(result) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setMapSearchOpen(false);
    setMapSearchQuery('');
    setMapSearchResults([]);
    if (mapRef.current) mapRef.current.setView([lat, lng], 16);
  }

  function confirmPin() {
    const finalCenter = mapRef.current ? mapRef.current.getCenter() : center;
    const payload = { latitude: finalCenter.lat, longitude: finalCenter.lng, address: resolvedAddress };
    if (mode === 'edit') {
      save({ ...payload, label: initialLabel });
    } else {
      setCenter({ lat: finalCenter.lat, lng: finalCenter.lng });
      setStep('label');
    }
  }

  async function save(payload) {
    setSaving(true);
    setError('');
    try {
      await onSave(payload);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  function confirmLabel() {
    if (!label.trim()) return;
    save({ label: label.trim(), address: resolvedAddress, latitude: center.lat, longitude: center.lng });
  }

  return (
    <div data-testid="location-map-screen" style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--paper)', color: 'var(--charcoal)' }}>
      {step === 'prompt' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 20px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <button onClick={onClose} aria-label="Back" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--charcoal)', padding: 0 }}>←</button>
            <h2 style={{ fontSize: 20 }}>Add a new address</h2>
          </div>

          <div style={{ background: 'linear-gradient(135deg, #ffe3d2, #fff6ec)', borderRadius: 18, padding: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--charcoal)', marginBottom: 14 }}>
              Get the fastest delivery
            </p>
            <button className="btn-primary" onClick={useDeviceLocation} style={{ width: 'auto', padding: '12px 20px' }}>
              📍 Turn on device location
            </button>
          </div>

          <input
            placeholder="Search an area or address"
            value={promptQuery}
            onChange={(e) => setPromptQuery(e.target.value)}
            style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 14, borderRadius: 24, padding: '12px 16px' }}
          />

          {promptQuery.trim().length >= 3 && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {promptSearching && <p className="muted">Searching…</p>}
              {!promptSearching && promptResults.length === 0 && (
                <p className="muted">No matches for "{promptQuery.trim()}".</p>
              )}
              <div className="stack">
                {promptResults.map((r) => (
                  <button
                    key={r.place_id}
                    onClick={() => goToMap({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) })}
                    style={{
                      width: '100%', textAlign: 'left', background: '#fdf8ef', border: '1px solid #e5ddc9',
                      borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 16, lineHeight: '20px' }}>📍</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{r.display_name.split(',')[0].trim()}</span>
                      <span style={{ display: 'block', fontSize: 12, color: '#6b6156' }}>{r.display_name}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'map' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* In normal flow (not floated over the map) so it's always rendered and visible —
              an absolutely-positioned overlay here was intermittently invisible on mobile
              (Safari's containing-block/viewport handling for fixed-position ancestors can
              be unreliable), and this is just as usable without that risk. */}
          <div style={{ position: 'relative', zIndex: 20, background: '#fff', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f4f1ea', borderRadius: 24, padding: '10px 14px' }}>
              <button
                onClick={() => (mode === 'add' ? setStep('prompt') : onClose())}
                aria-label="Back"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 0, color: 'var(--charcoal)' }}
              >
                ←
              </button>
              <input
                placeholder="Search an area or address"
                value={mapSearchQuery}
                onFocus={() => setMapSearchOpen(true)}
                onChange={(e) => { setMapSearchQuery(e.target.value); setMapSearchOpen(true); }}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 14, color: 'var(--charcoal)' }}
              />
            </div>
            {mapSearchOpen && mapSearchQuery.trim().length >= 3 && (
              <div style={{ marginTop: 8, background: '#fff', borderRadius: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                {mapSearching && <p className="muted" style={{ padding: 12 }}>Searching…</p>}
                {!mapSearching && mapSearchResults.length === 0 && (
                  <p className="muted" style={{ padding: 12 }}>No matches.</p>
                )}
                {mapSearchResults.map((r) => (
                  <button
                    key={r.place_id}
                    onClick={() => selectMapSearchResult(r)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid #eee' }}
                  >
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--charcoal)' }}>{r.display_name.split(',')[0].trim()}</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#6b6156' }}>{r.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

            {/* Fixed center pin — the map pans underneath it, this stays visually anchored
                to the container's center with its tip touching the exact target point. */}
            <div
              aria-hidden
              style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: 10 }}
            >
              <div style={{ fontSize: 40, lineHeight: 1, filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.35))' }}>📍</div>
            </div>
          </div>

          <div style={{ background: 'var(--paper)', borderRadius: '20px 20px 0 0', padding: 20, boxShadow: '0 -4px 16px rgba(0,0,0,0.15)' }}>
            <p style={{ fontSize: 13, color: '#8a8074', marginBottom: 10 }}>Place the pin at exact delivery location</p>
            {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>📍</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 800, fontSize: 15, color: 'var(--charcoal)' }}>
                  {resolvingAddress ? 'Locating…' : (resolvedAddress.split(',')[0].trim() || 'Selected location')}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: '#6b6156' }}>
                  {resolvingAddress ? '' : resolvedAddress}
                </span>
              </span>
            </div>
            <button className="btn-primary" onClick={confirmPin} disabled={resolvingAddress || saving} style={{ width: '100%' }}>
              {saving ? 'Saving…' : 'Confirm & proceed'}
            </button>
          </div>
        </div>
      )}

      {step === 'label' && (
        <div style={{ padding: '20px 20px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <button onClick={() => setStep('map')} aria-label="Back" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--charcoal)', padding: 0 }}>←</button>
            <h2 style={{ fontSize: 20 }}>Name this address</h2>
          </div>
          <p style={{ fontSize: 13, color: '#6b6156', marginBottom: 16 }}>{resolvedAddress}</p>
          {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
          <input
            placeholder="Label (e.g. Home, Work)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
            style={{ width: '100%', marginBottom: 14, background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
          />
          <button className="btn-primary" onClick={confirmLabel} disabled={saving || !label.trim()} style={{ width: '100%' }}>
            {saving ? 'Saving…' : 'Save address'}
          </button>
        </div>
      )}
    </div>
  );
}
