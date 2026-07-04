import { useState } from 'react';
import { api } from '../api';

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Login fields
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  // Register fields
  const [ownerName, setOwnerName] = useState('');
  const [name, setName] = useState('');
  const [cuisineType, setCuisineType] = useState('');
  const [address, setAddress] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login({ phone, password });
      api.setToken(result.accessToken);
      api.setStoredRestaurant(result.restaurant);
      onAuthed(result.restaurant);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Hyderabad center default — real address geocoding would replace this in production
      const restaurant = await api.registerRestaurant({
        ownerName,
        name,
        cuisineType,
        address,
        latitude: 17.4435,
        longitude: 78.3772,
        phone: regPhone,
      });
      const claimed = await api.claimRestaurant({ restaurantId: restaurant.id, password: regPassword });
      api.setToken(claimed.accessToken);
      api.setStoredRestaurant(claimed.restaurant);
      onAuthed(claimed.restaurant);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell" style={{ paddingTop: 60, maxWidth: 440 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 32, color: 'var(--chili)' }}>
          MannaDash for Restaurants
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Manage your menu and orders</p>
      </div>

      <div className="tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register restaurant</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="stack">
            <input placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : 'Log in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="stack">
            <input placeholder="Your name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
            <input placeholder="Restaurant name" value={name} onChange={(e) => setName(e.target.value)} required />
            <input placeholder="Cuisine type (e.g. Biryani)" value={cuisineType} onChange={(e) => setCuisineType(e.target.value)} required />
            <input placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} required />
            <input placeholder="Phone number" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} required />
            <input placeholder="Choose a password" type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Registering…' : 'Register & continue'}
            </button>
            <p className="muted">Your restaurant will need admin approval before it appears to customers — you can self-approve from the dashboard for testing.</p>
          </form>
        )}
      </div>
    </div>
  );
}
