import { useEffect, useState } from 'react';
import { api } from '../api';

// Hitech City, Hyderabad — reasonable default center for the MVP demo area
const DEFAULT_LAT = 17.4435;
const DEFAULT_LNG = 78.3772;

export default function RestaurantListScreen({ onSelectRestaurant }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('distance'); // 'distance' | 'rating'
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    load(DEFAULT_LAT, DEFAULT_LNG);
  }, []);

  async function load(lat, lng) {
    setLoading(true);
    setError('');
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

  const sortedRestaurants = [...filteredRestaurants].sort((a, b) => {
    if (sortBy === 'rating') return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
    return a.distanceMeters - b.distanceMeters;
  });

  return (
    <div className="screen">
      <div className="row" style={{ marginTop: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 26 }}>Nearby restaurants</h1>
      </div>
      <input
        placeholder="Search by name or cuisine…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 12 }}
      />
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
              <h3 style={{ fontSize: 17 }}>{r.name}</h3>
              <span className="pill">{(r.distanceMeters / 1000).toFixed(1)} km</span>
            </div>
            <p className="muted" style={{ color: '#6b6156' }}>
              {Number(r.ratingAvg) > 0 && <>★ {Number(r.ratingAvg).toFixed(1)} ({r.ratingCount}) · </>}
              {r.cuisineType} · {r.avgPrepTimeMins} min prep
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
