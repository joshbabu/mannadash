import { useState } from 'react';
import { api } from '../api';

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [vehicleType, setVehicleType] = useState('bike');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result =
        mode === 'login' ? await api.login({ phone, password }) : await api.signup({ name, phone, password, vehicleType });
      api.setToken(result.accessToken);
      api.setStoredRider(result.rider);
      onAuthed(result.rider);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell" style={{ paddingTop: 60 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 34, color: 'var(--curry)' }}>
          MannaDash Rider
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Deliver orders, earn on your schedule</p>
      </div>

      <div className="card">
        <div
          className="row"
          style={{ marginBottom: 16, background: '#f4f1ea', borderRadius: 12, padding: 4, gap: 4 }}
        >
          <button
            style={{
              flex: 1, padding: '10px 0', borderRadius: 9, fontWeight: 700, fontSize: 14,
              background: mode === 'login' ? 'var(--accent-gradient)' : 'transparent',
              color: mode === 'login' ? '#fff' : 'var(--charcoal)',
              boxShadow: mode === 'login' ? '0 4px 10px rgba(0,0,0,0.25)' : 'none',
              transition: 'all 0.15s ease',
            }}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            style={{
              flex: 1, padding: '10px 0', borderRadius: 9, fontWeight: 700, fontSize: 14,
              background: mode === 'signup' ? 'var(--accent-gradient)' : 'transparent',
              color: mode === 'signup' ? '#fff' : 'var(--charcoal)',
              boxShadow: mode === 'signup' ? '0 4px 10px rgba(0,0,0,0.25)' : 'none',
              transition: 'all 0.15s ease',
            }}
            onClick={() => setMode('signup')}
          >
            Sign up
          </button>
        </div>

        {error && <div className="error-banner" style={{ background: 'rgba(228,87,46,0.1)', color: 'var(--chili)', border: '1px solid var(--chili)' }}>{error}</div>}

        <form onSubmit={handleSubmit} className="stack">
          {mode === 'signup' && (
            <>
              <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required style={{ background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }} />
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} style={{ background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', borderRadius: 10, padding: 12 }}>
                <option value="bike">Bike</option>
                <option value="scooter">Scooter</option>
                <option value="bicycle">Bicycle</option>
              </select>
            </>
          )}
          <input placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} required style={{ background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }} />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }} />
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </form>

        {mode === 'signup' && (
          <p className="muted" style={{ marginTop: 12 }}>
            New accounts need verification before you can go online — ask your ops contact to verify you.
          </p>
        )}
      </div>
    </div>
  );
}
