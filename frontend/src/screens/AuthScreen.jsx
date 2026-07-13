import { useState } from 'react';
import { api } from '../api';
import LegalScreen from './LegalScreen';

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null); // null | 'terms' | 'privacy'

  if (legalDoc) {
    return <LegalScreen initialDoc={legalDoc} onBack={() => setLegalDoc(null)} />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result =
        mode === 'login' ? await api.login({ phone, password }) : await api.signup({ name, phone, password });
      api.setToken(result.accessToken);
      api.setStoredUser(result.user);
      onAuthed(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen" style={{ paddingTop: 40 }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div className="display" style={{ fontSize: 40, color: 'var(--turmeric)' }}>
          MannaDash
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Hyderabad's food, delivered hot</p>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 20, marginBottom: 16 }}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>

        {error && <div className="error-banner" style={{ background: 'rgba(228,87,46,0.1)', color: 'var(--chili-dark)', border: '1px solid var(--chili)' }}>{error}</div>}

        <form onSubmit={handleSubmit} className="stack">
          {mode === 'signup' && (
            <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required style={{ background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }} />
          )}
          <input
            placeholder="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            style={{ background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
          />
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </form>

        {mode === 'signup' && (
          <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            By signing up, you agree to our{' '}
            <button
              type="button"
              onClick={() => setLegalDoc('terms')}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--chili-dark)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Terms of Service
            </button>{' '}
            and{' '}
            <button
              type="button"
              onClick={() => setLegalDoc('privacy')}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--chili-dark)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Privacy Policy
            </button>
            .
          </p>
        )}

        <button
          className="btn-secondary"
          style={{ width: '100%', marginTop: 12, border: 'none', color: 'var(--chili-dark)' }}
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login' ? "New here? Create an account" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
