import { useEffect, useState } from 'react';
import { api } from '../api';

// Hitech City, Hyderabad — reasonable default center for the MVP demo area
const DEFAULT_LAT = 17.4435;
const DEFAULT_LNG = 78.3772;

// Curated quick-tap categories — tapping one just fills the same search box that already
// drives both the instant name/cuisine filter and the debounced dish search, so this adds
// zero new backend logic, purely a faster way to trigger what's already there. Fixed,
// hand-picked list rather than data-driven off actual order volume — at launch stage
// with a limited restaurant base, "most popular" would be thin or empty in places.
//
// searchTerm (when present) overrides label for the actual query, singular instead of
// plural — a plain substring search for "Cakes" never matches a dish literally named
// "Butterscotch Cake" (singular), but "Cake" matches both "Cake" and "Cakes" since the
// plural always contains the singular as a substring. label stays plural for the button
// itself, since that's the natural, expected way to read a category chip. Deliberately
// NOT applied to "Fries" — "Fries" (not "Fry") is the natural dish-name form itself
// (e.g. "Masala Fries"), so singularizing it would make matches worse, not better.
// "Pastry" uses a truncated root ("pastr") instead of the full singular — English's
// irregular y→ies plurals (Pastry/Pastries) break the "singular is a substring of the
// plural" trick that works for regular -s plurals, since "Pastry" is NOT a substring of
// "Pastries". A short common root sidesteps the irregularity entirely and matches both.
const QUICK_CATEGORIES = [
  { label: 'Biryani', icon: '🍛' },
  { label: 'Pizza', icon: '🍕' },
  { label: 'Burgers', icon: '🍔', searchTerm: 'Burger' },
  { label: 'Shawarma', icon: '🌯' },
  { label: 'Momos', icon: '🥟', searchTerm: 'Momo' },
  { label: 'Noodles', icon: '🍜', searchTerm: 'Noodle' },
  { label: 'Dosa', icon: '🫓' },
  { label: 'Idli', icon: '🍚' },
  { label: 'Pasta', icon: '🍝' },
  { label: 'Fries', icon: '🍟' },
  { label: 'Salad', icon: '🥗' },
  { label: 'Cakes', icon: '🍰', searchTerm: 'Cake' },
  { label: 'Pastry', icon: '🥐', searchTerm: 'pastr' },
  { label: 'Ice Cream', icon: '🍦' },
  { label: 'Shake', icon: '🥤' },
];

export default function RestaurantListScreen({ onSelectRestaurant }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('distance'); // 'distance' | 'rating'
  const [searchQuery, setSearchQuery] = useState('');
  const [currentLatLng, setCurrentLatLng] = useState({ lat: DEFAULT_LAT, lng: DEFAULT_LNG });
  const [dishMatches, setDishMatches] = useState([]); // restaurants found by dish, not name/cuisine

  // Phase H: dish-level search. The name/cuisine filter below is instant (client-side,
  // already-loaded data); dish search needs the backend (dish names aren't in the list
  // response at all) so it's debounced rather than fired on every keystroke.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setDishMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .getNearbyRestaurants(currentLatLng.lat, currentLatLng.lng, 8000, q)
        .then(setDishMatches)
        .catch(() => setDishMatches([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, currentLatLng]);

  useEffect(() => {
    load(DEFAULT_LAT, DEFAULT_LNG);
  }, []);

  async function load(lat, lng) {
    setLoading(true);
    setError('');
    setCurrentLatLng({ lat, lng });
    try {
      const results = await api.getNearbyRestaurants(lat, lng);
      setRestaurants(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => load(pos.coords.latitude, pos.coords.longitude),
      () => load(DEFAULT_LAT, DEFAULT_LNG),
    );
  }

  const filteredRestaurants = restaurants.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.cuisineType.toLowerCase().includes(q);
  });

  // Union of name/cuisine matches (instant) and dish matches (debounced, from the
  // backend) — a restaurant found only by dish still needs to actually appear, even if
  // its own name/cuisine never mentioned the search term at all
  const existingIds = new Set(filteredRestaurants.map((r) => r.id));
  const dishOnlyMatches = dishMatches.filter((r) => !existingIds.has(r.id));
  const combinedRestaurants = [...filteredRestaurants, ...dishOnlyMatches];

  const sortedRestaurants = [...combinedRestaurants].sort((a, b) => {
    if (sortBy === 'rating') return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
    return a.distanceMeters - b.distanceMeters;
  });

  return (
    <div className="screen">
      <div className="row" style={{ marginTop: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 26 }}>Nearby restaurants</h1>
      </div>
      <input
        placeholder="Search by name, cuisine, or dish…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
        {QUICK_CATEGORIES.map((cat) => {
          const queryValue = cat.searchTerm || cat.label;
          const active = searchQuery.trim().toLowerCase() === queryValue.toLowerCase();
          return (
            <button
              key={cat.label}
              aria-label={`${cat.icon} ${cat.label}`}
              onClick={() => setSearchQuery(active ? '' : queryValue)}
              style={{
                flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', minWidth: 56,
              }}
            >
              <span
                style={{
                  width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 22, background: active ? 'var(--chili)' : '#fdf8ef',
                  border: active ? '2px solid var(--chili-dark)' : '1px solid #e5ddc9',
                }}
              >
                {cat.icon}
              </span>
              <span style={{ fontSize: 11, color: active ? 'var(--chili)' : 'var(--text-secondary, #c9c2b4)', fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>
                {cat.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginBottom: 16, gap: 8 }}>
        <button className="btn-secondary" onClick={useMyLocation}>
          📍 Use my location
        </button>
        <button
          className="btn-secondary"
          onClick={() => setSortBy(sortBy === 'distance' ? 'rating' : 'distance')}
        >
          Sort: {sortBy === 'distance' ? 'Nearest' : 'Top rated'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Finding what's cooking nearby…</p>}

      {!loading && restaurants.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p>No restaurants nearby yet.</p>
          <p className="muted" style={{ color: '#6b6156' }}>Try widening the search or check back soon — MannaDash is just getting started here.</p>
        </div>
      )}

      <div className="stack">
        {sortedRestaurants.map((r) => (
          <button
            key={r.id}
            className="card"
            style={{ textAlign: 'left', width: '100%' }}
            onClick={() => onSelectRestaurant(r)}
          >
            <div className="row">
              <h3 style={{ fontSize: 17 }}>
                {r.name}
                {r.isVegOnly && (
                  <span
                    style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#2e6b34', background: '#e3edd8', padding: '2px 8px', borderRadius: 10, verticalAlign: 'middle' }}
                  >
                    🌱 Pure Veg
                  </span>
                )}
              </h3>
              <span className="pill">{(r.distanceMeters / 1000).toFixed(1)} km</span>
            </div>
            <p className="muted" style={{ color: '#6b6156' }}>
              {Number(r.ratingAvg) > 0 && <>★ {Number(r.ratingAvg).toFixed(1)} ({r.ratingCount}) · </>}
              {r.cuisineType} · {r.avgPrepTimeMins} min prep
              {r.costForTwo && <> · ₹{r.costForTwo} for two</>}
            </p>
            {r.matchedDishes?.length > 0 && (
              <p style={{ color: 'var(--chili-dark)', fontSize: 13, fontWeight: 600, margin: '4px 0 0' }}>
                🍽️ {r.matchedDishes.join(', ')}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
