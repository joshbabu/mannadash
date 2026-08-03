import { useEffect, useState } from 'react';
import { api } from '../api';
import LocationMapScreen from './LocationMapScreen';

// Bias/limit results toward the Hyderabad metro area so a search for a common area name
// (there are multiple "Shivaji Nagar"s in India) resolves to the right one by default.
// Loose bounding box around Hyderabad + Secunderabad; `bounded=0` still allows a good
// match outside it if nothing local fits, it's just a ranking hint, not a hard wall.
const HYDERABAD_VIEWBOX = '78.20,17.60,78.70,17.20'; // left,top,right,bottom

// Full-screen "select your location" flow, modeled on the reference screenshot: search,
// a couple of quick actions, then the saved-addresses list with per-row select/edit/delete.
// Search hits OpenStreetMap's free Nominatim geocoder — no API key needed, but it's rate
// -limited to ~1 req/sec and isn't meant for heavy production autocomplete traffic. Fine
// for this stage; worth swapping for Google Places/Mapbox (proxied through the backend,
// so the key stays server-side) once volume justifies it.
// "Recently searched" from the reference isn't included — there's no backend search-history
// concept to back it with real data, and a fabricated list would just be decoration.
export default function AddressPickerScreen({
  addresses,
  selectedAddress,
  onClose,
  onSelectAddress,
  onAddressesUpdated,
  onUseMyLocation,
  defaultLatLng,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [locationOn, setLocationOn] = useState(false);
  const [locationMapMode, setLocationMapMode] = useState(null); // null | 'add' | 'edit'
  const [editTarget, setEditTarget] = useState(null);
  const [searchAddCenter, setSearchAddCenter] = useState(null); // {lat, lng, label} when 'add' was triggered from a search result
  const [openMenuId, setOpenMenuId] = useState(null);
  const [error, setError] = useState('');

  const q = searchQuery.trim().toLowerCase();
  const filteredAddresses = !q
    ? addresses
    : addresses.filter((a) => a.label.toLowerCase().includes(q) || a.address.toLowerCase().includes(q));

  // Debounced live area/address search — separate from the instant saved-addresses filter
  // above, since this one needs a network round trip.
  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSearchResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError('');
    const timer = setTimeout(() => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=${HYDERABAD_VIEWBOX}&bounded=0&countrycodes=in&limit=6&addressdetails=1`;
      fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
        .then((res) => {
          if (!res.ok) throw new Error('Search failed');
          return res.json();
        })
        .then((results) => setSearchResults(results || []))
        .catch((err) => {
          if (err.name !== 'AbortError') setSearchError('Could not search right now — try again.');
        })
        .finally(() => setSearching(false));
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery]);

  function shortLabelFor(result) {
    // First segment of the display name reads like an area/landmark name; the full
    // display_name (shown underneath) carries the rest of the detail.
    return result.display_name.split(',')[0].trim();
  }

  function selectSearchResult(result) {
    // Matches the reference behavior: a search result is a starting point to confirm on
    // the map and save as a real address, not something that gets applied instantly.
    // The earlier version called onSelectAddress() directly here — which set it as the
    // browsing location for this session only, never persisted it, and got silently
    // overwritten by the saved "Home" address again on the next app load. That's exactly
    // how a restaurant's real, corrected coordinates could look "not able to pick from
    // search" — tapping a result appeared to do nothing lasting.
    setSearchAddCenter({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      label: shortLabelFor(result),
    });
    setLocationMapMode('add');
  }

  function toggleLocation() {
    const next = !locationOn;
    setLocationOn(next);
    if (next) onUseMyLocation();
  }

  function openAddOnMap() {
    setSearchAddCenter(null);
    setLocationMapMode('add');
  }

  function openEditOnMap(addr) {
    setEditTarget(addr);
    setLocationMapMode('edit');
    setOpenMenuId(null);
  }

  async function handleMapSave(payload) {
    const wasSearchDriven = locationMapMode === 'add' && Boolean(searchAddCenter);
    const updated = locationMapMode === 'edit'
      ? await api.updateAddress(editTarget.id, payload)
      : await api.saveAddress(payload);
    onAddressesUpdated(updated);
    // Only auto-select (and thereby close the whole picker) when this save came from the
    // top-level search — that's the one case where "confirm this address" clearly means
    // "start using it now". Plain "Add New Address" and "Edit" both stay on the list
    // afterward instead, same as before this fix — confirmed by the existing tests, which
    // this regressed the first time around by auto-closing after every save.
    if (wasSearchDriven) {
      const newlyAdded = updated[updated.length - 1];
      if (newlyAdded) onSelectAddress(newlyAdded);
    }
    setLocationMapMode(null);
    setEditTarget(null);
    setSearchAddCenter(null);
  }

  async function deleteAddress(id) {
    setOpenMenuId(null);
    try {
      const updated = await api.removeAddress(id);
      onAddressesUpdated(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div
      data-testid="address-picker"
      style={{
        position: 'fixed', inset: 0, zIndex: 80, background: 'var(--paper)', color: 'var(--charcoal)',
        overflowY: 'auto', padding: '20px 20px 40px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <button
          onClick={onClose}
          aria-label="Back"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--charcoal)', padding: 0 }}
        >
          ←
        </button>
        <h2 style={{ fontSize: 20 }}>Select your location</h2>
      </div>

      <input
        placeholder="Search an area or address"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 14, borderRadius: 24, padding: '12px 16px' }}
      />

      {searchQuery.trim().length >= 3 && (
        <div style={{ marginBottom: 20 }}>
          {searching && <p className="muted">Searching…</p>}
          {!searching && searchError && <div className="error-banner">{searchError}</div>}
          {!searching && !searchError && searchResults.length === 0 && (
            <p className="muted">No matches for "{searchQuery.trim()}".</p>
          )}
          {!searching && searchResults.length > 0 && (
            <div className="stack">
              {searchResults.map((r) => (
                <button
                  key={r.place_id}
                  onClick={() => selectSearchResult(r)}
                  style={{
                    width: '100%', textAlign: 'left', background: '#fdf8ef', border: '1px solid #e5ddc9',
                    borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: '20px' }}>📍</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: 'var(--charcoal)' }}>
                      {shortLabelFor(r)}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: '#6b6156' }}>{r.display_name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
        <button
          onClick={toggleLocation}
          style={{
            flex: 1, textAlign: 'left', background: '#fdf8ef', border: '1px solid #e5ddc9', borderRadius: 14,
            padding: '12px 14px', cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block', width: 34, height: 20, borderRadius: 10, marginBottom: 8,
              background: locationOn ? 'var(--chili)' : '#ddd', position: 'relative',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: locationOn ? 16 : 2, width: 16, height: 16, borderRadius: '50%',
              background: '#fff', transition: 'left 0.15s ease',
            }} />
          </span>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--charcoal)' }}>
            Turn on Location
          </span>
        </button>
        <button
          onClick={openAddOnMap}
          style={{
            flex: 1, textAlign: 'left', background: '#fdf8ef', border: '1px solid #e5ddc9', borderRadius: 14,
            padding: '12px 14px', cursor: 'pointer',
          }}
        >
          <span style={{ display: 'block', fontSize: 20, marginBottom: 8 }}>➕</span>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--charcoal)' }}>
            Add New Address
          </span>
        </button>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}

      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: '#8a8074', textTransform: 'uppercase', marginBottom: 10 }}>
        {q ? 'Matching saved addresses' : 'Saved addresses'}
      </p>

      {filteredAddresses.length === 0 && (
        <p className="muted" style={{ marginBottom: 20 }}>
          {addresses.length === 0 ? 'No saved addresses yet — add one above.' : 'No saved addresses match your search.'}
        </p>
      )}

      <div className="stack">
        {filteredAddresses.map((a) => {
          const isSelected = selectedAddress?.id === a.id;
          return (
            <div
              key={a.id}
              style={{
                position: 'relative', background: '#fdf8ef', border: isSelected ? '2px solid var(--chili-dark)' : '1px solid #e5ddc9',
                borderRadius: 14, padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 18, lineHeight: '22px' }}>🏠</span>
                <button
                  onClick={() => onSelectAddress(a)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--charcoal)' }}>{a.label}</span>
                    {isSelected && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#0f7a5c', background: '#d6f5e8', borderRadius: 8, padding: '2px 8px' }}>
                        SELECTED
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'block', fontSize: 13, color: '#6b6156' }}>
                    {a.addressDetails ? `${a.addressDetails}, ` : ''}{a.address}
                  </span>
                  {(a.receiverName || a.receiverPhone) && (
                    <span style={{ display: 'block', fontSize: 12, color: '#8a8074', marginTop: 2 }}>
                      {a.receiverName}{a.receiverName && a.receiverPhone ? ' · ' : ''}{a.receiverPhone}
                    </span>
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === a.id ? null : a.id); }}
                  aria-label={`Options for ${a.label}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px', color: '#6b6156' }}
                >
                  ⋮
                </button>
                {openMenuId === a.id && (
                  <div
                    style={{
                      position: 'absolute', top: 40, right: 10, background: 'var(--ink)', borderRadius: 10,
                      overflow: 'hidden', boxShadow: '0 8px 20px rgba(0,0,0,0.35)', zIndex: 5, minWidth: 120,
                    }}
                  >
                    <button
                      onClick={() => openEditOnMap(a)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', fontSize: 14 }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => deleteAddress(a.id)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--chili)', cursor: 'pointer', fontSize: 14 }}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {locationMapMode && (
        <LocationMapScreen
          mode={locationMapMode}
          startAtMap={locationMapMode === 'add' && Boolean(searchAddCenter)}
          initialCenter={
            locationMapMode === 'edit' && editTarget
              ? { lat: Number(editTarget.latitude), lng: Number(editTarget.longitude) }
              : searchAddCenter || defaultLatLng
          }
          initialLabel={
            locationMapMode === 'edit' && editTarget
              ? editTarget.label
              : searchAddCenter?.label || ''
          }
          initialAddressDetails={locationMapMode === 'edit' && editTarget ? editTarget.addressDetails : ''}
          initialReceiverName={locationMapMode === 'edit' && editTarget ? editTarget.receiverName : ''}
          initialReceiverPhone={locationMapMode === 'edit' && editTarget ? editTarget.receiverPhone : ''}
          onClose={() => { setLocationMapMode(null); setEditTarget(null); setSearchAddCenter(null); }}
          onSave={handleMapSave}
        />
      )}
    </div>
  );
}
