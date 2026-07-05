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
                </p>
              </div>
              <strong style={{ color: 'var(--curry)', fontSize: 17 }}>+₹{h.amount.toFixed(0)}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
