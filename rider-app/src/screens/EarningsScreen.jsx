import { useEffect, useState } from 'react';
import { api } from '../api';

export default function EarningsScreen() {
  const [earnings, setEarnings] = useState(null);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwChanged, setPwChanged] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  async function changePassword() {
    setPwError('');
    setChangingPw(true);
    try {
      await api.changePassword({ currentPassword: currentPw, newPassword: newPw });
      setCurrentPw('');
      setNewPw('');
      setPwChanged(true);
      setTimeout(() => setPwChanged(false), 3000);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setChangingPw(false);
    }
  }
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMyEarnings().then(setEarnings).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!earnings) {
    return (
      <div>
        <div className="skeleton-card" style={{ textAlign: 'center' }}>
          <div className="skeleton-block" style={{ height: 12, width: '40%', margin: '0 auto 10px' }} />
          <div className="skeleton-block" style={{ height: 34, width: '55%', margin: '0 auto' }} />
        </div>
        <div className="skeleton-card" style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="skeleton-block" style={{ height: 12, width: '70%', margin: '0 auto 8px' }} />
            <div className="skeleton-block" style={{ height: 20, width: '40%', margin: '0 auto' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="skeleton-block" style={{ height: 12, width: '70%', margin: '0 auto 8px' }} />
            <div className="skeleton-block" style={{ height: 20, width: '40%', margin: '0 auto' }} />
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div className="skeleton-card" key={i}>
            <div className="skeleton-block" style={{ height: 15, width: '45%', marginBottom: 8 }} />
            <div className="skeleton-block" style={{ height: 12, width: '65%' }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
        <p style={{ margin: '0 0 4px', color: '#8a8378', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Earned today
        </p>
        <p style={{ fontSize: 36, fontWeight: 700, margin: 0, color: 'var(--curry)' }}>₹{earnings.todayTotal.toFixed(0)}</p>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid #e5ddc9', paddingRight: 12 }}>
          <p style={{ margin: '0 0 4px', color: '#8a8378', fontSize: 12 }}>Lifetime earnings</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>₹{earnings.lifetimeTotal.toFixed(0)}</p>
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', color: '#8a8378', fontSize: 12 }}>Deliveries</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{earnings.deliveryCount}</p>
        </div>
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Recent deliveries</h2>
      {earnings.history.length === 0 && <p className="muted">No deliveries yet.</p>}
      <div className="stack">
        {earnings.history.map((h) => (
          <div key={h.orderId} className="card">
            <div className="row">
              <div>
                <p style={{ margin: 0, fontWeight: 600 }}>{h.restaurantName}</p>
                <p style={{ margin: '2px 0 0', color: '#8a8378', fontSize: 13 }}>
                  {new Date(h.deliveredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {new Date(h.deliveredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {h.tipAmount > 0 && <> · 🎁 ₹{h.tipAmount.toFixed(0)} tip</>}
                </p>
              </div>
              <strong style={{ color: 'var(--curry)', fontSize: 17 }}>+₹{h.amount.toFixed(0)}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontWeight: 700, margin: '0 0 8px' }}>Change password</p>
        {pwError && <div className="error-banner">{pwError}</div>}
        <div className="stack">
          <input placeholder="Current password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
          <input placeholder="New password (min 6 characters)" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={changePassword} disabled={changingPw || !currentPw || newPw.length < 6}>
              {changingPw ? 'Changing…' : 'Change password'}
            </button>
            {pwChanged && <span style={{ color: 'var(--curry)', fontWeight: 600, fontSize: 14 }}>✓ Changed</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
