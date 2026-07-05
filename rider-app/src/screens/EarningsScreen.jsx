import { useEffect, useState } from 'react';
import { api } from '../api';

export default function EarningsScreen() {
  const [earnings, setEarnings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMyEarnings().then(setEarnings).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!earnings) return <p className="muted">Loading your earnings…</p>;

  return (
    <div>
      <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
        <p className="muted" style={{ marginBottom: 4 }}>Today</p>
        <p style={{ fontSize: 32, fontWeight: 700, margin: 0, color: 'var(--curry)' }}>₹{earnings.todayTotal.toFixed(0)}</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <span className="muted">Lifetime earnings</span>
          <strong>₹{earnings.lifetimeTotal.toFixed(0)}</strong>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">Total deliveries</span>
          <strong>{earnings.deliveryCount}</strong>
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
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  {new Date(h.deliveredAt).toLocaleDateString()} · {new Date(h.deliveredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              <strong style={{ color: 'var(--curry)' }}>+₹{h.amount.toFixed(0)}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
