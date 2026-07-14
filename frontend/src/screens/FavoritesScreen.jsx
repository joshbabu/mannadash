import { useEffect, useState } from 'react';
import { api } from '../api';

export default function FavoritesScreen({ onBack, onSelectRestaurant }) {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getFavorites().then(setFavorites).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  async function removeFavorite(id) {
    try {
      await api.removeFavorite(id);
      setFavorites((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Favorites</h1>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && favorites.length === 0 && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p>No favorites yet.</p>
          <p className="muted" style={{ color: '#6b6156' }}>Tap the heart on any restaurant to save it here.</p>
        </div>
      )}

      <div className="stack">
        {favorites.map((r) => (
          <div key={r.id} className="card" style={{ position: 'relative' }}>
            <button
              aria-label="Remove from favorites"
              onClick={() => removeFavorite(r.id)}
              style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
            >
              ❤️
            </button>
            <button
              style={{ textAlign: 'left', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              onClick={() => onSelectRestaurant(r)}
            >
              <h3 style={{ fontSize: 17 }}>{r.name}</h3>
              <p className="muted" style={{ color: '#6b6156' }}>
                {Number(r.ratingAvg) > 0 && <>★ {Number(r.ratingAvg).toFixed(1)} ({r.ratingCount}) · </>}
                {r.cuisineType}
              </p>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
