import { useState } from 'react';
import { api } from '../api';

export default function LoginScreen({ onAuthed }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login({ username, password });
      api.setToken(result.accessToken);
      api.setStoredAdmin(result.admin);
      onAuthed(result.admin);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell" style={{ maxWidth: 380, paddingTop: 80 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 30, color: 'var(--turmeric)' }}>
          MannaDash Admin
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Operations control</p>
      </div>

      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit} className="stack">
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
